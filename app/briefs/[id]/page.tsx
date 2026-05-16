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
};

export default function BriefDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [perShotBusy, setPerShotBusy] = useState<Record<number, boolean>>({});

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

  if (!brief) return <div className="container"><p className="muted">Loading…</p></div>;

  const framesByIdx: Record<number, Frame> = {};
  (brief.frames ?? []).forEach((f) => (framesByIdx[f.shot_idx] = f));
  const allApproved = brief.frames && brief.frames.length > 0 && brief.frames.every((f) => f.status === "approved");

  // Pipeline stage index: 0=storyboard, 1=frames generating, 2=frames ready, 3=approved, 4=delivered
  const stageIdx = (() => {
    if (brief.status === "delivered") return 4;
    if (brief.status === "frames_approved" || brief.status === "videos_pending") return 3;
    if (brief.status === "frames_ready") return 2;
    if (brief.status === "frames_pending") return 1;
    return 0;
  })();

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
          { label: "Video render", sub: "Higgsfield (queued)" },
          { label: "Delivered", sub: "Periskope (queued)" },
        ].map((step, i) => (
          <div key={i} className={`pipeline-step ${i < stageIdx ? "done" : i === stageIdx ? "active" : ""}`}>
            <strong>{step.label}</strong>
            <span>{step.sub}</span>
          </div>
        ))}
      </div>

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
              <div className="eyebrow" style={{ color: "var(--accent)" }}>All frames approved</div>
              <p style={{ margin: "6px 0 0", color: "var(--text-2)" }}>
                Ready for video render → Periskope delivery (next stage).
              </p>
            </div>
          )}
        </>
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
