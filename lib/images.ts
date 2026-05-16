// Image generation via Gemini. Uses the image-preview model which returns
// inline base64 PNG. Falls back to an Imagen REST call if the env var is set.
//
// Output: a publicly-fetchable URL (R2 or local).

import { putAsset } from "./storage";
import { bump } from "./usage";

import { resolveImageModel } from "./models";

const KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeneratedImage = { url: string; key: string };

export async function generateFrameImage(opts: {
  prompt: string;
  brief_id: string;
  shot_idx: number;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
}): Promise<GeneratedImage> {
  if (!KEY) throw new Error("GEMINI_API_KEY not set");

  const fullPrompt = enrichForVerticalUgc(opts.prompt, opts.aspect_ratio ?? "9:16");
  const model = resolveImageModel();

  const res = await fetch(
    `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          temperature: 0.9,
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini image error ${res.status}: ${t.slice(0, 400)}`);
  }
  bump("frame_image");

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p: any) => p?.inlineData?.data);
  if (!imagePart) {
    const textPart = parts.find((p: any) => p?.text);
    throw new Error(`Gemini returned no image. ${textPart?.text?.slice(0, 200) ?? ""}`);
  }
  const mime = imagePart.inlineData.mimeType ?? "image/png";
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const buf = Buffer.from(imagePart.inlineData.data, "base64");

  return putAsset({
    prefix: `briefs/${opts.brief_id}/frames`,
    ext,
    body: buf,
    contentType: mime,
  });
}

function enrichForVerticalUgc(prompt: string, aspect: string) {
  // Push the image model toward UGC aesthetics so frames look like real TikTok stills.
  return [
    `Vertical ${aspect} photo, single still frame from a short-form TikTok video.`,
    "Smartphone-shot aesthetic: handheld, natural lighting, slightly imperfect framing, real human in frame if mentioned.",
    "No watermarks, no logos other than the product, no caption text overlays in the image (overlays added later in post).",
    "Composition: subject and product clearly visible, eye-level, modern home / influencer setting.",
    "",
    "Scene:",
    prompt,
  ].join("\n");
}
