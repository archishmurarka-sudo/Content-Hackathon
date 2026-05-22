// POST /api/scripts/batch-images
// Body: { product_id: string, only_approved?: boolean, force?: boolean }
//
// Generates ad images for every script under a product. By default skips
// scripts that already have a ready image — pass force=true to re-render.
// Runs in parallel with a small concurrency cap so we don't burst OpenAI.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { listScriptsForProduct, setScriptImage } from "@/lib/ad-scripts";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateAdImage, buildPromptForAdScript } from "@/lib/openai-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 540;

const CONCURRENCY = 3;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)) {
    return NextResponse.json({ error: "OPENAI_API_KEY / OPENAI_KEY not set on the server" }, { status: 500 });
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
  if (!force) scripts = scripts.filter((s) => s.image_status !== "ready");

  if (scripts.length === 0) {
    return NextResponse.json({ count: 0, message: "no scripts needed images" });
  }

  // Mark all as pending up front so the UI flips immediately.
  await Promise.all(scripts.map((s) => setScriptImage(s.id, { image_status: "pending", image_error: null })));

  let succeeded = 0;
  let failed = 0;

  // Simple concurrency limiter — chunk the array and process in parallel batches.
  for (let i = 0; i < scripts.length; i += CONCURRENCY) {
    const chunk = scripts.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (s) => {
        const { prompt, aspect } = buildPromptForAdScript({
          script_csv: s.script_csv as Record<string, string>,
          product_name: product.name,
          product_brand: product.brand,
          product_format: product.format,
          product_one_liner: product.one_liner,
          placement: s.placement,
          hero_image_url: product.hero_image_url ?? null,
        });
        try {
          const img = await generateAdImage({
            prompt,
            aspect,
            quality: "medium",
            prefix: `scripts/${s.id}/images`,
            reference_image_url: product.hero_image_url ?? null,
            extra_reference_urls: product.gallery_image_urls ?? null,
          });
          await setScriptImage(s.id, {
            image_status: "ready",
            image_url: img.url,
            image_key: img.key,
            image_prompt: prompt,
            image_error: null,
          });
          succeeded++;
        } catch (err: any) {
          await setScriptImage(s.id, {
            image_status: "failed",
            image_error: err?.message ?? "image generation failed",
          });
          failed++;
        }
      })
    );
  }

  return NextResponse.json({ count: scripts.length, succeeded, failed });
}
