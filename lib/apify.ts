// Apify TikTok scraper client. Uses the `clockworks~tiktok-scraper` actor
// (most popular community TikTok scraper) via the synchronous "run-sync"
// endpoint — POST returns parsed dataset items in one round-trip, no polling.
//
// HTTP-only, no native binaries — safe to run on Railway.

export type ApifyTikTokPost = {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  videoUrl?: string;
  diggCount?: number; // likes
  playCount?: number; // plays/views
  shareCount?: number;
  commentCount?: number;
  createTime?: number;
  authorMeta?: {
    name?: string;
    nickName?: string;
    fans?: number;
    bioLink?: { link?: string };
    signature?: string;
    avatar?: string;
  };
  hashtags?: { name?: string }[];
  musicMeta?: { musicName?: string; musicAuthor?: string };
};

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper";

export function extractTikTokHandle(input: string): string | null {
  const raw = input.trim().replace(/^@/, "");
  if (/^[\w.\-]{2,30}$/.test(raw) && !raw.includes("/")) return raw;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    // /@handle, /@handle/video/123, /handle, /handle/video/123
    const m = u.pathname.match(/^\/(?:@)?([\w.\-]{2,30})(?:\/|$)/);
    if (m) return m[1];
  } catch {
    // not a URL — fall through
  }
  return null;
}

export async function scrapeTikTokProfile(
  handleOrUrl: string,
  opts: { resultsPerPage?: number } = {}
): Promise<ApifyTikTokPost[]> {
  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not set");
  const handle = extractTikTokHandle(handleOrUrl);
  if (!handle) throw new Error(`could not parse a TikTok handle from '${handleOrUrl.slice(0, 80)}'`);

  const url = `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles: [handle],
      resultsPerPage: opts.resultsPerPage ?? 10,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Apify ${res.status}: ${t.slice(0, 300)}`);
  }
  const items = (await res.json()) as unknown;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Apify returned no posts for @${handle}`);
  }
  return items as ApifyTikTokPost[];
}
