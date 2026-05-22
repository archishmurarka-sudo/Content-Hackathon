import { NextRequest, NextResponse } from "next/server";
import { getBrief, initFrames, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { findCreator, findProduct, ensureCreatorsLoaded, ensureProductsLoaded } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/briefs/:id/frames  → generate (or re-generate) frames for the brief.
//
// By default, SKIPS shots that already have status==="ready" — every frame
// is a ~$0.04 OpenAI image gen, and the operator clicking "Regenerate all"
// twice was paying for the entire storyboard twice. Pass `{ force: true }`
// in the body (or ?force=1) to override and re-render every shot regardless.
// Failed shots are always retried.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "storyboard not ready" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const url = new URL(req.url);
  const force = Boolean(body?.force) || url.searchParams.get("force") === "1";

  await initFrames(id);
  await ensureCreatorsLoaded();
  await ensureProductsLoaded();

  // Re-fetch after initFrames so we have the canonical frame map.
  const briefAfterInit = (await getBrief(id))!;
  const existing = new Map((briefAfterInit.frames ?? []).map((f) => [f.shot_idx, f]));

  const creator = findCreator(brief.creator_handle);
  const product = findProduct(brief.product_id);
  const productLabel = product ? `${product.name} (${product.brand})` : undefined;
  const productHero = product?.hero_image_url ?? undefined;
  const creatorAvatar = creator?.avatar_url ?? undefined;
  const creatorReferences = (creator?.recent_videos ?? [])
    .map((v) => v.cover_url)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);
  const funnelStage = brief.funnel_stage ?? "BOF";

  let skipped = 0;
  let generated = 0;

  await Promise.all(
    brief.storyboard.shots.map(async (shot) => {
      // Dedup: skip shots already in "ready" state unless caller forces.
      // "pending"/"failed"/missing always (re)generate.
      const current = existing.get(shot.idx);
      if (!force && current?.status === "ready" && current.image_url) {
        skipped++;
        return;
      }
      try {
        const img = await generateFrameImage({
          prompt: shot.image_prompt,
          brief_id: id,
          shot_idx: shot.idx,
          funnel_stage: funnelStage,
          product_label: productLabel,
          product_hero_url: productHero,
          creator_handle: brief.creator_handle,
          creator_archetype: creator?.archetype,
          creator_avatar_url: creatorAvatar,
          creator_reference_urls: creatorReferences,
          shot_visual: shot.visual,
          shot_product_action: shot.product_action,
          shot_overlay: shot.overlay,
        });
        await setFrame(id, shot.idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
        generated++;
      } catch (err: any) {
        await setFrame(id, shot.idx, { status: "failed", error: err?.message ?? "frame failed" });
      }
    })
  );

  const result = await getBrief(id);
  return NextResponse.json({ ...result, _meta: { generated, skipped, forced: force } });
}
