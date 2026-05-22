// Decompose a single Meta-script CSV row into N timed beats AND a casting
// lock (one consistent human protagonist). Each beat is a moment within the
// 8-second video with its own voiceover line and visual description.
//
// Why we lock a single protagonist in the same Gemini call:
//   - Keyframe images must show the SAME person across all 5 frames or the
//     "storyboard" looks like 5 unrelated ads. The prompt builder cannot
//     enforce identity continuity from beat.visual alone — beats describe
//     scenes, not the actor. We need a separate locked-persona block that
//     gets stamped on every keyframe prompt verbatim.
//   - We also pass any Connoisseur archetype data so the persona pick is
//     biased toward casting that's known to perform on this brand's corpus.
//
// One Gemini Flash call per script (~$0.001), strict JSON output.

import { resolveTextModel } from "./models";
import { bump } from "./usage";
import type { ScriptEnrichment } from "./connoisseur_enrichment";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ScriptBeat = {
  idx: number;
  timestamp_s: number;       // 0..8
  voiceover: string;         // the line spoken at this moment
  visual: string;            // the on-screen action / composition
};

// Locked protagonist description, reused across every keyframe in the
// storyboard so the same person, wardrobe, hair, and setting appear in all
// frames. The model is told to OBEY this verbatim — beat.visual only changes
// the action, never the person.
export type ScriptPersona = {
  // Casting (who's on camera)
  age_range: string;          // "early 30s", "late 40s"
  gender: string;             // "woman", "man", "non-binary"
  ethnicity: string;          // "white American", "Black American", etc.
  body_type: string;          // "athletic", "slim", "soft curves"
  hair: string;               // "shoulder-length brown waves, no makeup"
  wardrobe: string;           // "oversized cream knit sweater + denim shorts"
  vibe: string;               // "girl-next-door / lived-in / mid-cycle wellness vibe"
  // Environment (where it happens)
  setting: string;            // "warm-lit bedroom in soft morning light"
  lighting: string;           // "natural window light, warm 4200K, soft shadows"
  // Aesthetic recipe — repeated verbatim on every frame
  camera_style: string;       // "handheld iPhone, eye level, shallow depth of field"
};

export type DecomposedStoryboard = {
  persona: ScriptPersona;
  beats: ScriptBeat[];
  // The exact prompt sent to Gemini — persisted on the script row so the
  // "view prompt" UI can show what corpus + audience data fed the persona +
  // beat decomposition step.
  prompt: string;
  model: string;
};

export async function decomposeScriptIntoBeats(args: {
  script_csv: Record<string, string>;
  product_name: string;
  product_brand: string;
  audience_primary?: string | null;
  audience_secondary?: string | null;
  count?: number;            // default 5
  total_duration_s?: number; // default 8 (Veo cap)
  enrichment?: ScriptEnrichment;
}): Promise<DecomposedStoryboard> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const count = args.count ?? 5;
  const total = args.total_duration_s ?? 8;
  const model = resolveTextModel();
  const csv = args.script_csv;

  // Optional archetype hint — only inject if the corpus actually told us
  // which creator archetypes lift for this brand. The persona builder uses
  // this to bias casting toward known winners.
  const archetypeHint = args.enrichment?.archetype_performance?.length
    ? `\nARCHETYPES THAT WIN FOR THIS BRAND (bias your protagonist toward the top one)\n` +
      args.enrichment.archetype_performance
        .slice(0, 6)
        .map((a) => `- ${a.archetype}${a.performance ? ` (${a.performance})` : ""}`)
        .join("\n")
    : "";

  // Optional voice-atom hint — gives the persona a verifiable speech register.
  const voiceHint = args.enrichment?.voice_atoms?.length
    ? `\nCONSUMER VOICE PATTERNS (the protagonist sounds like someone who'd actually say these — informs wardrobe / vibe choices)\n` +
      args.enrichment.voice_atoms.slice(0, 6).map((v) => `- "${v.phrase}"`).join("\n")
    : "";

  const prompt = `You are storyboarding ${count} keyframes for a ${total}-second Meta direct-response ad. Your job: pick ONE locked human protagonist + decompose the script into ${count} evenly-spaced moments.

PRODUCT
${args.product_name} by ${args.product_brand}

PRIMARY AUDIENCE
${args.audience_primary ?? "(not specified)"}
${args.audience_secondary ? `SECONDARY AUDIENCE: ${args.audience_secondary}` : ""}
${archetypeHint}${voiceHint}

THE SCRIPT (single ad)
Building Block:    ${csv["Building Block"] ?? "—"}
Voiceover:         ${csv["Script/Voiceover"] ?? "—"}
Visual Ref:        ${csv["Visual Ref"] ?? "—"}
Recording Style:   ${csv["Scene Recording Style"] ?? "—"}
Production:        ${csv["Production"] ?? "—"}
Editor Note:       ${csv["Editor Note"] ?? "—"}
On-screen Text:    ${csv["Text on Screen"] ?? "—"}

YOUR JOB

PART A — pick ONE protagonist that fits the primary audience above and feels native to direct-response Meta ads (UGC, real-person energy, not stock model). Be SPECIFIC: name an age range, gender, ethnicity, hair, wardrobe, vibe, and the setting + lighting they're in. This is the SAME person, SAME outfit, SAME room for all ${count} beats — only the action changes between frames.

PART B — decompose this ${total}-second ad into exactly ${count} evenly-spaced keyframes (timestamps 0, ${(total / (count - 1)).toFixed(1)}, ${((2 * total) / (count - 1)).toFixed(1)}, …, ${total}). For each keyframe, return:
- idx: 0-based index
- timestamp_s: the moment in the video (integer or one-decimal float)
- voiceover: the line being spoken at that moment (split the full voiceover across beats; empty string if ambient)
- visual: a vivid one-sentence description of what the PROTAGONIST is doing at that moment — body language, hand position, where the product is in frame, the action that just changed. DO NOT redescribe the person's appearance — that's locked in PART A.

HARD RULES
- The protagonist in PART A is non-negotiable across all ${count} beats. No second person, no costume changes, no setting jumps.
- The product appears recognizable in at least 3 of the ${count} beats (mandatory in beat 0 and beat ${count - 1}).
- Each beat must show a DIFFERENT action or composition — describe what changed since the previous beat.
- Visual descriptions must be CONCRETE (camera distance, hand position, what's in frame). Not "shows the result" — actually describe the result.
- DO NOT include on-screen text in the visual description — overlays are added in post.

OUTPUT — strict JSON, no markdown fences, no commentary:
{
  "persona": {
    "age_range": "...",
    "gender": "...",
    "ethnicity": "...",
    "body_type": "...",
    "hair": "...",
    "wardrobe": "...",
    "vibe": "...",
    "setting": "...",
    "lighting": "...",
    "camera_style": "..."
  },
  "beats": [
    { "idx": 0, "timestamp_s": 0, "voiceover": "...", "visual": "..." },
    ...
  ]
}

Output exactly ${count} beats and exactly ONE persona.`;

  const res = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          maxOutputTokens: 4096,
          // Same thinking-budget guard as the script generator — Flash is
          // less affected than Pro but we kill it for consistency.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini beats ${res.status}: ${t.slice(0, 400)}`);
  }
  bump("storyboard");

  const data = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p?.thought)
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("");
  if (!text) throw new Error("Gemini returned empty content for beats");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const beats: any[] = Array.isArray(parsed?.beats) ? parsed.beats : [];
  if (beats.length === 0) throw new Error("Gemini returned no beats");

  const personaRaw = (parsed?.persona ?? {}) as Partial<ScriptPersona>;
  const persona: ScriptPersona = {
    age_range: String(personaRaw.age_range ?? "early 30s"),
    gender: String(personaRaw.gender ?? "woman"),
    ethnicity: String(personaRaw.ethnicity ?? "white American"),
    body_type: String(personaRaw.body_type ?? "average build"),
    hair: String(personaRaw.hair ?? "shoulder-length, natural"),
    wardrobe: String(personaRaw.wardrobe ?? "casual everyday outfit"),
    vibe: String(personaRaw.vibe ?? "girl-next-door, lived-in"),
    setting: String(personaRaw.setting ?? "warm-lit home interior"),
    lighting: String(personaRaw.lighting ?? "natural window light, warm tones"),
    camera_style: String(personaRaw.camera_style ?? "handheld iPhone, eye level"),
  };

  return {
    persona,
    beats: beats.slice(0, count).map((b, i) => ({
      idx: typeof b.idx === "number" ? b.idx : i,
      timestamp_s: Number(b.timestamp_s ?? (i * total) / (count - 1)),
      voiceover: String(b.voiceover ?? ""),
      visual: String(b.visual ?? ""),
    })),
    prompt,
    model,
  };
}

// Renders the locked persona as a prompt block that gets prepended to every
// keyframe's GPT-image-2 prompt. Kept here so the format stays canonical.
export function renderPersonaForKeyframe(p: ScriptPersona): string {
  return [
    "CAST LOCK (the SAME person + setting must appear in every keyframe — only the action changes)",
    `- Protagonist: ${p.age_range} ${p.ethnicity} ${p.gender}, ${p.body_type}, ${p.hair}.`,
    `- Wardrobe: ${p.wardrobe}.`,
    `- Vibe: ${p.vibe}.`,
    `- Setting: ${p.setting}.`,
    `- Lighting: ${p.lighting}.`,
    `- Camera: ${p.camera_style}.`,
    "Do NOT introduce a second person, swap outfits, jump locations, or change the lighting palette between frames.",
  ].join("\n");
}
