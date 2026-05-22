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
import { extractPromoSignals, renderPromoBlockForCopy } from "./promo-signals";

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

// Maps the operator's chosen style to the EXACT script_kind value that
// must come back on the row. When the operator picks "mixed", the model
// is free to choose any of the five concrete kinds.
const STYLE_TO_KIND: Record<Exclude<ScriptStyle, "mixed">, GeneratedScript["script_kind"]> = {
  problem_solution: "problem_solution",
  testimonial: "testimonial",
  listicle: "listicle",
  founder_story: "founder_story",
  before_after: "before_after",
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

  // Style commitment that appears at the very top — the FIRST thing the
  // model reads after its role. When the operator picked a concrete style
  // (not "mixed"), we name it explicitly and pin the JSON output's
  // script_kind to that exact value.
  const requestedKindLine =
    input.style === "mixed"
      ? `STYLE: variety pack (the model picks one of the 5 kinds per script). script_kind in the JSON output must be one of: problem_solution | testimonial | listicle | founder_story | before_after.`
      : `STYLE: ${prettyStyle(input.style)} (REQUIRED). script_kind in the JSON output MUST be the exact string "${input.style}". Any other value is a violation.`;

  const countNoun = input.count === 1 ? "1 ad script" : `${input.count} distinct ad scripts`;
  const scriptNoun = input.count === 1 ? "This script" : `All ${input.count} scripts`;

  // Build only the optional blocks that have content — empty competitor
  // refs / notes / enrichment used to leave dead whitespace and dilute the
  // model's attention.
  const optionalBlocks: string[] = [];
  if (input.competitor_refs && input.competitor_refs.trim()) {
    optionalBlocks.push(
      `COMPETITOR REFERENCES (swipe the STRUCTURE — hook beat, mid-beat, CTA shape — not the actual language)\n${input.competitor_refs.trim()}`
    );
  }
  if (input.notes && input.notes.trim()) {
    optionalBlocks.push(
      `OPERATOR NOTES (load-bearing — every script must reflect these explicitly, not paraphrase them away)\n${input.notes.trim()}`
    );
  }
  // Pull any concrete promo signals (prices, percent-off, event names) out of
  // the operator's notes and surface them as a dedicated PROMO HOOK block.
  // This forces the hook or CTA to name them verbatim instead of the model
  // drifting into generic "limited offer" language.
  const promo = extractPromoSignals(input.notes);
  const promoBlock = renderPromoBlockForCopy(promo);
  if (promoBlock) optionalBlocks.push(promoBlock);
  if (input.enrichment) {
    optionalBlocks.push(renderEnrichmentForPrompt(input.enrichment));
  }
  const optionalSection = optionalBlocks.length > 0 ? "\n" + optionalBlocks.join("\n\n") + "\n" : "";

  return `You are a senior direct-response copywriter for Meta ads (Facebook + Instagram, Feed + Reels + Stories). You will write ${countNoun} for ONE product. Each script is a single CSV row in the 10-column schema below.

╔═════════════════════════════════════════════════════════════════════════╗
║  REQUESTED BRIEF (these three lines are LOAD-BEARING — obey them all)   ║
╚═════════════════════════════════════════════════════════════════════════╝
${requestedKindLine}
PLACEMENT: ${prettyPlacement(input.placement)} — ${placementBlock}
COUNT: ${input.count} script${input.count === 1 ? "" : "s"} total.

STYLE — how every script in this batch must be structured
${styleBlock}

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
${optionalSection}
HARD RULES
1. Write how real people talk. Flowing sentences with natural conjunctions ("and", "because", "so", "but"). Fragments only for emphasis, sparingly.
2. NO medical claims. NO "cures", "treats", "heals", "FDA-approved". Use lifestyle language ("supports sleep", "helps you wind down").
3. Every benefit named in the body MUST map to a specific ingredient or delivery tech listed above. No "20+ vitamins" hand-waving — name the actual compound.
4. Editor Note column = practical editing techniques only ("quick zoom", "split screen", "freeze frame + text pop", "punch in"). NOT character motivation or emotional direction. Leave blank if no specific technique.
5. Execution Type must be exactly one of: "Creator-Led", "Stock+B-Roll Only", "Creator + B-Roll". Be honest — not every script needs a creator on camera.
6. ${scriptNoun} MUST follow the STYLE structure above. If the script you draft drifts into a different format, rewrite it before returning.
7. Pull at least one verbatim phrase from the CONSUMER VOICE block into at least one script.
${promo.has ? `8. PROMO is non-negotiable: every script's hook or CTA MUST name the price/event/discount supplied in PROMO HOOK above (verbatim — same dollar amount, same event name, same percent). Do not paraphrase ("amazing deal" instead of "$27") and do not skip it. This is the headline the operator typed; it leads the ad.\n` : ""}${input.count === 1 ? "" : `${promo.has ? "9" : "8"}. Variants must be distinct: different hooks, different angles, different CTAs. No two scripts can share the same opening line or pain entry point.\n`}
OUTPUT FORMAT — strict JSON, no markdown fences, no commentary:
{
  "scripts": [
    {
      "script_kind": ${
        input.style === "mixed"
          ? '"problem_solution" | "testimonial" | "listicle" | "founder_story" | "before_after"'
          : `"${input.style}"  // MUST be this exact value`
      },
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

Output exactly ${input.count} script${input.count === 1 ? "" : "s"}.`;
}

function prettyStyle(s: ScriptStyle): string {
  return {
    problem_solution: "Problem → Solution",
    testimonial: "Testimonial",
    listicle: "Listicle (N-reason format)",
    founder_story: "Founder story",
    before_after: "Before → After",
    mixed: "Variety pack",
  }[s];
}

function prettyPlacement(p: Placement): string {
  return { feed: "Feed", reels: "Reels", stories: "Stories", mixed: "Mixed Feed + Reels" }[p];
}

function placementGuide(p: Placement): string {
  switch (p) {
    case "feed":
      return "4:5 or 1:1 static / short-form. Hook + CTA visible in the first 3 seconds AND in on-screen text. Sound off by default — every claim has to land via captions too.";
    case "reels":
      return "9:16 vertical video, sound-on, fast cuts. Hook MUST land in the first 1.5 seconds or viewers swipe away. Subtitles + on-screen text. Native, not polished.";
    case "stories":
      return "9:16 vertical, sound-optional. Single-screen takeover style. Punchy. Swipe-up CTA on the last section.";
    case "mixed":
    default:
      return "Default to 9:16 vertical so the same asset can crop to Feed 4:5. Sound-on Reels-first but every claim must also land on mute.";
  }
}

function styleGuide(s: ScriptStyle, count: number): string {
  const lead = count === 1 ? "This script" : `All ${count} scripts`;
  switch (s) {
    case "problem_solution":
      return `${lead} MUST follow the structure: Problem → Agitation → Solution → Proof → CTA.
- Hook (0-3s): name a specific pain ripped from the CONSUMER VOICE block, verbatim if possible.
- Agitation (3-6s): make the pain visceral — describe the moment it hurts most.
- Solution (6-12s): introduce the product, name the 2-3 specific ingredients that address THAT exact pain.
- Proof (12-18s): one concrete proof point (ingredient form, delivery tech, or a verbatim consumer quote).
- CTA (18-25s): hard ask. "Tap shop now", "grab yours before stock runs out", etc.`;
    case "testimonial":
      return `${lead} MUST follow first-person testimonial framing:
- Opener: "I used to [PAIN, verbatim from consumer voice block]…"
- Discovery: "then I tried [PRODUCT]…"
- Result: "now I [SPECIFIC outcome tied to an ingredient]…"
- CTA: soft + personal — "you have to try it", "link in bio", etc.
Use verbatim consumer quotes as the DNA for sentence rhythm. The voice must feel like one person talking, not advertising.`;
    case "listicle":
      return `${lead} MUST use a numbered-list frame: "3 reasons why I switched to [product]" OR "5 things I wish I'd known about [pain category]".
- Pull the 3-5 highest-GMV pain points from the PAIN POINTS block as the list items.
- Each item names ONE specific ingredient or delivery tech as the answer.
- Closer: tie it back to the product + CTA.`;
    case "founder_story":
      return `${lead} MUST use founder-origin framing:
- Opener: "I built [PRODUCT] because [SPECIFIC PERSONAL PAIN]…"
- Discovery: what existing options failed at — name 1-2 things specifically (other supplement formats, doctor visits, etc.).
- Build: "so I formulated…" + name the actual ingredients in the product page.
- Close: low-pressure, conversational CTA. "If you struggle with X, here's the link."
Restrained, conversational, low production value vibe. NOT polished ad copy.`;
    case "before_after":
      return `${lead} MUST follow a sharp before → after pivot:
- Opener (0-4s): paint the BEFORE state in concrete sensory detail. Pull pain language verbatim from consumer voice.
- Pivot (4-6s): the moment something changed — be specific about what (started taking the product, hit X weeks, etc.).
- After (6-15s): the AFTER state, in equally concrete detail. Tie at least one improvement to a specific ingredient.
- CTA (15-25s): "if your before sounds like mine, here's what worked."
The pivot must feel earned — not magic.`;
    case "mixed":
    default:
      return `Variety pack across all 5 kinds. ${count === 1 ? "Pick ONE kind and commit to it." : `Distribute roughly evenly across ${count} scripts`}:
- problem_solution: Problem → Agitation → Solution → Proof → CTA
- testimonial: first-person "I used to / then I / now I"
- listicle: "3 reasons" or "5 things" format
- founder_story: origin-framing, restrained voice
- before_after: stark before → pivot → after`;
  }
}

export type GenerationResult = {
  scripts: GeneratedScript[];
  // The exact prompt that was sent to Gemini — persisted alongside the row
  // so the operator can verify what data + Connoisseur corpus blocks landed
  // in the request (the "view prompt" toggle on the Scripts page).
  prompt: string;
  model: string;
};

export async function generateScripts(input: GenerateInput): Promise<GenerationResult> {
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
          // 2.5 Pro reserves part of maxOutputTokens for hidden "thinking"
          // tokens by default — with 8192 the JSON output got truncated and
          // JSON.parse threw, surfacing as "Generation failed" toasts. We
          // turn thinking off (this task is pure copywriting, not reasoning)
          // AND raise the ceiling so we still have headroom for long batches.
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 0 },
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
  // 2.5 Pro can return multiple parts — text + optional thought parts. Filter
  // out anything flagged `thought: true` and concatenate the rest so we don't
  // accidentally try to JSON.parse the model's reasoning.
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p?.thought)
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("");
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason ?? "(none)";
    throw new Error(`Gemini returned empty content (finishReason=${finishReason}, parts=${parts.length})`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (parseErr: any) {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Surface the head of the offending text so the operator can see what
      // the model returned instead of valid JSON.
      throw new Error(
        `Gemini JSON parse failed: ${parseErr?.message ?? parseErr}. First 400 chars: ${text.slice(0, 400)}`
      );
    }
  }

  const rows: any[] = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
  const scripts = rows.map((r) => {
    // When the operator picked a concrete style, force script_kind to that
    // exact value. If Gemini drifted (e.g. wrote a testimonial when we asked
    // for problem_solution), the requested kind is the source of truth — we
    // don't want the persisted row claiming to be something the operator
    // didn't ask for.
    const requestedKind =
      input.style === "mixed" ? null : STYLE_TO_KIND[input.style];
    const modelKind = (r.script_kind ?? "problem_solution") as GeneratedScript["script_kind"];
    const finalKind = requestedKind ?? modelKind;

    return {
      script_kind: finalKind,
      style: input.style,
      placement: input.placement,
      source_ref: r.source_ref ?? null,
      csv: normalizeCsvRow(r.csv ?? {}),
    };
  });
  return { scripts, prompt, model };
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
