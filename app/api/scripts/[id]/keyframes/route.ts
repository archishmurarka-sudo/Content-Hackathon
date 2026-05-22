// POST /api/scripts/:id/keyframes
//
// Decomposes the script into 5 timed beats via Gemini (~$0.001), then
// generates one OpenAI gpt-image-2 image per beat in parallel
// (~$0.042 × 5 = $0.21). Stores the full keyframe array on the row and
// mirrors the first keyframe's URL onto the row-level image_url so the
// existing Veo first-frame path keeps working unchanged.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getScript, setScriptKeyframes, type ScriptKeyframe } from "@/lib/ad-scripts";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { decomposeScriptIntoBeats, renderPersonaForKeyframe } from "@/lib/script-beats";
import { fetchScriptEnrichment } from "@/lib/connoisseur_enrichment";
import { generateAdImage, buildPromptForKeyframe } from "@/lib/openai-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KEYFRAME_COUNT = 5;
const TOTAL_DURATION_S = 8;
const CONCURRENCY = 3;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)) {
    return NextResponse.json({ error: "OPENAI_API_KEY / OPENAI_KEY not set on the server" }, { status: 500 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  const { id } = await params;
  const script = await getScript(id);
  if (!script) return NextResponse.json({ error: "not found" }, { status: 404 });

  await ensureProductsLoaded();
  const product = findProduct(script.product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  await setScriptKeyframes(id, { keyframes_status: "pending" });

  // 0) Pull Connoisseur archetype + voice data (if the product has a corpus)
  //    so the protagonist pick is biased toward casting that actually wins
  //    for this brand. Soft-fails — MCP downtime never blocks the storyboard.
  const enrichment = await fetchScriptEnrichment(product).catch(() => undefined);

  // 1) Decompose script → 5 beats + ONE locked protagonist via Gemini.
  let decomposed;
  try {
    decomposed = await decomposeScriptIntoBeats({
      script_csv: script.script_csv as Record<string, string>,
      product_name: product.name,
      product_brand: product.brand,
      audience_primary: product.audience_primary ?? null,
      audience_secondary: product.audience_secondary ?? null,
      count: KEYFRAME_COUNT,
      total_duration_s: TOTAL_DURATION_S,
      enrichment,
    });
  } catch (err: any) {
    await setScriptKeyframes(id, { keyframes_status: "failed" });
    return NextResponse.json({ error: `beat decomposition failed: ${err?.message ?? err}` }, { status: 502 });
  }
  const { persona, beats, prompt: beatsPrompt, model: beatsModel } = decomposed;
  const personaBlock = renderPersonaForKeyframe(persona);

  // 2) Seed the array with pending entries so the UI can render the strip
  //    immediately.
  const seed: ScriptKeyframe[] = beats.map((b) => ({
    idx: b.idx,
    timestamp_s: b.timestamp_s,
    voiceover: b.voiceover,
    visual: b.visual,
    image_url: null,
    image_key: null,
    image_prompt: null,
    status: "pending",
    error: null,
  }));
  await setScriptKeyframes(id, {
    keyframes: seed,
    keyframes_status: "pending",
    persona,
    beats_prompt: beatsPrompt,
    beats_model: beatsModel,
  });

  // 3) Generate one image per beat. Concurrency-limited so we don't burst
  //    OpenAI; results streamed back into the keyframes array as each
  //    finishes — the poll loop in the UI sees them appear one by one.
  const results: ScriptKeyframe[] = [...seed];

  for (let i = 0; i < beats.length; i += CONCURRENCY) {
    const chunk = beats.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (b) => {
        const prompt = buildPromptForKeyframe({
          beat: b,
          total_beats: KEYFRAME_COUNT,
          total_duration_s: TOTAL_DURATION_S,
          product_name: product.name,
          product_brand: product.brand,
          product_format: product.format,
          product_one_liner: product.one_liner,
          placement: script.placement,
          hero_image_url: product.hero_image_url ?? null,
          persona_block: personaBlock,
          enrichment,
        });
        try {
          const img = await generateAdImage({
            prompt,
            aspect: script.placement === "feed" ? "square" : "portrait",
            quality: "medium",
            prefix: `scripts/${id}/keyframes/${b.idx}`,
            reference_image_url: product.hero_image_url ?? null,
            extra_reference_urls: product.gallery_image_urls ?? null,
          });
          results[b.idx] = {
            ...results[b.idx],
            image_url: img.url,
            image_key: img.key,
            image_prompt: prompt,
            status: "ready",
            error: null,
          };
          // Persist incrementally so the polling UI sees progress.
          // First keyframe doubles as the row's image_url (Veo first-frame).
          const patch: Parameters<typeof setScriptKeyframes>[1] = { keyframes: results };
          if (b.idx === 0) {
            patch.image_url = img.url;
            patch.image_key = img.key;
            patch.image_status = "ready";
            patch.image_prompt = prompt;
          }
          await setScriptKeyframes(id, patch);
        } catch (err: any) {
          results[b.idx] = {
            ...results[b.idx],
            status: "failed",
            error: err?.message ?? "image generation failed",
          };
          await setScriptKeyframes(id, { keyframes: results });
        }
      })
    );
  }

  // 4) Roll up the keyframes_status.
  const ready = results.filter((k) => k.status === "ready").length;
  const failed = results.filter((k) => k.status === "failed").length;
  const finalStatus =
    ready === results.length ? "ready" : failed === results.length ? "failed" : "partial";
  await setScriptKeyframes(id, { keyframes_status: finalStatus });

  const final = await getScript(id);
  return NextResponse.json({ script: final, ready, failed, total: results.length });
}
