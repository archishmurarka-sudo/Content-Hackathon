import { NextResponse } from "next/server";
import { resolveTextModel, resolveImageModel } from "@/lib/models";
import { hasDb, sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public health check. Never returns secret values — only booleans showing
// which env vars are present so you can verify Railway config without
// triggering a paid API call.
export async function GET() {
  let db_status: { configured: boolean; reachable: boolean; brief_count: number | null; error: string | null } = {
    configured: hasDb(),
    reachable: false,
    brief_count: null,
    error: null,
  };
  if (hasDb()) {
    try {
      await ensureSchema();
      const rows = await sql()`SELECT COUNT(*)::int AS n FROM briefs`;
      db_status.reachable = true;
      db_status.brief_count = (rows[0] as any).n;
    } catch (err: any) {
      db_status.error = String(err?.message ?? err).slice(0, 200);
    }
  }

  return NextResponse.json({
    ok: true,
    env: {
      DASHBOARD_PASSWORD: Boolean(process.env.DASHBOARD_PASSWORD),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      GEMINI_MODEL_RAW: process.env.GEMINI_MODEL ?? null,
      GEMINI_IMAGE_MODEL_RAW: process.env.GEMINI_IMAGE_MODEL ?? null,
      HIGGSFIELD_API_KEY: Boolean(process.env.HIGGSFIELD_API_KEY),
      YOUTUBE_API_KEY: Boolean(process.env.YOUTUBE_API_KEY),
      PERISKOPE_API_KEY: Boolean(process.env.PERISKOPE_API_KEY),
      PERISKOPE_PHONE: Boolean(process.env.PERISKOPE_PHONE),
      R2_BUCKET: process.env.R2_BUCKET ?? null,
      R2_ENDPOINT_SET: Boolean(process.env.R2_ENDPOINT),
      R2_ACCOUNT_ID_SET: Boolean(process.env.R2_ACCOUNT_ID),
      R2_CONFIGURED:
        Boolean(process.env.R2_ACCESS_KEY_ID) &&
        Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
        Boolean(process.env.R2_BUCKET) &&
        (Boolean(process.env.R2_ENDPOINT) || Boolean(process.env.R2_ACCOUNT_ID)),
    },
    resolved: {
      gemini_text_model: resolveTextModel(),
      gemini_image_model: resolveImageModel(),
    },
    db: db_status,
    commit_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    deploy_time: process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? null,
  });
}
