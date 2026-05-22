"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
// lucide-react doesn't export an `Instagram` glyph in this version; Camera
// is the closest neutral substitute that fits the social-photo metaphor.
import { Camera as Instagram, Sparkles, Trash2, Copy, Upload, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { BrandContextPanel } from "@/components/brand-context-panel";
import type { BrandContext } from "@/lib/brand-context";

type Product = { id: string; name: string; brand: string; one_liner?: string };
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

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    const res = await fetch("/api/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, format, theme, audience, vibe, enrich_with_connoisseur: useBrandIntel }),
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
    } else if (data?.image_status === "failed") {
      toast.error("Image generation failed", data?.error ?? "see settings");
    }
    refresh();
  }

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

          <label
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text, #222)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={useBrandIntel}
              onChange={(e) => setUseBrandIntel(e.target.checked)}
            />
            Use brand intelligence
            <span className="muted-sm" style={{ fontSize: 11 }}>
              · pull winning selling points + voice atoms from Connoisseur when available
            </span>
          </label>

          {error && <p style={{ color: "var(--danger, #d33)", marginTop: 12, fontSize: 13 }}>{error}</p>}
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
                background: "#000",
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
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 12 }}>
                    rendering…
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f88", fontSize: 12, padding: 12, textAlign: "center" }}>
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
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--text, #222)", whiteSpace: "pre-wrap" }}>
                  {post.caption}
                </p>
              )}
              {post.hashtags.length > 0 && (
                <p style={{ margin: 0, fontSize: 11, color: "var(--muted, #666)", lineHeight: 1.4 }}>
                  {post.hashtags.map((h) => `#${h}`).join(" ")}
                </p>
              )}
              {post.published_at && (
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  color: "var(--success, #2a8c5a)",
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
                    background: post.published_at ? "transparent" : "var(--accent, #111)",
                    color: post.published_at ? "var(--muted, #555)" : "white",
                    border: post.published_at ? "1px solid var(--border, #ddd)" : "1px solid var(--accent, #111)",
                    borderRadius: 6,
                    cursor: post.image_status === "ready" ? "pointer" : "not-allowed",
                  }}
                  title={post.image_status !== "ready" ? "Image must be ready before publishing" : post.published_at ? "Already published — click to re-stamp" : "Mark as published"}
                >
                  <Upload size={12} /> {publishingId === post.id ? "Publishing…" : post.published_at ? "Re-publish" : "Publish"}
                </button>
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
    </div>
  );
}
