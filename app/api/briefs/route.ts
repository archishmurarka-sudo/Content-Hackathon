import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, PRODUCTS } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { createBrief, listBriefs, setStoryboard, setFailed, initFrames, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { fetchYouTubeVideo } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ briefs: await listBriefs() });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const handle = String(body.creator_handle ?? "").trim();
  const product_id = String(body.product_id ?? "ashwamag").trim();
  const target_duration_s = Number(body.target_duration_s ?? 20);
  const funnel_raw = String(body.funnel_stage ?? "BOF").toUpperCase();
  const funnel_stage: "BOF" | "MOF" | "TOF" =
    funnel_raw === "MOF" || funnel_raw === "TOF" ? funnel_raw : "BOF";
  const youtube_url = typeof body.youtube_url === "string" ? body.youtube_url.trim() : "";

  if (!handle) return NextResponse.json({ error: "creator_handle required" }, { status: 400 });
  const creator = findCreator(handle);
  if (!creator) return NextResponse.json({ error: `creator @${handle} not found in catalog` }, { status: 404 });
  const product = PRODUCTS.find((p) => p.id === product_id);
  if (!product) return NextResponse.json({ error: `unknown product '${product_id}'` }, { status: 400 });

  // Fail fast if Gemini isn't configured — don't create the brief at all.
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  // Optional YouTube reference — fetched up front so the storyboard prompt can use it.
  // If the fetch fails we proceed without it rather than failing the whole brief.
  let youtube_ref = undefined as Awaited<ReturnType<typeof fetchYouTubeVideo>> | undefined;
  if (youtube_url) {
    try {
      youtube_ref = await fetchYouTubeVideo(youtube_url);
    } catch (err: any) {
      // soft-fail; storyboard will still generate without the ref
      youtube_ref = undefined;
    }
  }

  const brief = await createBrief({ creator_handle: creator.handle, product_id, target_duration_s, youtube_ref });

  // Generate storyboard in background, but await result so client gets it on POST.
  try {
    const prototypes = rankPrototypes({
      creator,
      product: product.name,
      target_duration_s,
      funnel_stage,
      limit: 3,
    });
    if (prototypes.length === 0) {
      throw new Error("no matching prototypes found");
    }
    const sb = await generateStoryboard({
      creator,
      product_line: `${product.name} by ${product.brand} — ${product.one_liner}`,
      product_id,
      prototypes,
      target_duration_s,
      funnel_stage,
      youtube_ref,
    });
    await setStoryboard(brief.id, { ...sb, brief_id: brief.id });

    // Fire-and-forget: auto-generate frames as soon as the storyboard is ready.
    // We don't await — the POST returns immediately with the storyboard, and
    // the brief detail page polls for frames as they finish.
    void autoGenerateFrames(brief.id, creator, product).catch(() => {});
  } catch (err: any) {
    await setFailed(brief.id, err?.message ?? "storyboard generation failed");
  }

  // Return current brief state
  const updated = (await import("@/lib/briefs")).getBrief(brief.id);
  return NextResponse.json(await updated);
}

async function autoGenerateFrames(briefId: string, creator: { handle: string; archetype: string }, product: { name: string; brand: string }) {
  const { getBrief } = await import("@/lib/briefs");
  const b = await getBrief(briefId);
  if (!b?.storyboard) return;

  await initFrames(briefId);
  const productLabel = `${product.name} (${product.brand})`;

  await Promise.all(
    b.storyboard.shots.map(async (shot) => {
      try {
        const img = await generateFrameImage({
          prompt: shot.image_prompt,
          brief_id: briefId,
          shot_idx: shot.idx,
          product_label: productLabel,
          creator_handle: creator.handle,
          creator_archetype: creator.archetype,
          shot_visual: shot.visual,
          shot_product_action: shot.product_action,
          shot_overlay: shot.overlay,
        });
        await setFrame(briefId, shot.idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
      } catch (err: any) {
        await setFrame(briefId, shot.idx, { status: "failed", error: err?.message ?? "frame failed" });
      }
    })
  );
}
