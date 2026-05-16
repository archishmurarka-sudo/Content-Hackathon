"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  top_pain: string;
  energy_rating: number | null;
};
type Product = { id: string; name: string; brand: string; one_liner: string };
type BriefFrame = { shot_idx: number; status: string; image_url?: string };
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: string;
  storyboard?: { hook: string; cta?: string; total_duration_s: number; shots: any[] };
  frames?: BriefFrame[];
  youtube_ref?: { videoId: string; title: string; thumbnailUrl: string };
  error?: string;
  created_at: number;
};
export default function Home() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [usage, setUsage] = useState<{ storyboard: number; frame_image: number; video_render: number; estimated_cost_usd: number } | null>(null);

  const [handle, setHandle] = useState("");
  const [productId, setProductId] = useState("ashwamag");
  const [duration, setDuration] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [cRes, pRes, bRes, uRes] = await Promise.all([
      fetch("/api/creators?q=", { cache: "no-store" }),
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/briefs", { cache: "no-store" }),
      fetch("/api/usage", { cache: "no-store" }),
    ]);
    setCreators((await cRes.json()).creators ?? []);
    setProducts((await pRes.json()).products ?? []);
    setBriefs((await bRes.json()).briefs ?? []);
    setUsage(uRes.ok ? await uRes.json() : null);
  }

  useEffect(() => { refresh(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creator_handle: handle,
        product_id: productId,
        target_duration_s: duration,
      }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "failed"); return; }
    setHandle("");
    refresh();
    if (data?.id) window.location.href = `/briefs/${data.id}`;
  }

  const totalGmv = creators.reduce((s, c) => s + (c.kalo_gmv ?? 0), 0);

  return (
    <div className="container">
      <h1>Mosaic Creator Engine</h1>
      <p className="muted">BOF video briefs, pegged to each creator's voice and best-performing pattern.</p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 20 }}>
        <Stat label="Creators in catalog" value={creators.length.toString()} />
        <Stat label="Top-creator GMV indexed" value={`$${(totalGmv / 1_000_000).toFixed(1)}M`} />
        <Stat label="BOF prototypes" value="157" sub="39 under 30s" />
        <Stat
          label="AI usage this run"
          value={usage ? `$${usage.estimated_cost_usd.toFixed(2)}` : "—"}
          sub={usage ? `${usage.storyboard} scripts · ${usage.frame_image} frames` : undefined}
        />
      </div>

      <h2 style={{ marginTop: 32 }}>New brief</h2>
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="muted">Creator (handle, no @)</label>
            <input list="creator-list" value={handle} onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. rphreviews" style={{ width: "100%", marginTop: 4 }} />
            <datalist id="creator-list">
              {creators.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.archetype} · {c.kalo_gmv ? `$${c.kalo_gmv.toLocaleString()}` : "—"}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label className="muted">Product</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ marginTop: 4 }}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted">Duration (s)</label>
            <input type="number" min={10} max={60} value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ width: 80, marginTop: 4 }} />
          </div>
          <button type="submit" disabled={submitting || !handle.trim()}>
            {submitting ? "Generating…" : "Generate brief"}
          </button>
        </div>
        {error && <p style={{ color: "#ff6b6b", marginTop: 12 }}>{error}</p>}
      </form>

      <div className="row" style={{ marginTop: 32, justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Recent briefs</h2>
        {briefs.some((b) => b.status === "failed") && (
          <button
            style={{ background: "transparent", color: "#ff6b6b", borderColor: "#ff6b6b", fontSize: 12, padding: "6px 12px" }}
            onClick={async () => {
              const n = briefs.filter((b) => b.status === "failed").length;
              if (!confirm(`Clear ${n} failed brief${n === 1 ? "" : "s"}?`)) return;
              await fetch("/api/briefs/purge-failed", { method: "POST" });
              refresh();
            }}
          >
            Clear failed
          </button>
        )}
      </div>
      <div className="grid">
        {briefs.length === 0 && <p className="muted">No briefs yet — pick a creator above.</p>}
        {briefs.map((b) => {
          const readyFrames = (b.frames ?? []).filter((f) => f.image_url);
          const approved = (b.frames ?? []).filter((f) => f.status === "approved").length;
          return (
            <Link key={b.id} href={`/briefs/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card" style={{ cursor: "pointer" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, " ")}</span>
                  <span className="muted">{new Date(b.created_at).toLocaleString()}</span>
                </div>
                <p style={{ margin: "10px 0 2px", fontSize: 14, fontWeight: 600 }}>
                  @{b.creator_handle} · {b.product_id} · {b.target_duration_s}s
                </p>
                {b.storyboard?.hook && (
                  <p className="muted" style={{ marginTop: 4, fontStyle: "italic" }}>"{b.storyboard.hook}"</p>
                )}
                {b.storyboard && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {b.storyboard.shots.length} shots · {b.storyboard.total_duration_s}s
                    {b.frames && b.frames.length > 0 ? ` · ${readyFrames.length}/${b.frames.length} frames ready · ${approved} approved` : ""}
                  </p>
                )}
                {readyFrames.length > 0 && (
                  <div className="row" style={{ marginTop: 8, gap: 4 }}>
                    {readyFrames.slice(0, 6).map((f) => (
                      <img
                        key={f.shot_idx}
                        src={f.image_url}
                        alt=""
                        style={{ width: 40, height: 71, objectFit: "cover", borderRadius: 4, background: "#000" }}
                      />
                    ))}
                  </div>
                )}
                {b.youtube_ref && (
                  <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>📎 YT ref: {b.youtube_ref.title.slice(0, 60)}</p>
                )}
                {b.error && (
                  <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 8 }}>{b.error.slice(0, 120)}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <h2 style={{ marginTop: 32 }}>Top creators by GMV</h2>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#1a1a22", textAlign: "left" }}>
              <th style={th}>Handle</th>
              <th style={th}>Archetype</th>
              <th style={th}>Top pain</th>
              <th style={{ ...th, textAlign: "right" }}>GMV</th>
              <th style={{ ...th, textAlign: "center" }}>Energy</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {creators.filter((c) => c.kalo_gmv).slice(0, 12).map((c) => (
              <tr key={c.handle} style={{ borderTop: "1px solid #23232f" }}>
                <td style={td}>@{c.handle}</td>
                <td style={td}><span className="muted">{c.archetype}</span></td>
                <td style={td}><span className="muted">{c.top_pain}</span></td>
                <td style={{ ...td, textAlign: "right" }}>${c.kalo_gmv!.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "center" }}>{c.energy_rating ?? "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => { setHandle(c.handle); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    Use
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#9a9aa8" };
const td: React.CSSProperties = { padding: "10px 14px" };
