// Patterns inspired by SamurAIGPT/AI-Youtube-Shorts-Generator
// `shorts_generator/highlights.py` — specifically the 8-signal virality
// rubric and the overlap-dedupe algorithm. That repo is unlicensed, so
// the implementation here is fresh; only the conceptual rubric is shared.
//
// Used to score `Prototype` rows so the storyboard prompt mimics the
// references with the highest viral potential, not just the highest
// duration-fit / archetype-fit score.

import type { Prototype } from "./data";

// Eight signals, ordered by impact on retention / shareability.
export const VIRALITY_SIGNALS = [
  "HOOK MOMENT — first 3 seconds create immediate curiosity ('the secret is…', 'nobody talks about…', 'I was wrong about…').",
  "EMOTIONAL PEAK — genuine surprise, laughter, anger, vulnerability, excitement; raw unscripted reactions.",
  "OPINION BOMB — strong, polarizing or counter-intuitive statement that triggers agree/disagree comments.",
  "REVELATION MOMENT — surprising fact, stat or confession that reframes how the viewer thinks.",
  "CONFLICT / TENSION — disagreement, pushback, or a problem confronted head-on.",
  "QUOTABLE ONE-LINER — a sentence that works as a standalone quote card.",
  "STORY PEAK — the climax or twist of an anecdote; the payoff moment.",
  "PRACTICAL VALUE — a concrete tip, hack or insight the viewer can immediately apply.",
] as const;

export type ViralityScore = {
  video_id: string;
  score: number; // 0..100
  signals_present: string[]; // names of signals from VIRALITY_SIGNALS that fired
  reason: string; // one sentence
};

// Heuristic scorer — no LLM call, deterministic, runs in O(prototypes).
// Inspects overlay/speech text and shot structure for cheap signal proxies.
// A Gemini-backed scorer can swap in later by sharing the same return shape.
export function scorePrototypeVirality(p: Prototype): ViralityScore {
  let score = 0;
  const present: string[] = [];
  const text = (p.shots ?? [])
    .map((s) => `${s.speech} ${s.overlay}`)
    .join(" ")
    .toLowerCase();

  // HOOK
  if (/^|\s(the secret|nobody talks|nobody tells|i was wrong|stop (doing|using)|listen up|wait until|here'?s why)/.test(text)) {
    score += 18;
    present.push("HOOK MOMENT");
  }
  // OPINION BOMB
  if (/(actually|honestly|truth is|the real reason|hot take|controversial|unpopular opinion)/.test(text)) {
    score += 12;
    present.push("OPINION BOMB");
  }
  // REVELATION (stats, numbers, "did you know")
  if (/(\d+%|\d+x|did you know|studies show|research shows|fda|clinical)/.test(text)) {
    score += 12;
    present.push("REVELATION MOMENT");
  }
  // PRACTICAL VALUE
  if (/(here'?s how|step \d|tip:|hack:|the trick|do this|don'?t do)/.test(text)) {
    score += 10;
    present.push("PRACTICAL VALUE");
  }
  // QUOTABLE — short, punchy first overlay (≤ 6 words)
  const firstOverlay = (p.shots?.[0]?.overlay ?? "").trim();
  if (firstOverlay && firstOverlay.split(/\s+/).length <= 6) {
    score += 8;
    present.push("QUOTABLE ONE-LINER");
  }
  // STORY PEAK — has a transition mid-way (hard_cut / whip_pan) suggesting a beat change
  const beats = (p.shots ?? []).filter((s) => s.transition && s.transition !== "none").length;
  if (beats >= 2) {
    score += 8;
    present.push("STORY PEAK");
  }
  // EMOTIONAL PEAK — dramatic / excited / urgent tone tag
  if ((p.shots ?? []).some((s) => /(dramatic|excited|urgent|shocked)/i.test(s.speech_tone))) {
    score += 8;
    present.push("EMOTIONAL PEAK");
  }
  // CONFLICT — "vs", "instead of", "stop", "don't"
  if (/(\bvs\b|instead of|stop\b|don'?t)/.test(text)) {
    score += 6;
    present.push("CONFLICT / TENSION");
  }
  // Duration bonus: 6–30s is the TikTok Shop sweet spot
  if (p.duration_seconds >= 6 && p.duration_seconds <= 30) score += 10;

  // Cap at 100
  score = Math.min(100, score);

  const reason =
    present.length === 0
      ? "No strong viral signal — neutral reference."
      : `Fires ${present.length} signal${present.length === 1 ? "" : "s"}: ${present.slice(0, 3).join(", ")}.`;

  return { video_id: p.video_id, score, signals_present: present, reason };
}

// Overlap-suppression dedupe — ported from SamurAIGPT's `dedupe_highlights`.
// Generalized: any item with {start, end, score}. Returns items kept in
// score-descending order with no >50% time-overlap pair.
export function dedupeByTimeOverlap<T extends { start: number; end: number; score: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const h of sorted) {
    const dur = h.end - h.start;
    let overlaps = false;
    for (const k of kept) {
      const o = Math.min(h.end, k.end) - Math.max(h.start, k.start);
      if (o > 0 && o > 0.5 * dur) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(h);
  }
  return kept;
}
