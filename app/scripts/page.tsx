"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Sparkles, Users, Package } from "lucide-react";
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
    pain_breakdown: PainRow[];
    consumer_quotes: string[];
    pain_anchors: string[];
    key_ingredients: string[];
    audience_primary: string | null;
    audience_secondary: string | null;
  };
  prototypes: {
    video_id: string;
    narrative_direction: string | null;
    video_format: string | null;
    duration_seconds: number;
    funnel_stage: string | null;
    voice_style: string | null;
    shot_count: number;
    first_shot: { speech: string; overlay: string; visual: string } | null;
  }[];
  creators: {
    handle: string;
    archetype: string;
    top_pain: string;
    kalo_gmv: number | null;
    energy_rating: number | null;
    dossier_excerpt: string | null;
  }[];
  speech_samples: { video_id: string; speech: string; overlay: string }[];
  counts: { prototypes: number; creators: number; pain_points: number; consumer_quotes: number };
};

type AdScript = {
  id: string;
  source_kind: "swipe_prototype" | "swipe_creator" | "original";
  source_ref: string | null;
  creator_handle: string | null;
  script_csv: Record<string, string>;
  approved: boolean;
  created_at: number;
};

type Mode = "swipe" | "original" | "mixed";

export default function ScriptsPage() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [scripts, setScripts] = useState<AdScript[]>([]);

  // Generator form state
  const [scriptCount, setScriptCount] = useState(10);
  const [mode, setMode] = useState<Mode>("mixed");
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  // Load products on mount.
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

  // Whenever product changes, fetch its brief + saved scripts.
  useEffect(() => {
    if (!selectedProductId) return;
    setBriefLoading(true);
    setBrief(null);
    setSelectedCreators(new Set());
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

  function toggleCreator(handle: string) {
    setSelectedCreators((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  async function generate() {
    if (!selectedProductId || !brief) return;
    setGenerating(true);
    const res = await fetch("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: selectedProductId,
        count: scriptCount,
        mode,
        creator_handles: Array.from(selectedCreators),
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
          <span className="eyebrow">Catalog</span>
          <h1 style={{ marginTop: 6 }}>Direct-response scripts</h1>
          <p className="muted-sm" style={{ marginTop: 6, maxWidth: 620 }}>
            Generates Meta / TikTok ad scripts using your existing BOF prototype library + creator dossiers.
            Pain points and consumer quotes come from the product record, source structures come from the
            top-ranked prototypes, voice comes from the creators you select.
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
                style={{
                  flexShrink: 0,
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {briefLoading && (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
          Assembling brief from existing prototypes + creators…
        </div>
      )}

      {!briefLoading && brief && (
        <>
          {/* Brief summary stats */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}>
            <Kpi icon={<Sparkles size={14} />} label="Pain points" value={String(brief.counts.pain_points)} sub="from product record" />
            <Kpi icon={<FileText size={14} />} label="Consumer quotes" value={String(brief.counts.consumer_quotes)} sub="verbatim Reddit / Amazon" />
            <Kpi icon={<Package size={14} />} label="Reference prototypes" value={String(brief.counts.prototypes)} sub="BOF videos analyzed" />
            <Kpi icon={<Users size={14} />} label="Top creators" value={String(brief.counts.creators)} sub="ranked by GMV + fit" />
          </div>

          {/* Research brief grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, marginBottom: 24 }}>
            {/* Pain breakdown */}
            <section className="card">
              <span className="eyebrow">Pain breakdown</span>
              <h2 style={{ marginTop: 4, marginBottom: 12 }}>What buyers struggle with</h2>
              {brief.research_brief.pain_breakdown.length === 0 ? (
                <p className="muted-sm">No pain breakdown on this product yet — add one on the Products tab to enrich script generation.</p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Pain</th><th>Tracked GMV</th><th>Context</th></tr>
                  </thead>
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

            {/* Consumer voice */}
            <section className="card">
              <span className="eyebrow">Consumer voice</span>
              <h2 style={{ marginTop: 4, marginBottom: 12 }}>Verbatim language</h2>
              {brief.research_brief.consumer_quotes.length === 0 ? (
                <p className="muted-sm">No quotes captured yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {brief.research_brief.consumer_quotes.map((q, i) => (
                    <div key={i} className="muted" style={{ fontStyle: "italic", fontFamily: "var(--font-fraunces, var(--font-serif))", fontSize: 16, lineHeight: 1.3, borderLeft: "2px solid var(--border-strong)", paddingLeft: 10 }}>
                      “{q}”
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Reference prototypes */}
          <section style={{ marginBottom: 24 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <div>
                <span className="eyebrow">Reference prototypes</span>
                <h2 style={{ marginTop: 4 }}>Top {brief.prototypes.length} videos to mimic</h2>
              </div>
              <span className="muted-sm">Each becomes a "swipe" script base</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
              {brief.prototypes.map((p) => (
                <div key={p.video_id} className="card" style={{ padding: 14 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <span className="mono" style={{ fontSize: 12, color: "var(--muted-2)" }}>{p.video_id}</span>
                        {p.funnel_stage && (
                          <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>{p.funnel_stage}</span>
                        )}
                        <span className="muted-sm">{p.duration_seconds}s · {p.shot_count} shots</span>
                      </div>
                      <div style={{ marginTop: 4, fontWeight: 600 }}>
                        {(p.narrative_direction ?? "—").replace(/^custom:\[?/, "").replace(/\]?$/, "").replace(/_/g, " ")}
                      </div>
                      {p.first_shot?.speech && (
                        <div className="muted-sm" style={{ marginTop: 6, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis" }}>
                          “{p.first_shot.speech.slice(0, 160)}{p.first_shot.speech.length > 160 ? "…" : ""}”
                        </div>
                      )}
                    </div>
                    <span className="muted-sm" style={{ whiteSpace: "nowrap" }}>{p.video_format ?? ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Creators picker */}
          <section style={{ marginBottom: 24 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <div>
                <span className="eyebrow">Target creators</span>
                <h2 style={{ marginTop: 4 }}>Voice match — pick the personas to write for</h2>
              </div>
              <span className="muted-sm">{selectedCreators.size} selected · empty = all</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {brief.creators.map((c) => {
                const selected = selectedCreators.has(c.handle);
                return (
                  <button
                    key={c.handle}
                    onClick={() => toggleCreator(c.handle)}
                    className={selected ? "card" : "card"}
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      borderColor: selected ? "var(--accent)" : "var(--border)",
                      background: selected ? "var(--accent-soft)" : undefined,
                      padding: 14,
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong>@{c.handle}</strong>
                      <span className="muted-sm">${((c.kalo_gmv ?? 0) / 1000).toFixed(0)}k</span>
                    </div>
                    <div className="muted-sm" style={{ marginTop: 4 }}>{c.archetype} · energy {c.energy_rating ?? "?"}/10</div>
                    <div className="muted-sm" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                      {c.dossier_excerpt ?? c.top_pain ?? "No dossier"}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Generator panel */}
          <div className="card" style={{ marginBottom: 24, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <span className="eyebrow" style={{ color: "var(--accent)" }}>Generate</span>
                <h2 style={{ marginTop: 4 }}>Spin scripts from this brief</h2>
                <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
                  Each script is one row in Noa's 10-column CSV (Section, Building Block, Voiceover, Recording Style, Production, Editor Note, Text on Screen, Visual Ref, Execution Type, Ref URL).
                </p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 16, gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}># scripts</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={scriptCount}
                  onChange={(e) => setScriptCount(Number(e.target.value))}
                  style={{ width: 90 }}
                />
              </div>
              <div>
                <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="swipe">Swipe (mimic prototypes)</option>
                  <option value="original">Original (from pain points)</option>
                  <option value="mixed">Mixed (50 / 50)</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="muted-sm">Creators: {selectedCreators.size === 0 ? "all top 8" : Array.from(selectedCreators).join(", ")}</div>
              </div>
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
                  (Backend generator is the next thing to wire — the UI ships first so we can validate the shape.)
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>#</th>
                      <th>Source</th>
                      <th>Creator</th>
                      <th>Hook</th>
                      <th>Mode</th>
                      <th style={{ width: 90 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scripts.map((s, i) => (
                      <tr key={s.id}>
                        <td className="mono muted-sm">{String(i + 1).padStart(2, "0")}</td>
                        <td className="mono muted-sm">{s.source_ref ?? "—"}</td>
                        <td>{s.creator_handle ? `@${s.creator_handle}` : <span className="muted-sm">any</span>}</td>
                        <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.script_csv?.["Script/Voiceover"] ?? s.script_csv?.["Building Block"] ?? "—"}
                        </td>
                        <td><span className="badge">{s.source_kind.replace("_", " ")}</span></td>
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
