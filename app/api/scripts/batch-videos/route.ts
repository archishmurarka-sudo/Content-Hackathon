// POST /api/scripts/batch-videos
// Body: { product_id: string, only_approved?: boolean, force?: boolean }
//
// Generates Veo videos for every script under a product that has an image
// (image is the first frame). By default skips scripts that already have a
// ready video — pass force=true to re-render. Lower concurrency than
// images because Veo jobs are expensive and Google rate-limits harder.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { listScriptsForProduct, setScriptVideo } from "@/lib/ad-scripts";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateScriptVideo, buildVideoPromptForScript } from "@/lib/gemini-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 540;

const CONCURRENCY = 2;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({} as any));
  const product_id = String(body.product_id ?? "").trim();
  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  const only_approved = Boolean(body.only_approved);
  const force = Boolean(body.force);

  await ensureProductsLoaded();
  const product = findProduct(product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  let scripts = await listScriptsForProduct(product_id);
  if (only_approved) scripts = scripts.filter((s) => s.approved);
  // Veo needs the image as first frame — require image_url + image_status ready.
  scripts = scripts.filter((s) => s.image_url && s.image_status === "ready");
  if (!force) scripts = scripts.filter((s) => s.video_status !== "ready");

  if (scripts.length === 0) {
    return NextResponse.json({
      count: 0,
      message: "no eligible scripts — either none have ready images, or all already have videos",
    });
  }

  await Promise.all(scripts.map((s) => setScriptVideo(s.id, { video_status: "pending", video_error: null })));

  const origin = absoluteOrigin(req);
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < scripts.length; i += CONCURRENCY) {
    const chunk = scripts.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (s) => {
        const prompt = buildVideoPromptForScript({
          script_csv: s.script_csv as Record<string, string>,
          product_name: product.name,
          product_brand: product.brand,
          placement: s.placement,
        });
        try {
          const v = await generateScriptVideo({
            prompt,
            image_url: absolutize(origin, s.image_url!),
            aspect_ratio: s.placement === "feed" ? "16:9" : "9:16",
            duration_s: 8,
            with_audio: true,
            prefix: `scripts/${s.id}/videos`,
          });
          await setScriptVideo(s.id, {
            video_status: "ready",
            video_url: v.url,
            video_key: v.key,
            video_prompt: prompt,
            video_model: v.model,
            video_error: null,
          });
          succeeded++;
        } catch (err: any) {
          await setScriptVideo(s.id, {
            video_status: "failed",
            video_error: err?.message ?? "video generation failed",
          });
          failed++;
        }
      })
    );
  }

  return NextResponse.json({ count: scripts.length, succeeded, failed });
}

function absoluteOrigin(req: NextRequest): string {
  const env = process.env.PUBLIC_BASE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function absolutize(origin: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}
