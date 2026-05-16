// Image generation via Gemini 2.5 Flash Image (aka Nano Banana).
// Returns inline base64 PNG/JPG, stored via the storage abstraction.
//
// Supports image-conditioned generation: if a product hero image URL is
// passed, we read it from our own storage and include it as an inlineData
// part. The model then uses the real product packaging as a visual anchor
// across every shot — no more hallucinated bottles.

import { putAsset, readAsset } from "./storage";
import { bump } from "./usage";
import { resolveImageModel } from "./models";

const KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeneratedImage = { url: string; key: string };

export type FrameGenContext = {
  // Required: the per-shot scene description
  prompt: string;
  brief_id: string;
  shot_idx: number;
  // Optional grounding so the model knows what the product looks like,
  // who the creator is, and what BOF UGC aesthetic to match.
  product_label?: string; // e.g. "green pouch of Root Labs Mag Ashwa Gummies"
  product_hero_url?: string; // /api/assets/... or absolute https — Nano Banana sees this as a reference
  creator_handle?: string;
  creator_archetype?: string;
  shot_visual?: string;       // raw "visual" line from storyboard
  shot_product_action?: string; // on display / close-up / in-use / unboxing
  shot_overlay?: string;      // text overlay reminder (we tell model NOT to render this)
  // One-shot user feedback to apply when regenerating
  feedback?: string;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
};

export async function generateFrameImage(opts: FrameGenContext): Promise<GeneratedImage> {
  if (!KEY) throw new Error("GEMINI_API_KEY not set");

  const fullPrompt = buildFramePrompt(opts);
  const model = resolveImageModel();

  // Build multimodal parts: optional product hero (as visual reference) + text prompt.
  const parts: any[] = [];
  if (opts.product_hero_url) {
    const ref = await loadImageAsInlineData(opts.product_hero_url);
    if (ref) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
      parts.push({ text: "↑ This is the actual product. Use this exact packaging, label, color, shape, and proportions in the generated frame. Do not invent a different bottle." });
    }
  }
  parts.push({ text: fullPrompt });

  const res = await fetch(
    `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          temperature: 0.85,
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
  const respParts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = respParts.find((p: any) => p?.inlineData?.data);
  if (!imagePart) {
    const textPart = respParts.find((p: any) => p?.text);
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

// Convert a hero image URL to inline base64 for multimodal Gemini.
// /api/assets/... is preferred — we read straight from storage to avoid an HTTP
// round-trip back to ourselves. Absolute URLs are fetched.
async function loadImageAsInlineData(url: string): Promise<{ mimeType: string; base64: string } | null> {
  try {
    if (url.startsWith("/api/assets/")) {
      const key = url.replace(/^\/api\/assets\//, "").split("/").map(decodeURIComponent).join("/");
      const r = await readAsset(key);
      if (!r) return null;
      return { mimeType: r.contentType || "image/png", base64: r.body.toString("base64") };
    }
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const mimeType = res.headers.get("content-type") || "image/png";
      const buf = Buffer.from(await res.arrayBuffer());
      return { mimeType, base64: buf.toString("base64") };
    }
    return null;
  } catch {
    return null;
  }
}

function buildFramePrompt(o: FrameGenContext): string {
  const aspect = o.aspect_ratio ?? "9:16";
  const lines: string[] = [];

  lines.push(`Portrait ${aspect} vertical photo — a single still frame from a naturalistic UGC TikTok Shop ad. Mobile-shot feel, no cinematic gloss, smartphone-shot aesthetic. NOT a polished studio ad.`);
  lines.push(`Composition: subject and product clearly visible, eye-level, modern home / kitchen / bathroom / bedroom setting matched to the creator's archetype.`);
  if (o.creator_handle || o.creator_archetype) {
    lines.push(`Persona: this is the content style of @${o.creator_handle ?? "unknown"} — a ${o.creator_archetype ?? "wellness creator"}. Match that vibe.`);
  }
  if (o.product_label) {
    lines.push(`Product on screen: ${o.product_label}. The actual product must be visible and recognizable.`);
  }
  if (o.shot_product_action) {
    lines.push(`Product action this shot: ${o.shot_product_action} (e.g. on a counter, held in hand, close-up).`);
  }

  lines.push("");
  lines.push("STRICT RULES");
  lines.push("- DO NOT render any text, captions, overlays, watermarks, app UI, or 'TikTok' branding in the image — overlay banners are added in post.");
  lines.push("- DO NOT add logos other than the actual product label.");
  lines.push("- DO NOT use AI-art, illustration, anime, or 3D render styles — this must look like a phone photo.");

  if (o.shot_overlay) {
    lines.push(`(Note: the post will later overlay the text "${o.shot_overlay}" on top of this image — leave clean negative space in the upper third for it, but DO NOT draw the text yourself.)`);
  }

  lines.push("");
  lines.push("SCENE");
  lines.push(o.prompt);
  if (o.shot_visual && o.shot_visual !== o.prompt) {
    lines.push("");
    lines.push("ADDITIONAL VISUAL CONTEXT FROM STORYBOARD");
    lines.push(o.shot_visual);
  }

  if (o.feedback) {
    lines.push("");
    lines.push("USER FEEDBACK ON THE PREVIOUS RENDER — APPLY THESE CHANGES");
    lines.push(o.feedback);
  }

  // Product LOCK paragraph — verbatim from the BOF model handover doc.
  if (o.product_hero_url) {
    lines.push("");
    lines.push("PRODUCT LOCK (HARD CONSTRAINT — DO NOT IGNORE): the attached product reference image is the ONE AND ONLY canonical version of the product. Every frame must show the bottle, label artwork, branding, typography, colors, shape, cap, applicator, dimensions, and all packaging details IDENTICAL to the reference image. Do not modify, restyle, recolor, redesign, re-text, swap, substitute, or invent any variation of the product. If you cannot match the reference exactly, render less detail rather than guessing. The product must remain visually consistent across all clips of this concept — same bottle, same label, same orientation logic.");
  }

  return lines.join("\n");
}
