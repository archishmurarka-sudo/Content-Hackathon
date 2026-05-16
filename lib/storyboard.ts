import type { Creator, Prototype, Product } from "./data";
import type { YouTubeVideo } from "./youtube";
import { bump } from "./usage";

export type StoryboardShot = {
  idx: number;
  duration_s: number;
  speech: string;
  speech_tone: string;
  visual: string;
  overlay: string;
  product_action: string;
  transition: string;
  image_prompt: string; // for frame image generation
  video_prompt: string; // for video generation
};

export type Storyboard = {
  brief_id: string;
  creator_handle: string;
  product_id: string;
  total_duration_s: number;
  hook: string;
  cta: string;
  shots: StoryboardShot[];
  rationale: string;
  inspired_by_video_ids: string[];
  creator_gender?: "female" | "male" | "non-binary";
  banner_choice?: "A" | "B";
};

import { resolveTextModel } from "./models";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type FunnelStage = "BOF" | "MOF" | "TOF";

const FUNNEL_INTENT: Record<FunnelStage, { name: string; intent: string; cta: string }> = {
  BOF: {
    name: "BOTTOM-OF-FUNNEL",
    intent: "Direct selling. Product visible by 5s. Hard CTA with urgency. Goal: buy now.",
    cta: "Final shot must be a hard, time-boxed CTA (e.g. 'Tap the orange cart, deal ends tonight').",
  },
  MOF: {
    name: "MIDDLE-OF-FUNNEL",
    intent: "Consideration / education. Build trust with mechanism, proof, or comparison. Product is shown but the goal is click-through, not buy-now.",
    cta: "Final shot is a soft CTA (e.g. 'See why I switched — link in bio'). No urgency, no price talk.",
  },
  TOF: {
    name: "TOP-OF-FUNNEL",
    intent: "Pure awareness / retention. Hook-heavy, story-driven. NO product pitch. NO CTA. The product appears at most as a subtle prop.",
    cta: "Final shot is a story payoff or a question that invites comments — NOT a CTA, NOT a price mention.",
  },
};

function buildPrompt(
  creator: Creator,
  product: Product,
  prototypes: Prototype[],
  target_s: number,
  funnel_stage: FunnelStage,
  youtubeRef?: YouTubeVideo,
) {
  const funnel = FUNNEL_INTENT[funnel_stage];
  const protoSummary = prototypes
    .map(
      (p) => `
VIDEO ${p.video_id} | creator=@${p.creator_handle} | narrative=${p.narrative_direction} | format=${p.video_format} | dur=${p.duration_seconds}s
${p.shots
  .slice(0, 8)
  .map(
    (s) =>
      `  [${s.start}-${s.end}] speech: "${s.speech.slice(0, 140)}" | visual: ${s.visual.slice(0, 140)} | overlay: "${(s.overlay || "").slice(0, 80)}" | action: ${s.product_action} | tone: ${s.speech_tone}`
  )
  .join("\n")}`
    )
    .join("\n\n");

  const ingredients = (product.key_ingredients ?? []).join(", ");
  const painLines = (product.pain_breakdown ?? [])
    .map((p) => `  - ${p.pain}${p.gmv_label ? ` (${p.gmv_label} tracked GMV)` : ""}: ${p.note ?? ""}`)
    .join("\n");
  const quotes = (product.consumer_quotes ?? [])
    .slice(0, 6)
    .map((q) => `  - "${q}"`)
    .join("\n");

  return `You are a TikTok Shop short-form video director for Mosaic Wellness. Generate a ${target_s}-second ${funnel.name} video storyboard pegged to one specific creator's voice and visual style.

FUNNEL INTENT
${funnel.intent}

CREATOR
@${creator.handle} — archetype: ${creator.archetype} | top pain: ${creator.top_pain} | energy: ${creator.energy_rating ?? "?"}/10 | Kalo GMV: ${
    creator.kalo_gmv ? "$" + creator.kalo_gmv.toLocaleString() : "n/a"
  }
Dossier excerpt:
${creator.dossier_excerpt ?? "(none)"}

PRODUCT
Name: ${product.name} by ${product.brand}
One-liner: ${product.one_liner}
${product.format ? `Format: ${product.format}` : ""}
${ingredients ? `Key ingredients: ${ingredients}` : ""}
${product.delivery_tech ? `Delivery tech: ${product.delivery_tech}` : ""}
${product.price_band ? `Price: ${product.price_band}` : ""}
${product.channel ? `Channel: ${product.channel}` : ""}
${product.audience_primary ? `Primary audience: ${product.audience_primary}` : ""}
${product.audience_secondary ? `Secondary audience: ${product.audience_secondary}` : ""}
${painLines ? `\nPain anchors (use ONLY the ones that fit this creator's top pain and the funnel stage — do NOT cram everything in):\n${painLines}` : ""}
${quotes ? `\nConsumer voice — verbatim phrases real buyers say (mirror this rhythm, don't quote literally):\n${quotes}` : ""}

REFERENCE PROTOTYPES (real top-performing videos in this category — mimic their structure, tone, pacing, hook style, CTA hardness)
${protoSummary}
${
  youtubeRef
    ? `

EXTERNAL YOUTUBE REFERENCE (use as additional inspiration for hook + pacing — match the energy, not the words)
Title: ${youtubeRef.title}
Channel: ${youtubeRef.channelTitle}
Duration: ${youtubeRef.durationSeconds}s${youtubeRef.isShort ? " (Short)" : ""}
Views: ${youtubeRef.viewCount ?? "?"} · Likes: ${youtubeRef.likeCount ?? "?"}
Tags: ${(youtubeRef.tags ?? []).slice(0, 12).join(", ") || "(none)"}
Description: ${(youtubeRef.description ?? "").slice(0, 400)}`
    : ""
}

CREATOR GENDER PRESENTATION (infer first, then use consistently)
Before writing anything else, infer this creator's gender presentation from
the handle, archetype, and dossier excerpt above. Pick ONE of: "female",
"male", "non-binary". Output it in the JSON as "creator_gender". Use it
consistently across BOTH shots — same person on camera, same voice in the
voiceover. Default rule: if the dossier or archetype clearly implies one
(e.g. "esthetician" / "beauty_guru" lean female; "pharmacist" / "grooming"
default to that creator's documented presentation), use that. If genuinely
unclear, default to "female" (the majority of MagAshwa creators).

HARDCODED FORMAT — LOCKED, DO NOT DEVIATE
This is a BOTTOM-OF-FUNNEL TikTok Shop video. You MUST produce exactly TWO
shots, 8 seconds each (16s total). The shots must look like the SAME real
person filming themselves with their phone — same person on camera, same
clothes, same setting, same lighting, same banner across both shots.

SHOT 1 — Hook + Product Reveal (8s)
- A real {creator_gender} person (~20s–40s, matched to the creator's archetype
  and energy) is in selfie-frame — head and upper torso visible, looking
  directly into the camera. Mid-shot from chest-up. They are holding the
  product in their hand near their face/shoulder, label dead-on to the camera
  and fully readable.
- They deliver the hook spoken directly to camera (lip-sync, natural mouth
  movement). At ~4s they tilt the product ~30° to show the side panel of
  the label, then return it to dead-on while continuing to speak.
- Setting: bright, clean, naturally-lit interior matched to the creator's
  archetype (e.g. esthetician → soft-lit treatment room; pharmacist →
  bright pharmacy counter or clean home office; wellness influencer →
  sunny kitchen / bedroom).
- Voiceover = exactly what the person says on camera (spoken naturally in
  a confident peer-toned {creator_gender} voice, energy ${creator.energy_rating ?? 7}/10,
  ~20 words): hook line + product name + key actives.
- Banner pinned across the upper third for the full 8s (see BANNER below).

SHOT 2 — Same Person + CTA Gesture (8s)
- The SAME {creator_gender} person from shot 1, same outfit, same setting,
  same lighting, same banner — visual + facial continuity from shot 1.
- Mid-shot from chest-up, still holding the product near their face/shoulder,
  label dead-on to camera. They continue speaking directly into the camera
  with natural lip-sync.
- NO product application. NO demo. NO product touching skin/scalp/hair. NO
  cap removal. The product simply stays held label-forward the whole time.
- Beat 4–8s: with their free hand they point firmly downward off the bottom
  of the frame, indicating the TikTok Shop cart. The primary hand keeps the
  product label-forward.
- Voiceover (same {creator_gender} voice as shot 1, same energy, ~15 words):
  structure/function benefit + hard CTA.

BANNER (LOCKED — pick ONE, identical across both shots)
The "overlay" JSON field must be ONLY the short human-readable text the
operator will see ("Banner A" or "Banner B"). The full pill-styling spec
goes inside image_prompt and video_prompt — NOT inside the "overlay" field.

Banner A (use when the concept references a specific discount %):
  TOP pill — solid coral-red, BOLD WHITE all-caps: "FLASH SALE"
  BOTTOM pill — solid white, BOLD BLACK mixed-case: "Save up to 30% off"

Banner B (default — use when no specific % mentioned):
  TOP pill — solid white, BOLD BLACK all-caps: "🚨 PRICE DROP 🚨"
    (red siren-light emojis flanking the text)
  BOTTOM pill — solid coral-red, BOLD WHITE sentence-case: "Limited time sale!"

COMPLIANCE (HARD FAIL if violated — keep speech compliant from the start)
- Banned words: cures, treats, prevents, heals, guaranteed, 100% effective,
  weight loss, metabolism, GLP-1, GLP, Ozempic, anxiety (as a condition),
  depression, insomnia.
- "Cortisol" is ONLY allowed inside the exact phrase "supports healthy
  cortisol levels."
- Required CTA wording: one of "click the orange shopping cart",
  "tap the orange cart", or "linked in shop below". Do NOT say
  "click the link in bio", DM, WhatsApp, external sites, or QR codes.
- Use structure/function language only ("supports healthy …", "helps with
  …", "may support …"). Never claim a cure or guaranteed outcome.

CTA gesture lock
- The CTA must be the spoken second-hand-pointing-down-at-the-cart moment
  in shot 2.
- ${funnel.cta}

OUTPUT FORMAT — pure JSON, no markdown fences, no commentary. The "shots"
array MUST have exactly 2 entries, each with duration_s: 8.

The "overlay" field is the short banner label only — e.g. "FLASH SALE — Save
up to 30% off" or "🚨 PRICE DROP 🚨 — Limited time sale!". Two short lines max.
DO NOT cram styling instructions, pill colors, or "TOP pill / BOTTOM pill"
markup into "overlay". That belongs in image_prompt + video_prompt.

For each shot the "image_prompt" must be a single self-contained paragraph
(~150–250 words) ready to paste into Gemini Nano Banana. It must include:
  • portrait 9:16, 8-second still-frame UGC aesthetic
  • the {creator_gender} person on camera with the choreography above
  • the setting (creator-matched)
  • the BANNER block verbatim (pill colors, text, positioning)
  • "PRODUCT LOCK" hard constraint paragraph appended at the end (packaging
    must match the attached reference image exactly).

For each shot the "video_prompt" must be the same self-contained paragraph
but in motion terms (lip-sync, tilt, second-hand-pointing-down) — ready for
Veo 3.1 Lite / image-to-video. Must explicitly call out "synchronized
{creator_gender} voiceover" so the audio model picks the correct voice.

{
  "creator_gender": "female" | "male" | "non-binary",
  "hook": "first 3-words-style hook line",
  "cta": "the exact closing CTA spoken in shot 2",
  "banner_choice": "A" | "B",
  "rationale": "2 sentences: why this script will work for THIS creator + this product",
  "inspired_by_video_ids": ["<videoId1>", "<videoId2>"],
  "shots": [
    {
      "idx": 0,
      "duration_s": 8,
      "speech": "hook + product name + actives, ~20 words",
      "speech_tone": "confident|urgent|conversational|excited",
      "visual": "shot-1 person on camera, mid-shot chest-up, holding product label-dead-on, rotates ~30° at ~4s",
      "overlay": "short banner label only — e.g. 'FLASH SALE — Save up to 30% off' OR '🚨 PRICE DROP 🚨 — Limited time sale!'",
      "product_action": "close-up",
      "transition": "hard_cut",
      "image_prompt": "<single paragraph as specified above>",
      "video_prompt": "<single paragraph as specified above>"
    },
    {
      "idx": 1,
      "duration_s": 8,
      "speech": "structure/function benefit + hard CTA, ~15 words",
      "speech_tone": "confident|urgent",
      "visual": "shot-2 same person continues to camera, free hand enters at 4s pointing down to cart",
      "overlay": "same short banner label as shot 1",
      "product_action": "on display",
      "transition": "none",
      "image_prompt": "<single paragraph as specified above>",
      "video_prompt": "<single paragraph as specified above>"
    }
  ]
}`;
}

export async function generateStoryboard(opts: {
  creator: Creator;
  product: Product;
  prototypes: Prototype[];
  target_duration_s: number;
  funnel_stage?: FunnelStage;
  youtube_ref?: YouTubeVideo;
}): Promise<Omit<Storyboard, "brief_id">> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const prompt = buildPrompt(
    opts.creator,
    opts.product,
    opts.prototypes,
    opts.target_duration_s,
    opts.funnel_stage ?? "BOF",
    opts.youtube_ref,
  );

  const model = resolveTextModel();
  const res = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t.slice(0, 400)}`);
  }
  bump("storyboard");

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty content");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Defensive: strip code fences if model added them despite responseMimeType
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  }

  // Hardcoded BOF model: exactly 2 shots × 8s. Trim/pad defensively so a
  // drift in the model output can't break the downstream pipeline.
  const rawShots: any[] = Array.isArray(parsed.shots) ? parsed.shots.slice(0, 2) : [];
  while (rawShots.length < 2) rawShots.push({});
  const shots: StoryboardShot[] = rawShots.map((s: any, i: number) => ({
    idx: i,
    duration_s: 8,
    speech: String(s.speech ?? ""),
    speech_tone: String(s.speech_tone ?? (i === 0 ? "confident" : "urgent")),
    visual: String(s.visual ?? ""),
    overlay: cleanOverlay(s.overlay),
    product_action: String(s.product_action ?? (i === 0 ? "close-up" : "on display")),
    transition: String(s.transition ?? (i === 0 ? "hard_cut" : "none")),
    image_prompt: String(s.image_prompt ?? s.visual ?? ""),
    video_prompt: String(s.video_prompt ?? s.visual ?? ""),
  }));

  const gender = String(parsed.creator_gender ?? "").toLowerCase();
  const banner = String(parsed.banner_choice ?? "").toUpperCase();

  return {
    creator_handle: opts.creator.handle,
    product_id: opts.product.id,
    total_duration_s: shots.reduce((sum, s) => sum + s.duration_s, 0),
    hook: String(parsed.hook ?? ""),
    cta: String(parsed.cta ?? ""),
    shots,
    rationale: String(parsed.rationale ?? ""),
    inspired_by_video_ids: Array.isArray(parsed.inspired_by_video_ids)
      ? parsed.inspired_by_video_ids.map(String)
      : opts.prototypes.map((p) => p.video_id),
    creator_gender: (gender === "male" || gender === "non-binary" ? gender : "female") as "female" | "male" | "non-binary",
    banner_choice: (banner === "A" || banner === "B" ? banner : "B") as "A" | "B",
  };
}

// Older prompts had the model dump full pill-styling specs into "overlay"
// (e.g. 'TOP pill — solid white, BOLD BLACK all-caps: "🚨 PRICE DROP 🚨"…').
// That's noisy in the UI and is now duplicated in image_prompt + video_prompt.
// Reduce any such payload back to a clean two-line banner label so the UI
// renders something the operator can actually scan at a glance.
function cleanOverlay(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // If it already looks like a clean short label, keep it.
  if (s.length < 80 && !/pill|bold|all-caps|sentence-case/i.test(s)) return s;
  // Otherwise extract the human-readable text from inside the quoted parts.
  const quoted = Array.from(s.matchAll(/[""]([^""]+)[""]/g)).map((m) => m[1].trim()).filter(Boolean);
  if (quoted.length >= 2) return `${quoted[0]} — ${quoted[1]}`;
  if (quoted.length === 1) return quoted[0];
  // Last resort: collapse + trim aggressively.
  return s.replace(/\s+/g, " ").slice(0, 80);
}
