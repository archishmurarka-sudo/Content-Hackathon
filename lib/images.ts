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

export type FunnelStage = "BOF" | "MOF" | "TOF";

export type FrameGenContext = {
  // Required: the per-shot scene description
  prompt: string;
  brief_id: string;
  shot_idx: number;
  // Funnel stage controls the entire aesthetic: BOF = product-hero / no-faces,
  // MOF = creator + product talking-head, TOF = creator-centric story moment.
  funnel_stage?: FunnelStage;
  // Optional grounding so the model knows what the product looks like,
  // who the creator is, and what UGC aesthetic to match.
  product_label?: string; // e.g. "green pouch of Root Labs Mag Ashwa Gummies"
  product_hero_url?: string; // /api/assets/... or absolute https — Nano Banana sees this as a reference
  // Creator avatar URL — used as a likeness anchor for MOF/TOF (face visible).
  // Ignored for BOF since BOF is hands-only / no faces.
  creator_avatar_url?: string;
  // Additional creator reference stills (TikTok video covers, etc.) — passed
  // alongside the avatar so Nano Banana has multiple angles of the creator's
  // face / styling to lock onto. Capped at 3 to keep multimodal payload sane.
  // Ignored for BOF.
  creator_reference_urls?: string[];
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

  // Build multimodal parts: optional product hero + (for MOF/TOF only) creator
  // avatar as likeness anchor + text prompt. BOF stays hands-only / no-faces,
  // so we deliberately skip the avatar even when one is provided.
  const stage: FunnelStage = opts.funnel_stage ?? "BOF";
  const parts: any[] = [];
  if (opts.product_hero_url) {
    const ref = await loadImageAsInlineData(opts.product_hero_url);
    if (ref) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
      parts.push({ text: "↑ This is the actual product. Use this exact packaging, label, color, shape, and proportions in the generated frame. Do not invent a different bottle." });
    }
  }
  if (stage !== "BOF" && opts.creator_avatar_url) {
    const ref = await loadImageAsInlineData(opts.creator_avatar_url);
    if (ref) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
      parts.push({ text: "↑ This is the creator's profile avatar. Match their face, hair color/length, skin tone, age, and general style in the generated frame. The person on screen must clearly be this individual." });
    }
  }
  // Additional creator reference stills (TikTok video covers) — fed in
  // sequence so Nano Banana has multiple angles + outfits to triangulate
  // the creator's likeness against. Hard-cap to avoid blowing the
  // multimodal payload past ~1 MB total.
  if (stage !== "BOF" && opts.creator_reference_urls?.length) {
    const refUrls = opts.creator_reference_urls.slice(0, 3);
    const refs = await Promise.all(refUrls.map((u) => loadImageAsInlineData(u)));
    refs.forEach((ref, i) => {
      if (ref) {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
        parts.push({ text: `↑ Additional reference shot ${i + 1} of the same creator (a still from one of their real TikToks). Use this alongside the avatar above to lock the creator's actual face, hair, and styling — do NOT average them into a generic person.` });
      }
    });
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
  const stage: FunnelStage = o.funnel_stage ?? "BOF";
  const lines: string[] = [];

  // Shared opener — every funnel uses real-phone UGC aesthetic.
  lines.push(`Portrait ${aspect} vertical photo — a single still frame from a hyper-realistic TikTok video. Shot on a modern smartphone (iPhone 15 Pro / Pixel 9). Natural daylight or warm interior light, shallow depth of field, real fabric / wood / counter textures. Must pass for an actual phone photo, not a render.`);

  // ── Composition + product visibility, branched per funnel ───────────────
  if (stage === "BOF") {
    lines.push(`Composition: the PRODUCT is the hero — dead-center, label dead-on, fully readable, sharply lit. Background softly out of focus. Modern home / kitchen / bathroom counter matched to the product category.`);
    if (o.product_label) lines.push(`Product on screen: ${o.product_label}. The actual product must be visible and recognizable.`);
    if (o.shot_product_action) lines.push(`Product action this shot: ${o.shot_product_action} (held in hand, close-up, on counter, etc.).`);
  } else if (stage === "MOF") {
    lines.push(`Composition: a CREATOR-led explainer / demo moment. The creator is mid-shot (chest-up) on the left or right third of the frame, looking into the camera as if mid-sentence to a friend. The PRODUCT is clearly visible in the SAME frame — either held in the creator's hand at chest height with the label angled toward the lens, or placed prominently on the counter beside them. Both the creator's face and the product label must be readable.`);
    lines.push(`Setting: an educational / proof context — kitchen island with morning light, bathroom mirror routine, a desk with a notebook, a tidy home gym corner. Real, lived-in, not staged.`);
    if (o.product_label) lines.push(`Product on screen: ${o.product_label}. The actual product packaging must be visible alongside the creator.`);
    if (o.shot_product_action) lines.push(`Product action this shot: ${o.shot_product_action}.`);
  } else {
    // TOF — pure awareness / story moment
    lines.push(`Composition: a CREATOR-centric story moment. The creator is the entire subject — a candid lifestyle still that looks like a friend caught a real moment of their day. Mid-shot or close-up, natural expression (looking off-camera, laughing, mid-thought, waking up, walking, etc.). This is a HOOK frame, not a product frame.`);
    lines.push(`Setting: a real-world lifestyle moment tied to the story beat — bedroom waking up, car POV at sunrise, walking outside, kitchen at the end of a long day, etc. Cinematic UGC, slight emotional weight, real natural light.`);
    lines.push(`PRODUCT VISIBILITY: the product is a subtle background prop AT MOST — partially visible on a nightstand / kitchen counter / bag, NEVER held up to the camera, NEVER label-forward. Many TOF frames will have NO product visible at all, and that is correct. Do NOT centre, hero, or pitch the product.`);
  }

  lines.push("");
  lines.push("HARD RULES (DO NOT violate)");
  // Universal rules
  lines.push("- HYPER-REALISTIC phone-photo aesthetic only. NO AI-art, illustration, anime, cartoon, 3D render, CGI, or glossy stock-ad sheen.");
  lines.push("- DO NOT render any text, captions, overlays, watermarks, app UI, or 'TikTok' branding in the image — overlays are burned in post.");
  lines.push("- DO NOT add logos other than the actual product label.");
  // Stage-specific face / person rules
  if (stage === "BOF") {
    lines.push("- NO FACES anywhere in the frame. NO mouths. NO eyes. NO portrait of any person. Only hands (and at most a slice of forearm) may be visible.");
    if (o.creator_handle || o.creator_archetype) {
      lines.push(`(Creator vibe — for setting + prop choice ONLY, not for showing a person: ${o.creator_archetype ?? "wellness creator"} style. Do NOT render the creator.)`);
    }
  } else if (stage === "MOF") {
    lines.push("- The creator's FACE IS THE FOCUS alongside the product. Match the attached creator reference photo for face, hair, skin tone, age, and style.");
    lines.push("- The creator must look like a real person caught mid-sentence — natural expression, not a posed model headshot. Avoid model-perfect skin retouching.");
    if (o.creator_archetype) lines.push(`(Creator archetype context: ${o.creator_archetype} — let it inform wardrobe, makeup, and styling.)`);
  } else {
    lines.push("- The creator's FACE IS THE FOCUS. Match the attached creator reference photo for face, hair, skin tone, age, and style.");
    lines.push("- Candid lifestyle vibe ONLY — not a posed product shot, not a brand campaign still. It should feel like a frame pulled from a creator's personal vlog.");
    lines.push("- Do NOT make the product the centre of attention. If unsure whether to include the product, omit it.");
    if (o.creator_archetype) lines.push(`(Creator archetype context: ${o.creator_archetype} — let it inform wardrobe, location, and overall vibe.)`);
  }

  if (o.shot_overlay) {
    const region = stage === "TOF" ? "lower third (TikTok caption region)" : "upper third";
    lines.push(`(Note: the post will later overlay the text "${o.shot_overlay}" on top of this image — leave clean negative space in the ${region} for it, but DO NOT draw the text yourself.)`);
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

  // Product LOCK — only enforced when the product is actually meant to be on
  // screen. TOF frames may not show the product at all, so the lock would
  // contradict the composition rule. We apply it for BOF + MOF only.
  if (o.product_hero_url && stage !== "TOF") {
    lines.push("");
    lines.push("PRODUCT LOCK (HARD CONSTRAINT — DO NOT IGNORE): the attached product reference image is the ONE AND ONLY canonical version of the product. Every frame must show the bottle, label artwork, branding, typography, colors, shape, cap, applicator, dimensions, and all packaging details IDENTICAL to the reference image. Do not modify, restyle, recolor, redesign, re-text, swap, substitute, or invent any variation of the product. If you cannot match the reference exactly, render less detail rather than guessing. The product must remain visually consistent across all clips of this concept — same bottle, same label, same orientation logic.");
  } else if (o.product_hero_url && stage === "TOF") {
    lines.push("");
    lines.push("PRODUCT LOCK (only IF the product appears in this frame): if you choose to include the product as a background prop, it must match the attached reference image exactly — same bottle, same label, same colors. Do not invent a variation. When in doubt, omit the product rather than render a wrong version.");
  }

  // Creator LIKENESS lock — only when an avatar was provided AND face is shown
  if (o.creator_avatar_url && stage !== "BOF") {
    lines.push("");
    lines.push("CREATOR LIKENESS LOCK (HARD CONSTRAINT): the attached creator reference photo is the ONE AND ONLY canonical face for this video. The person rendered must look like the same individual — same face structure, hair, skin tone, apparent age, and general styling. Do NOT generate a generic stock model. If you cannot match the reference convincingly, reduce facial detail (slight side-angle, hair partially covering face) rather than guessing a different person.");
  }

  return lines.join("\n");
}
