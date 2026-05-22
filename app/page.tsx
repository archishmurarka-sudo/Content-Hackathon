"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkles, Send, TrendingUp, Image as ImageIcon, ArrowRight } from "lucide-react";
import { useToast } from "@/components/toast";

type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  top_pain: string;
  energy_rating: number | null;
  dossier_excerpt?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  followers?: number | null;
  source?: "catalog" | "tiktok_scrape";
  recent_videos?: {
    web_video_url: string | null;
    cover_url: string | null;
    duration_s: number | null;
    like_count: number | null;
    play_count: number | null;
    caption: string | null;
  }[];
  persona?: {
    gender_presentation: string;
    apparent_ethnicity: string;
    apparent_age_range: string;
    speech_style: string;
    appearance_description: string;
  };
};
type Product = { id: string; name: string; brand: string; one_liner: string };
type BriefFrame = {
  shot_idx: number;
  status: string;
  image_url?: string;
  video_status?: "idle" | "pending" | "ready" | "failed";
  video_url?: string;
};
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: string;
  storyboard?: { hook: string; cta?: string; total_duration_s: number; shots: any[] };
  frames?: BriefFrame[];
  delivery?: { status: "queued" | "sent" | "failed"; to: string; sent_at?: number };
  error?: string;
  created_at: number;
};

export default function HomeWrapper() {
  // useSearchParams() bails out of static prerender; wrap in Suspense so the
  // build can prerender the shell while the search-param logic resolves on the client.
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const [creators, setCreators] = useState<Creator[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);

  const [handle, setHandle] = useState("");
  const [productId, setProductId] = useState("ashwamag");
  const [duration, setDuration] = useState(20);
  const [funnelStage, setFunnelStage] = useState<"BOF" | "MOF" | "TOF">("BOF");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TikTok creator scrape
  const [tiktokInput, setTiktokInput] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapedCreator, setScrapedCreator] = useState<Creator | null>(null);

  async function scrapeTikTok(e: React.FormEvent) {
    e.preventDefault();
    setScrapeError(null);
    setScrapedCreator(null);
    setScraping(true);
    const res = await fetch("/api/creators/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktok: tiktokInput }),
    });
    setScraping(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setScrapeError(data.error ?? "scrape failed");
      toast.error("Couldn't onboard creator", data?.error);
      return;
    }
    setScrapedCreator(data.creator);
    setHandle(data.creator?.handle ?? "");
    toast.success(`Onboarded @${data.creator?.handle}`, `archetype: ${data.creator?.archetype}`);
    refresh();
  }

  async function refresh() {
    const [cRes, pRes, bRes] = await Promise.all([
      fetch("/api/creators?q=", { cache: "no-store" }),
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/briefs", { cache: "no-store" }),
    ]);
    setCreators((await cRes.json()).creators ?? []);
    setProducts((await pRes.json()).products ?? []);
    setBriefs((await bRes.json()).briefs ?? []);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // Pre-fill the new-brief form when arriving from /?prefill=<handle>
  // (e.g. from the "Use" buttons on the creators table or per-creator pages).
  useEffect(() => {
    const pf = searchParams?.get("prefill");
    if (pf && pf !== handle) setHandle(pf);
    // intentionally only on mount / when prefill query changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creator_handle: handle, product_id: productId, target_duration_s: duration, funnel_stage: funnelStage }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "failed");
      toast.error("Couldn't generate brief", data?.error);
      return;
    }
    toast.success(`Brief drafted for @${handle}`, "Frames generating in the background");
    setHandle("");
    refresh();
    if (data?.id) window.location.href = `/briefs/${data.id}`;
  }

  const totalGmv = creators.reduce((s, c) => s + (c.kalo_gmv ?? 0), 0);
  const deliveredToday = briefs.filter((b) => b.status === "delivered" && Date.now() - b.created_at < 86_400_000).length;
  const inFlight = briefs.filter((b) => !["delivered", "failed"].includes(b.status)).length;
  const totalApproved = briefs.reduce((sum, b) => sum + (b.frames ?? []).filter((f) => f.status === "approved").length, 0);
  const totalClipsReady = briefs.reduce((sum, b) => sum + (b.frames ?? []).filter((f) => f.video_status === "ready").length, 0);

  return (
    <div className="container">
      {/* Hero */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginBottom: 28 }}>
        <div>
          <span className="eyebrow">Today</span>
          <h1 style={{ marginTop: 6 }}>
            Generate bottom-of-funnel videos<br />
            <span style={{ color: "var(--muted)" }}>pegged to your top creators.</span>
          </h1>
        </div>
        <div className="muted-sm" style={{ textAlign: "right", maxWidth: 280 }}>
          157 BOF prototypes indexed · 47 creators with full dossiers · 911 source videos analyzed.
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 28 }}>
        <Kpi icon={<Sparkles size={14} />} label="Creators in catalog" value={creators.length.toString()} sub={`$${(totalGmv / 1_000_000).toFixed(1)}M tracked GMV`} />
        <Kpi icon={<ImageIcon size={14} />} label="Briefs in flight" value={inFlight.toString()} sub={`${briefs.length} total`} />
        <Kpi icon={<TrendingUp size={14} />} label="Clips rendered" value={totalClipsReady.toString()} sub={`${totalApproved} frames approved`} />
        <Kpi icon={<Send size={14} />} label="Delivered today" value={deliveredToday.toString()} sub="via Periskope WhatsApp" />
      </div>

      {/* New brief panel */}
      <div className="card" style={{ marginBottom: 28 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <span className="eyebrow">New brief</span>
            <h2 style={{ marginTop: 4 }}>Spin up a video for a creator</h2>
          </div>
          <Link href="/creators" className="muted-sm" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            Browse creators <ArrowRight size={12} />
          </Link>
        </div>
        <form onSubmit={submit}>
          <div className="row" style={{ alignItems: "flex-end", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Creator handle</label>
              <input list="creator-list" value={handle} onChange={(e) => setHandle(e.target.value)}
                placeholder="rphreviews" style={{ width: "100%" }} />
              <datalist id="creator-list">
                {creators.map((c) => (
                  <option key={c.handle} value={c.handle}>
                    {c.archetype} · {c.kalo_gmv ? `$${c.kalo_gmv.toLocaleString()}` : "—"}
                  </option>
                ))}
              </datalist>
            </div>
            <div>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Duration</label>
              <input type="number" min={10} max={60} value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{ width: 80 }} />
            </div>
            <button type="submit" disabled={submitting || !handle.trim()}>
              {submitting ? "Generating…" : <>Generate <ArrowRight size={14} /></>}
            </button>
          </div>
          <div className="row" style={{ marginTop: 14, gap: 8, alignItems: "center" }}>
            <span className="muted-sm" style={{ marginRight: 4 }}>Funnel stage:</span>
            {(["BOF", "MOF", "TOF"] as const).map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setFunnelStage(stage)}
                className={funnelStage === stage ? "" : "btn-ghost btn-sm"}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  border: funnelStage === stage ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: funnelStage === stage ? "var(--accent)" : "transparent",
                  color: funnelStage === stage ? "white" : "var(--muted)",
                  borderRadius: 6,
                }}
              >
                {stage === "BOF" ? "Bottom · hard sell" : stage === "MOF" ? "Middle · consideration" : "Top · awareness"}
              </button>
            ))}
          </div>
          {error && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>{error}</p>}
        </form>
      </div>

      {/* Add creator from TikTok */}
      <div className="card" style={{ marginBottom: 28 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <span className="eyebrow">Onboard</span>
            <h2 style={{ marginTop: 4 }}>Add a new creator from TikTok</h2>
          </div>
          <span className="muted-sm">Apify scrape · Gemini dossier synthesis</span>
        </div>
        <form onSubmit={scrapeTikTok}>
          <div className="row" style={{ alignItems: "flex-end", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>TikTok handle or profile URL</label>
              <input
                value={tiktokInput}
                onChange={(e) => setTiktokInput(e.target.value)}
                placeholder="@rphreviews or https://www.tiktok.com/@rphreviews"
                style={{ width: "100%" }}
              />
            </div>
            <button type="submit" disabled={scraping || !tiktokInput.trim()}>
              {scraping ? "Scraping…" : <>Pull profile <ArrowRight size={14} /></>}
            </button>
          </div>
          {scrapeError && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>{scrapeError}</p>}
        </form>
        {scrapedCreator && (
          <div className="card" style={{ marginTop: 14, background: "rgba(0,0,0,0.02)" }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              {scrapedCreator.avatar_url && (
                <img
                  src={scrapedCreator.avatar_url}
                  alt=""
                  style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <strong style={{ fontSize: 16 }}>@{scrapedCreator.handle}</strong>
                  <span className="muted-sm">
                    {scrapedCreator.archetype} · energy {scrapedCreator.energy_rating ?? "—"}/10
                    {scrapedCreator.followers != null && <> · {scrapedCreator.followers.toLocaleString()} followers</>}
                  </span>
                </div>
                {scrapedCreator.bio && (
                  <p className="muted-sm" style={{ marginTop: 4, fontSize: 12, fontStyle: "italic" }}>{scrapedCreator.bio}</p>
                )}
                <p className="muted-sm" style={{ marginTop: 6 }}>Top pain: {scrapedCreator.top_pain}</p>
              </div>
            </div>

            {scrapedCreator.persona && (
              <div style={{ marginTop: 14, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>Persona</span>
                <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {[
                    { label: "Gender", value: scrapedCreator.persona.gender_presentation },
                    { label: "Ethnicity", value: scrapedCreator.persona.apparent_ethnicity?.replace(/_/g, " ") },
                    { label: "Age", value: scrapedCreator.persona.apparent_age_range },
                  ].map((p) => (
                    <span key={p.label} style={{
                      padding: "3px 9px",
                      fontSize: 11,
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      background: "white",
                    }}>
                      <span className="muted-sm" style={{ marginRight: 4 }}>{p.label}:</span>
                      <strong>{p.value || "—"}</strong>
                    </span>
                  ))}
                </div>
                {scrapedCreator.persona.speech_style && (
                  <p style={{ marginTop: 10, fontSize: 13 }}>
                    <span className="muted-sm" style={{ marginRight: 6 }}>Speech:</span>
                    {scrapedCreator.persona.speech_style}
                  </p>
                )}
                {scrapedCreator.persona.appearance_description && (
                  <p style={{ marginTop: 6, fontSize: 13 }}>
                    <span className="muted-sm" style={{ marginRight: 6 }}>Appearance:</span>
                    {scrapedCreator.persona.appearance_description}
                  </p>
                )}
              </div>
            )}

            {scrapedCreator.dossier_excerpt && (
              <p style={{ marginTop: 12, fontSize: 13 }}>{scrapedCreator.dossier_excerpt}</p>
            )}

            {scrapedCreator.recent_videos && scrapedCreator.recent_videos.some((v) => v.cover_url) && (
              <div style={{ marginTop: 14 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>Recent posts</span>
                <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  {scrapedCreator.recent_videos.slice(0, 6).map((v, i) =>
                    v.cover_url ? (
                      <a
                        key={i}
                        href={v.web_video_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        title={v.caption ?? ""}
                        style={{ display: "block", position: "relative", flex: "0 0 auto", width: 90 }}
                      >
                        <img
                          src={v.cover_url}
                          alt=""
                          style={{ width: 90, height: 120, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                        />
                        {v.play_count != null && (
                          <span style={{
                            position: "absolute", bottom: 4, left: 4, right: 4,
                            fontSize: 10, color: "white",
                            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                          }}>
                            ▶ {v.play_count > 1_000_000 ? `${(v.play_count / 1_000_000).toFixed(1)}M` : v.play_count > 1000 ? `${(v.play_count / 1000).toFixed(0)}k` : v.play_count}
                          </span>
                        )}
                      </a>
                    ) : null
                  )}
                </div>
              </div>
            )}

            <p className="muted-sm" style={{ marginTop: 12, fontSize: 12 }}>
              Handle copied into the brief form above — pick a product and click Generate.
            </p>
          </div>
        )}
      </div>

      {/* Two-column: Recent briefs + Top creators */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24 }}>
        <section>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <div>
              <span className="eyebrow">Recent briefs</span>
              <h2 style={{ marginTop: 4 }}>Live pipeline</h2>
            </div>
            {briefs.some((b) => b.status === "failed") && (
              <button
                className="btn-ghost btn-sm"
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
          <div className="col">
            {briefs.length === 0 && (
              <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                No briefs yet — pick a creator above to spin one up.
              </div>
            )}
            {briefs.slice(0, 8).map((b) => <BriefRow key={b.id} brief={b} />)}
            {briefs.length > 8 && (
              <Link href="/briefs" className="muted-sm" style={{ alignSelf: "center", marginTop: 6 }}>
                view all {briefs.length} briefs →
              </Link>
            )}
          </div>
        </section>

        <section>
          <span className="eyebrow">Top creators</span>
          <h2 style={{ marginTop: 4, marginBottom: 12 }}>By Kalo GMV</h2>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table>
              <tbody>
                {creators.filter((c) => c.kalo_gmv).slice(0, 10).map((c, i) => (
                  <tr key={c.handle}>
                    <td style={{ width: 30, color: "var(--muted-2)", fontSize: 12 }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>@{c.handle}</div>
                      <div className="muted-sm">{c.archetype}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 600 }}>${(c.kalo_gmv! / 1000).toFixed(0)}k</div>
                      <button className="btn-ghost btn-sm" style={{ marginTop: 4 }}
                        onClick={() => { setHandle(c.handle); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", color: "var(--muted)", marginBottom: 8 }}>
        {icon}<span className="stat-label" style={{ letterSpacing: 0.08 + "em" }}>{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="muted-sm" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BriefRow({ brief }: { brief: Brief }) {
  const readyFrames = (brief.frames ?? []).filter((f) => f.image_url);
  const approved = (brief.frames ?? []).filter((f) => f.status === "approved").length;
  const clipsReady = (brief.frames ?? []).filter((f) => f.video_status === "ready").length;
  const clipsPending = (brief.frames ?? []).filter((f) => f.video_status === "pending").length;
  return (
    <Link href={`/briefs/${brief.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card card-hover" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const f = readyFrames[i];
            return f?.image_url ? (
              <img key={i} src={f.image_url} alt="" style={{ width: 34, height: 60, objectFit: "cover", borderRadius: 4, background: "#000" }} />
            ) : (
              <div key={i} style={{ width: 34, height: 60, borderRadius: 4, background: "var(--surface-3)" }} />
            );
          })}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>@{brief.creator_handle}</span>
            <span className="muted-sm">{brief.product_id} · {brief.target_duration_s}s</span>
            <span className={`badge badge-${brief.status}`}>{brief.status.replace(/_/g, " ")}</span>
            {brief.delivery?.status === "sent" && <span className="badge badge-succeeded">sent</span>}
          </div>
          {brief.storyboard?.hook && (
            <div className="muted" style={{ fontStyle: "italic", marginTop: 4, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              "{brief.storyboard.hook}"
            </div>
          )}
          <div className="muted-sm" style={{ marginTop: 4 }}>
            {brief.storyboard ? `${brief.storyboard.shots.length} shots · ${brief.storyboard.total_duration_s}s` : "drafting…"}
            {brief.frames && brief.frames.length > 0 && ` · ${readyFrames.length}/${brief.frames.length} frames · ${approved} approved`}
            {(clipsReady > 0 || clipsPending > 0) && ` · ${clipsReady}/${approved} clips${clipsPending ? ` (${clipsPending} rendering)` : ""}`}
          </div>
        </div>
        <div className="muted-sm" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {timeAgo(brief.created_at)}
        </div>
      </div>
    </Link>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
