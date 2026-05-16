import fs from "node:fs";
import path from "node:path";
import { scorePrototypeVirality } from "./virality";
import { hasDb, sql, ensureSchema } from "./db";

export type CreatorRecentVideo = {
  web_video_url: string | null;
  cover_url: string | null;
  duration_s: number | null;
  like_count: number | null;
  play_count: number | null;
  caption: string | null;
};

export type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  winners: number;
  top_pain: string;
  energy_rating: number | null;
  dossier_excerpt: string | null;
  has_dossier: boolean;
  // Populated for creators onboarded via the TikTok-scrape flow.
  // Image URLs are R2-mirrored so they survive past TikTok's signed-URL expiry.
  avatar_url?: string | null;
  bio?: string | null;
  followers?: number | null;
  source?: "catalog" | "tiktok_scrape";
  recent_videos?: CreatorRecentVideo[];
  // Persona — observed visual + speech attributes used so generated videos
  // featuring this creator stay visually consistent. Inferred via Gemini
  // multimodal on the avatar image + recent post captions.
  persona?: {
    gender_presentation: "male" | "female" | "non_binary" | "unclear";
    apparent_ethnicity:
      | "white"
      | "black"
      | "east_asian"
      | "south_asian"
      | "hispanic_latino"
      | "middle_eastern"
      | "mixed"
      | "unclear";
    apparent_age_range: string; // e.g. "20s", "30s", "40s+"
    speech_style: string; // 1 sentence on cadence / tone / vocabulary
    appearance_description: string; // 2 sentences: build, hair, dress style, distinctive features
  };
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
  __creators_added?: Map<string, Creator>;
  __prototypes?: Prototype[];
};

function load<T>(file: string): T {
  const p = path.join(process.cwd(), "data", file);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function getCreators(): Creator[] {
  if (!g.__creators) g.__creators = load<Creator[]>("creators.json");
  const added = g.__creators_added ? Array.from(g.__creators_added.values()) : [];
  // Runtime-added creators surface first so newly-scraped TikTok creators are
  // visible immediately. In-memory only — survives the process, not redeploys.
  return [...added, ...g.__creators];
}

// Load DB-backed runtime creators into the in-memory map exactly once per
// process. Sync `getCreators()` reads from the map, so any API route that
// needs the freshest set should `await ensureCreatorsLoaded()` first.
const gLoad = globalThis as unknown as { __creatorsLoaded?: Promise<void> };
export async function ensureCreatorsLoaded(): Promise<void> {
  if (!hasDb()) return;
  if (gLoad.__creatorsLoaded) return gLoad.__creatorsLoaded;
  gLoad.__creatorsLoaded = (async () => {
    await ensureSchema();
    const rows = await sql()`SELECT data FROM creators_added ORDER BY created_at`;
    if (!g.__creators_added) g.__creators_added = new Map();
    for (const r of rows) {
      const c = r.data as Creator;
      g.__creators_added.set(c.handle.toLowerCase(), c);
    }
  })();
  return gLoad.__creatorsLoaded;
}

export async function addCreator(c: Creator): Promise<Creator> {
  if (!g.__creators_added) g.__creators_added = new Map();
  g.__creators_added.set(c.handle.toLowerCase(), c);
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO creators_added (handle, data, created_at)
      VALUES (${c.handle}, ${s.json(c) as any}, ${Date.now()})
      ON CONFLICT (handle) DO UPDATE SET data = EXCLUDED.data
    `;
  }
  return c;
}

export function getPrototypes(): Prototype[] {
  if (!g.__prototypes) g.__prototypes = load<Prototype[]>("bof_prototypes.json");
  return g.__prototypes;
}

export function findCreator(handle: string): Creator | undefined {
  const norm = handle.replace(/^@/, "").toLowerCase();
  return getCreators().find((c) => c.handle.toLowerCase() === norm);
}

// Score a prototype's fit for a target creator + product + duration + funnel stage.
// Higher = better fit. Used to pick the top N templates the LLM mimics.
export function rankPrototypes(opts: {
  creator: Creator;
  product: string;
  target_duration_s: number;
  funnel_stage?: "BOF" | "MOF" | "TOF";
  limit?: number;
}): Prototype[] {
  const { creator, product, target_duration_s } = opts;
  const funnel_stage = opts.funnel_stage ?? "BOF";
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
      // Funnel-stage match — heavy bias so the prompt mimics the right intent.
      if (p.funnel_stage === funnel_stage) score += 20;
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
