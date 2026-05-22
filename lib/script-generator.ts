// Meta direct-response script generator. One Gemini call returns N scripts
// in CSV-row form, grounded in the product's research brief.
//
// Why one call instead of N parallel calls:
//   - Gemini 2.5 Flash is fast enough that N=10 in a single response stays
//     under 30s end to end.
//   - One call shares context so variants stay distinct (the model sees its
//     other outputs and avoids repeating itself) — N parallel calls produce
//     noticeably more duplication.
//   - One call costs one prompt-prefix of system tokens instead of N.
//
// We ask the model for STRICT JSON (one row per script) and convert to the
// 10-column CSV shape on the server. This is more reliable than asking it
// to emit CSV directly — CSV with commas inside quoted strings trips up
// LLMs more often than not.

import { resolveScriptModel } from "./models";
import { bump } from "./usage";
import type { Product } from "./data";
import type { ScriptEnrichment } from "./connoisseur_enrichment";
import { renderEnrichmentForPrompt } from "./connoisseur_enrichment";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ScriptStyle =
  | "problem_solution"
  | "testimonial"
  | "listicle"
  | "founder_story"
  | "before_after"
  | "mixed";

export type Placement = "feed" | "reels" | "stories" | "mixed";

export type CsvRow = {
  "Section #": string;
  "Building Block": string;
  "Script/Voiceover": string;
  "Scene Recording Style": string;
  "Production": string;
  "Editor Note": string;
  "Text on Screen": string;
  "Visual Ref": string;
  "Execution Type": string;
  "Ad Reference URL": string;
};

export type GeneratedScript = {
  script_kind: "problem_solution" | "testimonial" | "listicle" | "founder_story" | "before_after";
  style: ScriptStyle;
  placement: Placement;
  source_ref: string | null;
  csv: CsvRow;
};

export type GenerateInput = {
  product: Product;
  count: number;
  style: ScriptStyle;
  placement: Placement;
  competitor_refs?: string;
  notes?: string;
  // Live corpus enrichment from Connoisseur MCP — voice atoms, selling
  // points, winner combos, compliance gates, archetype performance.
  // Optional: when present, injected as a high-priority block above the
  // hardcoded HARD RULES so the model treats the corpus as ground truth.
  enrichment?: ScriptEnrichment;
};

function buildPrompt(input: GenerateInput): string {
  const p = input.product;
  const placementBlock = placementGuide(input.placement);
  const styleBlock = styleGuide(input.style, input.count);
  const ingredients = (p.key_ingredients ?? []).join(", ") || "(none on file)";
  const pains = (p.pain_breakdown ?? [])
    .map((pb) => `- ${pb.pain}${pb.gmv_label ? ` (${pb.gmv_label})` : ""}${pb.note ? ` — ${pb.note}` : ""}`)
    .join("\n") || "(no pain breakdown on file)";
  const quotes = (p.consumer_quotes ?? []).map((q) => `- "${q}"`).join("\n") || "(no verbatim quotes on file)";

  return `You are a senior direct-response copywriter for Meta ads (Facebook + Instagram, Feed + Reels + Stories). You will write ${input.count} distinct ad scripts for ONE product. Each script is a single CSV row in the 10-column schema below.

PRODUCT
- Name: ${p.name}
- Brand: ${p.brand}
- One-liner: ${p.one_liner}
- Format: ${p.format ?? "—"}
- Price band: ${p.price_band ?? "—"}
- Primary audience: ${p.audience_primary ?? "—"}
- Secondary audience: ${p.audience_secondary ?? "—"}

INGREDIENTS / DELIVERY (fact-check anchor — every claim MUST map to one of these)
- Key ingredients: ${ingredients}
- Delivery tech: ${p.delivery_tech ?? "—"}

PAIN POINTS (rank-ordered; lead with the highest-GMV ones)
${pains}

CONSUMER VOICE (verbatim — pull these phrases into hooks and body where they fit naturally)
${quotes}

${input.competitor_refs ? `COMPETITOR REFERENCES (swipe structure, not language)\n${input.competitor_refs}\n` : ""}
${input.notes ? `OPERATOR NOTES\n${input.notes}\n` : ""}
${input.enrichment ? `\n${renderEnrichmentForPrompt(input.enrichment)}\n` : ""}

PLACEMENT
${placementBlock}

STYLE BRIEF
${styleBlock}

HARD RULES
1. Write how real people talk. Flowing sentences with natural conjunctions ("and", "because", "so", "but"). Fragments only for emphasis, sparingly.
2. NO medical claims. NO "cures", "treats", "heals", "FDA-approved". Use lifestyle language ("supports sleep", "helps you wind down").
3. Every benefit named in the body MUST map to a specific ingredient or delivery tech listed above. No "20+ vitamins" hand-waving — name the actual compound.
4. Editor Note column = practical editing techniques only ("quick zoom", "split screen", "freeze frame + text pop", "punch in"). NOT character motivation or emotional direction. Leave blank if no specific technique.
5. Execution Type must be exactly one of: "Creator-Led", "Stock+B-Roll Only", "Creator + B-Roll". Be honest — not every script needs a creator on camera.
6. Pull at least one verbatim phrase from the CONSUMER VOICE block above into at least one script. Not every script — at least one.
7. Variants must be distinct: different hooks, different angles, different CTAs. No two scripts can share the same opening line or pain entry point.

OUTPUT FORMAT — strict JSON, no markdown fences, no commentary:
{
  "scripts": [
    {
      "script_kind": "problem_solution" | "testimonial" | "listicle" | "founder_story" | "before_after",
      "source_ref": null,
      "csv": {
        "Section #": "1",
        "Building Block": "Hook — 0:00-0:03",
        "Script/Voiceover": "...",
        "Scene Recording Style": "...",
        "Production": "...",
        "Editor Note": "...",
        "Text on Screen": "...",
        "Visual Ref": "...",
        "Execution Type": "...",
        "Ad Reference URL": ""
      }
    }
  ]
}

Output exactly ${input.count} scripts.`;
}

function placementGuide(p: Placement): string {
  switch (p) {
    case "feed":
      return "Feed (4:5 or 1:1). Static / short-form. CTA in the first 3 seconds AND on-screen text. Sound off by default — every claim has to land via captions too.";
    case "reels":
      return "Reels (9:16). Vertical video, sound-on, fast cuts. Hook MUST land in the first 1.5 seconds or viewers swipe away. Subtitles + on-screen text. Native, not polished.";
    case "stories":
      return "Stories (9:16). Vertical, sound-optional. Single-screen takeover style. Punchy. Swipe-up CTA on the last section.";
    case "mixed":
    default:
      return "Mixed Feed + Reels. Default to 9:16 vertical so the same asset can crop to Feed 4:5. Sound-on Reels-first but every script must work on mute.";
  }
}

function styleGuide(s: ScriptStyle, count: number): string {
  switch (s) {
    case "problem_solution":
      return `All ${count} scripts follow Problem → Agitation → Solution → Proof → CTA. Lead with a specific pain ripped from the consumer voice block.`;
    case "testimonial":
      return `All ${count} scripts are testimonial-format: real-feeling first-person voice ("I used to..., then I tried..., now I..."). Use the verbatim consumer quotes as DNA for the speech rhythm.`;
    case "listicle":
      return `All ${count} scripts use a "3 reasons why" or "5 things I wish I knew" frame. Pull the 3-5 highest-GMV pain points and address each as a list item with a specific ingredient as the answer.`;
    case "founder_story":
      return `All ${count} scripts use founder-origin framing: "I built this because I had X problem and nothing worked." Restrained, conversational, low production value vibe.`;
    case "before_after":
      return `All ${count} scripts open with a stark before state (use the pain language verbatim), pivot at the midpoint to the after state, and close with the bridge (the product). The pivot must feel earned, not abrupt.`;
    case "mixed":
    default:
      return `Generate a variety pack across the 5 styles below. Distribute roughly evenly across ${count} scripts:
- problem_solution: Problem → Agitation → Solution → Proof → CTA
- testimonial: first-person "I used to / then I / now I"
- listicle: "3 reasons" or "5 things" format
- founder_story: origin-framing, restrained voice
- before_after: stark before → pivot → after`;
  }
}

export async function generateScripts(input: GenerateInput): Promise<GeneratedScript[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const prompt = buildPrompt(input);
  const model = resolveScriptModel();

  const res = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.95,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t.slice(0, 400)}`);
  }
  bump("storyboard"); // count scripts under the same usage bucket as scripts/storyboards

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty content");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const rows: any[] = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
  return rows.map((r) => ({
    script_kind: (r.script_kind ?? "problem_solution") as GeneratedScript["script_kind"],
    style: input.style,
    placement: input.placement,
    source_ref: r.source_ref ?? null,
    csv: normalizeCsvRow(r.csv ?? {}),
  }));
}

function normalizeCsvRow(r: Record<string, any>): CsvRow {
  return {
    "Section #": String(r["Section #"] ?? "1"),
    "Building Block": String(r["Building Block"] ?? ""),
    "Script/Voiceover": String(r["Script/Voiceover"] ?? ""),
    "Scene Recording Style": String(r["Scene Recording Style"] ?? ""),
    "Production": String(r["Production"] ?? ""),
    "Editor Note": String(r["Editor Note"] ?? ""),
    "Text on Screen": String(r["Text on Screen"] ?? ""),
    "Visual Ref": String(r["Visual Ref"] ?? ""),
    "Execution Type": String(r["Execution Type"] ?? "Creator-Led"),
    "Ad Reference URL": String(r["Ad Reference URL"] ?? ""),
  };
}

// CSV escaping for the download endpoint. Any value containing a comma,
// quote, or newline gets double-quote-wrapped with embedded quotes doubled.
export function toCsvLine(row: CsvRow): string {
  const cols: (keyof CsvRow)[] = [
    "Section #",
    "Building Block",
    "Script/Voiceover",
    "Scene Recording Style",
    "Production",
    "Editor Note",
    "Text on Screen",
    "Visual Ref",
    "Execution Type",
    "Ad Reference URL",
  ];
  return cols.map((c) => csvCell(row[c])).join(",");
}

export function csvHeader(): string {
  return [
    "Section #",
    "Building Block",
    "Script/Voiceover",
    "Scene Recording Style",
    "Production",
    "Editor Note",
    "Text on Screen",
    "Visual Ref",
    "Execution Type",
    "Ad Reference URL",
  ].join(",");
}

function csvCell(v: string): string {
  const s = v ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
