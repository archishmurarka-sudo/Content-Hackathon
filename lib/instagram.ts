// Instagram branded-content image generator.
//
// One-shot pipeline: product + theme + vibe → Gemini turns those into a
// concrete image prompt and a caption + hashtag block → OpenAI gpt-image-2
// renders the PNG → we store it in R2 and the row in Postgres.
//
// Separate from the TikTok UGC briefs flow because the input shape is
// different (no creator, no shot list, no funnel-stage) and the output is
// a single hero asset, not a multi-shot video.

import { hasDb, sql, ensureSchema } from "./db";
import { findProduct, ensureProductsLoaded } from "./data";
import { generateAdImage, type ImageAspect } from "./openai-images";
import { bump } from "./usage";
import { brandGuidelinesFor, renderGuidelinesForPrompt } from "./brand-guidelines";
import { renderEnrichmentForPrompt } from "./connoisseur_enrichment";
import { extractPromoSignals, renderPromoBlockForImage } from "./promo-signals";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export type IgFormat = "feed_1x1" | "feed_4x5" | "reels_9x16";
export type IgStatus = "pending" | "ready" | "failed";

const FORMAT_TO_ASPECT: Record<IgFormat, ImageAspect> = {
  feed_1x1: "square",
  feed_4x5: "portrait",
  reels_9x16: "portrait",
};

const FORMAT_LABEL: Record<IgFormat, string> = {
  feed_1x1: "Feed · 1:1",
  feed_4x5: "Feed · 4:5",
  reels_9x16: "Reels / Story · 9:16",
};

export const IG_FORMATS: { value: IgFormat; label: string }[] = [
  { value: "feed_1x1", label: FORMAT_LABEL.feed_1x1 },
  { value: "feed_4x5", label: FORMAT_LABEL.feed_4x5 },
  { value: "reels_9x16", label: FORMAT_LABEL.reels_9x16 },
];

export const IG_THEMES = [
  "lifestyle",
  "science_explainer",
  "ingredient_closeup",
  "before_after",
  "ritual",
  "social_proof",
  "sale_announcement",
  "packshot",
  "founder_voice",
  "mood",
] as const;

export type IgTheme = typeof IG_THEMES[number];

// Audience / pain anchor — orthogonal to theme. Theme is the post format;
// audience is who you're talking to and which pain you're anchoring on.
// Used to bias the Gemini creative drafter (caption + image prompt).
export const IG_AUDIENCES = [
  { value: "perimenopause",        label: "Perimenopause",           pain: "hot flashes, sleep, mood swings, brain fog" },
  { value: "menopause",            label: "Menopause",               pain: "hormonal recalibration, joint comfort, sleep" },
  { value: "womens_wellness",      label: "Women · general wellness", pain: "stress, sleep, daily energy" },
  { value: "mens_wellness",        label: "Men · general wellness",   pain: "energy, focus, recovery" },
  { value: "mens_testosterone",    label: "Men · T + energy",         pain: "low energy, motivation, training recovery" },
  { value: "sleep",                label: "Sleep",                    pain: "trouble falling asleep, fragmented sleep, 3am wakeups" },
  { value: "stress_anxiety",       label: "Stress / anxiety",         pain: "jaw tension, racing thoughts, wired-and-tired" },
  { value: "energy_focus",         label: "Energy / focus",           pain: "afternoon crash, brain fog, motivation dip" },
  { value: "skin",                 label: "Skin",                     pain: "dullness, breakouts, slow turnover" },
  { value: "hair_thinning",        label: "Hair thinning",            pain: "shedding, density loss, scalp irritation" },
  { value: "new_parents",          label: "New parents",              pain: "broken sleep, depletion, no time for ritual" },
  { value: "athletes_recovery",    label: "Athletes / recovery",      pain: "post-training soreness, deload sleep, cramping" },
  { value: "longevity_50plus",     label: "Longevity · 50+",          pain: "deep sleep, joint mobility, mental sharpness" },
  { value: "general",              label: "General",                  pain: "broad wellness audience" },
] as const;

export type IgAudienceValue = typeof IG_AUDIENCES[number]["value"];

export type IgPost = {
  id: string;
  product_id: string;
  format: IgFormat;
  theme: string;
  audience: string | null;          // see IG_AUDIENCES
  vibe: string | null;
  image_status: IgStatus;
  image_url: string | null;
  image_key: string | null;
  image_prompt: string | null;
  caption: string | null;
  hashtags: string[];
  published_at: number | null;      // epoch ms when operator clicked Publish
  error: string | null;
  created_at: number;
};

// ---- in-memory fallback when DATABASE_URL is missing ----
const g = globalThis as unknown as { __ig_posts?: Map<string, IgPost> };
const mem: Map<string, IgPost> = g.__ig_posts ?? new Map();
g.__ig_posts = mem;

function uid() {
  return `ig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- public API ----

export async function generateIgPost(input: {
  product_id: string;
  format: IgFormat;
  theme: string;
  audience?: string;
  vibe?: string;
  // Optional Connoisseur enrichment bundle. When present, the caption + image
  // prompt drafter sees the corpus's voice atoms + selling points + gates.
  enrichment?: import("./connoisseur_enrichment").ScriptEnrichment;
}): Promise<IgPost> {
  await ensureProductsLoaded();
  const product = findProduct(input.product_id);
  if (!product) throw new Error(`unknown product '${input.product_id}'`);

  const id = uid();
  const row: IgPost = {
    id,
    product_id: input.product_id,
    format: input.format,
    theme: input.theme,
    audience: input.audience?.trim() || null,
    vibe: input.vibe?.trim() || null,
    image_status: "pending",
    image_url: null,
    image_key: null,
    image_prompt: null,
    caption: null,
    hashtags: [],
    published_at: null,
    error: null,
    created_at: Date.now(),
  };
  await persist(row);

  try {
    // Step 1 — Gemini turns product + theme + audience + vibe + brand
    // guidelines into a concrete image prompt and a caption + hashtag block.
    // Image and copy share the same creative direction.
    const creative = await draftCreative({
      product,
      theme: input.theme,
      audience: input.audience ?? "general",
      vibe: input.vibe ?? "",
      format: input.format,
      enrichment: input.enrichment,
    });

    // Step 2 — OpenAI renders the PNG.
    // Pass the product's hero image (+ any gallery shots) as references so
    // the ACTUAL product appears in the output rather than an AI-imagined
    // version. /images/edits composes the new scene AROUND these references.
    // Falls back to text-only if the edit path errors or no hero exists.
    const img = await generateAdImage({
      prompt: creative.image_prompt,
      aspect: FORMAT_TO_ASPECT[input.format],
      quality: "medium",
      prefix: `instagram/${id}`,
      reference_image_url: product.hero_image_url ?? null,
      extra_reference_urls: product.gallery_image_urls ?? null,
    });

    const updated: IgPost = {
      ...row,
      image_status: "ready",
      image_url: img.url,
      image_key: img.key,
      image_prompt: creative.image_prompt,
      caption: creative.caption,
      hashtags: creative.hashtags,
    };
    await persist(updated);
    return updated;
  } catch (err: any) {
    const failed: IgPost = {
      ...row,
      image_status: "failed",
      error: err?.message ?? "image generation failed",
    };
    await persist(failed);
    return failed;
  }
}

export async function listIgPosts(): Promise<IgPost[]> {
  if (hasDb()) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM ig_posts ORDER BY created_at DESC LIMIT 100`;
    return rows.map(rowToPost);
  }
  return Array.from(mem.values()).sort((a, b) => b.created_at - a.created_at);
}

export async function getIgPost(id: string): Promise<IgPost | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM ig_posts WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) return undefined;
    return rowToPost(rows[0]);
  }
  return mem.get(id);
}

export async function deleteIgPost(id: string): Promise<boolean> {
  if (hasDb()) {
    await ensureSchema();
    const res = await sql()`DELETE FROM ig_posts WHERE id = ${id}`;
    return res.count > 0;
  }
  return mem.delete(id);
}

// Mark a post as published. No actual Meta Graph API call yet — that
// integration is gated on IG business account + app approval. For now
// this stamps a timestamp so the operator can track what's gone live.
// Idempotent: re-publishing just refreshes the timestamp.
export async function publishIgPost(id: string): Promise<IgPost | null> {
  const now = Date.now();
  if (hasDb()) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM ig_posts WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) return null;
    const current = rowToPost(rows[0]);
    if (current.image_status !== "ready") {
      throw new Error("can only publish a post with image_status='ready'");
    }
    await sql()`UPDATE ig_posts SET published_at = ${now} WHERE id = ${id}`;
    return { ...current, published_at: now };
  }
  const p = mem.get(id);
  if (!p) return null;
  if (p.image_status !== "ready") {
    throw new Error("can only publish a post with image_status='ready'");
  }
  const updated = { ...p, published_at: now };
  mem.set(id, updated);
  return updated;
}

// ---- internals ----

async function persist(row: IgPost): Promise<void> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO ig_posts (id, product_id, format, theme, audience, vibe, image_status, image_url, image_key, image_prompt, caption, hashtags, published_at, error, created_at)
      VALUES (${row.id}, ${row.product_id}, ${row.format}, ${row.theme}, ${row.audience ?? null}, ${row.vibe ?? null},
              ${row.image_status}, ${row.image_url ?? null}, ${row.image_key ?? null},
              ${row.image_prompt ?? null}, ${row.caption ?? null},
              ${s.json(row.hashtags) as any}, ${row.published_at ?? null}, ${row.error ?? null}, ${row.created_at})
      ON CONFLICT (id) DO UPDATE SET
        image_status = EXCLUDED.image_status,
        image_url    = EXCLUDED.image_url,
        image_key    = EXCLUDED.image_key,
        image_prompt = EXCLUDED.image_prompt,
        caption      = EXCLUDED.caption,
        hashtags     = EXCLUDED.hashtags,
        audience     = EXCLUDED.audience,
        published_at = EXCLUDED.published_at,
        error        = EXCLUDED.error
    `;
    return;
  }
  mem.set(row.id, row);
}

function rowToPost(r: any): IgPost {
  return {
    id: r.id,
    product_id: r.product_id,
    format: r.format as IgFormat,
    theme: r.theme,
    audience: r.audience ?? null,
    vibe: r.vibe ?? null,
    image_status: r.image_status as IgStatus,
    image_url: r.image_url ?? null,
    image_key: r.image_key ?? null,
    image_prompt: r.image_prompt ?? null,
    caption: r.caption ?? null,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : (r.hashtags ?? []),
    published_at: r.published_at != null ? Number(r.published_at) : null,
    error: r.error ?? null,
    created_at: Number(r.created_at),
  };
}

// Build the Gemini meta-prompt that produces the IG creative (image_prompt
// + caption + hashtags). Pure — no API calls. Exported so the preview
// endpoint can show the operator what would be sent to Gemini before any
// paid generation runs. `draftCreative` uses this internally too so the
// preview and the actual generation are guaranteed to use the same prompt.
//
// Returns the assembled prompt plus a few intermediate blocks so the UI
// can highlight what's coming from each source (Connoisseur, brand
// guidelines, promo signals, theme cue).
export function buildIgCreativePrompt(opts: {
  product: ReturnType<typeof findProduct>;
  theme: string;
  audience: string;
  vibe: string;
  format: IgFormat;
  enrichment?: import("./connoisseur_enrichment").ScriptEnrichment;
}): {
  prompt: string;
  blocks: {
    enrichment_block: string;
    guidelines_block: string;
    promo_block: string;
    theme_cue: string;
    audience_line: string;
    format_hint: string;
  };
} {
  const p = opts.product;
  if (!p) throw new Error("no product");

  const formatHint = {
    feed_1x1: "Instagram feed square (1:1). Subject centered, no important detail in the outer 5% (Instagram crops).",
    feed_4x5: "Instagram feed portrait (4:5). Vertical composition, subject upper-third.",
    reels_9x16: "Instagram Reels / Story (9:16). Full-bleed vertical. Leave a 200px top margin and 350px bottom margin clear for IG UI overlays.",
  }[opts.format];

  // Strong per-theme visual cues — the bottleneck before this was that
  // "theme=sale_announcement" landed as one word in the prompt and the
  // model treated it as a vague tag. Each entry below is concrete enough
  // for an image model to actually render.
  const themeVisualCue: Record<string, string> = {
    lifestyle: "A real-world moment of use — counter / bedside / gym bag / kitchen. Soft natural light, lived-in textures, the product as a quiet anchor in the scene.",
    science_explainer: "Studio still life. Product alongside its key actives (raw ingredients, beadlets, an abstract molecular visual). Soft diffused light, clinical-but-warm palette.",
    ingredient_closeup: "Extreme close-up. Single ingredient hero (e.g. ashwagandha root, magnesium beadlets) next to the product. Shallow depth of field, dramatic side-light.",
    before_after: "Two-panel implied transition — same setting, different time of day or mood. NO literal 'before/after' labels.",
    ritual: "A moment of ritual — opening the jar, two gummies in a palm, pouring a glass of water, placed on a nightstand at golden hour. Intimate, slow, candle-warm.",
    social_proof: "Editorial flat-lay — product on a desk surrounded by a handwritten note, a folded newspaper-style review card, a half-finished coffee. Documentary feel.",
    sale_announcement: "BOLD SALE ENERGY. Dark dramatic backdrop, warm gold rim-light, the product elevated as the hero of a high-contrast promotional frame. Visual cues of urgency — moody chiaroscuro, deep blacks, a single warm spotlight. Premium not tacky — think editorial Black Friday cover, not clearance-bin. If a specific price, percent-off, or event name is supplied in the PROMO OVERLAY block below, render it AS LARGE, CLEAN TYPOGRAPHY directly in the frame (uppercase sans-serif, tight tracking, gold or cream on the dark backdrop). Otherwise no text in the image.",
    packshot: "Pristine studio packshot — seamless paper backdrop, hero product centered, soft rim-light, immaculate composition.",
    founder_voice: "Documentary feel — hand holding the product on a workbench / open notebook / kitchen table. Slightly imperfect, candid framing.",
    mood: "Atmospheric, aspirational — heavy mood lighting, asymmetric composition, the product almost as a still-life prop.",
  };
  const themeCue = themeVisualCue[opts.theme] ?? "(no specific visual cue for this theme — use the brand's default visual direction.)";

  const audience = IG_AUDIENCES.find((a) => a.value === opts.audience);
  const audienceLine = audience
    ? `Audience: ${audience.label} — anchor pains: ${audience.pain}.`
    : "Audience: general wellness — no specific pain anchor.";

  const promo = extractPromoSignals(opts.vibe ?? "");
  const promoBlock = renderPromoBlockForImage(promo);

  const guidelines = brandGuidelinesFor(p.brand);
  const guidelinesBlock = guidelines
    ? renderGuidelinesForPrompt(guidelines)
    : `BRAND VOICE — ${p.brand}\n(no per-brand guidelines configured; default to clean, modern, warm.)`;
  const standardTags = guidelines?.standard_hashtags ?? [];

  const prompt = `You are designing a single branded Instagram post for ${p.brand}. Not creator UGC — this is owned-channel content posted from the brand handle. Premium, on-brand, no obvious AI artifacts.

${guidelinesBlock}

PRODUCT
${p.name} by ${p.brand}
${p.one_liner}
${p.key_ingredients?.length ? `Key ingredients: ${p.key_ingredients.join(", ")}` : ""}
${p.format ? `Format: ${p.format}` : ""}
${p.audience_primary ? `Primary audience (product-level): ${p.audience_primary}` : ""}

CREATIVE BRIEF
Theme: ${opts.theme}
THEME VISUAL TREATMENT (drive the actual look — do not summarize, render it):
${themeCue}

${audienceLine}

Vibe (operator's free-text direction — this drives the atmosphere; honour it literally if specific):
${opts.vibe || "(no specific vibe — default to brand visual direction)"}

${promoBlock ? promoBlock + "\n\n" : ""}Placement: ${formatHint}

${p.hero_image_url ? `PRODUCT REFERENCE IMAGE (CRITICAL)
The actual product packshot will be supplied to the image model as a reference. The "image_prompt" you write below must DESCRIBE THE SCENE AROUND that exact product — the SAME bottle, SAME label, SAME colors. Do NOT redesign or re-invent the product. Phrase the image_prompt as "Place the product in <scene with lighting and composition>" not "A photograph of a bottle".` : ""}

${opts.enrichment ? `\n${renderEnrichmentForPrompt(opts.enrichment)}\n\n` : ""}CRITICAL — every output must pass the brand voice + compliance rules above. If the theme would force a non-compliant phrasing (e.g. "before/after" implying a cure), reframe to a compliant alternative in the caption rather than breaking the rules.

Output a single JSON object with EXACTLY these keys, no markdown:
{
  "image_prompt": "ONE paragraph (≤140 words). Start with 'Place the supplied product in...' if a reference image will be used (see PRODUCT REFERENCE IMAGE above). Describe the SCENE — lighting, palette, props, framing, mood — explicitly using the THEME VISUAL TREATMENT and the operator's Vibe text above. If the vibe mentions a specific event/season (Black Friday, Prime Day, Diwali, New Year, summer, etc.), the scene must visually reflect that — do not just list the words. ${promo.has ? `A PROMO OVERLAY block is supplied above — you MUST describe the exact typography in the image: spell out the price/percent/event verbatim (e.g. '$27', 'PRIME DAY', '20% OFF'), specify size/placement/color/font feel, and ensure it does not cover the product label. This is the most important element of the frame.` : `No text/overlay instructions; overlays go in post.`}",
  "caption": "Instagram is IMAGE-FIRST. Keep the caption SHORT — one punchy hook line, then at most 1–2 short lines of context. Hard cap: ~50 words total. The image carries the message; the caption only adds the click. ${promo.has ? `Do NOT repeat the price/event/discount in long-form prose — it's already rendered on the image. Reference it briefly only ('live now', 'today only', 'link in bio').` : ""} Honour the BRAND VOICE + DO + DON'T rules. If audience is perimenopause / menopause / men's T / new parents / 50+, speak to that lived experience without alarmism.",
  "hashtags": ["array of 8-12 hashtags, no '#' prefix, lowercase. Always include these brand tags first: ${JSON.stringify(standardTags)}. Then a mix of category + audience-specific niche."]
}`;

  return {
    prompt,
    blocks: {
      enrichment_block: opts.enrichment ? renderEnrichmentForPrompt(opts.enrichment) : "",
      guidelines_block: guidelinesBlock,
      promo_block: promoBlock,
      theme_cue: themeCue,
      audience_line: audienceLine,
      format_hint: formatHint,
    },
  };
}

async function draftCreative(opts: {
  product: ReturnType<typeof findProduct>;
  theme: string;
  audience: string;
  vibe: string;
  format: IgFormat;
  enrichment?: import("./connoisseur_enrichment").ScriptEnrichment;
}): Promise<{ image_prompt: string; caption: string; hashtags: string[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const { prompt } = buildIgCreativePrompt(opts);

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini creative ${res.status}: ${t.slice(0, 300)}`);
  }
  bump("storyboard");
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    image_prompt: String(parsed.image_prompt ?? ""),
    caption: String(parsed.caption ?? ""),
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h: any) => String(h).replace(/^#/, ""))
      : [],
  };
}
