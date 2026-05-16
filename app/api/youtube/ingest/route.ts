import { NextRequest, NextResponse } from "next/server";
import { fetchYouTubeVideo } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const hasKey =
    process.env.YOUTUBE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY;
  if (!hasKey) {
    return NextResponse.json(
      { error: "No YouTube-capable API key set (tried YOUTUBE_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY)" },
      { status: 500 }
    );
  }

  try {
    const video = await fetchYouTubeVideo(url);
    return NextResponse.json({ video });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "youtube fetch failed" },
      { status: 500 }
    );
  }
}
