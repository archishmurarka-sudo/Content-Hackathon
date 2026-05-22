// Single Postgres connection pool. Reads DATABASE_URL from env (Railway sets
// this automatically when the Postgres plugin is in the same project).
//
// Schema is created idempotently on first call to ensureSchema(). No external
// migration runner — this is a single-table app right now and the trial moves
// faster than a migration toolchain would.

import postgres from "postgres";

const g = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __schemaReady?: Promise<void>;
};

export function hasDb() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set (Railway Postgres plugin not attached to this service?)");
  }
  if (!g.__sql) {
    g.__sql = postgres(process.env.DATABASE_URL, {
      max: 5,
      idle_timeout: 30,
      // Railway/Supabase managed PG defaults to require=ssl; the driver
      // negotiates automatically when the URL has sslmode=require.
      // No explicit ssl config needed.
    });
  }
  return g.__sql;
}

export async function ensureSchema(): Promise<void> {
  if (g.__schemaReady) return g.__schemaReady;
  const s = sql();
  g.__schemaReady = (async () => {
    await s`
      CREATE TABLE IF NOT EXISTS briefs (
        id TEXT PRIMARY KEY,
        creator_handle TEXT NOT NULL,
        product_id TEXT NOT NULL,
        target_duration_s INTEGER NOT NULL,
        status TEXT NOT NULL,
        storyboard JSONB,
        frames JSONB,
        youtube_ref JSONB,
        delivery JSONB,
        final_video_url TEXT,
        final_video_key TEXT,
        error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `;
    // Idempotent column adds for upgrading existing tables (Postgres 9.6+).
    await s`ALTER TABLE briefs ADD COLUMN IF NOT EXISTS delivery JSONB;`;
    await s`ALTER TABLE briefs ADD COLUMN IF NOT EXISTS final_video_url TEXT;`;
    await s`ALTER TABLE briefs ADD COLUMN IF NOT EXISTS final_video_key TEXT;`;
    await s`ALTER TABLE briefs ADD COLUMN IF NOT EXISTS funnel_stage TEXT;`;
    await s`CREATE INDEX IF NOT EXISTS briefs_created_at_idx ON briefs (created_at DESC);`;
    await s`CREATE INDEX IF NOT EXISTS briefs_status_idx ON briefs (status);`;
    // Creators added at runtime via the TikTok-scrape onboarding flow.
    // Base catalog still lives in data/creators.json (read-only); this table
    // captures anything onboarded after deploy so it survives container restarts.
    await s`
      CREATE TABLE IF NOT EXISTS creators_added (
        handle TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
    `;
    await s`CREATE INDEX IF NOT EXISTS creators_added_created_at_idx ON creators_added (created_at DESC);`;
    // User-added products. Built-in PRODUCTS array still lives in lib/data.ts.
    await s`
      CREATE TABLE IF NOT EXISTS products_added (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
    `;
    await s`CREATE INDEX IF NOT EXISTS products_added_created_at_idx ON products_added (created_at DESC);`;
    // Append-only event log for everything the operator does to a brief:
    // script regens, frame regens with feedback, approves, video renders,
    // stitches, sends. Source of truth for future model fine-tuning on
    // operator preferences ("what good looked like vs what got redone").
    await s`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        brief_id TEXT NOT NULL,
        shot_idx INTEGER,
        type TEXT NOT NULL,
        payload JSONB,
        outcome JSONB,
        created_at BIGINT NOT NULL
      );
    `;
    await s`CREATE INDEX IF NOT EXISTS events_brief_idx ON events (brief_id, created_at DESC);`;
    await s`CREATE INDEX IF NOT EXISTS events_type_idx ON events (type);`;
    await s`CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at DESC);`;

    // Meta direct-response ad scripts. Decoupled from the TikTok UGC briefs
    // table — the Scripts feature has different inputs (style + placement +
    // competitor refs, no creator) and a different output shape (10-column
    // CSV row per Noa's template).
    await s`
      CREATE TABLE IF NOT EXISTS ad_scripts (
        id           TEXT PRIMARY KEY,
        product_id   TEXT NOT NULL,
        batch_id     TEXT NOT NULL,
        script_kind  TEXT NOT NULL,
        style        TEXT,
        placement    TEXT,
        source_ref   TEXT,
        script_csv   JSONB NOT NULL,
        approved     BOOLEAN DEFAULT FALSE,
        image_status TEXT,
        image_url    TEXT,
        image_key    TEXT,
        image_prompt TEXT,
        image_error  TEXT,
        created_at   BIGINT NOT NULL
      );
    `;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS image_status TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS image_url TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS image_key TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS image_prompt TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS image_error TEXT;`;
    // Veo video columns (image-to-video via Gemini Veo 3.1 Fast).
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_status TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_url TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_key TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_prompt TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_model TEXT;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS video_error TEXT;`;
    // Keyframes — 5-image storyboard per script for visual-consistency QA
    // before committing to the Veo render. Shape: { idx, timestamp_s,
    // voiceover, visual, image_url, image_key, image_prompt, status, error }
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS keyframes JSONB;`;
    await s`ALTER TABLE ad_scripts ADD COLUMN IF NOT EXISTS keyframes_status TEXT;`;
    await s`CREATE INDEX IF NOT EXISTS ad_scripts_product_idx ON ad_scripts (product_id, created_at DESC);`;
    await s`CREATE INDEX IF NOT EXISTS ad_scripts_batch_idx ON ad_scripts (batch_id);`;

    // Instagram branded-content posts. Owned-channel content (not creator
    // UGC) — single hero image + caption + hashtags per row.
    await s`
      CREATE TABLE IF NOT EXISTS ig_posts (
        id           TEXT PRIMARY KEY,
        product_id   TEXT NOT NULL,
        format       TEXT NOT NULL,
        theme        TEXT NOT NULL,
        vibe         TEXT,
        image_status TEXT NOT NULL,
        image_url    TEXT,
        image_key    TEXT,
        image_prompt TEXT,
        caption      TEXT,
        hashtags     JSONB,
        error        TEXT,
        created_at   BIGINT NOT NULL
      );
    `;
    await s`CREATE INDEX IF NOT EXISTS ig_posts_created_at_idx ON ig_posts (created_at DESC);`;
    await s`CREATE INDEX IF NOT EXISTS ig_posts_product_idx ON ig_posts (product_id, created_at DESC);`;
  })();
  return g.__schemaReady;
}
