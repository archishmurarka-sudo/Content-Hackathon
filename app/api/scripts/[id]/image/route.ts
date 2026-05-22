// POST /api/scripts/:id/image
//
// Generates (or regenerates) the static ad image for a single script row.
// Pulls the product context, builds the image prompt from the script's CSV
// (hook + voiceover + visual ref + on-screen text + placement-aware aspect),
// calls OpenAI gpt-image-2, stores the PNG in R2 via lib/storage, then
// stamps image_url + image_key + image_prompt on the ad_scripts row.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getScript, setScriptImage } from "@/lib/ad-scripts";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateAdImage, buildPromptForAdScript } from "@/lib/openai-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)) {
    return NextResponse.json({ error: "OPENAI_API_KEY / OPENAI_KEY not set on the server" }, { status: 500 });
  }

  const script = await getScript(id);
  if (!script) return NextResponse.json({ error: "not found" }, { status: 404 });

  await ensureProductsLoaded();
  const product = findProduct(script.product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  await setScriptImage(id, { image_status: "pending", image_error: null });

  const { prompt, aspect } = buildPromptForAdScript({
    script_csv: script.script_csv as Record<string, string>,
    product_name: product.name,
    product_brand: product.brand,
    product_format: product.format,
    product_one_liner: product.one_liner,
    placement: script.placement,
    hero_image_url: product.hero_image_url ?? null,
  });

  try {
    const img = await generateAdImage({
      prompt,
      aspect,
      quality: "medium",
      prefix: `scripts/${id}/images`,
    });
    const updated = await setScriptImage(id, {
      image_status: "ready",
      image_url: img.url,
      image_key: img.key,
      image_prompt: prompt,
      image_error: null,
    });
    return NextResponse.json({ script: updated, cost_estimate_usd: img.cost_estimate_usd });
  } catch (err: any) {
    await setScriptImage(id, {
      image_status: "failed",
      image_error: err?.message ?? "image generation failed",
    });
    return NextResponse.json({ error: err?.message ?? "image generation failed" }, { status: 502 });
  }
}
