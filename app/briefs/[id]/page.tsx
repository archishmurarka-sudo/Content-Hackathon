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

  async function generateAllFrames() {
    setGeneratingFrames(true);
    await fetch(`/api/briefs/${id}/frames`, { method: "POST" });
    setGeneratingFrames(false);
    load();
  }

  async function shotAction(idx: number, action: "regenerate" | "approve" | "unapprove") {
    setPerShotBusy((b) => ({ ...b, [idx]: true }));
    await fetch(`/api/briefs/${id}/frames/${idx}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setPerShotBusy((b) => ({ ...b, [idx]: false }));
    load();
  }

  if (!brief) return <div className="container"><p className="muted">Loading…</p></div>;

  const framesByIdx: Record<number, Frame> = {};
  (brief.frames ?? []).forEach((f) => (framesByIdx[f.shot_idx] = f));
  const allApproved = brief.frames && brief.frames.length > 0 && brief.frames.every((f) => f.status === "approved");

  return (
    <div className="container">
      <p><Link href="/" className="muted">← Back</Link></p>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Brief for @{brief.creator_handle}</h1>
          <p className="muted">{brief.product_id} · target {brief.target_duration_s}s · <span className={`badge badge-${brief.status}`}>{brief.status.replace(/_/g, " ")}</span></p>
        </div>
        <div className="row">
          <button onClick={regenStoryboard} disabled={regenerating || brief.status === "generating_storyboard"}>
            {regenerating ? "Regenerating…" : "Regenerate script"}
          </button>
        </div>
      </div>

      {brief.error && <div className="card" style={{ borderColor: "#ff6b6b", marginTop: 16 }}>
        <p style={{ color: "#ff6b6b", margin: 0 }}>Error: {brief.error}</p>
      </div>}

      {brief.status === "generating_storyboard" && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted">Gemini is drafting the storyboard…</p>
        </div>
      )}

      {brief.storyboard && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#9a9aa8" }}>Hook</div>
            <p style={{ fontSize: 20, fontWeight: 600, margin: "6px 0" }}>"{brief.storyboard.hook}"</p>
            <div className="muted" style={{ marginTop: 8 }}>{brief.storyboard.rationale}</div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Inspired by video IDs: {brief.storyboard.inspired_by_video_ids.join(", ")}
            </div>
          </div>

          <div className="row" style={{ marginTop: 24, justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Storyboard · {brief.storyboard.shots.length} shots · {brief.storyboard.total_duration_s}s</h2>
            <div className="row">
              {!brief.frames || brief.frames.length === 0 ? (
                <button onClick={generateAllFrames} disabled={generatingFrames}>
                  {generatingFrames ? "Generating frames…" : "Generate frame images"}
                </button>
              ) : (
                <button onClick={generateAllFrames} disabled={generatingFrames}>
                  {generatingFrames ? "Regenerating all…" : "Regenerate all frames"}
                </button>
              )}
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            {brief.storyboard.shots.map((s) => {
              const f = framesByIdx[s.idx];
              return (
                <div key={s.idx} className="card">
                  <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                    <div style={{ width: 220, flexShrink: 0 }}>
                      {f?.image_url ? (
                        <img src={f.image_url} alt={`Shot ${s.idx + 1}`} style={{ width: "100%", borderRadius: 8, aspectRatio: "9/16", objectFit: "cover", background: "#000" }} />
                      ) : (
                        <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: 8, background: "#1a1a22", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12, textAlign: "center", padding: 12 }}>
                          {f?.status === "pending" ? "Generating…" : f?.status === "failed" ? "Failed" : "No frame yet"}
                        </div>
                      )}
                      {f && (
                        <div style={{ marginTop: 8 }}>
                          <span className={`badge badge-${f.status === "approved" ? "succeeded" : f.status === "ready" ? "storyboard_ready" : f.status === "failed" ? "failed" : "pending"}`}>
                            {f.status}
                          </span>
                          {f.error && <p style={{ color: "#ff6b6b", fontSize: 11, marginTop: 6 }}>{f.error}</p>}
                          <div className="row" style={{ marginTop: 8 }}>
                            <button
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => shotAction(s.idx, "regenerate")}
                              disabled={perShotBusy[s.idx]}
                            >
                              {perShotBusy[s.idx] ? "…" : "Regenerate"}
                            </button>
                            {f.status === "ready" ? (
                              <button
                                style={{ padding: "4px 10px", fontSize: 12, background: "#4ade80", borderColor: "#4ade80" }}
                                onClick={() => shotAction(s.idx, "approve")}
                                disabled={perShotBusy[s.idx]}
                              >
                                Approve
                              </button>
                            ) : f.status === "approved" ? (
                              <button
                                style={{ padding: "4px 10px", fontSize: 12 }}
                                onClick={() => shotAction(s.idx, "unapprove")}
                                disabled={perShotBusy[s.idx]}
                              >
                                Unapprove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <strong>Shot {s.idx + 1} · {s.duration_s}s</strong>
                        <span className="muted">{s.speech_tone} · {s.product_action} · {s.transition}</span>
                      </div>
                      <p style={{ marginTop: 12, fontSize: 16 }}><strong>Speech:</strong> {s.speech}</p>
                      {s.overlay && <p className="muted" style={{ fontSize: 13 }}><strong>Overlay:</strong> {s.overlay}</p>}
                      <p className="muted" style={{ fontSize: 13 }}><strong>Visual:</strong> {s.visual}</p>
                      <details style={{ marginTop: 8 }}>
                        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Image + video prompts</summary>
                        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}><strong>image_prompt:</strong> {s.image_prompt}</p>
                        <p className="muted" style={{ fontSize: 12 }}><strong>video_prompt:</strong> {s.video_prompt}</p>
                      </details>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#9a9aa8" }}>CTA</div>
            <p style={{ fontSize: 18, marginTop: 6 }}>"{brief.storyboard.cta}"</p>
          </div>

          {allApproved && (
            <div className="card" style={{ marginTop: 16, borderColor: "#4ade80" }}>
              <p style={{ margin: 0 }}>
                <strong>All frames approved.</strong> Ready for video render → Periskope delivery (next stage).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
