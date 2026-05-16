// Brief storage. Postgres-backed when DATABASE_URL is set (Railway), otherwise
// in-memory Map for local dev. Same async API both ways.

import type { Storyboard } from "./storyboard";
import type { YouTubeVideo } from "./youtube";
import { hasDb, sql, ensureSchema } from "./db";

export type BriefStatus =
  | "generating_storyboard"
  | "storyboard_ready"
  | "frames_pending"
  | "frames_ready"
  | "frames_approved"
  | "videos_pending"
  | "videos_ready"
  | "delivered"
  | "failed";

export type FrameStatus = "pending" | "ready" | "approved" | "failed";
export type VideoStatus = "idle" | "pending" | "ready" | "failed";

export type Frame = {
  shot_idx: number;
  status: FrameStatus;
  image_url?: string;
  image_key?: string;
  prompt: string;
  error?: string;
  // Video clip for this shot (image-to-video render).
  video_status?: VideoStatus;
  video_url?: string;
  video_key?: string;
  video_model?: string;
  video_error?: string;
  updated_at: number;
};

export type DeliveryStatus = "queued" | "sent" | "failed";
export type DeliveryChannel = "email" | "whatsapp";
export type Delivery = {
  status: DeliveryStatus;
  channel: DeliveryChannel;
  to: string;
  message_id?: string;
  subject?: string;
  error?: string;
  sent_at?: number;
};

export type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: BriefStatus;
  storyboard?: Storyboard;
  frames?: Frame[];
  youtube_ref?: YouTubeVideo;
  delivery?: Delivery;
  final_video_url?: string;
  final_video_key?: string;
  error?: string;
  created_at: number;
  updated_at: number;
};

// --- in-memory fallback (used when DATABASE_URL is not set) ---
const g = globalThis as unknown as { __briefs?: Map<string, Brief> };
const memStore: Map<string, Brief> = g.__briefs ?? new Map();
g.__briefs = memStore;

function uid() {
  return `brief_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- generic helpers ---
function rollupStatus(frames: Frame[] | undefined, currentStatus: BriefStatus): BriefStatus {
  if (!frames || frames.length === 0) return currentStatus;
  // Video stages take precedence once the user starts rendering.
  const anyVideoStarted = frames.some((f) => f.video_status && f.video_status !== "idle");
  if (anyVideoStarted) {
    if (frames.every((f) => f.video_status === "ready")) {
      // Stay in "delivered" once we've delivered; otherwise mark videos_ready.
      return currentStatus === "delivered" ? "delivered" : "videos_ready";
    }
    if (frames.some((f) => f.video_status === "pending")) return "videos_pending";
  }
  if (frames.every((f) => f.status === "approved")) return "frames_approved";
  if (frames.every((f) => f.status === "ready" || f.status === "approved")) return "frames_ready";
  if (frames.some((f) => f.status === "pending")) return "frames_pending";
  return currentStatus;
}

// ---------- DB-backed implementation ----------
async function dbInsert(brief: Brief): Promise<Brief> {
  await ensureSchema();
  const s = sql();
  await s`
    INSERT INTO briefs (id, creator_handle, product_id, target_duration_s, status, storyboard, frames, youtube_ref, delivery, error, created_at, updated_at)
    VALUES (${brief.id}, ${brief.creator_handle}, ${brief.product_id}, ${brief.target_duration_s}, ${brief.status},
            ${brief.storyboard ? s.json(brief.storyboard) : null},
            ${brief.frames ? s.json(brief.frames) : null},
            ${brief.youtube_ref ? s.json(brief.youtube_ref) : null},
            ${brief.delivery ? s.json(brief.delivery) : null},
            ${brief.error ?? null}, ${brief.created_at}, ${brief.updated_at})
  `;
  return brief;
}

async function dbGet(id: string): Promise<Brief | undefined> {
  await ensureSchema();
  const s = sql();
  const rows = await s`SELECT * FROM briefs WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return undefined;
  return rowToBrief(rows[0]);
}

async function dbList(): Promise<Brief[]> {
  await ensureSchema();
  const s = sql();
  const rows = await s`SELECT * FROM briefs ORDER BY created_at DESC LIMIT 200`;
  return rows.map(rowToBrief);
}

async function dbDelete(id: string): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const res = await s`DELETE FROM briefs WHERE id = ${id}`;
  return res.count > 0;
}

async function dbPurgeFailed(): Promise<number> {
  await ensureSchema();
  const s = sql();
  const res = await s`DELETE FROM briefs WHERE status = 'failed'`;
  return res.count;
}

async function dbUpdate(id: string, patch: Partial<Brief>): Promise<Brief | undefined> {
  await ensureSchema();
  const s = sql();
  const current = await dbGet(id);
  if (!current) return undefined;
  const merged: Brief = { ...current, ...patch, updated_at: Date.now() };
  await s`
    UPDATE briefs SET
      status = ${merged.status},
      storyboard = ${merged.storyboard ? s.json(merged.storyboard) : null},
      frames = ${merged.frames ? s.json(merged.frames) : null},
      youtube_ref = ${merged.youtube_ref ? s.json(merged.youtube_ref) : null},
      delivery = ${merged.delivery ? s.json(merged.delivery) : null},
      final_video_url = ${merged.final_video_url ?? null},
      final_video_key = ${merged.final_video_key ?? null},
      error = ${merged.error ?? null},
      updated_at = ${merged.updated_at}
    WHERE id = ${id}
  `;
  return merged;
}

function rowToBrief(r: any): Brief {
  return {
    id: r.id,
    creator_handle: r.creator_handle,
    product_id: r.product_id,
    target_duration_s: Number(r.target_duration_s),
    status: r.status as BriefStatus,
    storyboard: r.storyboard ?? undefined,
    frames: r.frames ?? undefined,
    youtube_ref: r.youtube_ref ?? undefined,
    delivery: r.delivery ?? undefined,
    final_video_url: r.final_video_url ?? undefined,
    final_video_key: r.final_video_key ?? undefined,
    error: r.error ?? undefined,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

// ---------- Public API (auto-routes to DB or memory) ----------

export async function createBrief(input: {
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  youtube_ref?: YouTubeVideo;
}): Promise<Brief> {
  const brief: Brief = {
    id: uid(),
    creator_handle: input.creator_handle,
    product_id: input.product_id,
    target_duration_s: input.target_duration_s,
    youtube_ref: input.youtube_ref,
    status: "generating_storyboard",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  if (hasDb()) return dbInsert(brief);
  memStore.set(brief.id, brief);
  return brief;
}

export async function getBrief(id: string): Promise<Brief | undefined> {
  if (hasDb()) return dbGet(id);
  return memStore.get(id);
}

export async function listBriefs(): Promise<Brief[]> {
  if (hasDb()) return dbList();
  return Array.from(memStore.values()).sort((a, b) => b.created_at - a.created_at);
}

export async function deleteBrief(id: string): Promise<boolean> {
  if (hasDb()) return dbDelete(id);
  return memStore.delete(id);
}

export async function purgeFailed(): Promise<number> {
  if (hasDb()) return dbPurgeFailed();
  let n = 0;
  for (const [id, b] of memStore.entries()) {
    if (b.status === "failed") {
      memStore.delete(id);
      n++;
    }
  }
  return n;
}

export async function setStoryboard(id: string, storyboard: Storyboard): Promise<void> {
  if (hasDb()) {
    await dbUpdate(id, { storyboard, status: "storyboard_ready" });
    return;
  }
  const b = memStore.get(id);
  if (!b) return;
  b.storyboard = storyboard;
  b.status = "storyboard_ready";
  b.updated_at = Date.now();
  memStore.set(id, b);
}

export async function setFailed(id: string, error: string): Promise<void> {
  if (hasDb()) {
    await dbUpdate(id, { status: "failed", error });
    return;
  }
  const b = memStore.get(id);
  if (!b) return;
  b.status = "failed";
  b.error = error;
  b.updated_at = Date.now();
  memStore.set(id, b);
}

export async function initFrames(id: string): Promise<void> {
  const b = await getBrief(id);
  if (!b?.storyboard) return;
  const frames: Frame[] = b.storyboard.shots.map((s) => ({
    shot_idx: s.idx,
    status: "pending" as FrameStatus,
    prompt: s.image_prompt,
    updated_at: Date.now(),
  }));
  if (hasDb()) {
    await dbUpdate(id, { frames, status: "frames_pending" });
    return;
  }
  const mem = memStore.get(id);
  if (!mem) return;
  mem.frames = frames;
  mem.status = "frames_pending";
  mem.updated_at = Date.now();
  memStore.set(id, mem);
}

export async function setFrame(id: string, shot_idx: number, patch: Partial<Frame>): Promise<void> {
  if (hasDb()) {
    const b = await dbGet(id);
    if (!b?.frames) return;
    const frames = b.frames.map((f) =>
      f.shot_idx === shot_idx ? { ...f, ...patch, updated_at: Date.now() } : f
    );
    const newStatus = rollupStatus(frames, b.status);
    await dbUpdate(id, { frames, status: newStatus });
    return;
  }
  const b = memStore.get(id);
  if (!b?.frames) return;
  const i = b.frames.findIndex((f) => f.shot_idx === shot_idx);
  if (i < 0) return;
  b.frames[i] = { ...b.frames[i], ...patch, updated_at: Date.now() };
  b.status = rollupStatus(b.frames, b.status);
  b.updated_at = Date.now();
  memStore.set(id, b);
}

export async function setDelivery(id: string, delivery: Delivery): Promise<void> {
  const status: BriefStatus = delivery.status === "sent" ? "delivered" : (await getBrief(id))?.status ?? "videos_ready";
  if (hasDb()) {
    await dbUpdate(id, { delivery, status });
    return;
  }
  const b = memStore.get(id);
  if (!b) return;
  b.delivery = delivery;
  b.status = status;
  b.updated_at = Date.now();
  memStore.set(id, b);
}

export async function setFinalVideo(id: string, final_video_url: string, final_video_key: string): Promise<void> {
  if (hasDb()) {
    await dbUpdate(id, { final_video_url, final_video_key });
    return;
  }
  const b = memStore.get(id);
  if (!b) return;
  b.final_video_url = final_video_url;
  b.final_video_key = final_video_key;
  b.updated_at = Date.now();
  memStore.set(id, b);
}
