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
// Routes to OpenRouter (Veo 3.1 + others) when VIDEO_PROVIDER=openrouter,
// otherwise falls back to fal.ai (Kling / Luma / etc).
export async function renderShotVideoAndStore(opts: VideoGenContext): Promise<VideoResult> {
  const provider = (process.env.VIDEO_PROVIDER ?? "fal").toLowerCase();
  if (provider === "openrouter") {
    const result = await renderViaOpenRouter(opts);
    bump("video_render");
    // OpenRouter's renderer already stored the bytes when it had to use the
    // authenticated download path — in that case `already_stored` is true
    // and we just pass through the stored URL/key.
    if (result.already_stored) {
      return { url: result.video_url, key: result.stored_key!, duration_s: result.duration_s, model: result.model };
    }
    const stored = await downloadAndStore(result.video_url, opts.brief_id, opts.shot_idx);
    return { ...stored, duration_s: result.duration_s, model: result.model };
  }
  const job = await startVideoJob(opts);
  const result = await pollUntilDone(job, { timeoutMs: 5 * 60 * 1000, intervalMs: 4000 });
  bump("video_render");
  const stored = await downloadAndStore(result.video_url, opts.brief_id, opts.shot_idx);
  return { ...stored, duration_s: result.duration_s, model: job.model };
}

// ---- OpenRouter provider ----
//
// Endpoint:   POST   https://openrouter.ai/api/v1/videos
// Poll:       GET    https://openrouter.ai/api/v1/videos/{id}
// Download:   GET    https://openrouter.ai/api/v1/videos/{id}/content?index=0
//
// We default to google/veo-3.1-fast because it's the cheapest Veo tier that
// includes native synchronized audio (~$0.10/sec). Set OPENROUTER_VIDEO_MODEL
// to swap (google/veo-3.1, google/veo-3.1-lite, openai/sora-2-pro, etc.).

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_VIDEO_MODEL || "google/veo-3.1-fast";

type OpenRouterResult = {
  video_url: string;
  duration_s: number;
  model: string;
  already_stored?: boolean;
  stored_key?: string;
};

async function renderViaOpenRouter(opts: VideoGenContext): Promise<OpenRouterResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const model = OPENROUTER_DEFAULT_MODEL;

  const body: any = {
    model,
    prompt: opts.prompt,
    resolution: "1080p",
    aspect_ratio: opts.aspect_ratio ?? "9:16",
  };
  if (opts.image_url) {
    body.frame_images = [{
      type: "image_url",
      image_url: { url: opts.image_url },
      frame_type: "first_frame",
    }];
  }

  // 1) Submit job.
  const submit = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const t = await submit.text();
    throw new Error(`OpenRouter submit ${submit.status}: ${t.slice(0, 400)}`);
  }
  const submitData = await submit.json();
  const jobId: string | undefined = submitData?.id ?? submitData?.job_id ?? submitData?.data?.id;
  if (!jobId) throw new Error(`OpenRouter: no job id in ${JSON.stringify(submitData).slice(0, 200)}`);

  // 2) Poll until completed.
  const started = Date.now();
  const timeoutMs = 8 * 60 * 1000; // Veo can take a few minutes
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(`${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`, {
      headers: { "Authorization": `Bearer ${key}` },
    });
    if (!poll.ok) {
      const t = await poll.text();
      throw new Error(`OpenRouter poll ${poll.status}: ${t.slice(0, 200)}`);
    }
    const pollData = await poll.json();
    const status = String(pollData?.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded") {
      const unsigned: string[] = pollData?.unsigned_urls ?? [];
      const directUrl = unsigned[0]
        ?? pollData?.video_url
        ?? pollData?.output?.video?.url;
      const url = directUrl
        ?? `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}/content?index=0`;
      // For the auth-gated content endpoint we must fetch with the bearer
      // token; downloadAndStore() uses plain fetch, so prefer unsigned_urls
      // when present and otherwise download here.
      if (unsigned[0]) {
        return { video_url: unsigned[0], duration_s: Number(pollData?.duration ?? opts.duration_s ?? 8), model };
      }
      // Fall back to authenticated download.
      const dl = await fetch(url, { headers: { "Authorization": `Bearer ${key}` } });
      if (!dl.ok) throw new Error(`OpenRouter content ${dl.status}`);
      // Stash the bytes via a data URL hop won't work — instead we save it
      // immediately ourselves and return a placeholder URL so the caller's
      // downloadAndStore() is a no-op pass-through.
      const ab = await dl.arrayBuffer();
      const stored = await putAsset({
        prefix: `briefs/${opts.brief_id}/videos/shot_${opts.shot_idx}`,
        ext: "mp4",
        body: Buffer.from(ab),
        contentType: dl.headers.get("content-type") ?? "video/mp4",
      });
      return {
        video_url: stored.url,
        duration_s: Number(pollData?.duration ?? opts.duration_s ?? 8),
        model,
        already_stored: true,
        stored_key: stored.key,
      };
    }
    if (status === "failed" || status === "error") {
      throw new Error(pollData?.error ?? "OpenRouter video job failed");
    }
    // else still in_progress / queued — continue polling.
  }
  throw new Error(`OpenRouter video job timed out after ${timeoutMs}ms`);
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
