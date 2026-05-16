// Video generation via fal.ai (image-to-video).
//
// We default to Kling 2.1 because it's the strongest realism-per-dollar option
// for short-form product/UGC clips, but the model is swappable via FAL_VIDEO_MODEL
// (e.g. "fal-ai/luma-dream-machine/ray-2/image-to-video",
//        "fal-ai/minimax/video-01/image-to-video",
//        "fal-ai/runway-gen3/turbo/image-to-video").
//
// Flow:
//   1. POST to https://queue.fal.run/<model> → returns { request_id }
//   2. Poll  https://queue.fal.run/<model>/requests/<id>/status
//   3. When status === "COMPLETED" → GET .../requests/<id> for the result
//   4. Download the produced mp4 and re-upload to our own R2 via putAsset(),
//      so the URL is stable and our /api/assets proxy serves it.

import { putAsset, type PutResult } from "./storage";
import { bump } from "./usage";

const FAL_BASE = "https://queue.fal.run";
const FAL_REST_BASE = "https://rest.alpha.fal.ai"; // status/result endpoints
const DEFAULT_MODEL = process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video";

export type VideoJob = {
  request_id: string;
  model: string;
};

export type VideoResult = PutResult & {
  duration_s: number;
  model: string;
};

export type VideoGenContext = {
  brief_id: string;
  shot_idx: number;
  image_url: string;        // absolute URL the video model can fetch (our /api/assets URL works on Railway)
  prompt: string;           // the video_prompt from the storyboard
  duration_s?: number;      // target clip duration (clamped to model limits)
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  negative_prompt?: string;
};

// ---- public API ----

export async function startVideoJob(opts: VideoGenContext): Promise<VideoJob> {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY not set");
  if (!opts.image_url) throw new Error("image_url required");

  const model = DEFAULT_MODEL;
  const body = buildBody(model, opts);

  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fal queue error ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  if (!data?.request_id) throw new Error(`fal queue: missing request_id in response ${JSON.stringify(data).slice(0, 200)}`);
  return { request_id: data.request_id, model };
}

export type JobStatus =
  | { state: "IN_QUEUE" | "IN_PROGRESS" }
  | { state: "COMPLETED" }
  | { state: "FAILED"; error: string };

export async function getJobStatus(job: VideoJob): Promise<JobStatus> {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY not set");
  const url = `${FAL_BASE}/${job.model}/requests/${encodeURIComponent(job.request_id)}/status`;
  const res = await fetch(url, { headers: { "Authorization": `Key ${key}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fal status ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const state = String(data?.status ?? "").toUpperCase();
  if (state === "COMPLETED") return { state: "COMPLETED" };
  if (state === "FAILED" || state === "ERROR") {
    return { state: "FAILED", error: data?.error ?? "fal job failed" };
  }
  return { state: state === "IN_PROGRESS" ? "IN_PROGRESS" : "IN_QUEUE" };
}

export async function fetchJobResult(job: VideoJob): Promise<{ video_url: string; duration_s: number }> {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY not set");
  const url = `${FAL_BASE}/${job.model}/requests/${encodeURIComponent(job.request_id)}`;
  const res = await fetch(url, { headers: { "Authorization": `Key ${key}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fal result ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  // fal returns either { video: { url, ... } } or { video_url } depending on model.
  const videoUrl: string | undefined =
    data?.video?.url ??
    data?.video_url ??
    data?.output?.video?.url ??
    data?.output?.[0]?.url;
  if (!videoUrl) throw new Error(`fal result: no video url in ${JSON.stringify(data).slice(0, 300)}`);
  const duration = Number(data?.video?.duration ?? data?.duration ?? 5);
  return { video_url: videoUrl, duration_s: duration };
}

// One-shot helper: start → poll → download → store in R2.
// Used by the API route which itself runs inside a Next.js Node handler (maxDuration ≥ 300).
export async function renderShotVideoAndStore(opts: VideoGenContext): Promise<VideoResult> {
  const job = await startVideoJob(opts);
  const result = await pollUntilDone(job, { timeoutMs: 5 * 60 * 1000, intervalMs: 4000 });
  bump("video_render");
  // Re-host the mp4 in our own storage so the public URL doesn't expire.
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
    if (status.state === "COMPLETED") return fetchJobResult(job);
    if (status.state === "FAILED") throw new Error(status.error);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`video job timed out after ${timeoutMs}ms`);
}

async function downloadAndStore(remoteUrl: string, brief_id: string, shot_idx: number): Promise<PutResult> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`video download failed ${res.status}`);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const contentType = res.headers.get("content-type") || "video/mp4";
  return putAsset({
    prefix: `briefs/${brief_id}/videos/shot_${shot_idx}`,
    ext: "mp4",
    body: buf,
    contentType,
  });
}

// ---- request body shaping per fal model family ----

function buildBody(model: string, o: VideoGenContext) {
  const ar = o.aspect_ratio ?? "9:16";
  // The fal "input" shape is model-specific. We handle the three most common
  // families and fall back to a generic shape for the rest.
  if (model.includes("kling-video")) {
    return {
      input: {
        prompt: o.prompt,
        image_url: o.image_url,
        duration: String(Math.min(10, Math.max(5, o.duration_s ?? 5))),
        aspect_ratio: ar,
        negative_prompt: o.negative_prompt ?? "blur, distort, low quality, watermark, text",
      },
    };
  }
  if (model.includes("luma") || model.includes("dream-machine")) {
    return {
      input: {
        prompt: o.prompt,
        image_url: o.image_url,
        aspect_ratio: ar,
        loop: false,
      },
    };
  }
  if (model.includes("minimax") || model.includes("hailuo")) {
    return {
      input: {
        prompt: o.prompt,
        image_url: o.image_url,
        prompt_optimizer: true,
      },
    };
  }
  if (model.includes("runway")) {
    return {
      input: {
        prompt: o.prompt,
        image_url: o.image_url,
        duration: String(Math.min(10, Math.max(5, o.duration_s ?? 5))),
        ratio: ar === "9:16" ? "768:1280" : ar === "16:9" ? "1280:768" : "1024:1024",
      },
    };
  }
  // Generic fallback — most fal video models accept this minimal shape.
  return {
    input: {
      prompt: o.prompt,
      image_url: o.image_url,
      aspect_ratio: ar,
    },
  };
}
