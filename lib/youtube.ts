// Server-side YouTube Data API v3 client.
// Pulls reference-video metadata so we can use real YouTube Shorts / videos
// as additional prototype context for the storyboard generator.
//
// API key only — no OAuth — so captions.download is out of reach. Title,
// description, duration, tags and stats are enough to start; we can layer
// transcripts in later via the unofficial timedtext endpoint if needed.

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  durationSeconds: number;
  publishedAt: string;
  tags: string[];
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string;
  isShort: boolean;
};

const API = "https://www.googleapis.com/youtube/v3";

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const shorts = u.pathname.match(/\/shorts\/([\w-]{11})/);
    if (shorts) return shorts[1];
    const embed = u.pathname.match(/\/embed\/([\w-]{11})/);
    if (embed) return embed[1];
  } catch {
    // not a URL — fall through
  }
  return null;
}

function parseDurationToSeconds(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const sec = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + sec;
}

export async function fetchYouTubeVideo(urlOrId: string): Promise<YouTubeVideo> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY not set");
  const videoId = extractVideoId(urlOrId);
  if (!videoId) throw new Error(`could not parse a YouTube video ID from '${urlOrId.slice(0, 80)}'`);

  const parts = ["snippet", "contentDetails", "statistics"].join(",");
  const url = `${API}/videos?part=${parts}&id=${videoId}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`YouTube API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const item = data?.items?.[0];
  if (!item) throw new Error(`no video found for id ${videoId}`);

  const sn = item.snippet ?? {};
  const cd = item.contentDetails ?? {};
  const st = item.statistics ?? {};
  const durationSeconds = parseDurationToSeconds(String(cd.duration ?? ""));

  return {
    videoId,
    title: String(sn.title ?? ""),
    description: String(sn.description ?? ""),
    channelTitle: String(sn.channelTitle ?? ""),
    durationSeconds,
    publishedAt: String(sn.publishedAt ?? ""),
    tags: Array.isArray(sn.tags) ? sn.tags.map(String) : [],
    viewCount: st.viewCount ? Number(st.viewCount) : null,
    likeCount: st.likeCount ? Number(st.likeCount) : null,
    thumbnailUrl:
      sn.thumbnails?.maxres?.url ??
      sn.thumbnails?.high?.url ??
      sn.thumbnails?.medium?.url ??
      sn.thumbnails?.default?.url ??
      "",
    isShort: durationSeconds > 0 && durationSeconds <= 60,
  };
}
