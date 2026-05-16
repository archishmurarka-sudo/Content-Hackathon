import type { Creator, Prototype } from "./data";
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
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

function buildPrompt(creator: Creator, productLine: string, prototypes: Prototype[], target_s: number) {
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

  return `You are a TikTok Shop short-form video director for Mosaic Wellness. Generate a ${target_s}-second BOTTOM-OF-FUNNEL video storyboard pegged to one specific creator's voice and visual style.

CREATOR
@${creator.handle} — archetype: ${creator.archetype} | top pain: ${creator.top_pain} | energy: ${creator.energy_rating ?? "?"}/10 | Kalo GMV: ${
    creator.kalo_gmv ? "$" + creator.kalo_gmv.toLocaleString() : "n/a"
  }
Dossier excerpt:
${creator.dossier_excerpt ?? "(none)"}

PRODUCT
${productLine}

REFERENCE PROTOTYPES (real top-performing videos in this category — mimic their structure, tone, pacing, hook style, CTA hardness)
${protoSummary}

REQUIREMENTS
- Total duration: ${target_s} seconds (±2s).
- 4 to 6 shots.
- BOF intent: direct selling, product visible by 5s, hard CTA, urgency.
- Speech matches THIS creator's voice (energy ${creator.energy_rating ?? 7}/10, archetype ${creator.archetype}).
- Each shot needs: speech (≤25 words), speech_tone, visual description, on-screen overlay text, product_action, transition.
- For each shot ALSO write:
  - image_prompt: a vivid 1–2 sentence description for an AI image model to render the opening frame (lighting, framing, color, props, person POV).
  - video_prompt: a 1–2 sentence motion description for an AI video model (what moves, camera, energy).
- Hook in first 2 seconds. Final shot = CTA + urgency.

OUTPUT FORMAT — pure JSON, no markdown fences, no commentary:
{
  "hook": "first-3-words-style hook line",
  "cta": "the closing CTA sentence",
  "rationale": "2 sentences: why this script will work for THIS creator",
  "inspired_by_video_ids": ["<videoId1>", "<videoId2>"],
  "shots": [
    {
      "idx": 0,
      "duration_s": 4,
      "speech": "...",
      "speech_tone": "urgent|conversational|excited|...",
      "visual": "...",
      "overlay": "...",
      "product_action": "on display|close-up|in-use|unboxing|none",
      "transition": "hard_cut|whip_pan|match_cut|none",
      "image_prompt": "...",
      "video_prompt": "..."
    }
  ]
}`;
}

export async function generateStoryboard(opts: {
  creator: Creator;
  product_line: string;
  product_id: string;
  prototypes: Prototype[];
  target_duration_s: number;
}): Promise<Omit<Storyboard, "brief_id">> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const prompt = buildPrompt(opts.creator, opts.product_line, opts.prototypes, opts.target_duration_s);

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
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

  const shots: StoryboardShot[] = (parsed.shots ?? []).map((s: any, i: number) => ({
    idx: i,
    duration_s: Number(s.duration_s) || 4,
    speech: String(s.speech ?? ""),
    speech_tone: String(s.speech_tone ?? "conversational"),
    visual: String(s.visual ?? ""),
    overlay: String(s.overlay ?? ""),
    product_action: String(s.product_action ?? "on display"),
    transition: String(s.transition ?? "hard_cut"),
    image_prompt: String(s.image_prompt ?? s.visual ?? ""),
    video_prompt: String(s.video_prompt ?? s.visual ?? ""),
  }));

  return {
    creator_handle: opts.creator.handle,
    product_id: opts.product_id,
    total_duration_s: shots.reduce((sum, s) => sum + s.duration_s, 0),
    hook: String(parsed.hook ?? ""),
    cta: String(parsed.cta ?? ""),
    shots,
    rationale: String(parsed.rationale ?? ""),
    inspired_by_video_ids: Array.isArray(parsed.inspired_by_video_ids)
      ? parsed.inspired_by_video_ids.map(String)
      : opts.prototypes.map((p) => p.video_id),
  };
}
