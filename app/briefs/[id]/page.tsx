"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { ConnoisseurToggle } from "@/components/connoisseur-toggle";

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
    creator_gender?: "female" | "male" | "non-binary";
    banner_choice?: "A" | "B";
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

type HealthSnapshot = {
  env: {
    OPENROUTER_API_KEY?: boolean;
    VIDEO_MODEL?: string | null;
    RESEND_API_KEY?: boolean;
    R2_CONFIGURED?: boolean;
  };
};

export default function BriefDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [perShotBusy, setPerShotBusy] = useState<Record<number, boolean>>({});
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [renderingNext, setRenderingNext] = useState(false);
  const [perShotVideoBusy, setPerShotVideoBusy] = useState<Record<number, boolean>>({});
  const [stitching, setStitching] = useState(false);
  const [stitchError, setStitchError] = useState<string | null>(null);
  // Connoisseur pre-ship check result — populated by polling
  // /api/briefs/:id/pre-ship which reads the latest brief.pre_ship_check
  // event (set fire-and-forget once the storyboard lands).
  const [preShip, setPreShip] = useState<{
    flags: { rule: string; severity?: string; evidence?: string | null }[];
    passed: boolean | null;
    flag_count: number;
    checked_at: number | null;
    ok: boolean | null;
    brand_slug?: string | null;
  } | null>(null);
  // WhatsApp is the active delivery channel right now (Periskope is live;
  // Resend isn't wired on the Railway service yet).
  const [deliveryChannel, setDeliveryChannel] = useState<"email" | "whatsapp">("whatsapp");
  const [emailTo, setEmailTo] = useState("");
  const [postingNotes, setPostingNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [savedPhoneLoaded, setSavedPhoneLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Test-mode allowlist phone — shown as a one-click prefill so the operator
  // doesn't have to retype the test number. PERISKOPE_TEST_MODE=true on the
  // Railway service blocks anything else from receiving.
  const TEST_PHONE = "918017920654";

  // Connoisseur enrichment toggle for the Regenerate-script button. Default
  // ON — mirrors the home-page brief generator and the Scripts/Instagram
  // pages so the operator sees the same default everywhere.
  const [enrichWithConnoisseur, setEnrichWithConnoisseur] = useState(true);
  const [lastRegenEnrichment, setLastRegenEnrichment] = useState<{
    brand_slug: string;
    counts: { voice_atoms: number; selling_points: number; winner_combos: number; compliance_gates: number; archetype_performance: number };
  } | null>(null);

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

  // Poll the pre-ship-check endpoint until a result lands (the storyboard
  // route schedules it fire-and-forget right after the storyboard saves).
  // Stop polling once we've got one OR after ~60s — whichever first.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    async function tick() {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/briefs/${id}/pre-ship`, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          if (!cancelled) setPreShip(d);
          if (d?.checked_at) return; // done — no more polling
        }
      } catch { /* swallow */ }
      tries += 1;
      if (tries < 12) setTimeout(tick, 5000);
    }
    tick();
    return () => { cancelled = true; };
  }, [id]);

  // Pull /api/health once on mount so we know which downstream stages are wired
  // (OpenRouter, Resend). Powers the "OpenRouter not configured" disabled state
  // on the Generate-videos button so the user isn't left clicking a silent button.
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHealth(d))
      .catch(() => {});
  }, []);

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
    const res = await fetch(`/api/briefs/${id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrich_with_connoisseur: enrichWithConnoisseur }),
    });
    setRegenerating(false);
    const data = await res.json().catch(() => ({}));
    setLastRegenEnrichment(data?.enrichment ?? null);
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
    if (ready.length === 0) {
      toast.error("No approved frames", "Approve at least one frame before rendering videos.");
      return;
    }
    // Veo 3.1 Lite: $0.05/s × 8s = ~$0.40 per clip at 720p with audio.
    const cost = (ready.length * 0.40).toFixed(2);
    if (!confirm(`Render ${ready.length} video clip${ready.length === 1 ? "" : "s"} via OpenRouter → Veo 3.1 Lite (~$${cost} total, audio on)?`)) return;
    setGeneratingVideos(true);
    const res = await fetch(`/api/briefs/${id}/render-videos`, { method: "POST" });
    setGeneratingVideos(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error("Video render failed", d?.error ?? `HTTP ${res.status}`);
    } else {
      toast.success(`Rendering ${ready.length} clip${ready.length === 1 ? "" : "s"}`, "Veo 3.1 Lite is processing — frames will fill in as each finishes.");
    }
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
        <div className="row" style={{ alignItems: "center" }}>
          <ConnoisseurToggle
            enabled={enrichWithConnoisseur}
            onChange={setEnrichWithConnoisseur}
            lastSummary={
              lastRegenEnrichment
                ? `${lastRegenEnrichment.counts.voice_atoms} voice atoms · ${lastRegenEnrichment.counts.selling_points} selling points · ${lastRegenEnrichment.counts.compliance_gates} gates`
                : null
            }
          />
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
          { label: "Video render", sub: "OpenRouter · Veo 3.1 Lite" },
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
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="eyebrow">Hook</div>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: 28, lineHeight: 1.15, margin: "10px 0 0", fontWeight: 500 }}>
                  &ldquo;{brief.storyboard.hook}&rdquo;
                </p>
              </div>
              <div className="col" style={{ gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                {brief.storyboard.creator_gender && (
                  <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>
                    {brief.storyboard.creator_gender === "female" ? "👩 female voice" : brief.storyboard.creator_gender === "male" ? "👨 male voice" : "🧑 non-binary voice"}
                  </span>
                )}
                {brief.storyboard.banner_choice && (
                  <span className="badge" style={{ background: brief.storyboard.banner_choice === "A" ? "var(--danger-soft)" : "var(--gold-soft)", color: brief.storyboard.banner_choice === "A" ? "var(--danger)" : "var(--gold)", borderColor: "var(--border)" }}>
                    Banner {brief.storyboard.banner_choice}
                  </span>
                )}
              </div>
            </div>
            {brief.storyboard.rationale && (
              <div className="muted" style={{ marginTop: 14, maxWidth: 720 }}>{brief.storyboard.rationale}</div>
            )}
            {brief.storyboard.inspired_by_video_ids?.length > 0 && (
              <div className="muted-sm mono" style={{ marginTop: 14 }}>
                Inspired by: {brief.storyboard.inspired_by_video_ids.join(" · ")}
              </div>
            )}
            {preShip?.checked_at && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: preShip.flag_count > 0 ? 8 : 0 }}>
                  <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    🍄 Connoisseur pre-ship check
                    {preShip.brand_slug && <span className="muted-sm mono" style={{ fontSize: 10 }}>· {preShip.brand_slug}</span>}
                  </div>
                  <span className="badge" style={{
                    background: preShip.passed ? "var(--success-soft, #e6f5ec)" : "var(--danger-soft)",
                    color: preShip.passed ? "var(--success, #1a7a3a)" : "var(--danger)",
                    borderColor: "var(--border)",
                  }}>
                    {preShip.passed ? `✓ Passed` : `${preShip.flag_count} flag${preShip.flag_count === 1 ? "" : "s"}`}
                  </span>
                </div>
                {preShip.flags.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-2)" }}>
                    {preShip.flags.slice(0, 6).map((f, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <strong>{f.severity && f.severity !== "info" ? `[${f.severity}] ` : ""}</strong>{f.rule}
                        {f.evidence && <span className="muted-sm" style={{ marginLeft: 6 }}>— "{f.evidence}"</span>}
                      </li>
                    ))}
                    {preShip.flags.length > 6 && (
                      <li className="muted-sm">…and {preShip.flags.length - 6} more</li>
                    )}
                  </ul>
                )}
                {preShip.ok === false && (
                  <div className="muted-sm" style={{ marginTop: 6 }}>
                    (Connoisseur MCP was unreachable — pre-ship-check skipped.)
                  </div>
                )}
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
                videoBusy={Boolean(perShotVideoBusy[s.idx])}
                openrouterReady={Boolean(health?.env?.OPENROUTER_API_KEY)}
                onAction={(action, extra) => shotAction(s.idx, action, extra)}
                onRenderVideo={() => regenShotVideo(s.idx)}
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
                      ? `Ready to render ${approvedCount} clip${approvedCount === 1 ? "" : "s"} via OpenRouter Veo 3.1 Lite (8s, 720p, audio on).`
                      : videosReadyCount < approvedCount
                        ? `${videosReadyCount}/${approvedCount} clips rendered${videosPendingCount ? ` · ${videosPendingCount} in flight` : ""}.`
                        : `All ${videosReadyCount} clips rendered. Send to creator below.`}
                  </p>
                </div>
                <div className="col" style={{ gap: 8, alignItems: "flex-end" }}>
                  {health && !health.env?.OPENROUTER_API_KEY && (
                    <div className="muted-sm" style={{ color: "var(--gold)", fontSize: 12, textAlign: "right", maxWidth: 280 }}>
                      ⚠ <strong>OpenRouter not configured.</strong> Add <code className="mono">OPENROUTER_API_KEY</code> in Railway Variables to enable video render.
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn-ghost"
                      onClick={renderNextShot}
                      disabled={renderingNext || videosPendingCount > 0 || videosReadyCount >= approvedCount || Boolean(health && !health.env?.OPENROUTER_API_KEY)}
                      title="Render the next un-rendered approved frame — useful for testing one shot before paying for the full batch"
                    >
                      {renderingNext
                        ? "Rendering shot…"
                        : videosReadyCount >= approvedCount
                          ? "All shots done"
                          : `Render shot ${videosReadyCount + 1} of ${approvedCount}`}
                    </button>
                    <button
                      onClick={generateAllVideos}
                      disabled={generatingVideos || videosPendingCount > 0 || Boolean(health && !health.env?.OPENROUTER_API_KEY)}
                    >
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

          {(brief.frames?.length ?? 0) > 0 && (
            <>
              {allVideosReady && (
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
                  <div style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <video
                      src={brief.final_video_url}
                      controls
                      playsInline
                      preload="metadata"
                      style={{ width: 260, aspectRatio: "9/16", borderRadius: 8, background: "#000", objectFit: "contain" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Final cut ready</div>
                      <p className="muted-sm" style={{ marginTop: 4, marginBottom: 14 }}>
                        Stitched {videosReadyCount} clips into one 9:16 mp4 with overlay text burned in.
                      </p>
                      <div className="row" style={{ gap: 8 }}>
                        <a
                          href={`${brief.final_video_url}${brief.final_video_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${brief.creator_handle}-${brief.product_id}-${brief.target_duration_s}s.mp4`)}`}
                          download={`${brief.creator_handle}-${brief.product_id}-${brief.target_duration_s}s.mp4`}
                          style={{
                            padding: "8px 14px",
                            fontSize: 13,
                            fontWeight: 600,
                            background: "var(--accent)",
                            color: "var(--bg)",
                            border: "1px solid var(--accent)",
                            borderRadius: 4,
                            textDecoration: "none",
                          }}
                        >
                          ↓ Download mp4
                        </a>
                        <a
                          href={brief.final_video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "8px 14px",
                            fontSize: 13,
                            fontWeight: 600,
                            background: "transparent",
                            color: "var(--text-2)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            textDecoration: "none",
                          }}
                        >
                          ↗ Open in new tab
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                {stitchError && <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>{stitchError}</p>}
              </div>
              )}

              {(brief.frames?.length ?? 0) > 0 && (
                <div className="card" style={{ marginTop: 20 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <span className="eyebrow">Send to creator</span>
                      <h2 style={{ marginTop: 4 }}>
                        {brief.final_video_url ? "Deliver final cut" : "Send preview"}
                      </h2>
                      <p className="muted-sm" style={{ marginTop: 6, maxWidth: 540 }}>
                        {brief.final_video_url
                          ? "Drops the stitched MP4 in WhatsApp with a download link to the public handoff page."
                          : (brief.frames?.some((f) => f.video_status === "ready")
                              ? "Sends the shot clips that are ready, with a download link to the handoff page."
                              : "Sends a frame preview with the hook + CTA + handoff link — render videos to upgrade to a full delivery.")}
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
                      className={deliveryChannel === "whatsapp" ? "" : "btn-ghost"}
                      onClick={() => setDeliveryChannel("whatsapp")}
                      style={{ padding: "6px 14px", fontSize: 13 }}
                    >WhatsApp (Periskope)</button>
                    <button
                      className={deliveryChannel === "email" ? "" : "btn-ghost"}
                      onClick={() => setDeliveryChannel("email")}
                      style={{ padding: "6px 14px", fontSize: 13 }}
                      disabled={!brief.final_video_url}
                      title={brief.final_video_url ? "" : "Email needs the final stitched cut"}
                    >Email (Resend)</button>
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18, marginTop: 12, alignItems: "flex-start" }}>
                      <div>
                        <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>
                              Creator phone (country code, no +)
                            </label>
                            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="14155550123" style={{ width: "100%" }} />
                          </div>
                          <button onClick={sendToWhatsApp} disabled={sending || !phone.trim()}>
                            {sending ? "Sending…" : brief.delivery?.channel === "whatsapp" && brief.delivery.status === "sent" ? "Re-send" : "Send to WhatsApp"}
                          </button>
                        </div>
                        <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setPhone(TEST_PHONE)}
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            title="Pre-fill the Periskope test allowlist number (+91 8017920654)"
                          >Use test number</button>
                          <span className="muted-sm" style={{ fontSize: 11 }}>
                            Test mode active — only <code>{TEST_PHONE}</code> receives until <code>PERISKOPE_TEST_MODE=false</code> on Railway.
                          </span>
                        </div>
                      </div>

                      {/* Bot / chat-bubble preview — shows what WhatsApp will render */}
                      <WhatsAppPreview brief={brief} testPhone={TEST_PHONE} phone={phone} />
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
  const downloadName = `shot_${String(frame.shot_idx + 1).padStart(2, "0")}.mp4`;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ position: "relative", aspectRatio: "9/16", borderRadius: 6, overflow: "hidden", background: "#000" }}>
        {frame.video_url ? (
          <video
            src={frame.video_url}
            controls
            playsInline
            preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          />
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

      {status === "ready" && frame.video_url && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <a
            href={`${frame.video_url}${frame.video_url.includes("?") ? "&" : "?"}download=${encodeURIComponent(downloadName)}`}
            download={downloadName}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              fontSize: 11,
              fontWeight: 600,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            ↓ Download
          </a>
          <a
            href={frame.video_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              fontSize: 11,
              fontWeight: 600,
              background: "transparent",
              color: "var(--text-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            ↗ Open
          </a>
        </div>
      )}

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
  videoBusy,
  openrouterReady,
  onAction,
  onRenderVideo,
}: {
  shot: Shot;
  frame: Frame | undefined;
  busy: boolean;
  videoBusy: boolean;
  openrouterReady: boolean;
  onAction: (action: "regenerate" | "approve" | "unapprove", extra?: { prompt_override?: string; feedback?: string }) => void;
  onRenderVideo: () => void;
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

  const videoStatus = frame?.video_status ?? "idle";
  const canRenderVideo = status === "approved" && (videoStatus === "idle" || videoStatus === "failed");

  function handleRenderVideo() {
    if (!openrouterReady) return;
    if (!confirm(`Render Shot ${shot.idx + 1} as an 8s video via OpenRouter → Veo 3.1 Lite (~$0.40, audio on)?`)) return;
    onRenderVideo();
  }

  return (
    <div className="card">
      <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {/* If the per-shot clip is ready, show it INLINE here. Otherwise show the still frame. */}
          {videoStatus === "ready" && frame?.video_url ? (
            <video
              src={frame.video_url}
              controls
              playsInline
              poster={frame.image_url}
              style={{ width: "100%", borderRadius: 8, aspectRatio: "9/16", objectFit: "cover", background: "#000" }}
            />
          ) : frame?.image_url ? (
            <div style={{ position: "relative" }}>
              <img
                src={frame.image_url}
                alt={`Shot ${shot.idx + 1}`}
                style={{ width: "100%", borderRadius: 8, aspectRatio: "9/16", objectFit: "cover", background: "#000" }}
              />
              {videoStatus === "pending" && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 8,
                  background: "rgba(0,0,0,0.55)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 12, fontWeight: 600,
                }}>
                  Rendering video…
                </div>
              )}
            </div>
          ) : (
            <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: 8, background: "#1a1a22", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12, textAlign: "center", padding: 12 }}>
              {status === "pending" ? "Generating…" : status === "failed" ? "Failed" : "No frame yet"}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <span className={`badge badge-${statusBadgeClass}`}>frame · {status}</span>
            {videoStatus !== "idle" && (
              <span
                className={`badge badge-${videoStatus === "ready" ? "succeeded" : videoStatus === "failed" ? "failed" : "pending"}`}
                style={{ marginLeft: 6 }}
              >
                video · {videoStatus}
              </span>
            )}
            {frame?.error && <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 6 }}>{frame.error}</p>}
            {frame?.video_error && <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 6 }}>video: {frame.video_error}</p>}

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
                  disabled={busy || videoStatus === "pending"}
                  title={videoStatus === "pending" ? "Wait for video to finish rendering" : undefined}
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

            {/* Per-shot video render — surfaces the moment a frame is approved.
                This is the path the user wants: approve one image → immediately
                generate the video for it, without waiting for the whole batch. */}
            {status === "approved" && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #23232f" }}>
                {videoStatus === "ready" ? (
                  <div className="row" style={{ gap: 6 }}>
                    <a
                      href={frame?.video_url}
                      download={`shot_${shot.idx + 1}.mp4`}
                      style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)" }}
                    >
                      Download mp4
                    </a>
                    <button
                      style={{ padding: "4px 10px", fontSize: 12, background: "transparent", color: "var(--text-2)", borderColor: "var(--border-strong)" }}
                      onClick={handleRenderVideo}
                      disabled={videoBusy || !openrouterReady}
                      title={!openrouterReady ? "OPENROUTER_API_KEY not set on Railway" : undefined}
                    >
                      {videoBusy ? "Re-rendering…" : "Re-render"}
                    </button>
                  </div>
                ) : (
                  <button
                    style={{ padding: "6px 12px", fontSize: 12, background: "var(--gold)", borderColor: "var(--gold)", color: "var(--accent-fg)", fontWeight: 600 }}
                    onClick={handleRenderVideo}
                    disabled={videoBusy || videoStatus === "pending" || !openrouterReady}
                    title={!openrouterReady ? "OPENROUTER_API_KEY not set on Railway" : "Render this shot as an 8s video with audio via Veo 3.1 Lite"}
                  >
                    {videoStatus === "pending" || videoBusy
                      ? "Rendering…"
                      : videoStatus === "failed"
                        ? "Retry video"
                        : "🎬 Generate video for this shot"}
                  </button>
                )}
              </div>
            )}
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

// WhatsApp chat-bubble preview — the "bot" panel beside the Send form.
// Renders what the recipient will actually see: media thumbnail, hook in
// bold, brief metadata, CTA in italics, and the handoff URL. Updates live
// as the operator types the phone number and as the brief state changes.
function WhatsAppPreview({ brief, testPhone, phone }: { brief: Brief; testPhone: string; phone: string }) {
  const recipient = (phone || testPhone).replace(/[^0-9]/g, "");
  const previewRecipient = recipient
    ? `+${recipient.slice(0, 2)} ${recipient.slice(2, 7)} ${recipient.slice(7)}`.trim()
    : `+${testPhone}`;

  // Same fallback the deliver route uses: stitched mp4 → first ready clip → first ready frame
  const finalUrl = brief.final_video_url ?? null;
  const firstClip = brief.frames?.find((f) => f.video_status === "ready" && f.video_url) ?? null;
  const firstFrame = brief.frames?.find((f) => f.status === "ready" && f.image_url) ?? null;
  const mediaUrl = finalUrl ?? firstClip?.video_url ?? firstFrame?.image_url ?? null;
  const mediaKind: "video" | "image" = finalUrl || firstClip ? "video" : "image";

  const hook = brief.storyboard?.hook ?? `Your @${brief.creator_handle} brief`;
  const meta = `${brief.storyboard?.shots?.length ?? brief.frames?.length ?? "?"} shots · ${brief.target_duration_s}s`;
  const cta = brief.storyboard?.cta;
  const handoffUrl = `/handoff/${brief.id}`;
  const delivered = brief.delivery?.status === "sent";

  return (
    <div style={{
      border: "1px solid #e3e3e3",
      borderRadius: 14,
      background: "#e5ddd5",
      padding: 14,
      boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
    }}>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="eyebrow" style={{ fontSize: 10, color: "#506069" }}>Preview · WhatsApp bot</span>
        <span style={{ fontSize: 10, color: "#506069", fontFamily: "monospace" }}>To {previewRecipient}</span>
      </div>
      <div style={{
        background: "#dcf8c6",
        borderRadius: "10px 10px 2px 10px",
        padding: 8,
        maxWidth: "100%",
        marginLeft: "auto",
        fontSize: 13,
        color: "#222",
        boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
      }}>
        {mediaUrl && (
          <div style={{ background: "#000", borderRadius: 6, overflow: "hidden", marginBottom: 6, aspectRatio: "9 / 16", maxHeight: 240 }}>
            {mediaKind === "video" ? (
              <video
                src={mediaUrl}
                muted
                playsInline
                preload="metadata"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <img
                src={mediaUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            )}
          </div>
        )}
        <div style={{ lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
          <strong>“{hook}”</strong>
          {"\n"}
          <span style={{ fontWeight: 600 }}>{meta}</span>
          {cta && (
            <>
              {"\n\n"}
              CTA: <em>{cta}</em>
            </>
          )}
          {"\n\n"}
          {finalUrl ? "Tap the video to preview, or download here:" : "Open the brief:"}
          {"\n"}
          <span style={{ color: "#1f6dd0", textDecoration: "underline" }}>{handoffUrl}</span>
        </div>
        <div style={{ textAlign: "right", marginTop: 4, fontSize: 10, color: "#7b8a90" }}>
          {delivered ? (
            <>
              {brief.delivery?.sent_at ? new Date(brief.delivery.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
              {" "}
              <span style={{ color: "#34b7f1" }}>✓✓</span>
            </>
          ) : (
            <>not sent yet</>
          )}
        </div>
      </div>
    </div>
  );
}
