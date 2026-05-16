import { NextResponse } from "next/server";
import { resolveTextModel, resolveImageModel } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public health check. Never returns secret values — only booleans showing
// which env vars are present so you can verify Railway config without
// triggering a paid API call.
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      DASHBOARD_PASSWORD: Boolean(process.env.DASHBOARD_PASSWORD),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      GEMINI_MODEL_RAW: process.env.GEMINI_MODEL ?? null,
      GEMINI_IMAGE_MODEL_RAW: process.env.GEMINI_IMAGE_MODEL ?? null,
      HIGGSFIELD_API_KEY: Boolean(process.env.HIGGSFIELD_API_KEY),
      YOUTUBE_API_KEY: Boolean(process.env.YOUTUBE_API_KEY),
      PERISKOPE_API_KEY: Boolean(process.env.PERISKOPE_API_KEY),
      PERISKOPE_PHONE: Boolean(process.env.PERISKOPE_PHONE),
      R2_BUCKET: process.env.R2_BUCKET ?? null,
      R2_CONFIGURED:
        Boolean(process.env.R2_ACCOUNT_ID) &&
        Boolean(process.env.R2_ACCESS_KEY_ID) &&
        Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
        Boolean(process.env.R2_BUCKET),
    },
    resolved: {
      gemini_text_model: resolveTextModel(),
      gemini_image_model: resolveImageModel(),
    },
    commit_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    deploy_time: process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? null,
  });
}
