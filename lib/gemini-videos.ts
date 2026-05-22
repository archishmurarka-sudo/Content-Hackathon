// Image-to-video generation via the Gemini Veo API.
//
// Endpoint:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning?key=${GEMINI_API_KEY}
// Body:
//   { instances: [{ prompt, image: { bytesBase64Encoded, mimeType } }],
//     parameters: { aspectRatio, durationSeconds, generateAudio } }
//
// Returns: { name: "operations/..." }  — a long-running op handle.
// Poll:    GET .../{operation_name}?key=...  → { done, response?: { ... }, error?: {...} }
//
// We then download the produced mp4 (Gemini returns either a signed URI or a
// base64 blob depending on the model variant) and re-host in our own R2 via
// putAsset() so the URL is stable and served by /api/assets.
//
// Default model: veo-3.1-fast-generate-001 (cheapest tier WITH native synced
// audio at the time of writing). Override via GEMINI_VIDEO_MODEL — common
// alternatives: veo-3.1-generate-001 (full quality, pricier), veo-3.1-lite-
// generate-001 (no audio, cheapest).

import { putAsset, type PutResult } from "./storage";
import { bump } from "./usage";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function videoModel(): string {
  return (process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-001").trim();
}

export type VeoAspectRatio = "9:16" | "16:9";

export type VeoGenerateOpts = {
  prompt: string;
  image_url?: string;          // fetched + base64'd before sending; image is treated as first frame
  aspect_ratio?: VeoAspectRatio;
  duration_s?: number;         // Veo caps native gen at 8s per call
  with_audio?: boolean;
  // Storage hint — where in R2 to put the resulting mp4.
  prefix: string;
};

export type VeoResult = PutResult & {
  model: string;
  duration_s: number;
  prompt: string;
};

// One-shot helper: submit → poll → download → store. Used by API routes.
export async function generateScriptVideo(opts: VeoGenerateOpts): Promise<VeoResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = videoModel();

  const instance: any = { prompt: opts.prompt };
  if (opts.image_url) {
    const img = await fetchImageBase64(opts.image_url);
    instance.image = { bytesBase64Encoded: img.base64, mimeType: img.mimeType };
  }

  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: opts.aspect_ratio ?? "9:16",
      durationSeconds: Math.min(8, Math.max(4, opts.duration_s ?? 8)),
      generateAudio: opts.with_audio ?? true,
    },
  };

  // 1) Submit the long-running operation.
  const submit = await fetch(
    `${GEMINI_BASE}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!submit.ok) {
    const t = await submit.text();
    throw new Error(`Veo submit ${submit.status}: ${t.slice(0, 500)}`);
  }
  const submitJson = await submit.json();
  const operationName: string | undefined = submitJson?.name;
  if (!operationName) {
    throw new Error(`Veo: missing operation name in ${JSON.stringify(submitJson).slice(0, 300)}`);
  }

  // 2) Poll until done.
  const started = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  const intervalMs = 5000;
  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const poll = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(operationName).replace(/%2F/gi, "/")}?key=${encodeURIComponent(key)}`,
      { method: "GET" }
    );
    if (!poll.ok) {
      const t = await poll.text();
      throw new Error(`Veo poll ${poll.status}: ${t.slice(0, 300)}`);
    }
    const data = await poll.json();
    if (data?.error) {
      throw new Error(`Veo op failed: ${data.error.message ?? JSON.stringify(data.error).slice(0, 300)}`);
    }
    if (data?.done) {
      // The response shape varies by model variant. Try every documented spot.
      const sample =
        data?.response?.generatedSamples?.[0] ??
        data?.response?.videos?.[0] ??
        data?.response?.predictions?.[0];
      const videoUri: string | undefined = sample?.video?.uri ?? sample?.uri ?? sample?.video?.url;
      const videoB64: string | undefined = sample?.video?.bytesBase64Encoded ?? sample?.bytesBase64Encoded;

      let buf: Buffer;
      if (videoB64) {
        buf = Buffer.from(videoB64, "base64");
      } else if (videoUri) {
        // The URI is also key-gated — append the API key on download.
        const sep = videoUri.includes("?") ? "&" : "?";
        const dl = await fetch(`${videoUri}${sep}key=${encodeURIComponent(key)}`);
        if (!dl.ok) throw new Error(`Veo download ${dl.status}`);
        const ab = await dl.arrayBuffer();
        buf = Buffer.from(ab);
      } else {
        throw new Error(`Veo response missing video payload: ${JSON.stringify(data).slice(0, 400)}`);
      }

      const stored = await putAsset({
        prefix: opts.prefix,
        ext: "mp4",
        body: buf,
        contentType: "video/mp4",
      });
      bump("video_render");
      return {
        ...stored,
        model,
        duration_s: Number(body.parameters.durationSeconds),
        prompt: opts.prompt,
      };
    }
    // still running — loop.
  }
  throw new Error(`Veo job timed out after ${timeoutMs}ms`);
}

async function fetchImageBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch ${res.status} from ${url}`);
  const ab = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") ?? "image/png";
  return { base64: Buffer.from(ab).toString("base64"), mimeType };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Build the Veo prompt for a Meta direct-response script row. We deliberately
// describe the MOTION and AUDIO arc — not the static composition, which the
// first-frame image already carries — so the generation focuses on what
// changes over the 8 seconds.
export function buildVideoPromptForScript(args: {
  script_csv: Record<string, string>;
  product_name: string;
  product_brand: string;
  placement?: string | null;
}): string {
  const csv = args.script_csv;
  const hook = (csv["Building Block"] ?? "").trim();
  const voiceover = (csv["Script/Voiceover"] ?? "").trim();
  const recordingStyle = (csv["Scene Recording Style"] ?? "").trim();
  const production = (csv["Production"] ?? "").trim();
  const editorNote = (csv["Editor Note"] ?? "").trim();
  const placement = (args.placement ?? "mixed").toLowerCase();

  const lines = [
    `Vertical ${placement === "feed" ? "1:1" : "9:16"} short-form ad for ${args.product_name} by ${args.product_brand}. 8 seconds.`,
    "",
    "MOTION & CAMERA",
    recordingStyle || "Handheld, slight camera movement, eye-level. The subject and product stay visible throughout.",
    "",
    "AUDIO (synced voiceover — speak this line, native conversational American English, no accent affectation)",
    voiceover ? `"${voiceover}"` : "(no voiceover; ambient sound only)",
    "",
    hook ? `OPENING BEAT: ${hook}` : "",
    production ? `PRODUCTION NOTES: ${production}` : "",
    editorNote ? `EDITING: ${editorNote}` : "",
    "",
    "STRICT RULES",
    "- DO NOT generate or render any on-screen text, captions, overlays, watermarks, or UI. Overlays are added in post.",
    "- Maintain product appearance and label exactly as shown in the first frame.",
    "- No medical claims in voiceover.",
    "- Sound must work on mute too — the visual story has to land without audio.",
  ];
  return lines.filter(Boolean).join("\n");
}
