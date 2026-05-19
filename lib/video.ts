// Image-to-video renderer with a provider switch.
//
// VIDEO_PROVIDER=openrouter  → OpenRouter → Google Veo 3.1 Lite (default)
// VIDEO_PROVIDER=higgsfield  → Higgsfield platform API (e.g. DoP / Speak)
//
// Each provider implements the same submit → poll → download contract so
// the caller only needs `renderShotVideoAndStore()`. The result is always
// re-uploaded to our R2 (`/api/assets/...`) so the URL is stable for
// stitching + WhatsApp handoff.
//
// Why Veo 3.1 Lite (default): native synchronized audio + lowest cost in
// the Veo family (~$0.05 / sec → ~$0.40 per 8s clip at 720p). Veo doesn't
// know who our scraped creator is — for character-likeness work, switch
// to Higgsfield (their SoulID can lock onto a reference photo).

import { putAsset, type PutResult } from "./storage";
import { bump } from "./usage";

// ---- shared types ----

export type VideoJob = {
  request_id: string;
  model: string;
  polling_url: string;
  provider: "openrouter" | "higgsfield";
};

export type VideoResult = PutResult & {
  duration_s: number;
  model: string;
};

export type VideoGenContext = {
  brief_id: string;
  shot_idx: number;
  image_url: string;
  prompt: string;
  duration_s?: number;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  generate_audio?: boolean;
  negative_prompt?: string;
  // Higgsfield-specific. When set, the renderer uses SoulID character
  // consistency from this reference photo. Pass the scraped creator's
  // R2-mirrored avatar URL to make the output look like them.
  soul_id_reference?: string;
};

const DEFAULT_RESOLUTION = (process.env.VIDEO_RESOLUTION as "480p" | "720p" | "1080p") || "720p";

function currentProvider(): "openrouter" | "higgsfield" {
  const v = (process.env.VIDEO_PROVIDER ?? "openrouter").toLowerCase();
  return v === "higgsfield" ? "higgsfield" : "openrouter";
}

// ---- public dispatch ----

export async function startVideoJob(opts: VideoGenContext): Promise<VideoJob> {
  if (!opts.image_url) throw new Error("image_url required");
  return currentProvider() === "higgsfield"
    ? startHiggsfield(opts)
    : startOpenRouter(opts);
}

export type JobStatus =
  | { state: "IN_QUEUE" | "IN_PROGRESS" }
  | { state: "COMPLETED"; video_url: string; duration_s: number }
  | { state: "FAILED"; error: string };

export async function getJobStatus(job: VideoJob): Promise<JobStatus> {
  return job.provider === "higgsfield" ? statusHiggsfield(job) : statusOpenRouter(job);
}

export async function pollUntilDone(
  job: VideoJob,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<{ video_url: string; duration_s: number }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await getJobStatus(job);
    if (status.state === "COMPLETED") return { video_url: status.video_url, duration_s: status.duration_s };
    if (status.state === "FAILED") throw new Error(status.error);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`video job timed out after ${timeoutMs}ms`);
}

export async function renderShotVideoAndStore(opts: VideoGenContext): Promise<VideoResult> {
  const job = await startVideoJob(opts);
  const result = await pollUntilDone(job, { timeoutMs: 8 * 60 * 1000, intervalMs: 5000 });
  bump("video_render");
  const stored = await downloadAndStore(result.video_url, opts.brief_id, opts.shot_idx, job.provider);
  return { ...stored, duration_s: result.duration_s, model: job.model };
}

// ---- download → R2 ----

async function downloadAndStore(
  remoteUrl: string,
  brief_id: string,
  shot_idx: number,
  provider: "openrouter" | "higgsfield",
): Promise<PutResult> {
  const headers: Record<string, string> = {};
  if (provider === "openrouter" && remoteUrl.includes("openrouter.ai/api/v1/videos/") && remoteUrl.includes("/content")) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`;
  } else if (provider === "higgsfield" && remoteUrl.includes("platform.higgsfield.ai")) {
    // Higgsfield-hosted result URLs are typically signed and don't need auth,
    // but if we ever fall through to a job-content endpoint, the same key works.
    const k = process.env.HIGGSFIELD_API_KEY;
    if (k) headers.Authorization = `Bearer ${k}`;
  }
  const res = await fetch(remoteUrl, { headers });
  if (!res.ok) throw new Error(`video download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "video/mp4";
  return putAsset({
    prefix: `briefs/${brief_id}/videos/shot_${shot_idx}`,
    ext: "mp4",
    body: buf,
    contentType,
  });
}

// =========================================================================
// OpenRouter (default) — Veo 3.1 Lite via /api/v1/videos
// =========================================================================

const OR_BASE = "https://openrouter.ai/api/v1";
const OR_DEFAULT_MODEL = process.env.VIDEO_MODEL || "google/veo-3.1-lite";

function orAuthHeaders() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function startOpenRouter(opts: VideoGenContext): Promise<VideoJob> {
  const model = OR_DEFAULT_MODEL;
  const body = buildOpenRouterBody(model, opts);
  const res = await fetch(`${OR_BASE}/videos`, {
    method: "POST",
    headers: orAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter submit ${res.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await res.json();
  const request_id = data?.id ?? data?.job_id;
  const polling_url: string | undefined = data?.status?.polling_url ?? data?.polling_url;
  if (!request_id) throw new Error(`OpenRouter response missing id: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    request_id,
    model,
    polling_url: polling_url || `${OR_BASE}/videos/${encodeURIComponent(request_id)}`,
    provider: "openrouter",
  };
}

async function statusOpenRouter(job: VideoJob): Promise<JobStatus> {
  const res = await fetch(job.polling_url, { headers: orAuthHeaders() });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter status ${res.status}: ${t.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const raw = String(data?.status?.state ?? data?.status ?? "").toLowerCase();
  if (raw === "completed" || raw === "succeeded" || raw === "done") {
    const url =
      data?.status?.unsigned_urls?.[0] ??
      data?.unsigned_urls?.[0] ??
      data?.video?.url ??
      data?.video_url ??
      `${OR_BASE}/videos/${encodeURIComponent(job.request_id)}/content?index=0`;
    const duration = Number(data?.video?.duration ?? data?.duration ?? data?.request?.duration ?? 8) || 8;
    return { state: "COMPLETED", video_url: url, duration_s: duration };
  }
  if (raw === "failed" || raw === "error" || raw === "cancelled" || raw === "canceled") {
    return { state: "FAILED", error: String(data?.error ?? data?.status?.error ?? "video job failed") };
  }
  return { state: raw === "in_progress" || raw === "running" ? "IN_PROGRESS" : "IN_QUEUE" };
}

// =========================================================================
// Higgsfield — image-to-video via platform API
// =========================================================================
//
// Auth: Authorization: Bearer <HIGGSFIELD_API_KEY> against
// HIGGSFIELD_API_BASE (default https://platform.higgsfield.ai).
// Model id via HIGGSFIELD_VIDEO_MODEL (default "dop" — their cinematic
// image-to-video model).
//
// The exact payload field names below mirror the higgsfield-js (v2) client
// shape. If Higgsfield rejects the body once we point a real key at it,
// the only thing that needs adjusting is buildHiggsfieldBody() + the
// status field accessors in statusHiggsfield() — the dispatch contract
// above is provider-agnostic.

const HF_BASE = (process.env.HIGGSFIELD_API_BASE || "https://platform.higgsfield.ai").replace(/\/$/, "");
const HF_DEFAULT_MODEL = process.env.HIGGSFIELD_VIDEO_MODEL || "dop";

function hfAuthHeaders() {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error("HIGGSFIELD_API_KEY not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function startHiggsfield(opts: VideoGenContext): Promise<VideoJob> {
  const model = HF_DEFAULT_MODEL;
  const body = buildHiggsfieldBody(model, opts);
  const res = await fetch(`${HF_BASE}/v1/jobs`, {
    method: "POST",
    headers: hfAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Higgsfield submit ${res.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await res.json();
  const request_id = data?.id ?? data?.job_id ?? data?.request_id;
  if (!request_id) throw new Error(`Higgsfield response missing id: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    request_id,
    model,
    polling_url: data?.polling_url ?? `${HF_BASE}/v1/jobs/${encodeURIComponent(request_id)}`,
    provider: "higgsfield",
  };
}

async function statusHiggsfield(job: VideoJob): Promise<JobStatus> {
  const res = await fetch(job.polling_url, { headers: hfAuthHeaders() });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Higgsfield status ${res.status}: ${t.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const raw = String(data?.status ?? data?.state ?? "").toLowerCase();
  if (raw === "completed" || raw === "succeeded" || raw === "done" || raw === "success") {
    const url =
      data?.result?.video_url ??
      data?.video_url ??
      data?.output?.video_url ??
      data?.output?.url ??
      data?.media?.url ??
      "";
    if (!url) {
      return { state: "FAILED", error: `Higgsfield reported completion but no video URL: ${JSON.stringify(data).slice(0, 300)}` };
    }
    const duration = Number(data?.result?.duration ?? data?.duration ?? 8) || 8;
    return { state: "COMPLETED", video_url: url, duration_s: duration };
  }
  if (raw === "failed" || raw === "error" || raw === "cancelled" || raw === "canceled") {
    return { state: "FAILED", error: String(data?.error ?? data?.message ?? "Higgsfield job failed") };
  }
  return { state: raw === "in_progress" || raw === "processing" || raw === "running" ? "IN_PROGRESS" : "IN_QUEUE" };
}

// ---- request body shaping ----

function withEnglishAudioGuard(prompt: string): string {
  const head =
    "LANGUAGE LOCK: the audio MUST be clear, native American English. " +
    "The on-camera speaker is American. Do NOT use Hindi, Spanish, Tamil, " +
    "Mandarin, or any non-English language. Do NOT invent gibberish or " +
    "use a heavy accent that obscures pronunciation.\n\n";
  if (/LANGUAGE LOCK|native American English|US English/i.test(prompt)) return prompt;
  return head + prompt;
}

function buildOpenRouterBody(model: string, o: VideoGenContext) {
  const ar = o.aspect_ratio ?? "9:16";
  const duration = clampDuration(o.duration_s ?? 8);
  const prompt = withEnglishAudioGuard(o.prompt);
  if (model.startsWith("google/veo")) {
    return {
      model,
      prompt,
      duration,
      aspect_ratio: ar,
      resolution: DEFAULT_RESOLUTION,
      generate_audio: o.generate_audio ?? true,
      frame_images: [
        {
          type: "image_url",
          frame_type: "first_frame",
          image_url: { url: o.image_url },
        },
      ],
    };
  }
  return {
    model,
    prompt,
    duration,
    aspect_ratio: ar,
    resolution: DEFAULT_RESOLUTION,
    generate_audio: o.generate_audio ?? true,
    input_references: [{ type: "image_url", image_url: { url: o.image_url } }],
  };
}

function buildHiggsfieldBody(model: string, o: VideoGenContext) {
  const ar = o.aspect_ratio ?? "9:16";
  const duration = clampDuration(o.duration_s ?? 8);
  const prompt = withEnglishAudioGuard(o.prompt);
  const body: Record<string, any> = {
    model,                       // "dop" | "speak" | etc.
    prompt,
    duration_seconds: duration,
    aspect_ratio: ar,
    reference_image_url: o.image_url,
    resolution: DEFAULT_RESOLUTION,
  };
  // If the caller passed a SoulID reference (creator avatar), enable
  // character consistency. Higgsfield's SoulID system maps a face to a
  // persistent token; we pass it on every request so the same identity
  // appears across all shots in the brief.
  if (o.soul_id_reference) {
    body.character_reference_url = o.soul_id_reference;
    body.use_soul_id = true;
  }
  return body;
}

function clampDuration(_s: number): number {
  // BOF template lock: always 8s per clip. 2 × 8s = 16s stitched ad.
  return 8;
}
