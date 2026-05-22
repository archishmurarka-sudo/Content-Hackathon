"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, Sparkles, Package, Beaker } from "lucide-react";
import { useToast } from "@/components/toast";
import { ConnoisseurToggle } from "@/components/connoisseur-toggle";

type Product = {
  id: string;
  name: string;
  brand: string;
  one_liner: string;
  hero_image_url?: string | null;
};

type PainRow = { pain: string; gmv_label?: string; note?: string };

type ResearchBrief = {
  product: Product;
  research_brief: {
    one_liner: string;
    brand: string;
    pain_breakdown: PainRow[];
    pain_anchors: string[];
    consumer_quotes: string[];
    key_ingredients: string[];
    delivery_tech: string | null;
    format: string | null;
    price_band: string | null;
    audience_primary: string | null;
    audience_secondary: string | null;
  };
  counts: { pain_points: number; consumer_quotes: number; key_ingredients: number };
};

type AdScript = {
  id: string;
  script_kind: string;
  style?: string | null;
  placement?: string | null;
  source_ref: string | null;
  script_csv: Record<string, string>;
  approved: boolean;
  image_status?: "idle" | "pending" | "ready" | "failed";
  image_url?: string | null;
  image_prompt?: string | null;
  image_error?: string | null;
  video_status?: "idle" | "pending" | "ready" | "failed";
  video_url?: string | null;
  video_model?: string | null;
  video_error?: string | null;
  keyframes?: {
    idx: number;
    timestamp_s: number;
    voiceover: string;
    visual: string;
    image_url: string | null;
    image_prompt: string | null;
    status: "idle" | "pending" | "ready" | "failed";
    error: string | null;
  }[] | null;
  keyframes_status?: "idle" | "pending" | "ready" | "partial" | "failed";
  created_at: number;
};

type ScriptStyle = "problem_solution" | "testimonial" | "listicle" | "founder_story" | "before_after" | "mixed";

const STYLE_LABELS: Record<ScriptStyle, string> = {
  problem_solution: "Problem / Solution",
  testimonial: "Testimonial",
  listicle: "Listicle (3-reason format)",
  founder_story: "Founder story",
  before_after: "Before / After",
  mixed: "Mixed (variety pack)",
};

export default function ScriptsPage() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [scripts, setScripts] = useState<AdScript[]>([]);

  // Generator inputs (Meta-focused).
  // Locked to 1 script per generate while we validate the end-to-end loop —
  // a single Generate click costs ~$0.001 (Gemini script) + $0.21 (5 OpenAI
  // keyframes) + $0.80 (Veo render) = $1.01. Batch mode comes back once the
  // single-script path is proven.
  const scriptCount = 1;
  const [style, setStyle] = useState<ScriptStyle>("mixed");
  const [placement, setPlacement] = useState<"feed" | "reels" | "stories" | "mixed">("mixed");
  const [competitorRefs, setCompetitorRefs] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [perScriptImaging, setPerScriptImaging] = useState<Record<string, boolean>>({});
  const [perScriptVideoing, setPerScriptVideoing] = useState<Record<string, boolean>>({});
  const [perScriptKeyframing, setPerScriptKeyframing] = useState<Record<string, boolean>>({});

  // Diagnostic — the Connoisseur enrichment used on the most recent generate.
  // Populated from /api/scripts POST response so the operator can see which
  // tools fed the batch (and which were empty / errored).
  const [lastEnrichment, setLastEnrichment] = useState<{
    brand_slug: string;
    counts: { voice_atoms: number; selling_points: number; winner_combos: number; compliance_gates: number; archetype_performance: number };
    tool_status: Record<string, string>;
  } | null>(null);
  // Per-generation operator toggle — default ON.
  const [enrichWithConnoisseur, setEnrichWithConnoisseur] = useState(true);

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setProducts(d.products ?? []);
        if (!selectedProductId && d.products?.length) {
          setSelectedProductId(d.products[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    setBriefLoading(true);
    setBrief(null);
    Promise.all([
      fetch(`/api/scripts/research-brief?product_id=${encodeURIComponent(selectedProductId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/scripts?product_id=${encodeURIComponent(selectedProductId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([b, s]) => {
        if (b) setBrief(b);
        if (s) setScripts(s.scripts ?? []);
      })
      .catch(() => {})
      .finally(() => setBriefLoading(false));
  }, [selectedProductId]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  async function generate() {
    if (!selectedProductId || !brief) return;
    setGenerating(true);
    const res = await fetch("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: selectedProductId,
        count: scriptCount,
        style,
        placement,
        competitor_refs: competitorRefs.trim() || undefined,
        notes: extraNotes.trim() || undefined,
        enrich_with_connoisseur: enrichWithConnoisseur,
      }),
    });
    setGenerating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Generation failed", data?.error ?? `HTTP ${res.status}`);
      return;
    }
    setLastEnrichment(data?.enrichment ?? null);
    const e = data?.enrichment;
    const enrichSummary = e
      ? `Enriched by Connoisseur (${e.counts.voice_atoms} voice atoms, ${e.counts.selling_points} selling points, ${e.counts.compliance_gates} gates)`
      : enrichWithConnoisseur
        ? `Saved to ${selectedProduct?.name} (Connoisseur enrichment skipped — MCP empty or unreachable)`
        : `Saved to ${selectedProduct?.name} (Connoisseur disabled)`;
    toast.success(`Generated ${data?.count ?? 0} scripts`, enrichSummary);
    // Refresh the list.
    fetch(`/api/scripts?product_id=${encodeURIComponent(selectedProductId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setScripts(d.scripts ?? []))
      .catch(() => {});
  }

  async function toggleApprove(id: string, approved: boolean) {
    const res = await fetch(`/api/scripts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    if (!res.ok) {
      toast.error("Couldn't update", `HTTP ${res.status}`);
      return;
    }
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, approved } : s)));
  }

  async function removeScript(id: string) {
    if (!confirm("Delete this script?")) return;
    const res = await fetch(`/api/scripts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete", `HTTP ${res.status}`);
      return;
    }
    setScripts((prev) => prev.filter((s) => s.id !== id));
  }

  function downloadCsv(onlyApproved: boolean) {
    if (!selectedProductId) return;
    const url = `/api/scripts/export?product_id=${encodeURIComponent(selectedProductId)}${onlyApproved ? "&only_approved=1" : ""}`;
    window.location.href = url;
  }

  // While any image / video / keyframe is pending, poll every 4s so the UI
  // catches up. Keyframes stream in one at a time as each OpenAI call lands,
  // so the polling makes them appear progressively.
  useEffect(() => {
    const pending = scripts.some(
      (s) =>
        s.image_status === "pending" ||
        s.video_status === "pending" ||
        s.keyframes_status === "pending"
    );
    if (!pending) return;
    const t = setInterval(() => {
      refreshScripts();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts]);

  async function refreshScripts() {
    if (!selectedProductId) return;
    const r = await fetch(`/api/scripts?product_id=${encodeURIComponent(selectedProductId)}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setScripts(d.scripts ?? []);
  }

  async function generateOneImage(id: string) {
    setPerScriptImaging((m) => ({ ...m, [id]: true }));
    // Optimistic — flip the local row to pending so the UI shows a spinner.
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, image_status: "pending", image_error: null } : s)));
    const res = await fetch(`/api/scripts/${encodeURIComponent(id)}/image`, { method: "POST" });
    setPerScriptImaging((m) => ({ ...m, [id]: false }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Image generation failed", data?.error ?? `HTTP ${res.status}`);
    }
    refreshScripts();
  }

  async function generateOneVideo(id: string) {
    setPerScriptVideoing((m) => ({ ...m, [id]: true }));
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, video_status: "pending", video_error: null } : s)));
    const res = await fetch(`/api/scripts/${encodeURIComponent(id)}/video`, { method: "POST" });
    setPerScriptVideoing((m) => ({ ...m, [id]: false }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Video generation failed", data?.error ?? `HTTP ${res.status}`);
    }
    refreshScripts();
  }

  // Keyframes: 5-image storyboard per script. Each script gets ONE Gemini
  // decomposition call (~$0.001) + 5 OpenAI gpt-image-2 calls (~$0.21) =
  // ~$0.21 per script. The first keyframe doubles as the row's lead image,
  // so the existing Veo first-frame path picks it up unchanged.
  async function generateKeyframes(id: string) {
    if (!confirm("Generate a 5-keyframe storyboard for this script via OpenAI gpt-image-2 (~$0.21)?")) return;
    setPerScriptKeyframing((m) => ({ ...m, [id]: true }));
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, keyframes_status: "pending", keyframes: null } : s))
    );
    const res = await fetch(`/api/scripts/${encodeURIComponent(id)}/keyframes`, { method: "POST" });
    setPerScriptKeyframing((m) => ({ ...m, [id]: false }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Keyframes failed", data?.error ?? `HTTP ${res.status}`);
    } else {
      toast.success(`Storyboard ready`, `${data?.ready ?? 0}/${data?.total ?? 0} keyframes`);
    }
    refreshScripts();
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Meta ads</span>
          <h1 style={{ marginTop: 6 }}>Direct-response scripts</h1>
          <p className="muted-sm" style={{ marginTop: 6, maxWidth: 620 }}>
            Generates Meta ad scripts (Feed / Reels / Stories) grounded in the product's pain breakdown,
            consumer voice, and ingredient claims. Brand-agnostic on the output side — write a script,
            cast a creator later.
          </p>
        </div>
      </div>

      {/* Product picker */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <span className="eyebrow">Product</span>
        </div>
        <div style={{ display: "flex", gap: 8, padding: 12, overflowX: "auto" }}>
          {products.length === 0 && <p className="muted-sm" style={{ padding: 8 }}>Loading products…</p>}
          {products.map((p) => {
            const active = p.id === selectedProductId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProductId(p.id)}
                className={active ? "" : "btn-ghost"}
                style={{ flexShrink: 0, padding: "8px 14px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {briefLoading && (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
          Loading product research…
        </div>
      )}

      {!briefLoading && brief && (
        <>
          {/* Product card */}
          <div className="card" style={{ marginBottom: 20, display: "flex", gap: 16, alignItems: "center" }}>
            {selectedProduct?.hero_image_url && (
              <img
                src={selectedProduct.hero_image_url}
                alt={selectedProduct.name}
                style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow">{brief.research_brief.brand}</div>
              <h2 style={{ marginTop: 4 }}>{selectedProduct?.name}</h2>
              <p className="muted-sm" style={{ marginTop: 4, maxWidth: 720 }}>{brief.research_brief.one_liner}</p>
              <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                {brief.research_brief.format && <Tag>{brief.research_brief.format}</Tag>}
                {brief.research_brief.price_band && <Tag>{brief.research_brief.price_band}</Tag>}
                {brief.research_brief.audience_primary && <Tag>👥 {brief.research_brief.audience_primary}</Tag>}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
            <Kpi icon={<Sparkles size={14} />} label="Pain points" value={String(brief.counts.pain_points)} sub="grounding for hooks" />
            <Kpi icon={<FileText size={14} />} label="Consumer quotes" value={String(brief.counts.consumer_quotes)} sub="verbatim user voice" />
            <Kpi icon={<Beaker size={14} />} label="Key ingredients" value={String(brief.counts.key_ingredients)} sub="fact-check anchor" />
          </div>

          {/* Research brief */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, marginBottom: 24 }}>
            <section className="card">
              <span className="eyebrow">Pain breakdown</span>
              <h2 style={{ marginTop: 4, marginBottom: 12 }}>What buyers struggle with</h2>
              {brief.research_brief.pain_breakdown.length === 0 ? (
                <p className="muted-sm">No pain breakdown on this product yet — add one on the Products tab to enrich script generation.</p>
              ) : (
                <table>
                  <thead><tr><th>Pain</th><th>Tracked GMV</th><th>Context</th></tr></thead>
                  <tbody>
                    {brief.research_brief.pain_breakdown.map((p) => (
                      <tr key={p.pain}>
                        <td style={{ fontWeight: 600 }}>{p.pain}</td>
                        <td className="mono">{p.gmv_label ?? "—"}</td>
                        <td className="muted-sm">{p.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <span className="eyebrow">Consumer voice</span>
              <h2 style={{ marginTop: 4, marginBottom: 12 }}>Verbatim language</h2>
              {brief.research_brief.consumer_quotes.length === 0 ? (
                <p className="muted-sm">No quotes captured yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {brief.research_brief.consumer_quotes.map((q, i) => (
                    <div
                      key={i}
                      className="muted"
                      style={{
                        fontStyle: "italic",
                        fontFamily: "var(--font-fraunces, var(--font-serif))",
                        fontSize: 16,
                        lineHeight: 1.3,
                        borderLeft: "2px solid var(--border-strong)",
                        paddingLeft: 10,
                      }}
                    >
                      “{q}”
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Ingredients / fact-check anchor */}
          {brief.research_brief.key_ingredients.length > 0 && (
            <section className="card" style={{ marginBottom: 24 }}>
              <span className="eyebrow">Fact-check anchor</span>
              <h2 style={{ marginTop: 4, marginBottom: 10 }}>Ingredients we can credibly claim</h2>
              <p className="muted-sm" style={{ marginBottom: 12 }}>
                These get passed to the generator so every script claim maps to a real ingredient (no hallucinated benefits).
              </p>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {brief.research_brief.key_ingredients.map((ing) => (
                  <span key={ing} className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)", textTransform: "none" }}>
                    {ing}
                  </span>
                ))}
              </div>
              {brief.research_brief.delivery_tech && (
                <p className="muted-sm" style={{ marginTop: 12 }}>
                  <strong style={{ color: "var(--text-2)" }}>Delivery:</strong> {brief.research_brief.delivery_tech}
                </p>
              )}
            </section>
          )}

          {/* Generator panel — Meta-specific knobs */}
          <div className="card" style={{ marginBottom: 24, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <span className="eyebrow" style={{ color: "var(--accent)" }}>Generate</span>
                <h2 style={{ marginTop: 4 }}>Spin Meta scripts from this brief</h2>
                <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
                  Each script outputs as a 10-column CSV row: Section, Building Block, Voiceover, Recording Style,
                  Production, Editor Note, Text on Screen, Visual Ref, Execution Type, Ref URL. Casting and creator
                  selection happen downstream — these are placement-agnostic scripts.
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
              <div>
                <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Style</label>
                <select value={style} onChange={(e) => setStyle(e.target.value as ScriptStyle)} style={{ width: "100%" }}>
                  {(Object.keys(STYLE_LABELS) as ScriptStyle[]).map((k) => (
                    <option key={k} value={k}>{STYLE_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Placement</label>
                <select value={placement} onChange={(e) => setPlacement(e.target.value as any)} style={{ width: "100%" }}>
                  <option value="mixed">Mixed (Feed + Reels)</option>
                  <option value="feed">Feed (4:5 or 1:1)</option>
                  <option value="reels">Reels (9:16)</option>
                  <option value="stories">Stories (9:16)</option>
                </select>
              </div>
            </div>
            <p className="muted-sm" style={{ marginTop: 10, fontSize: 12 }}>
              <strong style={{ color: "var(--text-2)" }}>Single-script mode:</strong> each Generate click produces one script with 5 keyframe images for visual QA, then an 8s Veo video on demand. Batch mode is paused while we validate the loop end-to-end.
            </p>

            <div style={{ marginTop: 14 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>
                Competitor ad references <span style={{ opacity: 0.6 }}>(optional — paste Meta Ads Library URLs or transcripts, one per line)</span>
              </label>
              <textarea
                value={competitorRefs}
                onChange={(e) => setCompetitorRefs(e.target.value)}
                rows={3}
                placeholder="https://facebook.com/ads/library/?id=...&#10;Or paste the transcript of a winning ad you want to swipe…"
                style={{ width: "100%", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)", fontSize: 12 }}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>
                Notes for the generator <span style={{ opacity: 0.6 }}>(optional — promo, offer, angle to push)</span>
              </label>
              <textarea
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                rows={2}
                placeholder="e.g. 25% off bundle this week, lean into sleep angle for Mother's Day, avoid medical claims…"
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>

            <div className="row" style={{ marginTop: 14, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <ConnoisseurToggle
                enabled={enrichWithConnoisseur}
                onChange={setEnrichWithConnoisseur}
                lastSummary={lastEnrichment
                  ? `${lastEnrichment.brand_slug} · ${lastEnrichment.counts.voice_atoms} atoms · ${lastEnrichment.counts.selling_points} SP · ${lastEnrichment.counts.compliance_gates} gates`
                  : null}
              />
              <button onClick={generate} disabled={generating || !selectedProductId}>
                {generating ? "Generating…" : <>Generate {scriptCount} <ArrowRight size={14} /></>}
              </button>
            </div>
          </div>

          {/* Scripts table */}
          <section>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <div>
                <span className="eyebrow">Output</span>
                <h2 style={{ marginTop: 4 }}>Scripts for {selectedProduct?.name} <span className="muted-sm" style={{ fontWeight: 400 }}>· {scripts.length} total</span></h2>
              </div>
              {scripts.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="btn-ghost btn-sm" onClick={() => downloadCsv(true)} title="Approved scripts only">
                    ↓ Approved CSV
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => downloadCsv(false)}>
                    ↓ All CSV
                  </button>
                </div>
              )}
            </div>
            {scripts.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                No scripts generated yet. The brief above is ready — click <strong style={{ color: "var(--text-2)" }}>Generate</strong> to spin a batch.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {scripts.map((s, i) => (
                  <ScriptCard
                    key={s.id}
                    index={i + 1}
                    script={s}
                    onToggle={() => toggleApprove(s.id, !s.approved)}
                    onDelete={() => removeScript(s.id)}
                    onGenerateImage={() => generateOneImage(s.id)}
                    onGenerateVideo={() => generateOneVideo(s.id)}
                    onGenerateKeyframes={() => generateKeyframes(s.id)}
                    imagingBusy={Boolean(perScriptImaging[s.id])}
                    videoingBusy={Boolean(perScriptVideoing[s.id])}
                    keyframingBusy={Boolean(perScriptKeyframing[s.id])}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {!briefLoading && !brief && selectedProductId && (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
          Couldn't load the brief for this product.
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", color: "var(--muted)", marginBottom: 8 }}>
        {icon}<span className="stat-label" style={{ letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="muted-sm" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)", textTransform: "none" }}>
      {children}
    </span>
  );
}

function ScriptCard({
  index,
  script,
  onToggle,
  onDelete,
  onGenerateImage,
  onGenerateVideo,
  onGenerateKeyframes,
  imagingBusy,
  videoingBusy,
  keyframingBusy,
}: {
  index: number;
  script: AdScript;
  onToggle: () => void;
  onDelete: () => void;
  onGenerateImage: () => void;
  onGenerateVideo: () => void;
  onGenerateKeyframes: () => void;
  imagingBusy: boolean;
  videoingBusy: boolean;
  keyframingBusy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const csv = script.script_csv ?? {};
  const imgStatus = script.image_status ?? "idle";
  const vidStatus = script.video_status ?? "idle";
  const kfStatus = script.keyframes_status ?? "idle";
  const keyframes = script.keyframes ?? [];
  const hasKeyframes = keyframes.length > 0;
  const isPortrait = script.placement !== "feed";
  const imgAspect = isPortrait ? "9/16" : "1/1";
  const imageDownloadName = `script_${String(index).padStart(2, "0")}.png`;
  const videoDownloadName = `script_${String(index).padStart(2, "0")}.mp4`;

  return (
    <div className="card" style={{ padding: 14, borderColor: script.approved ? "var(--accent)" : "var(--border)", background: script.approved ? "var(--accent-soft)" : undefined }}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14 }}>
        {/* Asset stack — image on top, video below */}
        <div style={{ width: 200, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Image slot */}
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: imgAspect,
                borderRadius: 8,
                background: "#000",
                overflow: "hidden",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {script.image_url ? (
                <img
                  src={script.image_url}
                  alt={`Ad image for script ${index}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span className="muted-sm" style={{ fontSize: 11, textAlign: "center", padding: 8 }}>
                  {imgStatus === "pending" ? "Generating…" : imgStatus === "failed" ? "Failed" : "No image yet"}
                </span>
              )}
              {imgStatus === "pending" && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12 }}>
                  Generating…
                </div>
              )}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 4, flexWrap: "wrap" }}>
              <button
                className="btn-ghost btn-sm"
                onClick={onGenerateImage}
                disabled={imagingBusy || imgStatus === "pending"}
                style={{ fontSize: 11, flex: 1 }}
                title={script.image_url ? "Regenerate image" : "Generate image"}
              >
                {imagingBusy || imgStatus === "pending"
                  ? "…"
                  : script.image_url
                    ? "↻ Image"
                    : imgStatus === "failed"
                      ? "Retry image"
                      : "✨ Image"}
              </button>
              {script.image_url && (
                <a
                  href={`${script.image_url}${script.image_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(imageDownloadName)}`}
                  download={imageDownloadName}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "4px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    borderRadius: 4,
                    textDecoration: "none",
                  }}
                >
                  ↓ PNG
                </a>
              )}
            </div>
            {script.image_error && (
              <p style={{ color: "#ff6b6b", fontSize: 10, marginTop: 4 }}>{script.image_error}</p>
            )}
          </div>

          {/* Video slot */}
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: imgAspect,
                borderRadius: 8,
                background: "#000",
                overflow: "hidden",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {script.video_url ? (
                <video
                  src={script.video_url}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
                />
              ) : script.image_url ? (
                <img
                  src={script.image_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }}
                />
              ) : (
                <span className="muted-sm" style={{ fontSize: 11, textAlign: "center", padding: 8 }}>
                  No video yet
                </span>
              )}
              {vidStatus === "pending" && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, flexDirection: "column", gap: 4 }}>
                  <span>Rendering…</span>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>Veo 3.1 Fast · ~2-4 min</span>
                </div>
              )}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 4, flexWrap: "wrap" }}>
              <button
                className="btn-ghost btn-sm"
                onClick={onGenerateVideo}
                disabled={videoingBusy || vidStatus === "pending" || !script.image_url}
                style={{ fontSize: 11, flex: 1 }}
                title={
                  !script.image_url
                    ? "Generate the image first — Veo uses it as the first frame"
                    : script.video_url
                      ? "Regenerate video"
                      : "Generate video"
                }
              >
                {videoingBusy || vidStatus === "pending"
                  ? "…"
                  : script.video_url
                    ? "↻ Video"
                    : vidStatus === "failed"
                      ? "Retry video"
                      : "🎬 Video"}
              </button>
              {script.video_url && (
                <a
                  href={`${script.video_url}${script.video_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(videoDownloadName)}`}
                  download={videoDownloadName}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "4px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: "var(--magenta-soft)",
                    color: "var(--magenta)",
                    border: "1px solid var(--magenta)",
                    borderRadius: 4,
                    textDecoration: "none",
                  }}
                >
                  ↓ MP4
                </a>
              )}
            </div>
            {script.video_error && (
              <p style={{ color: "#ff6b6b", fontSize: 10, marginTop: 4 }}>{script.video_error}</p>
            )}
          </div>
        </div>

        {/* Script body */}
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="mono muted-sm">#{String(index).padStart(2, "0")}</span>
                <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>
                  {script.script_kind.replace(/_/g, " ")}
                </span>
                {script.placement && script.placement !== "mixed" && (
                  <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>{script.placement}</span>
                )}
                {script.approved && <span className="badge badge-succeeded">approved</span>}
              </div>
              <div style={{ marginTop: 8, fontWeight: 600 }}>{csv["Building Block"] ?? "—"}</div>
              <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5 }}>
                {csv["Script/Voiceover"] ?? "—"}
              </div>
              {csv["Text on Screen"] && (
                <div className="muted-sm" style={{ marginTop: 6 }}>
                  <strong style={{ color: "var(--text-2)" }}>On screen:</strong> {csv["Text on Screen"]}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="btn-ghost btn-sm" onClick={() => setExpanded((e) => !e)}>
                {expanded ? "Hide" : "Details"}
              </button>
              <button
                className="btn-sm"
                onClick={onToggle}
                style={script.approved
                  ? { background: "transparent", color: "var(--text-2)", borderColor: "var(--border)" }
                  : { background: "var(--accent)", color: "var(--bg)", borderColor: "var(--accent)" }}
              >
                {script.approved ? "Unapprove" : "Approve"}
              </button>
              <button className="btn-sm btn-danger" onClick={onDelete} title="Delete">×</button>
            </div>
          </div>
          {expanded && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontSize: 13 }}>
                <Detail label="Scene Recording Style" value={csv["Scene Recording Style"]} />
                <Detail label="Production" value={csv["Production"]} />
                <Detail label="Editor Note" value={csv["Editor Note"]} />
                <Detail label="Visual Ref" value={csv["Visual Ref"]} />
                <Detail label="Execution Type" value={csv["Execution Type"]} />
                <Detail label="Ad Reference URL" value={csv["Ad Reference URL"]} />
                {script.image_prompt && <Detail label="Image prompt" value={script.image_prompt} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Keyframe storyboard — 5 images sweeping the 8s video. Used to QA visual
          consistency BEFORE paying for Veo. First keyframe doubles as the
          image_url + Veo first-frame, so a sane storyboard guarantees a sane
          video. */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <span className="eyebrow">Keyframe storyboard</span>
            <p className="muted-sm" style={{ marginTop: 2, fontSize: 11 }}>
              {hasKeyframes
                ? `${keyframes.filter((k) => k.status === "ready").length} / ${keyframes.length} keyframes ready`
                : "5-image storyboard across the 8s video — verify visual consistency before rendering."}
            </p>
          </div>
          <button
            className="btn-ghost btn-sm"
            onClick={onGenerateKeyframes}
            disabled={keyframingBusy || kfStatus === "pending"}
            title="Generate 5 keyframes via OpenAI gpt-image-2 (~$0.21). The first keyframe also becomes the Veo first-frame."
            style={{ fontSize: 11 }}
          >
            {keyframingBusy || kfStatus === "pending"
              ? "Generating…"
              : hasKeyframes
                ? "↻ Regen storyboard"
                : "🎞️ Generate storyboard"}
          </button>
        </div>
        {hasKeyframes && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {keyframes.map((kf) => (
              <KeyframeTile
                key={kf.idx}
                kf={kf}
                aspect={imgAspect}
                downloadName={`script_${String(index).padStart(2, "0")}_keyframe_${kf.idx + 1}.png`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyframeTile({
  kf,
  aspect,
  downloadName,
}: {
  kf: NonNullable<AdScript["keyframes"]>[number];
  aspect: string;
  downloadName: string;
}) {
  return (
    <div>
      <div
        style={{
          width: "100%",
          aspectRatio: aspect,
          borderRadius: 6,
          background: "#000",
          overflow: "hidden",
          border: "1px solid var(--border)",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={kf.visual}
      >
        {kf.image_url ? (
          <img src={kf.image_url} alt={`Keyframe ${kf.idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="muted-sm" style={{ fontSize: 10 }}>
            {kf.status === "pending" ? "…" : kf.status === "failed" ? "Failed" : "Empty"}
          </span>
        )}
        {kf.status === "pending" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10 }}>
            …
          </div>
        )}
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            padding: "2px 6px",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 9,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            borderRadius: 3,
          }}
        >
          {kf.timestamp_s}s
        </div>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: "var(--muted)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {kf.voiceover ? `"${kf.voiceover.slice(0, 60)}${kf.voiceover.length > 60 ? "…" : ""}"` : <span style={{ opacity: 0.5 }}>(ambient)</span>}
      </div>
      {kf.image_url && (
        <a
          href={`${kf.image_url}${kf.image_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(downloadName)}`}
          download={downloadName}
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 4,
            fontSize: 10,
            color: "var(--muted-2)",
            textDecoration: "none",
          }}
        >
          ↓ PNG
        </a>
      )}
      {kf.error && (
        <p style={{ color: "#ff6b6b", fontSize: 9, marginTop: 4 }}>{kf.error}</p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <div className="muted-sm" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 2 }}>{value || <span className="muted-sm">—</span>}</div>
    </div>
  );
}
