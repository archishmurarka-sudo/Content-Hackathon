"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
// lucide-react doesn't export an `Instagram` glyph in this version; Camera
// is the closest neutral substitute that fits the social-photo metaphor.
import { Camera as Instagram, Sparkles, Trash2, Copy, Upload, CheckCircle2, Download } from "lucide-react";
import { useToast } from "@/components/toast";
import { BrandContextPanel } from "@/components/brand-context-panel";
import { ConnoisseurToggle } from "@/components/connoisseur-toggle";
import { ConnoisseurPanel, type EnrichmentOverride } from "@/components/connoisseur-panel";
import { readResearchPicks, clearResearchPicks } from "@/lib/research-picks";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import type { BrandContext } from "@/lib/brand-context";

type Product = { id: string; name: string; brand: string; one_liner?: string; hero_image_url?: string | null };
type IgFormat = "feed_1x1" | "feed_4x5" | "reels_9x16";
type IgPost = {
  id: string;
  product_id: string;
  format: IgFormat;
  theme: string;
  audience: string | null;
  vibe: string | null;
  image_status: "pending" | "ready" | "failed";
  image_url: string | null;
  image_prompt: string | null;
  caption: string | null;
  hashtags: string[];
  published_at: number | null;
  error: string | null;
  created_at: number;
};
type Audience = { value: string; label: string; pain?: string };

const FORMAT_LABEL: Record<IgFormat, string> = {
  feed_1x1: "Feed · 1:1",
  feed_4x5: "Feed · 4:5",
  reels_9x16: "Reels · 9:16",
};

const FORMAT_ASPECT: Record<IgFormat, string> = {
  feed_1x1: "1 / 1",
  feed_4x5: "4 / 5",
  reels_9x16: "9 / 16",
};

const THEME_LABEL: Record<string, string> = {
  lifestyle: "Lifestyle",
  science_explainer: "Science explainer",
  ingredient_closeup: "Ingredient close-up",
  before_after: "Before / after",
  ritual: "Ritual",
  social_proof: "Social proof",
  sale_announcement: "Sale announcement",
  packshot: "Packshot",
  founder_voice: "Founder voice",
  mood: "Mood",
};

export default function InstagramPage() {
  const toast = useToast();
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formats, setFormats] = useState<{ value: IgFormat; label: string }[]>([]);
  const [themes, setThemes] = useState<string[]>([]);

  const [productId, setProductId] = useState("ashwamag");
  const [format, setFormat] = useState<IgFormat>("feed_1x1");
  const [theme, setTheme] = useState("lifestyle");
  const [audience, setAudience] = useState<string>("general");
  const [vibe, setVibe] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Brand-context slot — fed by /api/brand-context which the other chat
  // is wiring to the Connoisseur MCP. Until that lands the endpoint
  // returns `available: false` and the panel renders an empty state.
  const [brandCtx, setBrandCtx] = useState<BrandContext | null>(null);
  const [brandCtxLoading, setBrandCtxLoading] = useState(false);
  const [useBrandIntel, setUseBrandIntel] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  // Preview state — dry-run of the prompt assembly with no paid API calls.
  // Fires POST /api/instagram/preview with the same body Generate would
  // send and renders the result inline so the operator can see what the
  // Connoisseur enrichment is injecting before spending on an image gen.
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<null | {
    gemini_prompt: string;
    blocks: { enrichment_block: string; guidelines_block: string; promo_block: string; theme_cue: string; audience_line: string; format_hint: string };
    enrichment_summary: null | {
      brand_slug: string;
      counts: Record<string, number>;
      tool_status: Record<string, string>;
      voice_atoms: { phrase: string; category?: string | null }[];
      selling_points: { point: string; mechanism?: string | null }[];
      winner_combos: { combo: string; evidence?: string | null; performance?: string | null }[];
      compliance_gates: { pattern: string; severity: string; safer_alternative?: string | null }[];
      archetype_performance: { archetype: string; performance?: string | null }[];
    };
    reference: { hero_present: boolean; gallery_count: number };
  }>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSection, setPreviewSection] = useState<"connoisseur" | "full">("connoisseur");
  const [enrichmentOverride, setEnrichmentOverride] = useState<EnrichmentOverride | null>(null);
  const igTotalPicked = enrichmentOverride
    ? enrichmentOverride.voice_atoms.length + enrichmentOverride.selling_points.length +
      enrichmentOverride.winner_combos.length + enrichmentOverride.compliance_gates.length +
      enrichmentOverride.archetype_performance.length
    : null;
  // Research → Instagram handoff (see /research → "Use in Instagram"). Hydrate
  // the override on mount and show a clearable banner.
  const [picksFromResearch, setPicksFromResearch] = useState<{ brand_slug: string; total_picked: number } | null>(null);
  useEffect(() => {
    const picks = readResearchPicks();
    if (picks) {
      setEnrichmentOverride(picks.enrichment_override as EnrichmentOverride);
      setPicksFromResearch({ brand_slug: picks.brand_slug, total_picked: picks.total_picked });
    }
  }, []);

  useEffect(() => {
    if (!productId) return;
    setBrandCtxLoading(true);
    fetch(`/api/brand-context?product_id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrandCtx(d ?? null))
      .catch(() => setBrandCtx(null))
      .finally(() => setBrandCtxLoading(false));
  }, [productId]);

  async function refresh() {
    const [igRes, pRes] = await Promise.all([
      fetch("/api/instagram", { cache: "no-store" }),
      fetch("/api/products", { cache: "no-store" }),
    ]);
    const igData = await igRes.json().catch(() => ({}));
    const pData = await pRes.json().catch(() => ({}));
    setPosts(igData.posts ?? []);
    setFormats(igData.formats ?? []);
    setThemes(igData.themes ?? []);
    setAudiences(igData.audiences ?? []);
    setProducts(pData.products ?? []);
  }

  useEffect(() => { refresh(); }, []);
  useVisibleInterval(refresh, 5000);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    const res = await fetch("/api/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, format, theme, audience, vibe, enrich_with_connoisseur: useBrandIntel, enrichment_override: enrichmentOverride ?? undefined }),
    });
    setGenerating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "failed");
      toast.error("Generation failed", data?.error);
      return;
    }
    if (data?.image_status === "ready") {
      toast.success("Image generated", `${products.find((p) => p.id === productId)?.name ?? productId} · ${FORMAT_LABEL[format]}`);
      // Server flag — if the product had no hero, this was a text-only render
      // (invented bottle). Surface so the operator knows to fix the catalog.
      if (data?.reference?.warning) {
        toast.error("Generated without product photo", data.reference.warning);
      }
    } else if (data?.image_status === "failed") {
      toast.error("Image generation failed", data?.error ?? "see settings");
    }
    refresh();
  }

  // Preview — dry-run the prompt build with the current form state. No paid
  // API calls; just shows what would be sent to Gemini (and the Connoisseur
  // block being injected). Same body shape as generate() so the preview is
  // guaranteed to match the next generate click.
  async function runPreview() {
    setPreviewError(null);
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/instagram/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, format, theme, audience, vibe, enrich_with_connoisseur: useBrandIntel, enrichment_override: enrichmentOverride ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data?.error ?? "preview failed");
        return;
      }
      setPreview(data);
      setPreviewSection(data?.enrichment_summary ? "connoisseur" : "full");
    } finally {
      setPreviewing(false);
    }
  }

  // Pre-flight check on the selected product. If no hero is on file the
  // generated image will be invented from text — show a banner so the
  // operator can fix it before spending the API call.
  const selectedProduct = products.find((p) => p.id === productId) || null;
  const heroMissing = Boolean(selectedProduct) && !selectedProduct?.hero_image_url;

  async function removePost(id: string) {
    if (!confirm("Delete this post?")) return;
    const res = await fetch(`/api/instagram/${id}`, { method: "DELETE" });
    if (res.ok) refresh();
  }

  async function publishPost(post: IgPost) {
    if (post.published_at) {
      if (!confirm("This post is already marked as published. Mark it again with a fresh timestamp?")) return;
    }
    setPublishingId(post.id);
    const res = await fetch(`/api/instagram/${post.id}/publish`, { method: "POST" });
    setPublishingId(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Publish failed", data?.error);
      return;
    }
    toast.success("Marked as published", "WhatsApp + post log will show it.");
    refresh();
  }

  function copyCaption(post: IgPost) {
    const tags = post.hashtags.map((h) => `#${h}`).join(" ");
    const full = post.caption ? `${post.caption}\n\n${tags}` : tags;
    navigator.clipboard.writeText(full).then(
      () => toast.success("Caption copied", "Paste straight into Instagram."),
      () => toast.error("Copy failed", "Selecting it manually still works.")
    );
  }

  const themesToUse = themes.length > 0 ? themes : Object.keys(THEME_LABEL);
  const formatsToUse = formats.length > 0 ? formats : (Object.keys(FORMAT_LABEL) as IgFormat[]).map((v) => ({ value: v, label: FORMAT_LABEL[v] }));

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, gap: 24 }}>
        <div>
          <span className="eyebrow">Owned channel</span>
          <h1 style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
            <Instagram size={26} />
            Instagram branded content
          </h1>
          <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
            Single-image hero posts for our own Instagram handles — not creator UGC.
            Gemini drafts the creative + caption; OpenAI renders the image; everything stored in R2.
          </p>
        </div>
        <Link href="/" className="muted-sm" style={{ fontSize: 13 }}>← back to dashboard</Link>
      </div>

      {picksFromResearch && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            background: "var(--accent-soft, rgba(108,76,181,0.14))",
            borderColor: "var(--accent)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13 }}>
            🍄 Using <strong>{picksFromResearch.total_picked}</strong> picks from Research · brand <code>{picksFromResearch.brand_slug}</code>
            <span className="muted-sm" style={{ marginLeft: 8, fontSize: 11 }}>(will apply to the next generate)</span>
          </div>
          <button
            onClick={() => { clearResearchPicks(); setEnrichmentOverride(null); setPicksFromResearch(null); toast.success("Cleared Research picks", "Next generate will use the live MCP fetch."); }}
            className="btn-ghost btn-sm"
            style={{ fontSize: 11 }}
          >
            Clear
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 28 }}>
        <span className="eyebrow">New post</span>
        <h2 style={{ marginTop: 4, marginBottom: 14 }}>Generate an image</h2>
        <form onSubmit={generate}>
          <div className="row" style={{ gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.brand}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 200 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Theme</label>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {themesToUse.map((t) => (
                  <option key={t} value={t}>{THEME_LABEL[t] ?? t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 220 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Audience / pain</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {(audiences.length > 0
                  ? audiences
                  : [
                      { value: "general", label: "General" },
                      { value: "perimenopause", label: "Perimenopause" },
                      { value: "menopause", label: "Menopause" },
                      { value: "womens_wellness", label: "Women · general wellness" },
                      { value: "mens_wellness", label: "Men · general wellness" },
                      { value: "mens_testosterone", label: "Men · T + energy" },
                      { value: "sleep", label: "Sleep" },
                      { value: "stress_anxiety", label: "Stress / anxiety" },
                      { value: "energy_focus", label: "Energy / focus" },
                      { value: "skin", label: "Skin" },
                      { value: "hair_thinning", label: "Hair thinning" },
                      { value: "new_parents", label: "New parents" },
                      { value: "athletes_recovery", label: "Athletes / recovery" },
                      { value: "longevity_50plus", label: "Longevity · 50+" },
                    ]
                ).map((a) => (
                  <option key={a.value} value={a.value} title={a.pain ?? ""}>{a.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={generating || !productId || !theme}>
              {generating ? "Generating…" : <><Sparkles size={14} /> Generate</>}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={runPreview}
              disabled={previewing || !productId || !theme}
              title="Show the full Gemini prompt + Connoisseur enrichment that will be sent — no paid API calls."
            >
              {previewing ? "Loading…" : "Preview prompt"}
            </button>
          </div>

          <div className="row" style={{ marginTop: 14, gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted-sm" style={{ marginRight: 4 }}>Format:</span>
            {formatsToUse.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  border: format === f.value ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: format === f.value ? "var(--accent)" : "transparent",
                  color: format === f.value ? "var(--accent-fg)" : "var(--text-2)",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontWeight: format === f.value ? 600 : 500,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Vibe (optional)</label>
            <textarea
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              rows={2}
              placeholder="e.g. soft natural light, terrazzo countertop, hand pouring water into a glass, warm afternoon mood"
              style={{ width: "100%", fontSize: 13 }}
            />
            <p className="muted-sm" style={{ marginTop: 4, fontSize: 11 }}>
              Tip: name a setting, lighting, prop, or mood. Gemini turns this into a concrete prompt for gpt-image-2.
            </p>
          </div>

          {heroMissing && selectedProduct && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--danger-soft)",
                border: "1px solid var(--danger)",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 14 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <strong>{selectedProduct.name} has no product photo on file.</strong>
                <div style={{ marginTop: 2, color: "var(--muted)" }}>
                  Generation will fall back to text-only — the image will show an AI-invented bottle, not your actual product.{" "}
                  <Link href={`/products/${selectedProduct.id}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    Upload a hero image on the product page →
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <ConnoisseurToggle
              enabled={useBrandIntel}
              onChange={setUseBrandIntel}
              onCustomize={() => setPanelOpen(true)}
              pickedCount={igTotalPicked}
            />
          </div>

          {error && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>{error}</p>}
          {previewError && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>preview: {previewError}</p>}

          {preview && (
            <div
              style={{
                marginTop: 16,
                border: "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--surface-2)",
                overflow: "hidden",
              }}
            >
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                <div className="row" style={{ alignItems: "center", gap: 8 }}>
                  <span className="eyebrow">Preview · dry-run</span>
                  <span className="muted-sm" style={{ fontSize: 11 }}>
                    {preview.enrichment_summary
                      ? `🍄 ${preview.enrichment_summary.brand_slug} · ${preview.enrichment_summary.counts.voice_atoms}v / ${preview.enrichment_summary.counts.selling_points}sp / ${preview.enrichment_summary.counts.winner_combos}wc / ${preview.enrichment_summary.counts.compliance_gates}cg`
                      : "(Connoisseur off — no enrichment injected)"}
                  </span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className={previewSection === "connoisseur" ? "" : "btn-ghost"}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                    onClick={() => setPreviewSection("connoisseur")}
                  >
                    Connoisseur
                  </button>
                  <button
                    type="button"
                    className={previewSection === "full" ? "" : "btn-ghost"}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                    onClick={() => setPreviewSection("full")}
                  >
                    Full Gemini prompt
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: "4px 10px" }}
                    onClick={() => setPreview(null)}
                    title="Close preview"
                  >
                    ×
                  </button>
                </div>
              </div>

              {previewSection === "connoisseur" && (
                <div style={{ padding: 14 }}>
                  {preview.enrichment_summary ? (
                    <>
                      <PreviewSlot label="Voice atoms" count={preview.enrichment_summary.voice_atoms.length}>
                        {preview.enrichment_summary.voice_atoms.slice(0, 12).map((a, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "2px 0" }}>
                            <span style={{ color: "var(--accent)" }}>&ldquo;</span>{a.phrase}<span style={{ color: "var(--accent)" }}>&rdquo;</span>
                            {a.category && <span className="muted-sm" style={{ marginLeft: 6, fontSize: 10 }}>[{a.category}]</span>}
                          </div>
                        ))}
                      </PreviewSlot>
                      <PreviewSlot label="Selling points" count={preview.enrichment_summary.selling_points.length}>
                        {preview.enrichment_summary.selling_points.slice(0, 10).map((s, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "2px 0" }}>
                            • {s.point}{s.mechanism && <span className="muted-sm" style={{ marginLeft: 4, fontSize: 11 }}>({s.mechanism})</span>}
                          </div>
                        ))}
                      </PreviewSlot>
                      <PreviewSlot label="Winning combos" count={preview.enrichment_summary.winner_combos.length}>
                        {preview.enrichment_summary.winner_combos.slice(0, 6).map((w, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "2px 0" }}>
                            • {w.combo}{w.performance && <span style={{ color: "var(--accent)", marginLeft: 4 }}>({w.performance})</span>}
                          </div>
                        ))}
                      </PreviewSlot>
                      <PreviewSlot label="Compliance gates" count={preview.enrichment_summary.compliance_gates.length}>
                        {preview.enrichment_summary.compliance_gates.slice(0, 8).map((g, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "2px 0" }}>
                            <span style={{ color: "var(--danger)", fontWeight: 600 }}>[{g.severity}]</span> avoid &ldquo;{g.pattern}&rdquo;
                            {g.safer_alternative && <span className="muted-sm" style={{ marginLeft: 6, fontSize: 11 }}>→ &ldquo;{g.safer_alternative}&rdquo;</span>}
                          </div>
                        ))}
                      </PreviewSlot>
                      <PreviewSlot label="Archetype performance" count={preview.enrichment_summary.archetype_performance.length}>
                        {preview.enrichment_summary.archetype_performance.slice(0, 6).map((a, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "2px 0" }}>
                            • <strong>{a.archetype}</strong>{a.performance && <span style={{ color: "var(--accent)", marginLeft: 4 }}>({a.performance})</span>}
                          </div>
                        ))}
                      </PreviewSlot>
                      <div className="muted-sm" style={{ marginTop: 12, fontSize: 10, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
                        Tool status: {Object.entries(preview.enrichment_summary.tool_status).map(([k, v]) => `${k}=${v}`).join(" · ")}
                      </div>
                    </>
                  ) : (
                    <p className="muted-sm" style={{ margin: 0 }}>Connoisseur enrichment is OFF for this generation — nothing extra would be injected into the prompt.</p>
                  )}
                </div>
              )}

              {previewSection === "full" && (
                <div style={{ padding: 14 }}>
                  <p className="muted-sm" style={{ marginTop: 0, marginBottom: 8, fontSize: 11 }}>
                    This is the EXACT prompt that would be sent to {`${"gemini-2.5-flash"}`}. The image_prompt + caption + hashtags Gemini returns then drive the gpt-image-2 render.
                  </p>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: 12,
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "var(--text-2)",
                      maxHeight: 460,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {preview.gemini_prompt}
                  </pre>
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(preview.gemini_prompt).then(
                          () => toast.success("Prompt copied", "Paste into any LLM scratchpad."),
                          () => toast.error("Copy failed", "Select manually instead."),
                        );
                      }}
                    >
                      <Copy size={12} /> Copy prompt
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      <div style={{ marginBottom: 28 }}>
        <BrandContextPanel ctx={brandCtx} loading={brandCtxLoading} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <span className="eyebrow">Gallery</span>
          <h2 style={{ marginTop: 4 }}>Recent posts</h2>
        </div>
        <span className="muted-sm">{posts.length} total</span>
      </div>

      {posts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted-sm">No posts yet — generate one above.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {posts.map((post) => (
            <div key={post.id} className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                background: "var(--surface-3)",
                borderRadius: 8,
                overflow: "hidden",
                aspectRatio: FORMAT_ASPECT[post.format] || "1 / 1",
                position: "relative",
              }}>
                {post.image_status === "ready" && post.image_url ? (
                  <img
                    src={post.image_url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : post.image_status === "pending" ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>
                    rendering…
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--danger)", fontSize: 12, padding: 12, textAlign: "center" }}>
                    {post.error ?? "failed"}
                  </div>
                )}
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>
                  {products.find((p) => p.id === post.product_id)?.name ?? post.product_id}
                </strong>
                <span className="muted-sm" style={{ fontSize: 11 }}>
                  {FORMAT_LABEL[post.format]} · {THEME_LABEL[post.theme] ?? post.theme}
                </span>
              </div>
              {post.caption && (
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                  {post.caption}
                </p>
              )}
              {post.hashtags.length > 0 && (
                <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
                  {post.hashtags.map((h) => `#${h}`).join(" ")}
                </p>
              )}
              {post.published_at && (
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  color: "var(--ok)",
                  fontWeight: 600,
                }}>
                  <CheckCircle2 size={12} /> Published · {new Date(post.published_at).toLocaleString()}
                </div>
              )}
              <div className="row" style={{ marginTop: 4, gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => publishPost(post)}
                  disabled={post.image_status !== "ready" || publishingId === post.id}
                  style={{
                    fontSize: 11,
                    padding: "4px 10px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: post.published_at ? "transparent" : "var(--accent)",
                    color: post.published_at ? "var(--muted)" : "var(--accent-fg)",
                    border: post.published_at ? "1px solid var(--border)" : "1px solid var(--accent)",
                    borderRadius: 999,
                    fontWeight: 600,
                    cursor: post.image_status === "ready" ? "pointer" : "not-allowed",
                  }}
                  title={post.image_status !== "ready" ? "Image must be ready before publishing" : post.published_at ? "Already published — click to re-stamp" : "Mark as published"}
                >
                  <Upload size={12} /> {publishingId === post.id ? "Publishing…" : post.published_at ? "Re-publish" : "Publish"}
                </button>
                {post.image_url && (
                  <a
                    href={`${post.image_url}${post.image_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(
                      `${(products.find((p) => p.id === post.product_id)?.name ?? post.product_id).replace(/\s+/g, "-").toLowerCase()}-${post.theme}-${post.format}.png`
                    )}`}
                    download
                    className="btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                    title="Download PNG to disk"
                  >
                    <Download size={12} /> Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => copyCaption(post)}
                  className="btn-ghost btn-sm"
                  disabled={!post.caption}
                  style={{ fontSize: 11, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Copy size={12} /> Copy caption
                </button>
                <button
                  type="button"
                  onClick={() => removePost(post.id)}
                  className="btn-ghost btn-sm"
                  style={{ fontSize: 11, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, color: "var(--danger, #c33)" }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConnoisseurPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onChange={setEnrichmentOverride}
      />
    </div>
  );
}

// Small collapsible-section helper used inside the preview panel.
// Renders a header with the section name + item count, and only shows
// the children when count > 0 (zero-count sections stay collapsed to
// keep the panel scannable).
function PreviewSlot({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) {
    return (
      <div style={{ padding: "6px 0", borderBottom: "1px dashed var(--border)" }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
        <span className="muted-sm" style={{ marginLeft: 8, fontSize: 11 }}>none</span>
      </div>
    );
  }
  return (
    <details open style={{ padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
      <summary style={{ cursor: "pointer", padding: "2px 0" }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
        <span style={{ marginLeft: 8, color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>{count}</span>
      </summary>
      <div style={{ marginTop: 6, marginLeft: 4 }}>{children}</div>
    </details>
  );
}
