// Onboard a new TikTok creator into the catalog.
// Flow: Apify TikTok scrape → Gemini dossier synthesis → in-memory addCreator().
// HTTP-only (no shell-outs), so this works on Railway.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { scrapeTikTokProfile } from "@/lib/apify";
import { synthesizeCreatorFromPosts } from "@/lib/creator_sync";
import { addCreator } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Apify run-sync can take up to 5 minutes for cold-start actors.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const input = String(body.tiktok ?? body.handle ?? body.url ?? "").trim();
  if (!input) return NextResponse.json({ error: "tiktok handle or url required" }, { status: 400 });

  if (!(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN)) {
    return NextResponse.json({ error: "APIFY_TOKEN not set on the server" }, { status: 500 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  try {
    const posts = await scrapeTikTokProfile(input, { resultsPerPage: 10 });
    const creator = await synthesizeCreatorFromPosts(posts);
    addCreator(creator);
    return NextResponse.json({
      creator,
      posts_sampled: posts.length,
      first_post_url: posts[0]?.webVideoUrl ?? null,
      author_avatar: posts[0]?.authorMeta?.avatar ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "tiktok scrape failed" }, { status: 500 });
  }
}
