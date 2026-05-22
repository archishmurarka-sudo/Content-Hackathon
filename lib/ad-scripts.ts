// Persistence for Meta direct-response scripts. DB-backed when DATABASE_URL
// is set, in-memory Map otherwise (same dual mode as lib/briefs.ts).

import { hasDb, sql, ensureSchema } from "./db";
import type { GeneratedScript, CsvRow } from "./script-generator";
import type { ScriptPersona } from "./script-beats";

export type ImageStatus = "idle" | "pending" | "ready" | "failed";
export type VideoStatus = "idle" | "pending" | "ready" | "failed";
export type KeyframesStatus = "idle" | "pending" | "ready" | "partial" | "failed";

export type ScriptKeyframe = {
  idx: number;
  timestamp_s: number;
  voiceover: string;
  visual: string;
  image_url: string | null;
  image_key: string | null;
  image_prompt: string | null;
  status: ImageStatus;
  error: string | null;
};

export type AdScript = {
  id: string;
  product_id: string;
  batch_id: string;
  script_kind: string;
  style: string | null;
  placement: string | null;
  source_ref: string | null;
  script_csv: CsvRow;
  approved: boolean;
  // Static ad image (one per script, generated via OpenAI gpt-image-2).
  image_status?: ImageStatus;
  image_url?: string | null;
  image_key?: string | null;
  image_prompt?: string | null;
  image_error?: string | null;
  // Ad video (one per script, generated via Gemini Veo 3.1 Fast, image-to-video).
  video_status?: VideoStatus;
  video_url?: string | null;
  video_key?: string | null;
  video_prompt?: string | null;
  video_model?: string | null;
  video_error?: string | null;
  // 5-keyframe storyboard for visual-consistency QA. When ready, the first
  // keyframe's image_url is also mirrored onto image_url at the row level
  // so it feeds the Veo first-frame.
  keyframes?: ScriptKeyframe[] | null;
  keyframes_status?: KeyframesStatus;
  // Locked human protagonist (age, gender, ethnicity, wardrobe, vibe, setting,
  // lighting, camera) — stamped onto every keyframe in this script's storyboard
  // so all 5 frames star the same person. Persisted so the UI can show the
  // operator who got cast and so regen can reuse the same persona.
  persona?: ScriptPersona | null;
  // The exact prompt that was sent to Gemini when this script was generated,
  // including the LIVE INTELLIGENCE FROM THE CONNOISSEUR CORPUS block when
  // enrichment was on. Surfaced in the UI ("view prompt" on each script) so
  // the operator can verify what corpus data landed in the request.
  generation_prompt?: string | null;
  generation_model?: string | null;
  // Prompt sent to Gemini at the beat-decomposition / persona-pick stage.
  beats_prompt?: string | null;
  beats_model?: string | null;
  created_at: number;
};

const g = globalThis as unknown as { __ad_scripts?: Map<string, AdScript> };
const mem: Map<string, AdScript> = g.__ad_scripts ?? new Map();
g.__ad_scripts = mem;

function uid(prefix = "script"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newBatchId(): string {
  return uid("batch");
}

export async function insertScripts(args: {
  product_id: string;
  batch_id: string;
  scripts: GeneratedScript[];
  // Same prompt across the whole batch — captured once so a "view prompt"
  // operator action can show exactly what fed Gemini for any script in the
  // batch (including the Connoisseur enrichment block).
  generation_prompt?: string | null;
  generation_model?: string | null;
}): Promise<AdScript[]> {
  const now = Date.now();
  const rows: AdScript[] = args.scripts.map((g) => ({
    id: uid(),
    product_id: args.product_id,
    batch_id: args.batch_id,
    script_kind: g.script_kind,
    style: g.style,
    placement: g.placement,
    source_ref: g.source_ref,
    script_csv: g.csv,
    approved: false,
    generation_prompt: args.generation_prompt ?? null,
    generation_model: args.generation_model ?? null,
    created_at: now,
  }));

  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    for (const r of rows) {
      await s`
        INSERT INTO ad_scripts (id, product_id, batch_id, script_kind, style, placement, source_ref, script_csv, approved, generation_prompt, generation_model, created_at)
        VALUES (${r.id}, ${r.product_id}, ${r.batch_id}, ${r.script_kind}, ${r.style}, ${r.placement}, ${r.source_ref}, ${s.json(r.script_csv as any)}, ${r.approved}, ${r.generation_prompt ?? null}, ${r.generation_model ?? null}, ${r.created_at})
      `;
    }
    return rows;
  }
  for (const r of rows) mem.set(r.id, r);
  return rows;
}

export async function listScriptsForProduct(product_id: string): Promise<AdScript[]> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    const rs = await s`SELECT * FROM ad_scripts WHERE product_id = ${product_id} ORDER BY created_at DESC LIMIT 500`;
    return rs.map(rowToScript);
  }
  return Array.from(mem.values())
    .filter((r) => r.product_id === product_id)
    .sort((a, b) => b.created_at - a.created_at);
}

export async function getScript(id: string): Promise<AdScript | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    const rs = await s`SELECT * FROM ad_scripts WHERE id = ${id} LIMIT 1`;
    if (rs.length === 0) return undefined;
    return rowToScript(rs[0]);
  }
  return mem.get(id);
}

export async function setApproved(id: string, approved: boolean): Promise<AdScript | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`UPDATE ad_scripts SET approved = ${approved} WHERE id = ${id}`;
    return getScript(id);
  }
  const cur = mem.get(id);
  if (!cur) return undefined;
  cur.approved = approved;
  mem.set(id, cur);
  return cur;
}

export async function deleteScript(id: string): Promise<boolean> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    const r = await s`DELETE FROM ad_scripts WHERE id = ${id}`;
    return r.count > 0;
  }
  return mem.delete(id);
}

export async function setScriptImage(
  id: string,
  patch: {
    image_status?: ImageStatus;
    image_url?: string | null;
    image_key?: string | null;
    image_prompt?: string | null;
    image_error?: string | null;
  }
): Promise<AdScript | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      UPDATE ad_scripts SET
        image_status = COALESCE(${patch.image_status ?? null}, image_status),
        image_url    = ${patch.image_url ?? null},
        image_key    = ${patch.image_key ?? null},
        image_prompt = ${patch.image_prompt ?? null},
        image_error  = ${patch.image_error ?? null}
      WHERE id = ${id}
    `;
    return getScript(id);
  }
  const cur = mem.get(id);
  if (!cur) return undefined;
  Object.assign(cur, patch);
  mem.set(id, cur);
  return cur;
}

export async function setScriptKeyframes(
  id: string,
  patch: {
    keyframes?: ScriptKeyframe[] | null;
    keyframes_status?: KeyframesStatus;
    // When the first keyframe is ready, mirror its URL onto image_url so
    // the existing Veo first-frame path picks it up without changes.
    image_url?: string | null;
    image_key?: string | null;
    image_status?: ImageStatus;
    image_prompt?: string | null;
    // Locked human protagonist for this script's storyboard.
    persona?: ScriptPersona | null;
    // Beat-decomposition prompt + model (Gemini Flash call that returned
    // persona + beats).
    beats_prompt?: string | null;
    beats_model?: string | null;
  }
): Promise<AdScript | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      UPDATE ad_scripts SET
        keyframes        = ${patch.keyframes === undefined ? null : (patch.keyframes === null ? null : s.json(patch.keyframes as any))},
        keyframes_status = COALESCE(${patch.keyframes_status ?? null}, keyframes_status),
        image_url        = COALESCE(${patch.image_url ?? null}, image_url),
        image_key        = COALESCE(${patch.image_key ?? null}, image_key),
        image_status     = COALESCE(${patch.image_status ?? null}, image_status),
        image_prompt     = COALESCE(${patch.image_prompt ?? null}, image_prompt),
        persona          = COALESCE(${patch.persona === undefined ? null : s.json(patch.persona as any)}, persona),
        beats_prompt     = COALESCE(${patch.beats_prompt ?? null}, beats_prompt),
        beats_model      = COALESCE(${patch.beats_model ?? null}, beats_model)
      WHERE id = ${id}
    `;
    return getScript(id);
  }
  const cur = mem.get(id);
  if (!cur) return undefined;
  Object.assign(cur, patch);
  mem.set(id, cur);
  return cur;
}

export async function setScriptVideo(
  id: string,
  patch: {
    video_status?: VideoStatus;
    video_url?: string | null;
    video_key?: string | null;
    video_prompt?: string | null;
    video_model?: string | null;
    video_error?: string | null;
  }
): Promise<AdScript | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      UPDATE ad_scripts SET
        video_status = COALESCE(${patch.video_status ?? null}, video_status),
        video_url    = ${patch.video_url ?? null},
        video_key    = ${patch.video_key ?? null},
        video_prompt = ${patch.video_prompt ?? null},
        video_model  = ${patch.video_model ?? null},
        video_error  = ${patch.video_error ?? null}
      WHERE id = ${id}
    `;
    return getScript(id);
  }
  const cur = mem.get(id);
  if (!cur) return undefined;
  Object.assign(cur, patch);
  mem.set(id, cur);
  return cur;
}

function rowToScript(r: any): AdScript {
  return {
    id: r.id,
    product_id: r.product_id,
    batch_id: r.batch_id,
    script_kind: r.script_kind,
    style: r.style ?? null,
    placement: r.placement ?? null,
    source_ref: r.source_ref ?? null,
    script_csv: r.script_csv,
    approved: Boolean(r.approved),
    image_status: (r.image_status as ImageStatus | null) ?? "idle",
    image_url: r.image_url ?? null,
    image_key: r.image_key ?? null,
    image_prompt: r.image_prompt ?? null,
    image_error: r.image_error ?? null,
    video_status: (r.video_status as VideoStatus | null) ?? "idle",
    video_url: r.video_url ?? null,
    video_key: r.video_key ?? null,
    video_prompt: r.video_prompt ?? null,
    video_model: r.video_model ?? null,
    video_error: r.video_error ?? null,
    keyframes: (r.keyframes as ScriptKeyframe[] | null) ?? null,
    keyframes_status: (r.keyframes_status as KeyframesStatus | null) ?? "idle",
    persona: (r.persona as ScriptPersona | null) ?? null,
    generation_prompt: r.generation_prompt ?? null,
    generation_model: r.generation_model ?? null,
    beats_prompt: r.beats_prompt ?? null,
    beats_model: r.beats_model ?? null,
    created_at: Number(r.created_at),
  };
}
