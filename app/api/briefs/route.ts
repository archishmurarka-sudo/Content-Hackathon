import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, ensureCreatorsLoaded, ensureProductsLoaded, findProduct, type Product } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { createBrief, listBriefs, setStoryboard, setFailed, initFrames, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { fetchYouTubeVideo } from "@/lib/youtube";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";
import { fetchScriptEnrichment, preShipCheck, brandSlugForProduct, resolveEnrichmentFromBody } from "@/lib/connoisseur_enrichment";

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
  // Operator toggle — when false, skip the Connoisseur enrichment and
  // pre-ship check entirely. Defaults to true.
  const enrich_with_connoisseur = body.enrich_with_connoisseur !== false;

  if (!handle) return NextResponse.json({ error: "creator_handle required" }, { status: 400 });
  // Hydrate from Postgres so creators onboarded via /api/creators/scrape on a
  // previous request (or before this container booted) are findable.
  await ensureCreatorsLoaded();
  await ensureProductsLoaded();
  const creator = findCreator(handle);
  if (!creator) return NextResponse.json({ error: `creator @${handle} not found in catalog` }, { status: 404 });
  const product = findProduct(product_id);
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

  const brief = await createBrief({ creator_handle: creator.handle, product_id, target_duration_s, funnel_stage, youtube_ref });
  void logEvent({
    type: "brief.created",
    brief_id: brief.id,
    payload: {
      creator_handle: creator.handle,
      creator_archetype: creator.archetype,
      product_id,
      product_name: product.name,
      target_duration_s,
      funnel_stage,
      youtube_url_attached: Boolean(youtube_url),
    },
  });

  // Generate storyboard in background, but await result so client gets it on POST.
  const sbStartedAt = Date.now();
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
    // Live enrichment (voice atoms + selling points + winners + gates +
    // archetype perf). Honors enrich_with_connoisseur toggle and any
    // operator-picked override blob from the Connoisseur panel.
    const enrichment = await resolveEnrichmentFromBody(product, body);
    const sb = await generateStoryboard({
      creator,
      product,
      prototypes,
      target_duration_s,
      funnel_stage,
      youtube_ref,
      enrichment,
    });
    await setStoryboard(brief.id, { ...sb, brief_id: brief.id });
    void logEvent({
      type: "brief.storyboard_ready",
      brief_id: brief.id,
      payload: {
        creator_handle: creator.handle,
        product_id,
        funnel_stage,
        inspired_by_video_ids: prototypes.map((p) => p.video_id),
        connoisseur_enriched: Boolean(enrichment),
        enrichment_counts: enrichment ? {
          voice_atoms: enrichment.voice_atoms.length,
          selling_points: enrichment.selling_points.length,
          winner_combos: enrichment.winner_combos.length,
          compliance_gates: enrichment.compliance_gates.length,
          archetype_performance: enrichment.archetype_performance.length,
        } : null,
      },
      outcome: {
        hook: sb.hook,
        cta: sb.cta,
        creator_gender: sb.creator_gender,
        banner_choice: sb.banner_choice,
        shot_count: sb.shots.length,
        latency_ms: Date.now() - sbStartedAt,
      },
    });

    // Pre-ship check (fire-and-forget) — run the storyboard's speech lines
    // past the Connoisseur compliance gates and log any flags. We do NOT
    // block frame generation on this; flags surface on the brief detail page
    // so the operator can act before the spend on video render.
    void (async () => {
      const scriptText = sb.shots.map((s) => s.speech).filter(Boolean).join(" ");
      const sellingUsed = enrichment?.selling_points.slice(0, 8).map((s) => s.point) ?? [];
      const psc = await preShipCheck({ brand_slug: brandSlugForProduct(product) ?? "ashwamag", script_text: scriptText, selling_points_used: sellingUsed });
      void logEvent({
        type: "brief.pre_ship_check",
        brief_id: brief.id,
        payload: { creator_handle: creator.handle, product_id, brand_slug: brandSlugForProduct(product) ?? null, tool_ok: psc.ok },
        outcome: { passed: psc.passed, flag_count: psc.flags.length, flags: psc.flags.slice(0, 20) },
      });
    })().catch(() => {});

    // Fire-and-forget: auto-generate frames as soon as the storyboard is ready.
    // We don't await — the POST returns immediately with the storyboard, and
    // the brief detail page polls for frames as they finish.
    void autoGenerateFrames(brief.id, creator, product, funnel_stage).catch(() => {});
  } catch (err: any) {
    await setFailed(brief.id, err?.message ?? "storyboard generation failed");
    void logEvent({
      type: "brief.failed",
      brief_id: brief.id,
      payload: { stage: "storyboard" },
      outcome: { error: err?.message ?? "storyboard generation failed", latency_ms: Date.now() - sbStartedAt },
    });
  }

  // Return current brief state
  const updated = (await import("@/lib/briefs")).getBrief(brief.id);
  return NextResponse.json(await updated);
}

async function autoGenerateFrames(
  briefId: string,
  creator: { handle: string; archetype: string; avatar_url?: string | null; recent_videos?: { cover_url?: string | null }[] },
  product: Product,
  funnel_stage: "BOF" | "MOF" | "TOF",
) {
  const { getBrief } = await import("@/lib/briefs");
  const b = await getBrief(briefId);
  if (!b?.storyboard) return;

  await initFrames(briefId);
  const productLabel = `${product.name} (${product.brand})`;
  const productHero = product.hero_image_url ?? undefined;
  const creatorAvatar = creator.avatar_url ?? undefined;
  const creatorReferences = (creator.recent_videos ?? [])
    .map((v) => v.cover_url)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);

  await Promise.all(
    b.storyboard.shots.map(async (shot) => {
      try {
        const img = await generateFrameImage({
          prompt: shot.image_prompt,
          brief_id: briefId,
          shot_idx: shot.idx,
          funnel_stage,
          product_label: productLabel,
          product_hero_url: productHero,
          creator_handle: creator.handle,
          creator_archetype: creator.archetype,
          creator_avatar_url: creatorAvatar,
          creator_reference_urls: creatorReferences,
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
