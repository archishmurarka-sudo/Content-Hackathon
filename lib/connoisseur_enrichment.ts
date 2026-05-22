// Enrichment helpers that bundle several Connoisseur MCP calls into typed
// payloads ready to inject into Gemini prompts (scripts + briefs pipelines).
//
// All calls are run in parallel and are individually soft-failed: if a tool
// errors or returns nothing, we leave that section out rather than blocking
// generation. The MCP being down should never block a script/brief render.

import { callTool, extractToolJson } from "./connoisseur";
import type { Product } from "./data";

export type VoiceAtom = {
  atom_id?: number;
  phrase: string;
  category?: string | null;
  approved?: boolean | null;
};

export type SellingPoint = {
  point: string;
  mechanism?: string | null;
  source?: string | null;
};

export type WinnerCombo = {
  combo: string;
  evidence?: string | null;
  performance?: string | null;
};

export type ComplianceGate = {
  // The actual phrase or pattern that triggers the gate (e.g. "clinically lowers")
  pattern: string;
  severity: string; // "block" | "warn" | other
  gate_type?: string | null; // e.g. "banned_claim"
  safer_alternative?: string | null;
  rationale?: string | null;
};

export type ArchetypePerf = {
  archetype: string;
  performance?: string | null;
  notes?: string | null;
};

export type ScriptEnrichment = {
  brand_slug: string;
  voice_atoms: VoiceAtom[];
  selling_points: SellingPoint[];
  winner_combos: WinnerCombo[];
  compliance_gates: ComplianceGate[];
  archetype_performance: ArchetypePerf[];
  // Diagnostic — which tools came back empty / errored, useful for the UI badge.
  tool_status: Record<string, "ok" | "empty" | "error">;
};

// AshwaMag is the canonical Connoisseur brand. RootLabs sister-products map
// onto it for now (same corpus); add overrides here as more brands onboard.
const BRAND_SLUG_MAP: Record<string, string> = {
  "ashwamag": "ashwamag",
  "mag ashwa": "ashwamag",
  "magashwa": "ashwamag",
  "rootlabs": "ashwamag",
  "root labs": "ashwamag",
};

export function brandSlugForProduct(product: Pick<Product, "brand" | "name">): string {
  const candidates = [product.brand, product.name].filter(Boolean).map((s) => String(s).toLowerCase().trim());
  for (const c of candidates) {
    if (BRAND_SLUG_MAP[c]) return BRAND_SLUG_MAP[c];
  }
  return "ashwamag";
}

// Run a single tool with both possible arg shapes, swallow errors, normalize
// the return type. Connoisseur tools sometimes return a top-level array and
// sometimes a {result: <array>} wrapper — extractToolJson handles the SSE
// envelope but we still need to unwrap one extra layer.
async function safeCallList(toolName: string, args: Record<string, any>, status: Record<string, "ok" | "empty" | "error">): Promise<any[]> {
  try {
    const result = await callTool(toolName, args);
    let j: any = extractToolJson(result);
    if (j && typeof j === "object" && !Array.isArray(j) && "result" in j) {
      // Some tools return { result: <stringified-array> }
      j = typeof j.result === "string" ? JSON.parse(j.result) : j.result;
    }
    if (typeof j === "string") {
      try { j = JSON.parse(j); } catch { /* keep as string */ }
    }
    if (!Array.isArray(j)) {
      status[toolName] = j == null ? "empty" : "ok";
      return Array.isArray(j) ? j : [];
    }
    status[toolName] = j.length === 0 ? "empty" : "ok";
    return j;
  } catch (err) {
    status[toolName] = "error";
    return [];
  }
}

export async function fetchScriptEnrichment(product: Product, opts?: { limit?: number; brand_slug_override?: string }): Promise<ScriptEnrichment> {
  // When the caller knows the exact corpus slug (e.g. /api/connoisseur/preview
  // for an arbitrary brand), let them bypass the product-name mapper.
  const slug = opts?.brand_slug_override?.trim() || brandSlugForProduct(product);
  const limit = opts?.limit ?? 20;
  const status: Record<string, "ok" | "empty" | "error"> = {};

  const [voiceRaw, sellingRaw, winnersRaw, gatesRaw, archetypeRaw] = await Promise.all([
    safeCallList("get_voice_atoms", { brand_slug: slug, limit }, status),
    safeCallList("get_selling_points", { brand_slug: slug }, status),
    safeCallList("get_winner_combos", { brand_slug: slug }, status),
    safeCallList("get_compliance_gates", { brand_slug: slug }, status),
    safeCallList("get_archetype_performance", { brand_slug: slug }, status),
  ]);

  return {
    brand_slug: slug,
    voice_atoms: voiceRaw
      .filter((r) => r?.approved !== false)
      .map((r) => ({ atom_id: r.atom_id, phrase: String(r.phrase ?? r.text ?? ""), category: r.category ?? null, approved: r.approved })),
    selling_points: sellingRaw.map((r) => {
      // Shape: { sp_id, pain_point, ingredient, selling_point, evidence_basis, compliance_status }
      const point = String(r.selling_point ?? r.point ?? r.phrase ?? r.text ?? "");
      const mechanism = r.ingredient ? `${r.ingredient}${r.evidence_basis ? ` · ${r.evidence_basis}` : ""}` : (r.mechanism ?? null);
      return { point, mechanism, source: r.source ?? r.evidence_basis ?? null };
    }),
    winner_combos: winnersRaw.map((r) => {
      // Shape: { combo_id, narrative, hook, format, avg_gmv_usd, hold_rate_2s, n_videos, notes }
      const dims = [r.narrative && `narrative=${r.narrative}`, r.hook && `hook=${r.hook}`, r.format && `format=${r.format}`].filter(Boolean).join(" · ");
      const combo = dims || String(r.combo ?? r.pattern ?? r.combination ?? r.name ?? "(unspecified)");
      const performance = r.avg_gmv_usd ? `$${Number(r.avg_gmv_usd).toLocaleString()} avg GMV${r.hold_rate_2s ? `, ${r.hold_rate_2s}% 2s-hold` : ""}` : (r.performance ?? r.score ?? null);
      return { combo, evidence: r.notes ?? r.evidence ?? null, performance };
    }),
    compliance_gates: gatesRaw.map((r) => ({
      // Shape: { gate_id, gate_type, pattern, severity, safer_alternative, rationale, source }
      pattern: String(r.pattern ?? r.rule ?? r.phrase ?? r.text ?? ""),
      severity: String(r.severity ?? r.level ?? "warn"),
      gate_type: r.gate_type ?? null,
      safer_alternative: r.safer_alternative ?? null,
      rationale: r.rationale ?? null,
    })).filter((g) => g.pattern),
    archetype_performance: archetypeRaw.map((r) => {
      // Shape: { archetype, avg_gmv_usd, hold_rate_2s, n_videos, source, notes }
      const performance = r.avg_gmv_usd ? `$${Number(r.avg_gmv_usd).toLocaleString()} avg GMV${r.n_videos ? `, n=${r.n_videos}` : ""}` : (r.performance ?? r.score ?? null);
      return { archetype: String(r.archetype ?? r.name ?? ""), performance, notes: r.notes ?? null };
    }),
    tool_status: status,
  };
}

// Decide what enrichment to use for a generation request body. Honors:
//   1. enabled flag (`enrich_with_connoisseur: false` → no enrichment)
//   2. operator-supplied override blob (`enrichment_override`) — the panel
//      sends this when the operator has hand-picked priority items, so we
//      use it as-is and skip the MCP fetch
//   3. otherwise → live fetch from the MCP for this product's brand
//
// Always soft-fails to undefined on MCP error.
export async function resolveEnrichmentFromBody(product: Product, body: any): Promise<ScriptEnrichment | undefined> {
  const enabled = body?.enrich_with_connoisseur !== false;
  if (!enabled) return undefined;
  const override = body?.enrichment_override;
  if (override && typeof override === "object" && Array.isArray(override.voice_atoms)) {
    return {
      brand_slug: String(override.brand_slug ?? brandSlugForProduct(product)),
      voice_atoms: Array.isArray(override.voice_atoms) ? override.voice_atoms : [],
      selling_points: Array.isArray(override.selling_points) ? override.selling_points : [],
      winner_combos: Array.isArray(override.winner_combos) ? override.winner_combos : [],
      compliance_gates: Array.isArray(override.compliance_gates) ? override.compliance_gates : [],
      archetype_performance: Array.isArray(override.archetype_performance) ? override.archetype_performance : [],
      tool_status: override.tool_status ?? {},
    };
  }
  return await fetchScriptEnrichment(product).catch(() => undefined);
}

// Render the enrichment as a prompt block. Kept here (not in the prompt
// builder) so the formatting stays consistent across scripts + briefs.
export function renderEnrichmentForPrompt(e: ScriptEnrichment): string {
  const parts: string[] = [];
  if (e.voice_atoms.length) {
    parts.push(
      `CONSUMER VOICE — verified Reddit/Amazon phrases from the Connoisseur corpus (brand: ${e.brand_slug}). Mirror the rhythm. Pull at least one phrase verbatim if it fits.\n` +
        e.voice_atoms.slice(0, 15).map((a) => `  - "${a.phrase}"${a.category ? ` [${a.category}]` : ""}`).join("\n"),
    );
  }
  if (e.selling_points.length) {
    parts.push(
      `SELLING POINTS — mechanism language verified for this brand. Every benefit you name must map to one of these:\n` +
        e.selling_points.slice(0, 12).map((s) => `  - ${s.point}${s.mechanism ? ` (mechanism: ${s.mechanism})` : ""}`).join("\n"),
    );
  }
  if (e.winner_combos.length) {
    parts.push(
      `WINNING PATTERNS — pattern combinations that have produced tenure-leading ads. Bias variants toward these:\n` +
        e.winner_combos.slice(0, 8).map((w) => `  - ${w.combo}${w.evidence ? ` — ${w.evidence}` : ""}`).join("\n"),
    );
  }
  if (e.compliance_gates.length) {
    parts.push(
      `COMPLIANCE GATES — canonical from the corpus, supersedes any inline rules. Do NOT use these phrases. If you'd naturally say them, use the safer alternative instead:\n` +
        e.compliance_gates.slice(0, 20).map((c) =>
          `  - [${c.severity}] avoid: "${c.pattern}"${c.safer_alternative ? ` → instead say: "${c.safer_alternative}"` : ""}${c.rationale ? ` (reason: ${c.rationale})` : ""}`
        ).join("\n"),
    );
  }
  if (e.archetype_performance.length) {
    parts.push(
      `ARCHETYPE PERFORMANCE — which creator archetypes lift for this brand. Bias casting / persona language toward the top performers:\n` +
        e.archetype_performance.slice(0, 10).map((a) => `  - ${a.archetype}${a.performance ? ` (${a.performance})` : ""}${a.notes ? ` — ${a.notes}` : ""}`).join("\n"),
    );
  }
  return parts.length === 0 ? "" : `LIVE INTELLIGENCE FROM THE CONNOISSEUR CORPUS\n\n${parts.join("\n\n")}`;
}

// Pre-ship gate for the BOF brief flow. The MCP exposes a `pre_ship_check`
// tool but it scores *existing corpus ads*, not arbitrary input text. So we
// do the actually useful thing locally: fetch the canonical compliance gates
// (`get_compliance_gates`) and pattern-match each gate's `pattern` against
// the brief's speech lines. Each hit becomes a flag with the gate's safer
// alternative suggestion. Soft-fails: MCP outage returns ok=false, passed=true.
export type PreShipFlag = {
  rule: string;
  severity: string;
  evidence?: string | null;
};

export async function preShipCheck(args: { brand_slug?: string; script_text: string; selling_points_used?: string[] }): Promise<{ flags: PreShipFlag[]; passed: boolean; ok: boolean }> {
  const slug = args.brand_slug ?? "ashwamag";
  const status: Record<string, "ok" | "empty" | "error"> = {};
  const gatesRaw = await safeCallList("get_compliance_gates", { brand_slug: slug }, status);
  if (status["get_compliance_gates"] === "error") {
    return { flags: [], passed: true, ok: false };
  }
  const gates = gatesRaw
    .map((r: any) => ({
      pattern: String(r.pattern ?? r.rule ?? r.phrase ?? r.text ?? "").trim(),
      severity: String(r.severity ?? r.level ?? "warn"),
      safer: r.safer_alternative ?? null,
      rationale: r.rationale ?? null,
    }))
    .filter((g) => g.pattern.length >= 3);

  const haystack = args.script_text.toLowerCase();
  const flags: PreShipFlag[] = [];
  for (const g of gates) {
    const needle = g.pattern.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) continue;
    // Lift a ±30-char window as evidence so the operator sees where it tripped.
    const start = Math.max(0, idx - 20);
    const end = Math.min(haystack.length, idx + needle.length + 20);
    const snippet = "…" + args.script_text.slice(start, end).replace(/\s+/g, " ").trim() + "…";
    flags.push({
      rule: `Avoid "${g.pattern}"${g.safer ? ` → use "${g.safer}"` : ""}${g.rationale ? ` (${g.rationale})` : ""}`,
      severity: g.severity,
      evidence: snippet,
    });
  }
  // Severity-based pass: any "block" → fail; warnings → pass with notes.
  const passed = !flags.some((f) => /block|hard|fail/i.test(f.severity));
  return { flags, passed, ok: true };
}
