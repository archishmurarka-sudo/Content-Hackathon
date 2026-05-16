import type { Storyboard } from "./storyboard";
import type { YouTubeVideo } from "./youtube";

export type BriefStatus =
  | "generating_storyboard"
  | "storyboard_ready"
  | "frames_pending"
  | "frames_ready"
  | "frames_approved"
  | "videos_pending"
  | "delivered"
  | "failed";

export type FrameStatus = "pending" | "ready" | "approved" | "failed";

export type Frame = {
  shot_idx: number;
  status: FrameStatus;
  image_url?: string;
  image_key?: string;
  prompt: string;
  error?: string;
  updated_at: number;
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
  error?: string;
  created_at: number;
  updated_at: number;
};

const g = globalThis as unknown as { __briefs?: Map<string, Brief> };
const store: Map<string, Brief> = g.__briefs ?? new Map();
g.__briefs = store;

function uid() {
  return `brief_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createBrief(input: {
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  youtube_ref?: YouTubeVideo;
}): Brief {
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
  store.set(brief.id, brief);
  return brief;
}

export function setStoryboard(id: string, storyboard: Storyboard) {
  const b = store.get(id);
  if (!b) return;
  b.storyboard = storyboard;
  b.status = "storyboard_ready";
  b.updated_at = Date.now();
  store.set(id, b);
}

export function setFailed(id: string, error: string) {
  const b = store.get(id);
  if (!b) return;
  b.status = "failed";
  b.error = error;
  b.updated_at = Date.now();
  store.set(id, b);
}

export function getBrief(id: string) {
  return store.get(id);
}

export function listBriefs() {
  return Array.from(store.values()).sort((a, b) => b.created_at - a.created_at);
}

export function deleteBrief(id: string): boolean {
  return store.delete(id);
}

export function purgeFailed(): number {
  let n = 0;
  for (const [id, b] of store.entries()) {
    if (b.status === "failed") {
      store.delete(id);
      n++;
    }
  }
  return n;
}

export function patchShot(id: string, shotIdx: number, patch: Partial<NonNullable<Brief["storyboard"]>["shots"][number]>) {
  const b = store.get(id);
  if (!b?.storyboard) return;
  const shot = b.storyboard.shots[shotIdx];
  if (!shot) return;
  b.storyboard.shots[shotIdx] = { ...shot, ...patch };
  b.updated_at = Date.now();
  store.set(id, b);
}

export function initFrames(id: string) {
  const b = store.get(id);
  if (!b?.storyboard) return;
  b.frames = b.storyboard.shots.map((s) => ({
    shot_idx: s.idx,
    status: "pending" as FrameStatus,
    prompt: s.image_prompt,
    updated_at: Date.now(),
  }));
  b.status = "frames_pending";
  b.updated_at = Date.now();
  store.set(id, b);
}

export function setFrame(id: string, shot_idx: number, patch: Partial<Frame>) {
  const b = store.get(id);
  if (!b?.frames) return;
  const i = b.frames.findIndex((f) => f.shot_idx === shot_idx);
  if (i < 0) return;
  b.frames[i] = { ...b.frames[i], ...patch, updated_at: Date.now() };
  b.updated_at = Date.now();
  // Roll up status
  if (b.frames.every((f) => f.status === "approved")) b.status = "frames_approved";
  else if (b.frames.every((f) => f.status === "ready" || f.status === "approved")) b.status = "frames_ready";
  else if (b.frames.some((f) => f.status === "pending")) b.status = "frames_pending";
  store.set(id, b);
}
