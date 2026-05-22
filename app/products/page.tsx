"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Upload, Plus, Package, X, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/components/toast";

type PainBreakdown = { pain: string; gmv_label?: string; note?: string };
type Product = {
  id: string;
  name: string;
  brand: string;
  one_liner: string;
  pain_anchors: string[];
  hero_image_url?: string | null;
  gallery_image_urls?: string[] | null;
  format?: string;
  key_ingredients?: string[];
  delivery_tech?: string;
  price_band?: string;
  channel?: string;
  audience_primary?: string;
  audience_secondary?: string;
  pain_breakdown?: PainBreakdown[];
  consumer_quotes?: string[];
  source?: "builtin" | "user";
};

type Brief = { product_id: string; status: string };

export default function ProductsPage() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const [pRes, bRes] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/briefs", { cache: "no-store" }),
    ]);
    setProducts((await pRes.json()).products ?? []);
    setBriefs((await bRes.json()).briefs ?? []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  function briefsFor(id: string) {
    return briefs.filter((b) => b.product_id === id);
  }

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Catalog</span>
          <h1 style={{ marginTop: 6 }}>Products</h1>
          <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
            Every product the engine can generate scripts for. Pain anchors + audience hints get fed straight into the storyboard prompt.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add product</>}
        </button>
      </div>

      {showForm && (
        <AddProductForm
          onAdded={(p) => {
            toast.success("Product added", p.name);
            setShowForm(false);
            load();
          }}
          onError={(msg) => toast.error("Couldn't add product", msg)}
        />
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 18, marginTop: 24 }}>
        {products.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
            No products yet — add one above.
          </div>
        )}
        {products.map((p) => (
          <ProductCard key={p.id} product={p} briefCount={briefsFor(p.id).length} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function ProductCard({ product, briefCount, onChanged }: { product: Product; briefCount: number; onChanged: () => void }) {
  const isUser = product.source === "user";
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 0 }}>
        {/* Hero image — click to upload / replace */}
        <HeroSlot product={product} onChanged={onChanged} />

        {/* Detail */}
        <div style={{ padding: 22, display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="eyebrow">{product.brand}</span>
            {isUser && <span className="badge badge-storyboard_ready">user added</span>}
          </div>
          <h2 style={{ marginTop: 6 }}>{product.name}</h2>
          <p style={{ marginTop: 10, color: "var(--text-2)", maxWidth: 640 }}>{product.one_liner}</p>

          <div className="row" style={{ marginTop: 14, gap: 6, flexWrap: "wrap" }}>
            {product.pain_anchors.slice(0, 8).map((p) => (
              <span key={p} className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)", textTransform: "none" }}>
                {p}
              </span>
            ))}
          </div>

          {/* Spec grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 22 }}>
            {product.format && <KV label="Format" value={product.format} />}
            {product.key_ingredients?.length ? <KV label="Key ingredients" value={product.key_ingredients.join(", ")} /> : null}
            {product.delivery_tech && <KV label="Delivery tech" value={product.delivery_tech} />}
            {product.price_band && <KV label="Price band" value={product.price_band} />}
            {product.audience_primary && <KV label="Primary audience" value={product.audience_primary} />}
            {product.audience_secondary && <KV label="Secondary audience" value={product.audience_secondary} />}
            {product.channel && <KV label="Channel" value={product.channel} />}
            <KV label="Briefs generated" value={String(briefCount)} />
          </div>

          {/* Pain breakdown */}
          {product.pain_breakdown?.length ? (
            <div style={{ marginTop: 22 }}>
              <span className="eyebrow">Pain breakdown</span>
              <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Pain</th>
                      <th>Tracked GMV</th>
                      <th>Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.pain_breakdown.map((p) => (
                      <tr key={p.pain}>
                        <td style={{ fontWeight: 600 }}>{p.pain}</td>
                        <td className="mono">{p.gmv_label ?? "—"}</td>
                        <td className="muted-sm">{p.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Consumer quotes */}
          {product.consumer_quotes?.length ? (
            <div style={{ marginTop: 22 }}>
              <span className="eyebrow">Consumer voice (Reddit / Amazon / TikTok)</span>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {product.consumer_quotes.map((q, i) => (
                  <div key={i} className="muted" style={{ fontStyle: "italic", fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.3 }}>
                    “{q}”
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 22 }}>
            <Link href={`/?product=${product.id}`} className="btn" style={{ textDecoration: "none" }}>
              <Plus size={14} /> New brief for {product.name}
            </Link>
            <Link href={`/briefs?product=${product.id}`} className="btn-ghost btn" style={{ textDecoration: "none" }}>
              {briefCount} brief{briefCount === 1 ? "" : "s"} in catalog
            </Link>
          </div>
        </div>
      </div>

      {/* Gallery strip — multi-upload of supporting assets (packaging, lifestyle shots, etc.) */}
      <GalleryStrip product={product} onChanged={onChanged} />
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-2)" }}>{value}</div>
    </div>
  );
}

function HeroSlot({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("prefix", `products/${product.id}/hero`);
      const up = await fetch("/api/uploads/image", { method: "POST", body: fd });
      const upd = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upd?.error ?? "upload failed");

      const patch = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hero_image_url: upd.url }),
      });
      if (!patch.ok) {
        const pd = await patch.json().catch(() => ({}));
        throw new Error(pd?.error ?? "save failed");
      }
      toast.success("Hero image updated", product.name);
      onChanged();
    } catch (err: any) {
      toast.error("Couldn't update hero", err?.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      onClick={() => !busy && fileRef.current?.click()}
      style={{
        background: "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 260,
        borderRight: "1px solid var(--border)",
        position: "relative",
        cursor: busy ? "wait" : "pointer",
        overflow: "hidden",
      }}
      title={product.hero_image_url ? "Click to replace hero image" : "Click to upload hero image"}
    >
      {product.hero_image_url ? (
        <img
          src={product.hero_image_url}
          alt={product.name}
          style={{ width: "100%", height: "100%", maxHeight: 320, objectFit: "cover" }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--muted-2)" }}>
          <Package size={28} />
          <span className="muted-sm">{busy ? "Uploading…" : "Click to upload hero image"}</span>
        </div>
      )}
      {product.hero_image_url && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "rgba(11,13,12,0.7)",
            backdropFilter: "blur(6px)",
            borderRadius: "var(--radius-pill)",
            color: "var(--text-2)",
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          <Upload size={11} />
          {busy ? "Uploading…" : "Click to replace"}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
    </div>
  );
}

function GalleryStrip({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busyCount, setBusyCount] = useState(0);
  const gallery = product.gallery_image_urls ?? [];

  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("prefix", `products/${product.id}/gallery`);
    const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(`Couldn't upload ${file.name}`, data?.error ?? "upload failed");
      return null;
    }
    return data.url as string;
  }

  async function savePatch(next_urls: string[]) {
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gallery_image_urls: next_urls }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error("Couldn't save gallery", d?.error ?? "save failed");
      return false;
    }
    return true;
  }

  async function onPickMany(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusyCount(files.length);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadOne(f)));
      const successful = uploaded.filter((u): u is string => Boolean(u));
      if (successful.length === 0) return;
      const next = [...gallery, ...successful];
      const ok = await savePatch(next);
      if (ok) {
        toast.success(`Added ${successful.length} asset${successful.length === 1 ? "" : "s"}`, product.name);
        onChanged();
      }
    } finally {
      setBusyCount(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAt(idx: number) {
    if (!confirm("Remove this asset from the product gallery?")) return;
    const next = gallery.filter((_, i) => i !== idx);
    const ok = await savePatch(next);
    if (ok) {
      toast.success("Asset removed", product.name);
      onChanged();
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "16px 22px" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <span className="eyebrow">Asset gallery</span>
          <p className="muted-sm" style={{ marginTop: 2 }}>
            {gallery.length === 0
              ? "No supporting assets yet — upload packaging shots, lifestyle photos, hand-holds, etc."
              : `${gallery.length} asset${gallery.length === 1 ? "" : "s"} stored. Click + to add more.`}
          </p>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={() => !busyCount && fileRef.current?.click()}
          disabled={busyCount > 0}
        >
          <Upload size={12} /> {busyCount > 0 ? `Uploading ${busyCount}…` : "Upload assets"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onPickMany}
        style={{ display: "none" }}
      />
      {gallery.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 8,
          }}
        >
          {gallery.map((url, i) => (
            <div
              key={`${url}-${i}`}
              style={{
                position: "relative",
                aspectRatio: "1/1",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <img
                src={url}
                alt={`${product.name} asset ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              <button
                onClick={() => removeAt(i)}
                title="Remove asset"
                aria-label="Remove asset"
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  padding: 0,
                  borderRadius: "50%",
                  background: "rgba(11,13,12,0.78)",
                  color: "var(--text-2)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddProductForm({ onAdded, onError }: { onAdded: (p: Product) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [painAnchors, setPainAnchors] = useState("");
  const [format, setFormat] = useState("");
  const [keyIngredients, setKeyIngredients] = useState("");
  const [audiencePrimary, setAudiencePrimary] = useState("");
  const [priceBand, setPriceBand] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState<string>("");
  // Additional product shots — packaging back, lifestyle, hand-hold, etc.
  // The hero is the primary anchor; gallery widens the visual vocabulary
  // that downstream image / video generators can reference.
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function pickHero(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("prefix", "products/hero");
    const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
    setUploading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { onError(data?.error ?? "upload failed"); return; }
    setHeroImageUrl(data.url);
  }

  async function pickGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setGalleryUploading(true);
    // Upload in parallel — same endpoint as the per-product gallery uploader.
    const results = await Promise.all(
      files.map(async (f) => {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("prefix", "products/gallery");
        const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { onError(`Couldn't upload ${f.name}: ${data?.error ?? "upload failed"}`); return null; }
        return data.url as string;
      })
    );
    setGalleryUploading(false);
    const ok = results.filter((u): u is string => Boolean(u));
    if (ok.length) setGalleryUrls((prev) => [...prev, ...ok]);
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function removeGalleryAt(idx: number) {
    setGalleryUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        brand,
        one_liner: oneLiner,
        pain_anchors: painAnchors.split(",").map((s) => s.trim()).filter(Boolean),
        format: format || undefined,
        key_ingredients: keyIngredients ? keyIngredients.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        audience_primary: audiencePrimary || undefined,
        price_band: priceBand || undefined,
        hero_image_url: heroImageUrl || undefined,
        gallery_image_urls: galleryUrls.length ? galleryUrls : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) { onError(data?.error ?? "save failed"); return; }
    onAdded(data.product);
    // reset
    setName(""); setBrand(""); setOneLiner(""); setPainAnchors("");
    setFormat(""); setKeyIngredients(""); setAudiencePrimary(""); setPriceBand("");
    setHeroImageUrl("");
    setGalleryUrls([]);
    if (fileRef.current) fileRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <span className="eyebrow">Add a product</span>
      <h2 style={{ marginTop: 4 }}>Onboard a new SKU</h2>
      <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
        Saved to Postgres. Pain anchors feed into storyboard ranking. Hero image is optional but makes the product card much nicer.
      </p>

      <form onSubmit={submit} style={{ marginTop: 18 }}>
        {/* Hero image dropzone + additional shots strip */}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                aspectRatio: "1/1",
                border: "1px dashed var(--border-strong)",
                borderRadius: "var(--radius)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                gap: 6,
                background: heroImageUrl ? `center/cover url('${heroImageUrl}') no-repeat` : "var(--surface-2)",
                color: "var(--muted)",
                overflow: "hidden",
              }}
            >
              {!heroImageUrl && (
                <>
                  {uploading ? (
                    <span className="muted-sm">Uploading…</span>
                  ) : (
                    <>
                      <Upload size={20} />
                      <span className="muted-sm">Click to upload hero image</span>
                      <span className="muted-sm" style={{ fontSize: 11 }}>JPG / PNG / WebP, ≤5 MB</span>
                    </>
                  )}
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={pickHero} style={{ display: "none" }} />
            </div>

            {/* Additional shots — multi-upload */}
            <div>
              <div className="muted-sm" style={{ fontSize: 11, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>More product shots ({galleryUrls.length})</span>
                {galleryUploading && <span style={{ color: "var(--accent)" }}>Uploading…</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {galleryUrls.map((url, i) => (
                  <div
                    key={url + i}
                    style={{
                      position: "relative",
                      aspectRatio: "1/1",
                      borderRadius: 6,
                      overflow: "hidden",
                      background: `center/cover url('${url}') no-repeat var(--surface-2)`,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => removeGalleryAt(i)}
                      title="Remove"
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        width: 18,
                        height: 18,
                        border: "none",
                        background: "rgba(0,0,0,0.6)",
                        color: "#fff",
                        borderRadius: "50%",
                        padding: 0,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <div
                  onClick={() => galleryRef.current?.click()}
                  title="Add more product images"
                  style={{
                    aspectRatio: "1/1",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "var(--muted)",
                    background: "var(--surface-2)",
                  }}
                >
                  <Plus size={16} />
                </div>
              </div>
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                multiple
                onChange={pickGallery}
                style={{ display: "none" }}
              />
              <p className="muted-sm" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.4 }}>
                Packaging back, lifestyle, hand-hold, ingredient shots — anything that widens the visual vocabulary for downstream generators. Multi-select supported.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Product name *" value={name} onChange={setName} placeholder="e.g. Mag Ashwa Gummies" />
            <Field label="Brand *" value={brand} onChange={setBrand} placeholder="e.g. Root Labs" />
            <Field label="Format" value={format} onChange={setFormat} placeholder="Gummy / Roll-on / Capsule" />
            <Field label="Price band" value={priceBand} onChange={setPriceBand} placeholder="$40–80 per bottle" />
            <div style={{ gridColumn: "1 / -1" }}>
              <Field
                label="One-liner *"
                value={oneLiner}
                onChange={setOneLiner}
                placeholder="The 1-sentence pitch the storyboard generator uses."
                textarea
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field
                label="Pain anchors (comma-separated)"
                value={painAnchors}
                onChange={setPainAnchors}
                placeholder="sleep, stress, energy"
              />
            </div>
            <Field
              label="Key ingredients (comma-separated)"
              value={keyIngredients}
              onChange={setKeyIngredients}
              placeholder="Magnesium glycinate, KSM-66 ashwagandha"
            />
            <Field label="Primary audience" value={audiencePrimary} onChange={setAudiencePrimary} placeholder="Women 25–45" />
          </div>
        </div>

        <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
          <button type="submit" disabled={submitting || !name.trim() || !brand.trim() || !oneLiner.trim()}>
            {submitting ? "Saving…" : "Save product"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ width: "100%" }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%" }}
        />
      )}
    </div>
  );
}
