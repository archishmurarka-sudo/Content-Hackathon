// Onboard a new TikTok creator into the catalog.
// Flow: Apify TikTok scrape → Gemini dossier synthesis → in-memory addCreator().
// HTTP-only (no shell-outs), so this works on Railway.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { scrapeTikTokProfile } from "@/lib/apify";
import { synthesizeCreatorFromPosts } from "@/lib/creator_sync";
import { addCreator, ensureCreatorsLoaded, findCreator } from "@/lib/data";

// Extract a normalized TikTok handle ("@foo", "https://tiktok.com/@foo", "foo")
// → "foo". Used for dedup lookup BEFORE we burn an Apify run.
function normalizeHandle(input: string): string {
  let s = input.trim();
  const urlMatch = s.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) s = urlMatch[1];
  return s.replace(/^@/, "").toLowerCase();
}

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
    await ensureCreatorsLoaded();

    // Dedup: an Apify TikTok actor run costs ~$5–20 per execution. If the
    // operator pastes a handle that's already in the catalog, return the
    // existing record instead of paying again. Pass `?force=1` (or
    // `{ force: true }` in the body) to override — useful for refreshing
    // an old dossier with new recent_videos.
    const url = new URL(req.url);
    const force = Boolean(body?.force) || url.searchParams.get("force") === "1";
    const normalized = normalizeHandle(input);
    if (!force && normalized) {
      const existing = findCreator(normalized);
      if (existing) {
        return NextResponse.json({
          creator: existing,
          posts_sampled: existing.recent_videos?.length ?? 0,
          first_post_url: existing.recent_videos?.[0]?.web_video_url ?? null,
          author_avatar: existing.avatar_url ?? null,
          _meta: { source: "cache", reason: "creator already in catalog", normalized_handle: normalized },
        });
      }
    }

    const posts = await scrapeTikTokProfile(input, { resultsPerPage: 10 });
    const creator = await synthesizeCreatorFromPosts(posts);
    await addCreator(creator);
    return NextResponse.json({
      creator,
      posts_sampled: posts.length,
      first_post_url: posts[0]?.webVideoUrl ?? null,
      author_avatar: posts[0]?.authorMeta?.avatar ?? null,
      _meta: { source: "apify", forced: force, normalized_handle: normalized },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "tiktok scrape failed" }, { status: 500 });
  }
}
