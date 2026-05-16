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

export type Product = {
  id: string;
  name: string;
  brand: string;
  one_liner: string;
  pain_anchors: string[];
  hero_image_url?: string | null;
  // Additional product photos (lifestyle / packaging / hand shots) used as
  // visual references in the storyboard image prompts. Hero stays the primary
  // anchor; gallery items widen the visual vocabulary.
  gallery_image_urls?: string[] | null;
  format?: string;                  // "Gummy", "Roll-on", "Capsule" etc.
  key_ingredients?: string[];
  delivery_tech?: string;           // e.g. "Beadlet delivery"
  price_band?: string;              // e.g. "$40–80 per bottle"
  channel?: string;                 // e.g. "TikTok Shop"
  audience_primary?: string;
  audience_secondary?: string;
  pain_breakdown?: { pain: string; gmv_label?: string; note?: string }[];
  consumer_quotes?: string[];       // verbatim Reddit/Amazon language
  source?: "builtin" | "user";
};

export const PRODUCTS: Product[] = [
  {
    id: "ashwamag",
    name: "Mag Ashwa Gummies",
    brand: "Root Labs",
    one_liner: "Magnesium glycinate + KSM-66 ashwagandha gummies, beadlet delivery, for sleep / stress / energy.",
    pain_anchors: ["sleep", "stress_cortisol", "energy", "brain_fog", "anxiety_calm"],
    format: "Gummy (chewable)",
    key_ingredients: ["Magnesium glycinate", "KSM-66 ashwagandha"],
    delivery_tech: "Beadlet delivery — protects magnesium through digestion for better absorption",
    price_band: "$40–80 per bottle (varies by bundle)",
    channel: "TikTok Shop (orange cart / link in bio)",
    audience_primary: "Women 25–45",
    audience_secondary: "Health-conscious adults, fitness enthusiasts, stressed professionals",
    pain_breakdown: [
      { pain: "Sleep", gmv_label: "$860K", note: "trouble sleeping, melatonin alternatives, sleep quality" },
      { pain: "Brain fog", gmv_label: "$418K", note: "can't focus, mental clarity, cognitive function" },
      { pain: "Energy", gmv_label: "$319K", note: "always tired, afternoon crashes, sustainable energy" },
      { pain: "Stress / cortisol", gmv_label: "$279K", note: "chronic stress, cortisol management, nervous system" },
      { pain: "General wellness", gmv_label: "$185K", note: "magnesium deficiency, daily health, micronutrients" },
      { pain: "Muscle recovery", gmv_label: "$16K", note: "post-workout, cramps, athletic performance" },
      { pain: "Anxiety / calm", note: "overstimulation, can't wind down, mind racing" },
    ],
    consumer_quotes: [
      "Tired of needing something every night just to fall asleep",
      "Perimenopause wrecked my sleep",
      "Stopped melatonin, wanted something more natural",
      "Stress burns through your magnesium faster than your diet can replace it",
      "Everything changed at 37",
    ],
    source: "builtin",
  },
  {
    id: "alpha",
    name: "Alpha Shilajit Gummies",
    brand: "Root Labs",
    one_liner: "10-in-1 pure Himalayan shilajit gummies (4000mg) with tongkat ali, maca + KSM-66 — for men's energy, testosterone support and gym performance.",
    pain_anchors: ["testosterone", "energy", "stamina", "mental_clarity", "general_wellness", "aging_longevity"],
    format: "Gummy (tamarind-flavored, individually wrapped) · 2/day",
    key_ingredients: [
      "4000mg Pure Himalayan Shilajit Gold (75% fulvic acid)",
      "Tongkat Ali (testosterone support)",
      "Maca Root (energy / endurance)",
      "KSM-66 Ashwagandha (stress recovery)",
      "Black Pepper (bioavailability)",
    ],
    delivery_tech: "ShilAbsorb Bioavailability Technology — 3.5× better absorption than standard shilajit extracts",
    price_band: "$32 (60-ct) / $56.99 (120-ct) · ~$0.53 per gummy",
    channel: "TikTok Shop (primary) → Amazon (#2 BSR Shilajit) → D2C",
    audience_primary: "Men 25–50 noticing energy / drive / recovery decline",
    audience_secondary: "Gym-goers, biohackers, men avoiding TRT clinics",
    pain_breakdown: [
      { pain: "Energy & stamina", note: "shilajit + maca + KSM-66 — mitochondrial energy + endurance without stimulants" },
      { pain: "Testosterone & vitality", note: "shilajit + tongkat ali support healthy T; KSM-66 lowers cortisol load" },
      { pain: "Gym performance", note: "supports oxygen use + ATP production, lean muscle, endurance" },
      { pain: "Mental clarity", note: "fulvic acid + trace minerals support cognitive pathways" },
      { pain: "Comparison superiority", note: "4000mg vs <3000mg competitors, verified COA, 10-in-1 formula" },
      { pain: "General wellness", note: "85 of 102 trace minerals in one supplement" },
      { pain: "Aging longevity", note: "fulvic acid for cellular health; centuries of Ayurvedic use" },
    ],
    consumer_quotes: [
      "Shilajit gummies changed my energy",
      "Signs your testosterone is low (and what nobody tells you)",
      "Why every man over 30 needs this",
      "The supplement doctors won't tell you about",
      "I'm 50 and feel better than at 30",
      "Why your body breaks down after 40 — it's the minerals",
    ],
    source: "builtin",
  },
  {
    id: "hgr",
    name: "HGR Hair Growth Roll-On",
    brand: "Be Bodywise",
    one_liner: "Advanced hair-density roll-on serum with 5% saw palmetto + Redensyl + 3% rosemary oil — natural alternative to minoxidil for thinning, shedding and patchy growth.",
    pain_anchors: ["hair_thinning", "hair_shedding", "natural_alternative", "eyebrow_growth", "beard_growth", "scalp_health"],
    format: "Topical roll-on serum · 0.84 fl oz (25 ml) · 30-day supply",
    key_ingredients: [
      "5% Saw Palmetto (DHT management)",
      "Redensyl (follicle stem-cell activator)",
      "3% Rosemary Oil (scalp circulation)",
      "Anagain (extends anagen / growth phase)",
      "Caffeine Herbasome (follicle energy)",
      "Fenugreek (follicle anchoring)",
    ],
    delivery_tech: "Roll-on applicator — targets thinning areas precisely, no waste",
    price_band: "$30 per bottle · ~$35.71/oz · 30-day supply",
    channel: "TikTok Shop (primary) → Amazon (#26 BSR Hair Regrowth) → D2C",
    audience_primary: "Adults 22–45 with thinning, shedding, or patchy hair growth (gender-balanced)",
    audience_secondary: "Men avoiding minoxidil side-effects · women post-partum · beard-growth + eyebrow regrowth crowd",
    pain_breakdown: [
      { pain: "Hair thinning", note: "saw palmetto manages DHT (hormone behind thinning); Redensyl activates follicle stem cells" },
      { pain: "Hair shedding", note: "saw palmetto + fenugreek; visible drain-photo before/after content converts" },
      { pain: "Natural alternative to minoxidil", note: "rosemary oil is the clinically-studied minoxidil alternative; no chemical side effects" },
      { pain: "Eyebrow growth", note: "Anagain + rosemary; roll-on tip is precise for brows — cheaper than microblading" },
      { pain: "Beard growth", note: "saw palmetto + caffeine herbasome for patchy areas; Day-X transformation format" },
      { pain: "Scalp health", note: "rosemary + caffeine; 2-minute scalp-massage routine framing" },
      { pain: "Attractiveness / confidence", note: "fuller hair + brows as glow-up; women-notice-first framing" },
    ],
    consumer_quotes: [
      "Why your hair is thinning — it's not just genetics",
      "If your shower drain looks like this, watch this",
      "Throw away your minoxidil",
      "The natural alternative to Rogaine that actually works",
      "I tried everything for my thinning hair — this worked",
      "Stop microblading — try this instead",
      "Your scalp is starving and you don't know it",
    ],
    source: "builtin",
  },
];

// ---------- runtime-added products (persisted) ----------

const gProd = globalThis as unknown as {
  __products_added?: Map<string, Product>;
  __productsLoaded?: Promise<void>;
};

export async function ensureProductsLoaded(): Promise<void> {
  if (!hasDb()) return;
  if (gProd.__productsLoaded) return gProd.__productsLoaded;
  gProd.__productsLoaded = (async () => {
    await ensureSchema();
    const rows = await sql()`SELECT data FROM products_added ORDER BY created_at`;
    if (!gProd.__products_added) gProd.__products_added = new Map();
    for (const r of rows) {
      const p = r.data as Product;
      gProd.__products_added.set(p.id, p);
    }
  })();
  return gProd.__productsLoaded;
}

export function getAllProducts(): Product[] {
  const added = gProd.__products_added ? Array.from(gProd.__products_added.values()) : [];
  const addedIds = new Set(added.map((p) => p.id));
  // Overrides (added entries with built-in ids) win, then any built-ins not yet
  // overridden. This both dedupes the catalog and lets PATCH on a built-in
  // become the active version without leaving a duplicate row in the UI.
  const builtinNotOverridden = PRODUCTS.filter((p) => !addedIds.has(p.id));
  return [...added, ...builtinNotOverridden];
}

export function findProduct(id: string): Product | undefined {
  const norm = id.toLowerCase();
  return getAllProducts().find((p) => p.id.toLowerCase() === norm);
}

export async function addProduct(p: Product): Promise<Product> {
  if (!gProd.__products_added) gProd.__products_added = new Map();
  const enriched: Product = { ...p, source: "user" };
  gProd.__products_added.set(p.id, enriched);
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO products_added (id, data, created_at)
      VALUES (${p.id}, ${s.json(enriched)}, ${Date.now()})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    `;
  }
  return enriched;
}
