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

export type IgPost = {
  id: string;
  product_id: string;
  format: IgFormat;
  theme: string;
  vibe: string | null;
  image_status: IgStatus;
  image_url: string | null;
  image_key: string | null;
  image_prompt: string | null;
  caption: string | null;
  hashtags: string[];
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
  vibe?: string;
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
    vibe: input.vibe?.trim() || null,
    image_status: "pending",
    image_url: null,
    image_key: null,
    image_prompt: null,
    caption: null,
    hashtags: [],
    error: null,
    created_at: Date.now(),
  };
  await persist(row);

  try {
    // Step 1 — Gemini turns product + theme + vibe into a concrete image
    // prompt and a caption + hashtag block. We do both in one call so the
    // image and the copy share the same creative direction.
    const creative = await draftCreative({
      product,
      theme: input.theme,
      vibe: input.vibe ?? "",
      format: input.format,
    });

    // Step 2 — OpenAI renders the PNG.
    const img = await generateAdImage({
      prompt: creative.image_prompt,
      aspect: FORMAT_TO_ASPECT[input.format],
      quality: "medium",
      prefix: `instagram/${id}`,
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

// ---- internals ----

async function persist(row: IgPost): Promise<void> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO ig_posts (id, product_id, format, theme, vibe, image_status, image_url, image_key, image_prompt, caption, hashtags, error, created_at)
      VALUES (${row.id}, ${row.product_id}, ${row.format}, ${row.theme}, ${row.vibe ?? null},
              ${row.image_status}, ${row.image_url ?? null}, ${row.image_key ?? null},
              ${row.image_prompt ?? null}, ${row.caption ?? null},
              ${s.json(row.hashtags) as any}, ${row.error ?? null}, ${row.created_at})
      ON CONFLICT (id) DO UPDATE SET
        image_status = EXCLUDED.image_status,
        image_url    = EXCLUDED.image_url,
        image_key    = EXCLUDED.image_key,
        image_prompt = EXCLUDED.image_prompt,
        caption      = EXCLUDED.caption,
        hashtags     = EXCLUDED.hashtags,
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
    vibe: r.vibe ?? null,
    image_status: r.image_status as IgStatus,
    image_url: r.image_url ?? null,
    image_key: r.image_key ?? null,
    image_prompt: r.image_prompt ?? null,
    caption: r.caption ?? null,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : (r.hashtags ?? []),
    error: r.error ?? null,
    created_at: Number(r.created_at),
  };
}

async function draftCreative(opts: {
  product: ReturnType<typeof findProduct>;
  theme: string;
  vibe: string;
  format: IgFormat;
}): Promise<{ image_prompt: string; caption: string; hashtags: string[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const p = opts.product;
  if (!p) throw new Error("no product");

  const formatHint = {
    feed_1x1: "Instagram feed square (1:1). Subject centered, no important detail in the outer 5% (Instagram crops).",
    feed_4x5: "Instagram feed portrait (4:5). Vertical composition, subject upper-third.",
    reels_9x16: "Instagram Reels / Story (9:16). Full-bleed vertical. Leave a 200px top margin and 350px bottom margin clear for IG UI overlays.",
  }[opts.format];

  const prompt = `You are designing a single branded Instagram post for ${p.brand}. Not creator UGC — this is owned-channel content posted from the brand handle. Premium, on-brand, no obvious AI artifacts.

PRODUCT
${p.name} by ${p.brand}
${p.one_liner}
${p.key_ingredients?.length ? `Key ingredients: ${p.key_ingredients.join(", ")}` : ""}
${p.format ? `Format: ${p.format}` : ""}
${p.audience_primary ? `Primary audience: ${p.audience_primary}` : ""}

CREATIVE BRIEF
Theme: ${opts.theme}
Vibe: ${opts.vibe || "(default brand vibe — clean, modern, warm)"}
Placement: ${formatHint}

Output a single JSON object with EXACTLY these keys, no markdown:
{
  "image_prompt": "ONE paragraph (≤120 words) describing the photograph or illustration for an image model. Concrete: subject, composition, lighting, palette, props, mood. ${p.hero_image_url ? "If a product render appears, anchor the form to a real-world version of the product." : ""} Do NOT include any text overlay instructions — text is added in post.",
  "caption": "Instagram caption: hook line, then 1-3 short paragraphs. Conversational brand voice. No emojis at the start of the hook; up to 2 emojis total in the body. No hashtags here.",
  "hashtags": ["array of 8-12 hashtags, no '#' prefix, lowercase, mix of branded + category + niche"]
}`;

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
