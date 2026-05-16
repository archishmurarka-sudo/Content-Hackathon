// Append-only event log. Every regen, approval, render, and send writes
// here so we can later train a model on operator-preference signal:
//
//   - "the operator approved this image_prompt → this image" = positive
//   - "the operator regenerated this image with this feedback → new image" = correction
//   - "the operator regenerated the script entirely" = the storyboard wasn't good
//   - "the operator re-rendered shot N" = the video wasn't good
//
// logEvent() is fire-and-forget — any failure is swallowed so logging can
// never break a user-facing action. Without Postgres we silently skip; we
// don't run an in-memory fallback because that would defeat the purpose
// (we'd lose the signal on every redeploy).

import { hasDb, sql, ensureSchema } from "./db";

export type EventType =
  // storyboard
  | "brief.created"
  | "brief.storyboard_ready"
  | "brief.regenerate_script"
  | "brief.failed"
  // frames
  | "frame.generated"           // auto-generation pass
  | "frame.regenerated"         // single-shot regen, possibly with prompt_override + feedback
  | "frame.approved"
  | "frame.unapproved"
  | "frame.batch_regenerated"   // "Regenerate all frames"
  // video
  | "video.render_started"
  | "video.render_completed"
  | "video.render_failed"
  // stitch
  | "stitch.completed"
  | "stitch.failed"
  // delivery
  | "send.email"
  | "send.whatsapp"
  | "send.failed";

export type LogEventInput = {
  type: EventType;
  brief_id: string;
  shot_idx?: number;
  // Free-form input. For frame regens: { original_prompt, prompt_override, feedback }.
  // For video render: { image_url, video_prompt, model }.
  payload?: Record<string, unknown>;
  // Free-form result. For frame regens: { new_image_url, latency_ms } or { error }.
  outcome?: Record<string, unknown>;
};

export async function logEvent(input: LogEventInput): Promise<void> {
  if (!hasDb()) return;
  try {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO events (brief_id, shot_idx, type, payload, outcome, created_at)
      VALUES (
        ${input.brief_id},
        ${input.shot_idx ?? null},
        ${input.type},
        ${input.payload ? s.json(input.payload) : null},
        ${input.outcome ? s.json(input.outcome) : null},
        ${Date.now()}
      )
    `;
  } catch (err) {
    // never throw out of a log call
    console.warn("[events] logEvent failed:", err);
  }
}

export type StoredEvent = {
  id: number;
  brief_id: string;
  shot_idx: number | null;
  type: EventType;
  payload: Record<string, unknown> | null;
  outcome: Record<string, unknown> | null;
  created_at: number;
};

export async function listEvents(opts?: {
  brief_id?: string;
  type?: EventType;
  limit?: number;
}): Promise<StoredEvent[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const s = sql();
  const limit = Math.min(opts?.limit ?? 500, 5000);

  let rows: any[];
  if (opts?.brief_id && opts?.type) {
    rows = await s`SELECT * FROM events WHERE brief_id = ${opts.brief_id} AND type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (opts?.brief_id) {
    rows = await s`SELECT * FROM events WHERE brief_id = ${opts.brief_id} ORDER BY created_at DESC LIMIT ${limit}`;
  } else if (opts?.type) {
    rows = await s`SELECT * FROM events WHERE type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit}`;
  } else {
    rows = await s`SELECT * FROM events ORDER BY created_at DESC LIMIT ${limit}`;
  }

  return rows.map((r) => ({
    id: Number(r.id),
    brief_id: r.brief_id,
    shot_idx: r.shot_idx == null ? null : Number(r.shot_idx),
    type: r.type as EventType,
    payload: r.payload ?? null,
    outcome: r.outcome ?? null,
    created_at: Number(r.created_at),
  }));
}

export async function countEvents(): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`SELECT COUNT(*)::int AS n FROM events`;
  return (rows[0] as any).n as number;
}
