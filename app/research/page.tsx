"use client";

// /research — passive corpus viewer (NOT a tool runner).
//
// Loads the full Connoisseur enrichment bundle for a brand (voice atoms +
// selling points + winner combos + compliance gates + archetype performance)
// and synthesises it into scannable cards.
//
// Operator can:
//   1. Switch brand to compare AshwaMag vs Cymbiotika vs Codeage etc.
//   2. Read the corpus directly — no "run a tool" workflow.
//   3. Tick items to build a "picks" basket.
//   4. Send the picks to the Scripts or Instagram surface as the prefilled
//      enrichment_override (via localStorage — the target page hydrates it
//      on mount and shows a "using picks from Research" banner).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, FileImage, ScrollText, ArrowRight, RefreshCw } from "lucide-react";
import { useToast } from "@/components/toast";

type Brand = { brand_slug: string; display_name: string; n_ads: number; is_self: boolean };

type VoiceAtom = { atom_id?: number; phrase: string; category?: string | null; approved?: boolean | null };
type SellingPoint = { point: string; mechanism?: string | null; source?: string | null };
type WinnerCombo = { combo: string; evidence?: string | null; performance?: string | null };
type ComplianceGate = { pattern: string; severity: string; gate_type?: string | null; safer_alternative?: string | null; rationale?: string | null };
type ArchetypePerf = { archetype: string; performance?: string | null; notes?: string | null };

type Preview = {
  brand_slug: string;
  voice_atoms: VoiceAtom[];
  selling_points: SellingPoint[];
  winner_combos: WinnerCombo[];
  compliance_gates: ComplianceGate[];
  archetype_performance: ArchetypePerf[];
  tool_status?: Record<string, string>;
};

// localStorage key for picks → cross-page handoff to Scripts / Instagram.
// Versioned so older selections don't crash newer schemas.
export const PICKS_STORAGE_KEY = "connoisseur_research_picks_v1";

export default function ResearchPage() {
  const toast = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandSlug, setBrandSlug] = useState("ashwamag");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-category sets of picked item keys.
  const [picked, setPicked] = useState<Record<string, Set<string>>>({
    voice_atoms: new Set(),
    selling_points: new Set(),
    winner_combos: new Set(),
    compliance_gates: new Set(),
    archetype_performance: new Set(),
  });

  // Load brands once on mount.
  useEffect(() => {
    fetch("/api/connoisseur/brands", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
      .catch(() => {});
  }, []);

  // Reload preview whenever brand changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/connoisseur/preview?brand_slug=${encodeURIComponent(brandSlug)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) { setError(d.error); setPreview(null); return; }
        setPreview(d as Preview);
        // Reset picks when brand changes — different corpora, different items.
        setPicked({
          voice_atoms: new Set(),
          selling_points: new Set(),
          winner_combos: new Set(),
          compliance_gates: new Set(),
          archetype_performance: new Set(),
        });
      })
      .catch((e) => !cancelled && setError(e?.message ?? "preview failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [brandSlug]);

  function togglePick(category: keyof typeof picked, key: string) {
    setPicked((prev) => {
      const next = new Set(prev[category]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [category]: next };
    });
  }

  function pickAllInCategory(category: keyof typeof picked, keys: string[]) {
    setPicked((prev) => ({ ...prev, [category]: new Set(keys) }));
  }

  function clearAllPicks() {
    setPicked({
      voice_atoms: new Set(),
      selling_points: new Set(),
      winner_combos: new Set(),
      compliance_gates: new Set(),
      archetype_performance: new Set(),
    });
  }

  const totalPicked = useMemo(
    () => Object.values(picked).reduce((sum, s) => sum + s.size, 0),
    [picked]
  );

  // Build the EnrichmentOverride-shape payload from the current picks, then
  // stash in localStorage and route the operator to the target surface.
  function sendPicksTo(target: "scripts" | "instagram") {
    if (!preview) return;
    if (totalPicked === 0) { toast.error("No picks selected", "Tick at least one item first."); return; }
    const overrideBlob = {
      brand_slug: preview.brand_slug,
      voice_atoms: preview.voice_atoms.filter((x) => picked.voice_atoms.has(x.phrase)),
      selling_points: preview.selling_points.filter((x) => picked.selling_points.has(x.point)),
      winner_combos: preview.winner_combos.filter((x) => picked.winner_combos.has(x.combo)),
      compliance_gates: preview.compliance_gates.filter((x) => picked.compliance_gates.has(x.pattern)),
      archetype_performance: preview.archetype_performance.filter((x) => picked.archetype_performance.has(x.archetype)),
      tool_status: preview.tool_status ?? {},
    };
    const payload = {
      brand_slug: preview.brand_slug,
      picked_at: Date.now(),
      total_picked: totalPicked,
      enrichment_override: overrideBlob,
    };
    try { localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(payload)); } catch {}
    toast.success(`Sent ${totalPicked} picks to ${target === "scripts" ? "Scripts" : "Instagram"}`, "The target page will use them on the next generate.");
    window.location.href = target === "scripts" ? "/scripts" : "/instagram";
  }

  // Light synthesis helpers — show category counts + top items so the page
  // tells the operator the SHAPE of the corpus before they read every row.
  const voiceCategoryCounts = useMemo(() => {
    if (!preview) return [];
    const counts: Record<string, number> = {};
    for (const v of preview.voice_atoms) {
      const k = v.category || "uncategorised";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [preview]);

  const gateSeverityCounts = useMemo(() => {
    if (!preview) return [];
    const counts: Record<string, number> = {};
    for (const g of preview.compliance_gates) {
      const k = g.severity || "unknown";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [preview]);

  const currentBrand = brands.find((b) => b.brand_slug === brandSlug);

  return (
    <div style={{ padding: "20px 28px", maxWidth: 1400, margin: "0 auto", paddingBottom: 100 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--font-fraunces)", fontSize: 28, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <BookOpen size={22} /> Research
        </h1>
        <p style={{ color: "var(--muted)", margin: "4px 0 0", fontSize: 13 }}>
          The Connoisseur corpus, brand by brand. Read it, pick what matters, send it as priority context into Scripts or Instagram.
        </p>
      </header>

      {/* Brand picker + stats */}
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
          Brand corpus
          <select
            value={brandSlug}
            onChange={(e) => setBrandSlug(e.target.value)}
            style={{ padding: "7px 12px", fontSize: 13, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", minWidth: 260 }}
          >
            {brands.length === 0 && <option value={brandSlug}>{brandSlug}</option>}
            {brands.map((b) => (
              <option key={b.brand_slug} value={b.brand_slug}>
                {b.display_name}{b.is_self ? " ★" : ""} · {b.n_ads} ads
              </option>
            ))}
          </select>
        </label>
        {currentBrand && (
          <div className="row" style={{ gap: 8 }}>
            {currentBrand.is_self && (
              <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }}>
                ★ self brand
              </span>
            )}
            <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
              {currentBrand.n_ads} ads in corpus
            </span>
          </div>
        )}
        <button
          onClick={() => setBrandSlug((s) => s)}
          disabled={loading}
          className="btn-ghost btn-sm"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ padding: 14, borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Synthesis row — counts + top distributions */}
      {preview && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
          <SynthCard label="Voice atoms" count={preview.voice_atoms.length} status={preview.tool_status?.get_voice_atoms} />
          <SynthCard label="Selling points" count={preview.selling_points.length} status={preview.tool_status?.get_selling_points} />
          <SynthCard label="Winner combos" count={preview.winner_combos.length} status={preview.tool_status?.get_winner_combos} />
          <SynthCard label="Compliance gates" count={preview.compliance_gates.length} status={preview.tool_status?.get_compliance_gates} subtitle={gateSeverityCounts.map(([s, n]) => `${n} ${s}`).join(" · ")} />
          <SynthCard label="Archetype performance" count={preview.archetype_performance.length} status={preview.tool_status?.get_archetype_performance} />
        </div>
      )}

      {/* Voice atom category distribution */}
      {voiceCategoryCounts.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Voice atoms by category</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {voiceCategoryCounts.map(([cat, n]) => (
              <span key={cat} className="badge" style={{ fontSize: 11 }}>
                {cat} · <strong>{n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Detail sections */}
      {preview && (
        <div className="col" style={{ gap: 16 }}>
          <Section
            title="Consumer voice atoms"
            subtitle="Reddit + Amazon sourced phrases. The cadence prompts mirror in scripts."
            items={preview.voice_atoms.map((x) => ({
              key: x.phrase,
              primary: x.phrase,
              secondary: x.category ?? null,
            }))}
            picked={picked.voice_atoms}
            onToggle={(k) => togglePick("voice_atoms", k)}
            onAll={() => pickAllInCategory("voice_atoms", preview.voice_atoms.map((x) => x.phrase))}
          />
          <Section
            title="Selling points"
            subtitle="Mechanism language verified for this brand. Each anchored to an ingredient."
            items={preview.selling_points.map((x) => ({
              key: x.point,
              primary: x.point,
              secondary: x.mechanism ?? null,
            }))}
            picked={picked.selling_points}
            onToggle={(k) => togglePick("selling_points", k)}
            onAll={() => pickAllInCategory("selling_points", preview.selling_points.map((x) => x.point))}
          />
          <Section
            title="Winner combos"
            subtitle="Pattern combinations that have driven tenure-leading ads (avg GMV labelled)."
            items={preview.winner_combos.map((x) => ({
              key: x.combo,
              primary: x.combo,
              secondary: x.performance ?? null,
              tertiary: x.evidence ?? null,
            }))}
            picked={picked.winner_combos}
            onToggle={(k) => togglePick("winner_combos", k)}
            onAll={() => pickAllInCategory("winner_combos", preview.winner_combos.map((x) => x.combo))}
          />
          <Section
            title="Compliance gates"
            subtitle="Banned phrases with safer alternatives. Surfaced to the model as hard rules."
            items={preview.compliance_gates.map((x) => ({
              key: x.pattern,
              primary: `avoid "${x.pattern}"`,
              secondary: x.safer_alternative ? `→ "${x.safer_alternative}"` : null,
              tertiary: x.rationale ?? null,
              severity: x.severity,
            }))}
            picked={picked.compliance_gates}
            onToggle={(k) => togglePick("compliance_gates", k)}
            onAll={() => pickAllInCategory("compliance_gates", preview.compliance_gates.map((x) => x.pattern))}
          />
          <Section
            title="Archetype performance"
            subtitle="Which creator archetypes lift for this brand."
            items={preview.archetype_performance.map((x) => ({
              key: x.archetype,
              primary: x.archetype,
              secondary: x.performance ?? null,
              tertiary: x.notes ?? null,
            }))}
            picked={picked.archetype_performance}
            onToggle={(k) => togglePick("archetype_performance", k)}
            onAll={() => pickAllInCategory("archetype_performance", preview.archetype_performance.map((x) => x.archetype))}
          />
        </div>
      )}

      {/* Sticky picks bar */}
      {totalPicked > 0 && (
        <div
          style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
            background: "var(--surface)", borderTop: "1px solid var(--border)",
            padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 16, flexWrap: "wrap", boxShadow: "0 -6px 24px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: "var(--accent)" }}>{totalPicked}</strong> picks · brand <code>{brandSlug}</code>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={clearAllPicks} className="btn-ghost btn-sm">Clear</button>
            <button
              onClick={() => sendPicksTo("scripts")}
              className="btn btn-primary btn-sm"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <ScrollText size={13} /> Use in Scripts <ArrowRight size={12} />
            </button>
            <button
              onClick={() => sendPicksTo("instagram")}
              className="btn btn-primary btn-sm"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <FileImage size={13} /> Use in Instagram <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SynthCard({ label, count, status, subtitle }: { label: string; count: number; status?: string; subtitle?: string }) {
  const ok = status === "ok";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4, fontFamily: "var(--font-fraunces)" }}>{count}</div>
      {subtitle && <div className="muted-sm" style={{ marginTop: 4, fontSize: 11 }}>{subtitle}</div>}
      {status && !ok && (
        <div className="muted-sm" style={{ marginTop: 4, fontSize: 10, color: "var(--muted-2)" }}>tool: {status}</div>
      )}
    </div>
  );
}

type SectionItem = { key: string; primary: string; secondary?: string | null; tertiary?: string | null; severity?: string };

function Section({
  title, subtitle, items, picked, onToggle, onAll,
}: {
  title: string;
  subtitle: string;
  items: SectionItem[];
  picked: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
}) {
  const pickedCount = items.filter((i) => picked.has(i.key)).length;
  if (items.length === 0) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div className="eyebrow">{title}</div>
        <p className="muted-sm" style={{ marginTop: 6 }}>No items for this brand.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div className="eyebrow">{title}</div>
          <p className="muted-sm" style={{ marginTop: 4 }}>{subtitle}</p>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted-sm" style={{ fontSize: 11 }}>{pickedCount} / {items.length} picked</span>
          <button onClick={onAll} className="btn-ghost btn-sm" style={{ fontSize: 11, padding: "3px 10px" }}>Pick all</button>
        </div>
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4, maxHeight: 380, overflowY: "auto" }}>
        {items.map((it) => {
          const isPicked = picked.has(it.key);
          return (
            <label
              key={it.key}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
                borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: isPicked ? "var(--accent-soft, rgba(108,76,181,0.12))" : "transparent",
                color: isPicked ? "var(--text)" : "var(--text-2)",
                border: `1px solid ${isPicked ? "var(--accent)" : "transparent"}`,
                transition: "background 100ms, border-color 100ms",
              }}
            >
              <input
                type="checkbox"
                checked={isPicked}
                onChange={() => onToggle(it.key)}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: isPicked ? 500 : 400 }}>
                  {it.severity && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: it.severity === "block" ? "var(--danger)" : "var(--muted)", marginRight: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      [{it.severity}]
                    </span>
                  )}
                  {it.primary}
                </div>
                {it.secondary && (
                  <div className="muted-sm" style={{ marginTop: 2, fontSize: 12 }}>{it.secondary}</div>
                )}
                {it.tertiary && (
                  <div className="muted-sm" style={{ marginTop: 2, fontSize: 11, color: "var(--muted-2)" }}>{it.tertiary}</div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
