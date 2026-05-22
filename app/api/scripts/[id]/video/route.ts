// POST /api/scripts/:id/video
//
// Generates (or regenerates) the 8-second Veo video for a single script.
// Image-to-video: uses the script's existing image_url as the first frame
// (script_image goes through OpenAI first; this route refuses if not set).
// The mp4 lands in R2 alongside the image and is stamped onto the row.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getScript, setScriptVideo } from "@/lib/ad-scripts";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateScriptVideo, buildVideoPromptForScript } from "@/lib/gemini-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Veo can take 2-4 minutes per clip; give headroom.
export const maxDuration = 540;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }
  const { id } = await params;

  const script = await getScript(id);
  if (!script) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!script.image_url) {
    return NextResponse.json(
      { error: "this script has no image yet — generate the image first so Veo can use it as the first frame" },
      { status: 400 }
    );
  }

  await ensureProductsLoaded();
  const product = findProduct(script.product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  await setScriptVideo(id, { video_status: "pending", video_error: null });

  const prompt = buildVideoPromptForScript({
    script_csv: script.script_csv as Record<string, string>,
    product_name: product.name,
    product_brand: product.brand,
    placement: script.placement,
  });

  // Veo needs an absolute URL it can fetch over the internet.
  const origin = absoluteOrigin(req);
  const imageUrl = absolutize(origin, script.image_url);

  try {
    const v = await generateScriptVideo({
      prompt,
      image_url: imageUrl,
      aspect_ratio: script.placement === "feed" ? "16:9" : "9:16",
      duration_s: 8,
      with_audio: true,
      prefix: `scripts/${id}/videos`,
    });
    const updated = await setScriptVideo(id, {
      video_status: "ready",
      video_url: v.url,
      video_key: v.key,
      video_prompt: prompt,
      video_model: v.model,
      video_error: null,
    });
    return NextResponse.json({ script: updated });
  } catch (err: any) {
    await setScriptVideo(id, {
      video_status: "failed",
      video_error: err?.message ?? "video generation failed",
    });
    return NextResponse.json({ error: err?.message ?? "video generation failed" }, { status: 502 });
  }
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
