"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Instagram, Sparkles, Trash2, Copy } from "lucide-react";
import { useToast } from "@/components/toast";

type Product = { id: string; name: string; brand: string; one_liner?: string };
type IgFormat = "feed_1x1" | "feed_4x5" | "reels_9x16";
type IgPost = {
  id: string;
  product_id: string;
  format: IgFormat;
  theme: string;
  vibe: string | null;
  image_status: "pending" | "ready" | "failed";
  image_url: string | null;
  image_prompt: string | null;
  caption: string | null;
  hashtags: string[];
  error: string | null;
  created_at: number;
};

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
  const [vibe, setVibe] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      body: JSON.stringify({ product_id: productId, format, theme, vibe }),
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
                  border: format === f.value ? "1px solid var(--accent, #111)" : "1px solid var(--border, #ddd)",
                  background: format === f.value ? "var(--accent, #111)" : "transparent",
                  color: format === f.value ? "white" : "var(--muted, #666)",
                  borderRadius: 6,
                  cursor: "pointer",
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

          {error && <p style={{ color: "var(--danger, #d33)", marginTop: 12, fontSize: 13 }}>{error}</p>}
        </form>
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
              <div className="row" style={{ marginTop: 4, gap: 6 }}>
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
