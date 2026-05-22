// Static image generation via OpenAI gpt-image-2.
//
// Endpoint:   POST https://api.openai.com/v1/images/generations
// Auth:       Bearer ${OPENAI_API_KEY}
// Model:      gpt-image-2 (current frontier; same API shape as gpt-image-1).
//             Supports 1024×1024, 1024×1536 portrait, 1536×1024 landscape.
//             Override OPENAI_IMAGE_MODEL=gpt-image-1 to roll back.
//
// We always store the resulting PNG in our own R2 (or local fallback) so the
// asset URL is stable and reachable through the same /api/assets proxy the
// rest of the app uses. OpenAI's `b64_json` response is decoded directly to
// a Buffer and handed to putAsset() — no temp file on disk.

import { putAsset, type PutResult } from "./storage";
import { bump } from "./usage";

const OPENAI_BASE = "https://api.openai.com/v1";

function imageModel(): string {
  return (process.env.OPENAI_IMAGE_MODEL || "gpt-image-2").trim();
}

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageAspect = "square" | "portrait" | "landscape";

const SIZE_FOR_ASPECT: Record<ImageAspect, ImageSize> = {
  square: "1024x1024",     // Meta Feed (1:1)
  portrait: "1024x1536",   // Meta Reels / Stories / 4:5 Feed
  landscape: "1536x1024",  // Meta Audience Network landscape
};

export type GenerateImageOptions = {
  prompt: string;
  aspect?: ImageAspect;
  quality?: "low" | "medium" | "high";   // gpt-image-1 standard tiers
  // Storage hint — where in R2 to put the resulting PNG.
  prefix: string;                         // e.g. `scripts/<script_id>`
  // When present, switches to /images/edits so the model COMPOSES around
  // the given reference instead of inventing a product from scratch.
  // Use the product hero image here — the bottle/label/packaging in the
  // output will then match the real product exactly.
  reference_image_url?: string | null;
};

export type GenerateImageResult = PutResult & {
  model: string;
  size: ImageSize;
  prompt: string;
  cost_estimate_usd: number;
};

export async function generateAdImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  // Accept either OPENAI_API_KEY (canonical) or OPENAI_KEY (the env-var name
  // the operator chose on Railway). Same key — just two acceptable spellings.
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!key) throw new Error("OPENAI_API_KEY / OPENAI_KEY not set");

  const model = imageModel();
  const aspect = opts.aspect ?? "portrait";
  const size = SIZE_FOR_ASPECT[aspect];
  const quality = opts.quality ?? "medium";

  // Reference-image path: keeps the real product visible in the output.
  // gpt-image-1's /images/edits accepts multipart with an `image` file +
  // a `prompt` that describes the new scene around it.
  if (opts.reference_image_url) {
    try {
      return await editFromReference({
        key, model, prompt: opts.prompt, size, quality,
        prefix: opts.prefix,
        reference_image_url: opts.reference_image_url,
      });
    } catch (err: any) {
      // If the edits endpoint rejects (e.g. unsupported model variant),
      // fall back to text-only generation so we still produce SOMETHING
      // rather than failing the whole post.
      console.warn(`[openai-images] edits path failed, falling back to generations: ${err?.message ?? err}`);
    }
  }

  // Text-only generation fallback.
  const res = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: opts.prompt,
      size,
      n: 1,
      quality,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI image ${res.status}: ${t.slice(0, 400)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    // Some models return `url` instead — fall back to download.
    const url: string | undefined = data?.data?.[0]?.url;
    if (!url) throw new Error("OpenAI image: no b64_json and no url in response");
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`OpenAI image download ${dl.status}`);
    const ab = await dl.arrayBuffer();
    const stored = await putAsset({
      prefix: opts.prefix,
      ext: "png",
      body: Buffer.from(ab),
      contentType: dl.headers.get("content-type") ?? "image/png",
    });
    bump("frame_image");
    return {
      ...stored,
      model,
      size,
      prompt: opts.prompt,
      cost_estimate_usd: estimateCost(quality, size),
    };
  }

  const buf = Buffer.from(b64, "base64");
  const stored = await putAsset({
    prefix: opts.prefix,
    ext: "png",
    body: buf,
    contentType: "image/png",
  });
  bump("frame_image");

  return {
    ...stored,
    model,
    size,
    prompt: opts.prompt,
    cost_estimate_usd: estimateCost(quality, size),
  };
}

// OpenAI gpt-image-1 pricing (per generated image, May 2026):
//   low    : $0.011  (any size)
//   medium : $0.042  (any size)
//   high   : $0.167  (any size)
// Source: platform.openai.com/docs/guides/images-vision/pricing
function estimateCost(quality: "low" | "medium" | "high", _size: ImageSize): number {
  return { low: 0.011, medium: 0.042, high: 0.167 }[quality];
}

// Reference-image edit path. Downloads the product hero, hands it to
// /v1/images/edits along with the prompt, and stores the result the same
// way as the generations path so callers don't care which one ran.
async function editFromReference(opts: {
  key: string;
  model: string;
  prompt: string;
  size: ImageSize;
  quality: "low" | "medium" | "high";
  prefix: string;
  reference_image_url: string;
}): Promise<GenerateImageResult> {
  const absUrl = absolutizeAssetUrl(opts.reference_image_url);
  const refRes = await fetch(absUrl);
  if (!refRes.ok) throw new Error(`reference image fetch ${refRes.status} from ${absUrl}`);
  const refBuf = Buffer.from(await refRes.arrayBuffer());
  const refMime = (refRes.headers.get("content-type") || "image/png").split(";")[0].trim();
  const refExt = refMime === "image/jpeg" ? "jpg" : refMime === "image/webp" ? "webp" : "png";

  const fd = new FormData();
  fd.append("model", opts.model);
  fd.append("prompt", opts.prompt);
  fd.append("size", opts.size);
  fd.append("n", "1");
  fd.append("quality", opts.quality);
  fd.append("image", new Blob([refBuf], { type: refMime }), `product.${refExt}`);

  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.key}` },
    body: fd as any,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI edit ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const b64: string | undefined = data?.data?.[0]?.b64_json;
  if (!b64) {
    const url: string | undefined = data?.data?.[0]?.url;
    if (!url) throw new Error("OpenAI edit: response had no b64_json or url");
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`OpenAI edit download ${dl.status}`);
    const ab = await dl.arrayBuffer();
    const stored = await putAsset({
      prefix: opts.prefix,
      ext: "png",
      body: Buffer.from(ab),
      contentType: dl.headers.get("content-type") ?? "image/png",
    });
    bump("frame_image");
    return { ...stored, model: opts.model, size: opts.size, prompt: opts.prompt, cost_estimate_usd: estimateCost(opts.quality, opts.size) };
  }
  const buf = Buffer.from(b64, "base64");
  const stored = await putAsset({
    prefix: opts.prefix,
    ext: "png",
    body: buf,
    contentType: "image/png",
  });
  bump("frame_image");
  return {
    ...stored,
    model: opts.model,
    size: opts.size,
    prompt: opts.prompt,
    cost_estimate_usd: estimateCost(opts.quality, opts.size),
  };
}

// /api/assets/... is relative — OpenAI needs an absolute URL. Use
// PUBLIC_BASE_URL on Railway; else assume localhost for dev.
function absolutizeAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Builds an image prompt for a single keyframe of a Meta-script storyboard.
// Used by the 5-keyframe-per-script generator so each frame is concrete and
// distinct (instead of every script sharing one generic "lead image").
export function buildPromptForKeyframe(args: {
  beat: { idx: number; timestamp_s: number; voiceover: string; visual: string };
  total_beats: number;
  total_duration_s: number;
  product_name: string;
  product_brand: string;
  product_format?: string | null;
  product_one_liner?: string;
  placement?: string | null;
}): string {
  const placement = (args.placement ?? "mixed").toLowerCase();
  const isPortrait = placement !== "feed";

  const aestheticBlock = isPortrait
    ? "Aesthetic: vertical 9:16 Meta Reels / Stories keyframe. UGC-style, handheld, natural daylight or warm interior. Subject and product clearly visible. Not a polished studio ad."
    : "Aesthetic: clean, mobile-first Meta Feed keyframe. Square 1:1 composition, high contrast, sound-off-friendly. Real-feeling, not stock.";

  const lines = [
    aestheticBlock,
    "",
    `PRODUCT: ${args.product_name} by ${args.product_brand}${args.product_format ? ` (${args.product_format})` : ""}.`,
    args.product_one_liner ? `WHAT IT IS: ${args.product_one_liner}` : "",
    "",
    `KEYFRAME ${args.beat.idx + 1} of ${args.total_beats} — moment ${args.beat.timestamp_s}s of ${args.total_duration_s}s`,
    args.beat.voiceover ? `LINE BEING SPOKEN: "${args.beat.voiceover}"` : "(silent / ambient beat)",
    "",
    "SCENE",
    args.beat.visual,
    "",
    "STRICT RULES",
    "- DO NOT render any text, captions, overlays, watermarks, app UI, or brand logos other than the actual product label.",
    "- DO NOT use AI-art, illustration, anime, or 3D render styles — this must look like a real phone photo or studio still.",
    "- Maintain the SAME subject, SAME setting, SAME lighting palette across keyframes — this is one continuous ad. Only the action and framing change beat to beat.",
    "- Product must be recognizable in frame. The label must be readable enough to identify the brand.",
    "- Composition: eye-level, mobile-first framing.",
  ];

  return lines.filter(Boolean).join("\n");
}

// Builds the image prompt for a Meta direct-response script row. Combines the
// script's "Building Block" (hook) + "Script/Voiceover" + "Visual Ref" with
// the product context so the output looks like an actual ad asset, not a
// stock photo.
export function buildPromptForAdScript(args: {
  script_csv: Record<string, string>;
  product_name: string;
  product_brand: string;
  product_format?: string | null;
  product_one_liner?: string;
  placement?: string | null;        // "feed" | "reels" | "stories" | "mixed"
  hero_image_url?: string | null;   // currently informational only; gpt-image-1
                                    // text-to-image doesn't take refs. Future
                                    // upgrade: switch to /images/edits.
}): { prompt: string; aspect: ImageAspect } {
  const csv = args.script_csv;
  const hook = (csv["Building Block"] ?? "").trim();
  const voiceover = (csv["Script/Voiceover"] ?? "").trim();
  const visualRef = (csv["Visual Ref"] ?? "").trim();
  const textOnScreen = (csv["Text on Screen"] ?? "").trim();
  const placement = (args.placement ?? "mixed").toLowerCase();

  const aspect: ImageAspect =
    placement === "feed" ? "square" : "portrait";

  const aestheticBlock =
    placement === "feed"
      ? "Aesthetic: clean, mobile-first Meta Feed ad. High contrast, sound-off-friendly — the hook must read at a glance. Real-feeling, not stock. Avoid heavy retouching."
      : "Aesthetic: vertical 9:16 Meta Reels / Stories first-frame. UGC-style, handheld, natural daylight or warm interior. Subject and product clearly visible. Not a polished studio ad.";

  const lines = [
    aestheticBlock,
    "",
    `PRODUCT: ${args.product_name} by ${args.product_brand}${args.product_format ? ` (${args.product_format})` : ""}.`,
    args.product_one_liner ? `WHAT IT IS: ${args.product_one_liner}` : "",
    "",
    "SCENE",
    visualRef || voiceover || hook || "Hero product shot on a kitchen counter, morning light.",
    "",
    hook ? `MOMENT: ${hook}` : "",
    "",
    "STRICT RULES",
    "- DO NOT render any text, captions, overlays, watermarks, app UI, or 'Meta' branding in the image — overlays added in post.",
    textOnScreen ? `- The overlay text \"${textOnScreen}\" will be added separately; leave clean negative space at the top for it. Do NOT draw the text yourself.` : "",
    "- DO NOT use AI-art, illustration, anime, or 3D render styles — this must look like a real phone photo or studio still.",
    "- DO NOT add logos other than the actual product label.",
    "- Composition: product and any human subject clearly visible, eye-level framing.",
  ];

  return { prompt: lines.filter(Boolean).join("\n"), aspect };
}
