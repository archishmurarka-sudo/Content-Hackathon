import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, PRODUCTS } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { createBrief, listBriefs, setStoryboard, setFailed } from "@/lib/briefs";
import { fetchYouTubeVideo } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ briefs: listBriefs() });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const handle = String(body.creator_handle ?? "").trim();
  const product_id = String(body.product_id ?? "ashwamag").trim();
  const target_duration_s = Number(body.target_duration_s ?? 20);
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

  const brief = createBrief({ creator_handle: creator.handle, product_id, target_duration_s, youtube_ref });

  // Generate storyboard in background, but await result so client gets it on POST.
  try {
    const prototypes = rankPrototypes({
      creator,
      product: product.name,
      target_duration_s,
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
      youtube_ref,
    });
    setStoryboard(brief.id, { ...sb, brief_id: brief.id });
  } catch (err: any) {
    setFailed(brief.id, err?.message ?? "storyboard generation failed");
  }

  // Return current brief state
  const updated = (await import("@/lib/briefs")).getBrief(brief.id);
  return NextResponse.json(updated);
}
