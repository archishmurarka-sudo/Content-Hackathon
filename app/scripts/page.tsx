"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, Sparkles, Package, Beaker } from "lucide-react";
import { useToast } from "@/components/toast";

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
  script_kind: "swipe" | "original" | "testimonial" | "listicle";
  source_ref: string | null;
  script_csv: Record<string, string>;
  approved: boolean;
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
  const [scriptCount, setScriptCount] = useState(10);
  const [style, setStyle] = useState<ScriptStyle>("mixed");
  const [placement, setPlacement] = useState<"feed" | "reels" | "stories" | "mixed">("mixed");
  const [competitorRefs, setCompetitorRefs] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [generating, setGenerating] = useState(false);

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
      }),
    });
    setGenerating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Generation not wired yet", data?.error ?? data?.hint ?? `HTTP ${res.status}`);
      return;
    }
    toast.success("Scripts generated", `${data?.count ?? 0} new scripts`);
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

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 14, marginTop: 16 }}>
              <div>
                <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}># scripts</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={scriptCount}
                  onChange={(e) => setScriptCount(Number(e.target.value))}
                  style={{ width: 110 }}
                />
              </div>
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

            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
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
                <h2 style={{ marginTop: 4 }}>Scripts for {selectedProduct?.name}</h2>
              </div>
              {scripts.length > 0 && (
                <button className="btn-ghost btn-sm">Export to Google Sheet</button>
              )}
            </div>
            {scripts.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                No scripts generated yet. The brief above is ready — click <strong style={{ color: "var(--text-2)" }}>Generate</strong> to spin a batch.
                <div className="muted-sm" style={{ marginTop: 6 }}>
                  (Generator wires next; the UI ships first to validate the shape.)
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>#</th>
                      <th>Style</th>
                      <th>Hook</th>
                      <th>Body</th>
                      <th style={{ width: 90 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scripts.map((s, i) => (
                      <tr key={s.id}>
                        <td className="mono muted-sm">{String(i + 1).padStart(2, "0")}</td>
                        <td><span className="badge">{s.script_kind.replace(/_/g, " ")}</span></td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.script_csv?.["Building Block"] ?? "—"}
                        </td>
                        <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.script_csv?.["Script/Voiceover"] ?? "—"}
                        </td>
                        <td>{s.approved ? <span className="badge badge-succeeded">approved</span> : <span className="badge badge-pending">pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
