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
  })();
  return g.__schemaReady;
}
