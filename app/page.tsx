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
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  status: string;
  storyboard?: { hook: string; total_duration_s: number; shots: any[] };
  created_at: number;
};
type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  durationSeconds: number;
  publishedAt: string;
  tags: string[];
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string;
  isShort: boolean;
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

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytVideo, setYtVideo] = useState<YouTubeVideo | null>(null);

  async function fetchYouTube(e: React.FormEvent) {
    e.preventDefault();
    setYtError(null);
    setYtVideo(null);
    setYtLoading(true);
    const res = await fetch("/api/youtube/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ytUrl }),
    });
    setYtLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setYtError(data.error ?? "failed"); return; }
    setYtVideo(data.video);
  }

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
      body: JSON.stringify({ creator_handle: handle, product_id: productId, target_duration_s: duration }),
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

      <h2 style={{ marginTop: 32 }}>Borrowed from open source</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Concrete code ported into this dashboard from the closest replicable projects on GitHub. Each integration is live now.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <Borrowed
          repo="0xsline/StoryGen-Atelier"
          license="Apache-2.0"
          source="backend/src/services/llmService.js"
          ports={[
            { file: "lib/transitions.ts", desc: "analyzeShotTransition() — Gemini reads two adjacent frames + narratives, writes the cinematic bridge between them." },
            { file: "lib/storyboard.ts", desc: "Narrative-continuity block (Story Arc / Visual Consistency / Seamless Flow / Causal Relationship) folded into the brief prompt." },
            { file: "app/api/transitions/route.ts", desc: "POST /api/transitions { brief_id } → array of {transition_prompt, duration_s} for each cut." },
          ]}
        />
        <Borrowed
          repo="SamurAIGPT/AI-Youtube-Shorts-Generator"
          license="pattern only"
          source="shorts_generator/highlights.py"
          ports={[
            { file: "lib/virality.ts", desc: "8-signal virality rubric (HOOK / EMOTIONAL PEAK / OPINION BOMB / REVELATION / CONFLICT / QUOTABLE / STORY PEAK / PRACTICAL VALUE) + scorePrototypeVirality()." },
            { file: "lib/virality.ts", desc: "dedupeByTimeOverlap() — generalized port of their dedupe_highlights overlap-suppression algorithm." },
            { file: "lib/data.ts", desc: "rankPrototypes() now adds 0.5×virality to the fit score, so picked references are relevant AND viral." },
          ]}
        />
        <Borrowed
          repo="aself101/kling-api"
          license="MIT"
          source="src/utils/polling.ts"
          ports={[
            { file: "lib/poll.ts", desc: "pollUntil() + sleep() + formatDuration() — server-side polling primitive, stripped of the kling CLI spinner. Ready for the Higgsfield job poller." },
          ]}
        />
        <Borrowed
          repo="(your own YouTube Data API)"
          license="—"
          source="googleapis.com/youtube/v3/videos"
          ports={[
            { file: "lib/youtube.ts", desc: "Extracts video IDs from watch / youtu.be / shorts / embed URLs; pulls title, duration, tags, view & like counts." },
            { file: "app/api/youtube/ingest/route.ts", desc: "POST /api/youtube/ingest { url } → YouTubeVideo. Foundation for synthesising fresh prototypes on demand." },
          ]}
        />
      </div>

      <h2 style={{ marginTop: 32 }}>YouTube reference ingest</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Paste a YouTube Shorts or video URL — we&apos;ll pull title, duration, tags and stats via the YouTube Data API.
        Becomes the seed for an in-session prototype (next iteration wires it into the storyboard prompt).
      </p>
      <form className="card" onSubmit={fetchYouTube}>
        <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label className="muted">YouTube URL or video ID</label>
            <input
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/shorts/…"
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
          <button type="submit" disabled={ytLoading || !ytUrl.trim()}>
            {ytLoading ? "Fetching…" : "Fetch reference"}
          </button>
        </div>
        {ytError && <p style={{ color: "#ff6b6b", marginTop: 12 }}>{ytError}</p>}
      </form>
      {ytVideo && (
        <div className="card" style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "flex-start" }}>
          {ytVideo.thumbnailUrl && (
            <img
              src={ytVideo.thumbnailUrl}
              alt=""
              style={{ width: 160, borderRadius: 6, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{ytVideo.title}</p>
            <p className="muted" style={{ margin: "4px 0" }}>
              {ytVideo.channelTitle} · {ytVideo.durationSeconds}s
              {ytVideo.isShort && " · SHORT"}
              {ytVideo.viewCount !== null && ` · ${ytVideo.viewCount.toLocaleString()} views`}
              {ytVideo.likeCount !== null && ` · ${ytVideo.likeCount.toLocaleString()} likes`}
            </p>
            {ytVideo.tags.length > 0 && (
              <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                Tags: {ytVideo.tags.slice(0, 8).join(", ")}
              </p>
            )}
            {ytVideo.description && (
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>
                {ytVideo.description.slice(0, 320)}{ytVideo.description.length > 320 ? "…" : ""}
              </p>
            )}
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Recent briefs</h2>
      <div className="grid">
        {briefs.length === 0 && <p className="muted">No briefs yet — pick a creator above.</p>}
        {briefs.map((b) => (
          <Link key={b.id} href={`/briefs/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ cursor: "pointer" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, " ")}</span>
                <span className="muted">{new Date(b.created_at).toLocaleTimeString()}</span>
              </div>
              <p style={{ margin: "10px 0 4px", fontSize: 14, fontWeight: 600 }}>
                @{b.creator_handle} · {b.product_id}
              </p>
              {b.storyboard?.hook && (
                <p className="muted" style={{ marginTop: 4, fontStyle: "italic" }}>"{b.storyboard.hook}"</p>
              )}
              {b.storyboard && (
                <p className="muted">{b.storyboard.shots.length} shots · {b.storyboard.total_duration_s}s</p>
              )}
            </div>
          </Link>
        ))}
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

function Borrowed({ repo, license, source, ports }: {
  repo: string;
  license: string;
  source: string;
  ports: { file: string; desc: string }[];
}) {
  const repoUrl = repo.startsWith("(") ? null : `https://github.com/${repo}`;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 14 }}>
          {repoUrl ? (
            <a href={repoUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{repo}</a>
          ) : repo}
        </strong>
        <span className="muted" style={{ fontSize: 11 }}>{license}</span>
      </div>
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: 12, fontFamily: "monospace" }}>{source}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {ports.map((p) => (
          <li key={p.file} style={{ marginBottom: 6 }}>
            <code style={{ fontSize: 12 }}>{p.file}</code>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.desc}</div>
          </li>
        ))}
      </ul>
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
