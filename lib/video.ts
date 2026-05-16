// Video generation via OpenRouter → Google Veo 3.1 Lite (image-to-video + audio).
//
// Why OpenRouter: unified video API across providers (Veo / Sora / Seedance),
// async job + status + content endpoints, single API key.
//
// Why Veo 3.1 Lite: native synchronized audio + lowest cost in the Veo family
// (~$0.05 / sec → ~$0.40 per 8s clip at 720p), same low-latency as Veo Fast.
//
// Model is swappable via VIDEO_MODEL env var (e.g. "google/veo-3.1-fast",
// "google/veo-3.1", "openai/sora-2", "bytedance/seedance").
//
// Flow:
//   1. POST https://openrouter.ai/api/v1/videos with our frame image as the
//      first_frame anchor → returns { id, status: { polling_url } }
//   2. GET status.polling_url until status === "completed"
//   3. Use status.unsigned_urls[0] (auth-free) OR GET /content?index=0
//   4. Download the produced mp4 and re-upload to our own R2 via putAsset(),
//      so the URL is stable and our /api/assets proxy serves it.

import { putAsset, type PutResult } from "./storage";
import { bump } from "./usage";

const BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.VIDEO_MODEL || "google/veo-3.1-lite";
const DEFAULT_RESOLUTION = (process.env.VIDEO_RESOLUTION as "480p" | "720p" | "1080p") || "720p";

export type VideoJob = {
  request_id: string; // OpenRouter video id
  model: string;
  polling_url: string;
};

export type VideoResult = PutResult & {
  duration_s: number;
  model: string;
};

export type VideoGenContext = {
  brief_id: string;
  shot_idx: number;
  // Absolute URL the video model can fetch as the starting frame. Our
  // /api/assets URLs work on Railway because the asset proxy serves them.
  image_url: string;
  prompt: string;             // the video_prompt from the storyboard
  duration_s?: number;        // 4, 6 or 8 — Veo 3.1 Lite supports all three
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  generate_audio?: boolean;   // default true — Veo 3.1 Lite generates audio natively
  negative_prompt?: string;   // accepted in shape for future swap; Veo doesn't use it
};

function authHeaders() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// ---- public API ----

export async function startVideoJob(opts: VideoGenContext): Promise<VideoJob> {
  if (!opts.image_url) throw new Error("image_url required");
  const model = DEFAULT_MODEL;
  const body = buildBody(model, opts);

  const res = await fetch(`${BASE}/videos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter submit failed ${res.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await res.json();
  // OpenRouter shape: { id, model, status: { polling_url, ... }, ... }
  const request_id = data?.id ?? data?.job_id;
  const polling_url: string | undefined = data?.status?.polling_url ?? data?.polling_url;
  if (!request_id) throw new Error(`OpenRouter response missing id: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    request_id,
    model,
    polling_url: polling_url || `${BASE}/videos/${encodeURIComponent(request_id)}`,
  };
}

export type JobStatus =
  | { state: "IN_QUEUE" | "IN_PROGRESS" }
  | { state: "COMPLETED"; video_url: string; duration_s: number }
  | { state: "FAILED"; error: string };

export async function getJobStatus(job: VideoJob): Promise<JobStatus> {
  const res = await fetch(job.polling_url, { headers: authHeaders() });
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
      `${BASE}/videos/${encodeURIComponent(job.request_id)}/content?index=0`;
    const duration =
      Number(data?.video?.duration ?? data?.duration ?? data?.request?.duration ?? 8) || 8;
    return { state: "COMPLETED", video_url: url, duration_s: duration };
  }
  if (raw === "failed" || raw === "error" || raw === "cancelled" || raw === "canceled") {
    return { state: "FAILED", error: String(data?.error ?? data?.status?.error ?? "video job failed") };
  }
  return { state: raw === "in_progress" || raw === "running" ? "IN_PROGRESS" : "IN_QUEUE" };
}

// One-shot helper: start → poll → download → store in R2.
// Used by the API route which itself runs inside a Next.js Node handler (maxDuration ≥ 300).
export async function renderShotVideoAndStore(opts: VideoGenContext): Promise<VideoResult> {
  const job = await startVideoJob(opts);
  const result = await pollUntilDone(job, { timeoutMs: 8 * 60 * 1000, intervalMs: 5000 });
  bump("video_render");
  const stored = await downloadAndStore(result.video_url, opts.brief_id, opts.shot_idx);
  return { ...stored, duration_s: result.duration_s, model: job.model };
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

async function downloadAndStore(remoteUrl: string, brief_id: string, shot_idx: number): Promise<PutResult> {
  // Unsigned URLs from OpenRouter don't need auth; /content endpoints do.
  const needsAuth = remoteUrl.includes("openrouter.ai/api/v1/videos/") && remoteUrl.includes("/content");
  const headers: Record<string, string> = needsAuth
    ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` }
    : {};
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

// ---- request body shaping ----

function buildBody(model: string, o: VideoGenContext) {
  const ar = o.aspect_ratio ?? "9:16";
  const duration = clampDuration(o.duration_s ?? 8);
  // Veo 3.1 Lite — image-to-video via frame_images[first_frame], audio on by default.
  if (model.startsWith("google/veo")) {
    return {
      model,
      prompt: o.prompt,
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
  // Generic fallback for swapping models (e.g. openai/sora-2, bytedance/seedance).
  return {
    model,
    prompt: o.prompt,
    duration,
    aspect_ratio: ar,
    resolution: DEFAULT_RESOLUTION,
    generate_audio: o.generate_audio ?? true,
    input_references: [
      { type: "image_url", image_url: { url: o.image_url } },
    ],
  };
}

function clampDuration(s: number): number {
  // Veo 3.1 Lite supports 4 / 6 / 8 second clips.
  if (s <= 4) return 4;
  if (s <= 6) return 6;
  return 8;
}
