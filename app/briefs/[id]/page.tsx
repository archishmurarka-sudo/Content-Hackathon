"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

type Shot = {
  idx: number;
  duration_s: number;
  speech: string;
  speech_tone: string;
  visual: string;
  overlay: string;
  product_action: string;
  transition: string;
  image_prompt: string;
  video_prompt: string;
};
type Frame = {
  shot_idx: number;
  status: "pending" | "ready" | "approved" | "failed";
  image_url?: string;
  prompt: string;
  error?: string;
  video_status?: "idle" | "pending" | "ready" | "failed";
  video_url?: string;
  video_model?: string;
  video_error?: string;
};
type Delivery = {
  status: "queued" | "sent" | "failed";
  channel: "whatsapp" | "email";
  to: string;
  sent_at?: number;
  error?: string;
};
type YouTubeRef = {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string;
  isShort: boolean;
};
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: string;
  error?: string;
  storyboard?: {
    hook: string;
    cta: string;
    rationale: string;
    inspired_by_video_ids: string[];
    total_duration_s: number;
    shots: Shot[];
  };
  frames?: Frame[];
  youtube_ref?: YouTubeRef;
  delivery?: Delivery;
  final_video_url?: string;
};

type ProductInfo = {
  id: string;
  name: string;
  brand: string;
  hero_image_url?: string | null;
  one_liner?: string;
};

export default function BriefDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [perShotBusy, setPerShotBusy] = useState<Record<number, boolean>>({});
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [renderingNext, setRenderingNext] = useState(false);
  const [perShotVideoBusy, setPerShotVideoBusy] = useState<Record<number, boolean>>({});
  const [stitching, setStitching] = useState(false);
  const [stitchError, setStitchError] = useState<string | null>(null);
  const [deliveryChannel, setDeliveryChannel] = useState<"email" | "whatsapp">("email");
  const [emailTo, setEmailTo] = useState("");
  const [postingNotes, setPostingNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [savedPhoneLoaded, setSavedPhoneLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/briefs/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    setBrief(await res.json());
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);

  // Once we know which product the brief is for, fetch the product record so
  // we can show the same hero image that's being passed to Gemini as the
  // product reference.
  useEffect(() => {
    if (!brief?.product_id) return;
    if (product?.id === brief.product_id) return;
    fetch(`/api/products/${brief.product_id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProduct(d.product))
      .catch(() => {});
  }, [brief?.product_id, product?.id]);

  async function regenStoryboard() {
    setRegenerating(true);
    await fetch(`/api/briefs/${id}/regenerate`, { method: "POST" });
    setRegenerating(false);
    load();
  }

  async function generateAllFrames(isRegen: boolean) {
    if (isRegen) {
      const n = brief?.storyboard?.shots.length ?? 0;
      const cost = (n * 0.04).toFixed(2);
      if (!confirm(`Regenerate all ${n} frames? This will call Gemini ${n} times (~$${cost}).`)) return;
    }
    setGeneratingFrames(true);
    await fetch(`/api/briefs/${id}/frames`, { method: "POST" });
    setGeneratingFrames(false);
    load();
  }

  async function deleteThisBrief() {
    if (!confirm("Delete this brief? Storyboard, frames, and any history will be removed.")) return;
    const res = await fetch(`/api/briefs/${id}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/";
  }

  async function shotAction(
    idx: number,
    action: "regenerate" | "approve" | "unapprove",
    extra?: { prompt_override?: string; feedback?: string }
  ) {
    setPerShotBusy((b) => ({ ...b, [idx]: true }));
    await fetch(`/api/briefs/${id}/frames/${idx}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(extra ?? {}) }),
    });
    setPerShotBusy((b) => ({ ...b, [idx]: false }));
    load();
  }

  async function generateAllVideos() {
    const ready = (brief?.frames ?? []).filter((f) => f.status === "approved");
    if (ready.length === 0) return;
    const cost = (ready.length * 0.25).toFixed(2);
    if (!confirm(`Render ${ready.length} video clip${ready.length === 1 ? "" : "s"} via fal.ai (~$${cost})?`)) return;
    setGeneratingVideos(true);
    await fetch(`/api/briefs/${id}/render-videos`, { method: "POST" });
    setGeneratingVideos(false);
    load();
  }

  // Render the next approved frame that doesn't yet have a video clip.
  // Useful for one-by-one testing — cheaper to validate shot 1 before
  // committing to the full batch.
  async function renderNextShot() {
    const next = (brief?.frames ?? [])
      .filter((f) => f.status === "approved" && f.video_status !== "ready" && f.video_status !== "pending")
      .sort((a, b) => a.shot_idx - b.shot_idx)[0];
    if (!next) return;
    setRenderingNext(true);
    await fetch(`/api/briefs/${id}/videos/${next.shot_idx}`, { method: "POST" });
    setRenderingNext(false);
    load();
  }

  async function stitchFinal() {
    setStitchError(null);
    setStitching(true);
    const res = await fetch(`/api/briefs/${id}/stitch`, { method: "POST" });
    setStitching(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setStitchError(d?.error ?? "stitch failed");
    }
    load();
  }

  async function sendByEmail() {
    setSendError(null);
    if (!emailTo.trim()) { setSendError("Email required"); return; }
    setSending(true);
    const res = await fetch(`/api/briefs/${id}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTo.trim(), posting_notes: postingNotes.trim() || undefined }),
    });
    setSending(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setSendError(data?.error ?? "send failed");
    load();
  }

  async function regenShotVideo(idx: number) {
    setPerShotVideoBusy((b) => ({ ...b, [idx]: true }));
    await fetch(`/api/briefs/${id}/videos/${idx}`, { method: "POST" });
    setPerShotVideoBusy((b) => ({ ...b, [idx]: false }));
    load();
  }

  // Load saved phone for this creator once we know the handle.
  useEffect(() => {
    if (!brief || savedPhoneLoaded) return;
    fetch(`/api/creators/${brief.creator_handle}/contact`).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      if (data?.phone) setPhone(data.phone);
      setSavedPhoneLoaded(true);
    });
  }, [brief?.creator_handle, savedPhoneLoaded]);

  async function sendToWhatsApp() {
    setSendError(null);
    if (!phone.trim()) { setSendError("Phone required"); return; }
    setSending(true);
    const res = await fetch(`/api/briefs/${id}/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim(), save_phone: true }),
    });
    setSending(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setSendError(data?.error ?? "send failed");
    load();
  }

  if (!brief) return <div className="container"><p className="muted">Loading…</p></div>;

  const framesByIdx: Record<number, Frame> = {};
  (brief.frames ?? []).forEach((f) => (framesByIdx[f.shot_idx] = f));
  const allApproved = brief.frames && brief.frames.length > 0 && brief.frames.every((f) => f.status === "approved");

  // Pipeline stage index: 0=storyboard, 1=frames generating, 2=frames ready, 3=video render, 4=delivered
  const stageIdx = (() => {
    if (brief.status === "delivered") return 4;
    if (brief.status === "videos_ready") return 4;
    if (brief.status === "videos_pending" || brief.status === "frames_approved") return 3;
    if (brief.status === "frames_ready") return 2;
    if (brief.status === "frames_pending") return 1;
    return 0;
  })();

  const videosReadyCount = (brief.frames ?? []).filter((f) => f.video_status === "ready").length;
  const videosPendingCount = (brief.frames ?? []).filter((f) => f.video_status === "pending").length;
  const approvedCount = (brief.frames ?? []).filter((f) => f.status === "approved").length;
  const allVideosReady = approvedCount > 0 && videosReadyCount === approvedCount;

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Brief</span>
          <h1 style={{ marginTop: 6 }}>
            <span style={{ color: "var(--muted)" }}>@</span>{brief.creator_handle}
          </h1>
          <div className="row" style={{ alignItems: "center", marginTop: 8, gap: 10 }}>
            <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>{brief.product_id}</span>
            <span className="muted-sm">target {brief.target_duration_s}s</span>
            <span className={`badge badge-${brief.status}`}>{brief.status.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className="row">
          <button className="btn-ghost" onClick={regenStoryboard} disabled={regenerating || brief.status === "generating_storyboard"}>
            {regenerating ? "Regenerating…" : "Regenerate script"}
          </button>
          <button className="btn-danger" onClick={deleteThisBrief}>
            Delete
          </button>
        </div>
      </div>

      {/* Pipeline progress */}
      <div className="pipeline">
        {[
          { label: "Storyboard", sub: "Gemini script" },
          { label: "Frames", sub: "Nano Banana" },
          { label: "Frames ready", sub: "Review + approve" },
          { label: "Video render", sub: "fal.ai · Kling 2.1" },
          { label: "Delivered", sub: "Email · WhatsApp" },
        ].map((step, i) => (
          <div key={i} className={`pipeline-step ${i < stageIdx ? "done" : i === stageIdx ? "active" : ""}`}>
            <strong>{step.label}</strong>
            <span>{step.sub}</span>
          </div>
        ))}
      </div>

      {product && (
        <div className="card" style={{ marginTop: 24, display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ width: 88, height: 88, flexShrink: 0, borderRadius: "var(--radius)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {product.hero_image_url ? (
              <img src={product.hero_image_url} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span className="muted-sm" style={{ fontSize: 11, textAlign: "center", padding: 6 }}>No product hero — add one on the Products page</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Product reference</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>{product.name} <span className="muted-sm" style={{ fontWeight: 400 }}>· {product.brand}</span></div>
            <div className="muted-sm" style={{ marginTop: 4 }}>
              {product.hero_image_url
                ? "This exact hero image is passed to Gemini Nano Banana as a visual anchor on every frame — packaging stays consistent across shots."
                : "No hero image yet — frames will be generated from text only. Upload one on /products to lock product identity across shots."}
            </div>
          </div>
        </div>
      )}

      {brief.youtube_ref && (
        <div className="card" style={{ marginTop: 24, display: "flex", gap: 14, alignItems: "center" }}>
          {brief.youtube_ref.thumbnailUrl && (
            <img src={brief.youtube_ref.thumbnailUrl} alt="" style={{ width: 96, borderRadius: 6, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">YouTube reference</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>{brief.youtube_ref.title}</div>
            <div className="muted-sm" style={{ marginTop: 4 }}>
              {brief.youtube_ref.channelTitle} · {brief.youtube_ref.durationSeconds}s
              {brief.youtube_ref.isShort ? " · Short" : ""}
              {brief.youtube_ref.viewCount != null ? ` · ${brief.youtube_ref.viewCount.toLocaleString()} views` : ""}
              {" · "}
              <a href={`https://www.youtube.com/watch?v=${brief.youtube_ref.videoId}`} target="_blank" rel="noopener noreferrer">open</a>
            </div>
          </div>
        </div>
      )}

      {brief.error && <div className="card" style={{ borderColor: "var(--danger)", marginTop: 24 }}>
        <div className="eyebrow" style={{ color: "var(--danger)" }}>Error</div>
        <p style={{ color: "var(--danger)", margin: "6px 0 0" }}>{brief.error}</p>
      </div>}

      {brief.status === "generating_storyboard" && (
        <div className="card" style={{ marginTop: 24 }}>
          <p className="muted" style={{ margin: 0 }}>Gemini is drafting the storyboard…</p>
        </div>
      )}

      {brief.storyboard && (
        <>
          <div className="card" style={{ marginTop: 24 }}>
            <div className="eyebrow">Hook</div>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: 28, lineHeight: 1.15, margin: "10px 0 0", fontWeight: 500 }}>
              &ldquo;{brief.storyboard.hook}&rdquo;
            </p>
            {brief.storyboard.rationale && (
              <div className="muted" style={{ marginTop: 14, maxWidth: 720 }}>{brief.storyboard.rationale}</div>
            )}
            {brief.storyboard.inspired_by_video_ids?.length > 0 && (
              <div className="muted-sm mono" style={{ marginTop: 14 }}>
                Inspired by: {brief.storyboard.inspired_by_video_ids.join(" · ")}
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 32, justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <span className="eyebrow">Storyboard</span>
              <h2 style={{ marginTop: 6 }}>{brief.storyboard.shots.length} shots · {brief.storyboard.total_duration_s}s</h2>
              <p className="muted-sm" style={{ margin: "6px 0 0", maxWidth: 540 }}>
                Frames auto-generate via <strong style={{ color: "var(--text-2)" }}>Gemini 2.5 Flash Image (Nano Banana)</strong>. Edit the prompt or leave feedback on any shot to refine.
              </p>
            </div>
            <div className="row">
              <button className="btn-ghost" onClick={() => generateAllFrames(true)} disabled={generatingFrames}>
                {generatingFrames ? "Regenerating all…" : "Regenerate all frames"}
              </button>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
            {brief.storyboard.shots.map((s) => (
              <ShotCard
                key={s.idx}
                shot={s}
                frame={framesByIdx[s.idx]}
                busy={Boolean(perShotBusy[s.idx])}
                onAction={(action, extra) => shotAction(s.idx, action, extra)}
              />
            ))}
          </div>

          <div className="card" style={{ marginTop: 32 }}>
            <div className="eyebrow">CTA</div>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1.2, margin: "8px 0 0", fontWeight: 500 }}>
              &ldquo;{brief.storyboard.cta}&rdquo;
            </p>
          </div>

          {allApproved && (
            <div className="card" style={{ marginTop: 20, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="eyebrow" style={{ color: "var(--accent)" }}>All frames approved</div>
                  <p style={{ margin: "6px 0 0", color: "var(--text-2)" }}>
                    {videosReadyCount === 0
                      ? `Ready to render ${approvedCount} clip${approvedCount === 1 ? "" : "s"} via fal.ai (Kling 2.1).`
                      : videosReadyCount < approvedCount
                        ? `${videosReadyCount}/${approvedCount} clips rendered${videosPendingCount ? ` · ${videosPendingCount} in flight` : ""}.`
                        : `All ${videosReadyCount} clips rendered. Send to creator below.`}
                  </p>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn-ghost"
                    onClick={renderNextShot}
                    disabled={renderingNext || videosPendingCount > 0 || videosReadyCount >= approvedCount}
                    title="Render the next un-rendered approved frame — useful for testing one shot before paying for the full batch"
                  >
                    {renderingNext
                      ? "Rendering shot…"
                      : videosReadyCount >= approvedCount
                        ? "All shots done"
                        : `Render shot ${videosReadyCount + 1} of ${approvedCount}`}
                  </button>
                  <button onClick={generateAllVideos} disabled={generatingVideos || videosPendingCount > 0}>
                    {generatingVideos || videosPendingCount > 0
                      ? `Rendering${videosPendingCount ? ` (${videosPendingCount} left)` : "…"}`
                      : videosReadyCount === 0
                        ? "Generate all"
                        : videosReadyCount < approvedCount
                          ? "Render remaining"
                          : "Re-render all"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(brief.frames ?? []).some((f) => f.video_status && f.video_status !== "idle") && (
            <section style={{ marginTop: 32 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <span className="eyebrow">Rendered clips</span>
                  <h2 style={{ marginTop: 4 }}>{videosReadyCount}/{approvedCount} ready</h2>
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", marginTop: 12, gap: 12 }}>
                {(brief.frames ?? [])
                  .filter((f) => f.video_status && f.video_status !== "idle")
                  .sort((a, b) => a.shot_idx - b.shot_idx)
                  .map((f) => (
                    <VideoTile
                      key={f.shot_idx}
                      frame={f}
                      busy={Boolean(perShotVideoBusy[f.shot_idx])}
                      onRegen={() => regenShotVideo(f.shot_idx)}
                    />
                  ))}
              </div>
            </section>
          )}

          {allVideosReady && (
            <>
              <div className="card" style={{ marginTop: 24 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <span className="eyebrow">Final cut</span>
                    <h2 style={{ marginTop: 4 }}>Stitch into one video</h2>
                    <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
                      Concats all {videosReadyCount} clips into a single 9:16 mp4 with overlay text burned in (ffmpeg). Stored in R2 alongside the source clips.
                    </p>
                  </div>
                  <button onClick={stitchFinal} disabled={stitching}>
                    {stitching ? "Stitching…" : brief.final_video_url ? "Re-stitch" : "Stitch final video"}
                  </button>
                </div>
                {brief.final_video_url && (
                  <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <video src={brief.final_video_url} controls playsInline style={{ width: 240, aspectRatio: "9/16", borderRadius: 8, background: "#000" }} />
                    <div className="muted-sm" style={{ flex: 1 }}>
                      <div>Final cut ready — preview at left.</div>
                      <a href={brief.final_video_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8 }}>
                        Download mp4 →
                      </a>
                    </div>
                  </div>
                )}
                {stitchError && <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>{stitchError}</p>}
              </div>

              {brief.final_video_url && (
                <div className="card" style={{ marginTop: 20 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <span className="eyebrow">Auto-send to creator</span>
                      <h2 style={{ marginTop: 4 }}>Deliver final cut</h2>
                      <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
                        Pick channel — email is fastest to set up (Resend), WhatsApp uses Periskope.
                      </p>
                    </div>
                    {brief.delivery?.status === "sent" && (
                      <span className="badge badge-succeeded">
                        Sent via {brief.delivery.channel}{brief.delivery.sent_at ? ` · ${new Date(brief.delivery.sent_at).toLocaleTimeString()}` : ""}
                      </span>
                    )}
                  </div>

                  <div className="row" style={{ marginTop: 14, gap: 8 }}>
                    <button
                      className={deliveryChannel === "email" ? "" : "btn-ghost"}
                      onClick={() => setDeliveryChannel("email")}
                      style={{ padding: "6px 14px", fontSize: 13 }}
                    >Email (Resend)</button>
                    <button
                      className={deliveryChannel === "whatsapp" ? "" : "btn-ghost"}
                      onClick={() => setDeliveryChannel("whatsapp")}
                      style={{ padding: "6px 14px", fontSize: 13 }}
                    >WhatsApp (Periskope)</button>
                  </div>

                  {deliveryChannel === "email" ? (
                    <>
                      <div className="row" style={{ marginTop: 12, gap: 10, alignItems: "flex-end" }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Creator email</label>
                          <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="creator@example.com" style={{ width: "100%" }} />
                        </div>
                        <button onClick={sendByEmail} disabled={sending || !emailTo.trim()}>
                          {sending ? "Sending…" : brief.delivery?.channel === "email" && brief.delivery.status === "sent" ? "Re-send email" : "Send email"}
                        </button>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Posting notes (optional)</label>
                        <textarea value={postingNotes} onChange={(e) => setPostingNotes(e.target.value)} rows={2} placeholder="e.g. post Friday morning, use #magashwa caption…" style={{ width: "100%", fontSize: 13 }} />
                      </div>
                    </>
                  ) : (
                    <div className="row" style={{ marginTop: 12, gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Creator phone (country code, no +)</label>
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="14155550123" style={{ width: "100%" }} />
                      </div>
                      <button onClick={sendToWhatsApp} disabled={sending || !phone.trim()}>
                        {sending ? "Sending…" : brief.delivery?.channel === "whatsapp" && brief.delivery.status === "sent" ? "Re-send WhatsApp" : "Send to WhatsApp"}
                      </button>
                    </div>
                  )}

                  {sendError && <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>{sendError}</p>}
                  {brief.delivery?.status === "failed" && brief.delivery.error && (
                    <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>Last attempt: {brief.delivery.error}</p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function VideoTile({ frame, busy, onRegen }: { frame: Frame; busy: boolean; onRegen: () => void }) {
  const status = frame.video_status ?? "idle";
  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ position: "relative", aspectRatio: "9/16", borderRadius: 6, overflow: "hidden", background: "#000" }}>
        {frame.video_url ? (
          <video src={frame.video_url} controls playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : frame.image_url ? (
          <img src={frame.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />
        ) : null}
        {status === "pending" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12 }}>
            Rendering…
          </div>
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Shot {frame.shot_idx + 1}</div>
          <span className={`badge badge-${status === "ready" ? "succeeded" : status === "failed" ? "failed" : "storyboard_ready"}`}>{status}</span>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={onRegen}
          disabled={busy || status === "pending"}
          style={{ fontSize: 11 }}
        >
          {busy ? "…" : status === "failed" ? "Retry" : "Regen"}
        </button>
      </div>
      {frame.video_error && (
        <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 6 }}>{frame.video_error}</p>
      )}
      {frame.video_model && status === "ready" && (
        <p className="muted-sm" style={{ fontSize: 10, marginTop: 4 }}>{frame.video_model.split("/").slice(-2).join("/")}</p>
      )}
    </div>
  );
}

function ShotCard({
  shot,
  frame,
  busy,
  onAction,
}: {
  shot: Shot;
  frame: Frame | undefined;
  busy: boolean;
  onAction: (action: "regenerate" | "approve" | "unapprove", extra?: { prompt_override?: string; feedback?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(shot.image_prompt);
  const [feedback, setFeedback] = useState("");

  // Reset the editor when the underlying prompt changes (e.g. after a script regen)
  useEffect(() => {
    if (!editing) setPromptDraft(shot.image_prompt);
  }, [shot.image_prompt, editing]);

  const status = frame?.status ?? "pending";
  const statusBadgeClass =
    status === "approved" ? "succeeded" :
    status === "ready" ? "storyboard_ready" :
    status === "failed" ? "failed" : "pending";

  return (
    <div className="card">
      <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {frame?.image_url ? (
            <img
              src={frame.image_url}
              alt={`Shot ${shot.idx + 1}`}
              style={{ width: "100%", borderRadius: 8, aspectRatio: "9/16", objectFit: "cover", background: "#000" }}
            />
          ) : (
            <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: 8, background: "#1a1a22", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12, textAlign: "center", padding: 12 }}>
              {status === "pending" ? "Generating…" : status === "failed" ? "Failed" : "No frame yet"}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <span className={`badge badge-${statusBadgeClass}`}>{status}</span>
            {frame?.error && <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 6 }}>{frame.error}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              {status === "ready" ? (
                <button
                  style={{ padding: "4px 10px", fontSize: 12, background: "#4ade80", borderColor: "#4ade80" }}
                  onClick={() => onAction("approve")}
                  disabled={busy}
                >
                  Approve
                </button>
              ) : status === "approved" ? (
                <button
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => onAction("unapprove")}
                  disabled={busy}
                >
                  Unapprove
                </button>
              ) : null}
              <button
                style={{ padding: "4px 10px", fontSize: 12, background: "transparent", color: "#8ab4ff", borderColor: "#8ab4ff" }}
                onClick={() => setEditing((v) => !v)}
                disabled={busy}
              >
                {editing ? "Hide" : "Edit & regen"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>Shot {shot.idx + 1} · {shot.duration_s}s</strong>
            <span className="muted">{shot.speech_tone} · {shot.product_action} · {shot.transition}</span>
          </div>
          <p style={{ marginTop: 12, fontSize: 16 }}><strong>Speech:</strong> {shot.speech}</p>
          {shot.overlay && <p className="muted" style={{ fontSize: 13 }}><strong>Overlay:</strong> {shot.overlay}</p>}
          <p className="muted" style={{ fontSize: 13 }}><strong>Visual:</strong> {shot.visual}</p>

          {editing && (
            <div style={{ marginTop: 12, borderTop: "1px solid #23232f", paddingTop: 12 }}>
              <label className="muted" style={{ fontSize: 12 }}>Image prompt (edit then regenerate)</label>
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={4}
                style={{ width: "100%", marginTop: 4, fontSize: 13 }}
              />
              <label className="muted" style={{ fontSize: 12, marginTop: 8, display: "block" }}>
                Feedback on the current image (one-shot — e.g. "darker lighting, hand from the right")
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder="What should change in the next render?"
                style={{ width: "100%", marginTop: 4, fontSize: 13 }}
              />
              <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                <button
                  style={{ padding: "6px 12px", fontSize: 12, background: "transparent", color: "#9a9aa8", borderColor: "#3a3a48" }}
                  onClick={() => {
                    setPromptDraft(shot.image_prompt);
                    setFeedback("");
                  }}
                  disabled={busy}
                >
                  Reset
                </button>
                <button
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() => {
                    onAction("regenerate", {
                      prompt_override: promptDraft.trim() !== shot.image_prompt ? promptDraft : undefined,
                      feedback: feedback.trim() || undefined,
                    });
                    setFeedback("");
                  }}
                  disabled={busy}
                >
                  {busy ? "Regenerating…" : "Regenerate with edits"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
