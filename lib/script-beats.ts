// Decompose a single Meta-script CSV row into N timed beats. Each beat is a
// moment within the 8-second video with its own voiceover line and visual
// description — these get fed individually to OpenAI gpt-image-2 so we end
// up with a 5-image storyboard per script, used to verify visual consistency
// BEFORE paying for the Veo render ($0.80/clip).
//
// One Gemini Flash call per script (~$0.001), strict JSON output.

import { resolveTextModel } from "./models";
import { bump } from "./usage";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ScriptBeat = {
  idx: number;
  timestamp_s: number;       // 0..8
  voiceover: string;         // the line spoken at this moment
  visual: string;            // the on-screen action / composition
};

export async function decomposeScriptIntoBeats(args: {
  script_csv: Record<string, string>;
  product_name: string;
  product_brand: string;
  count?: number;            // default 5
  total_duration_s?: number; // default 8 (Veo cap)
}): Promise<ScriptBeat[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const count = args.count ?? 5;
  const total = args.total_duration_s ?? 8;
  const model = resolveTextModel();
  const csv = args.script_csv;

  const prompt = `You are storyboarding ${count} keyframes for a ${total}-second Meta direct-response ad.

PRODUCT
${args.product_name} by ${args.product_brand}

THE SCRIPT (single ad)
Building Block:    ${csv["Building Block"] ?? "—"}
Voiceover:         ${csv["Script/Voiceover"] ?? "—"}
Visual Ref:        ${csv["Visual Ref"] ?? "—"}
Recording Style:   ${csv["Scene Recording Style"] ?? "—"}
Production:        ${csv["Production"] ?? "—"}
Editor Note:       ${csv["Editor Note"] ?? "—"}
On-screen Text:    ${csv["Text on Screen"] ?? "—"}

YOUR JOB
Decompose this single ${total}-second ad into exactly ${count} evenly-spaced keyframes (timestamps 0, ${(total / (count - 1)).toFixed(1)}, ${((2 * total) / (count - 1)).toFixed(1)}, …, ${total}). For each keyframe, return:

- idx: 0-based index
- timestamp_s: the moment in the video (integer or one-decimal float)
- voiceover: the line being spoken at that moment (split the full voiceover across the beats; if a beat is silent/ambient use an empty string)
- visual: a vivid one-sentence description of what's ON SCREEN at that moment — composition, action, lighting, product visibility. Each beat MUST be visually distinct from the last; describe what CHANGED. The product must stay recognizable across all beats.

HARD RULES
- The product appears recognizable in every beat. No teleports, no reset between beats — this is one continuous shot or a sequence of cuts within ${total}s.
- Visual descriptions must be CONCRETE (camera distance, hand position, lighting, what's in frame). Not "shows the result" — actually describe the result.
- DO NOT include on-screen text in the visual description — overlays are added in post.
- Maintain the same subject identity across all beats (same person, same setting unless the script calls for a cut).

OUTPUT — strict JSON, no markdown fences, no commentary:
{
  "beats": [
    { "idx": 0, "timestamp_s": 0, "voiceover": "...", "visual": "..." },
    ...
  ]
}

Output exactly ${count} beats.`;

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
          maxOutputTokens: 2048,
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
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

  return beats.slice(0, count).map((b, i) => ({
    idx: typeof b.idx === "number" ? b.idx : i,
    timestamp_s: Number(b.timestamp_s ?? (i * total) / (count - 1)),
    voiceover: String(b.voiceover ?? ""),
    visual: String(b.visual ?? ""),
  }));
}
