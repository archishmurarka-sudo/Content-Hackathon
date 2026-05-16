import fs from "node:fs";
import path from "node:path";
import { scorePrototypeVirality } from "./virality";

export type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  winners: number;
  top_pain: string;
  energy_rating: number | null;
  dossier_excerpt: string | null;
  has_dossier: boolean;
};

export type Shot = {
  idx: number;
  start: string;
  end: string;
  speech: string;
  speech_tone: string;
  visual: string;
  overlay: string;
  overlay_style: string;
  product_action: string;
  transition: string;
};

export type Prototype = {
  video_id: string;
  source_bucket: string;
  creator_handle: string | null;
  product: string | null;
  duration_seconds: number;
  funnel_stage: string | null;
  narrative_direction: string | null;
  video_format: string | null;
  shots: Shot[];
  voice_style: string | null;
  music: string | null;
};

const g = globalThis as unknown as {
  __creators?: Creator[];
  __prototypes?: Prototype[];
};

function load<T>(file: string): T {
  const p = path.join(process.cwd(), "data", file);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function getCreators(): Creator[] {
  if (!g.__creators) g.__creators = load<Creator[]>("creators.json");
  return g.__creators;
}

export function getPrototypes(): Prototype[] {
  if (!g.__prototypes) g.__prototypes = load<Prototype[]>("bof_prototypes.json");
  return g.__prototypes;
}

export function findCreator(handle: string): Creator | undefined {
  const norm = handle.replace(/^@/, "").toLowerCase();
  return getCreators().find((c) => c.handle.toLowerCase() === norm);
}

// Score a prototype's fit for a target creator + product + duration.
// Higher = better fit. Used to pick the top N templates the LLM mimics.
export function rankPrototypes(opts: {
  creator: Creator;
  product: string;
  target_duration_s: number;
  limit?: number;
}): Prototype[] {
  const { creator, product, target_duration_s } = opts;
  const limit = opts.limit ?? 3;
  const productNorm = product.toLowerCase();

  const archetypeNarrativeAffinity: Record<string, string[]> = {
    pharmacist: ["pharmacist_authority", "10_form_stack", "glycinate_vs_oxide", "liposomal_superiority"],
    health_educator: ["deficiency_mechanism", "magnesium_deficiency", "compound_synergy", "10_form_stack"],
    wellness_influencer: ["stress_sleep_connection", "magnesium_deficiency", "compound_synergy"],
    deal_hunter: ["sale_announcement", "deal_stacking_tutorial", "deal_announcement", "direct_sales_pitch"],
    product_reviewer: ["liposomal_superiority", "social_proof_flood", "10_form_stack"],
    beauty_guru: ["stress_sleep_connection", "compound_synergy"],
    esthetician: ["stress_sleep_connection", "compound_synergy"],
    grooming_influencer: ["compound_synergy", "10_form_stack"],
  };

  const wantedNarratives = archetypeNarrativeAffinity[creator.archetype] ?? [];

  const scored = getPrototypes()
    .map((p) => {
      let score = 0;
      // Product match — heavy bias
      if (p.product && p.product.toLowerCase().includes(productNorm)) score += 50;
      // BOF preferred for selling
      if (p.funnel_stage === "BOF") score += 20;
      // Duration proximity (closer = better)
      if (p.duration_seconds > 0) {
        const diff = Math.abs(p.duration_seconds - target_duration_s);
        score += Math.max(0, 20 - diff);
      }
      // Narrative match to archetype
      if (p.narrative_direction) {
        const narr = p.narrative_direction.replace(/^custom:\[?/, "").replace(/\]?$/, "");
        if (wantedNarratives.some((w) => narr.includes(w))) score += 15;
      }
      // Same creator handle = strongest signal (their own past winners)
      if (p.creator_handle && p.creator_handle.toLowerCase().includes(creator.handle.toLowerCase())) {
        score += 40;
      }
      // Must have an actual shot list
      if (!p.shots || p.shots.length === 0) score -= 100;
      // Virality boost — ported pattern from SamurAIGPT/AI-Youtube-Shorts-Generator.
      // Half-weighted so fit (product/archetype/duration) stays primary, viral
      // references just float up among equally relevant ones.
      const virality = scorePrototypeVirality(p);
      score += virality.score * 0.5;
      return { p, score, virality };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);

  return scored;
}

export const PRODUCTS = [
  { id: "ashwamag", name: "Mag Ashwa Gummies", brand: "Root Labs",
    one_liner: "Magnesium glycinate + KSM-66 ashwagandha gummies, beadlet delivery, for sleep / stress / energy.",
    pain_anchors: ["sleep", "stress_cortisol", "energy", "brain_fog", "anxiety_calm"] },
  { id: "alpha", name: "Alpha Shilajit Gummies", brand: "Root Labs",
    one_liner: "Shilajit gummies for testosterone / energy / drive.",
    pain_anchors: ["testosterone", "energy", "stamina"] },
  { id: "hgr", name: "Hair Growth Roll-On", brand: "Be Bodywise",
    one_liner: "Topical roll-on for hair regrowth, thinning, receding.",
    pain_anchors: ["hair_thinning", "receding_hairline", "slow_growth"] },
];
