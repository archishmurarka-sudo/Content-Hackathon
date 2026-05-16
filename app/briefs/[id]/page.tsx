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
};

export default function BriefDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [regenerating, setRegenerating] = useState(false);

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

  async function regen() {
    setRegenerating(true);
    await fetch(`/api/briefs/${id}/regenerate`, { method: "POST" });
    setRegenerating(false);
    load();
  }

  if (!brief) return <div className="container"><p className="muted">Loading…</p></div>;

  return (
    <div className="container">
      <p><Link href="/" className="muted">← Back</Link></p>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Brief for @{brief.creator_handle}</h1>
          <p className="muted">{brief.product_id} · target {brief.target_duration_s}s · <span className={`badge badge-${brief.status}`}>{brief.status.replace(/_/g, " ")}</span></p>
        </div>
        <button onClick={regen} disabled={regenerating || brief.status === "generating_storyboard"}>
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
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

          <h2 style={{ marginTop: 24 }}>Storyboard · {brief.storyboard.shots.length} shots · {brief.storyboard.total_duration_s}s</h2>
          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            {brief.storyboard.shots.map((s) => (
              <div key={s.idx} className="card">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Shot {s.idx + 1} · {s.duration_s}s</strong>
                  <span className="muted">{s.speech_tone} · {s.product_action} · {s.transition}</span>
                </div>
                <p style={{ marginTop: 12, fontSize: 16 }}><strong>Speech:</strong> {s.speech}</p>
                {s.overlay && <p className="muted" style={{ fontSize: 13 }}><strong>Overlay:</strong> {s.overlay}</p>}
                <p className="muted" style={{ fontSize: 13 }}><strong>Visual:</strong> {s.visual}</p>
                <details style={{ marginTop: 8 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Image + video prompts (for next stage)</summary>
                  <p className="muted" style={{ fontSize: 12, marginTop: 6 }}><strong>image_prompt:</strong> {s.image_prompt}</p>
                  <p className="muted" style={{ fontSize: 12 }}><strong>video_prompt:</strong> {s.video_prompt}</p>
                </details>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#9a9aa8" }}>CTA</div>
            <p style={{ fontSize: 18, marginTop: 6 }}>"{brief.storyboard.cta}"</p>
          </div>

          <div className="card" style={{ marginTop: 16, borderStyle: "dashed" }}>
            <p className="muted" style={{ margin: 0 }}>
              <strong>Next:</strong> approve this script → generate static frame images per shot → approve frames → render videos via Higgsfield → stitch + deliver to creator via Periskope WhatsApp.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
