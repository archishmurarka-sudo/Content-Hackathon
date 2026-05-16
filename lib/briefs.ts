import type { Storyboard } from "./storyboard";

export type BriefStatus =
  | "generating_storyboard"
  | "storyboard_ready"
  | "frames_pending"
  | "frames_approved"
  | "videos_pending"
  | "delivered"
  | "failed";

export type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: BriefStatus;
  storyboard?: Storyboard;
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
}): Brief {
  const brief: Brief = {
    id: uid(),
    creator_handle: input.creator_handle,
    product_id: input.product_id,
    target_duration_s: input.target_duration_s,
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

export function patchShot(id: string, shotIdx: number, patch: Partial<NonNullable<Brief["storyboard"]>["shots"][number]>) {
  const b = store.get(id);
  if (!b?.storyboard) return;
  const shot = b.storyboard.shots[shotIdx];
  if (!shot) return;
  b.storyboard.shots[shotIdx] = { ...shot, ...patch };
  b.updated_at = Date.now();
  store.set(id, b);
}
