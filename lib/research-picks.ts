// Client-side helpers for the Research → Scripts/Instagram handoff.
//
// Research stores the operator's picked subset in localStorage as:
//   { brand_slug, picked_at, total_picked, enrichment_override }
//
// Scripts and Instagram pages hydrate this on mount so the picks become the
// active enrichment_override for the next generate. Picks expire after 30
// minutes so the operator doesn't get a stale "12 picks active" banner from
// last week's session.

export const PICKS_STORAGE_KEY = "connoisseur_research_picks_v1";
export const PICKS_TTL_MS = 30 * 60 * 1000;

export type ResearchPicks = {
  brand_slug: string;
  picked_at: number;
  total_picked: number;
  enrichment_override: {
    brand_slug: string;
    voice_atoms: any[];
    selling_points: any[];
    winner_combos: any[];
    compliance_gates: any[];
    archetype_performance: any[];
    tool_status?: Record<string, string>;
  };
};

export function readResearchPicks(): ResearchPicks | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PICKS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResearchPicks;
    if (!parsed?.enrichment_override) return null;
    if (Date.now() - (parsed.picked_at ?? 0) > PICKS_TTL_MS) {
      localStorage.removeItem(PICKS_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearResearchPicks() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PICKS_STORAGE_KEY); } catch {}
}
