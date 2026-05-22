import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { generateIgPost, listIgPosts, IG_FORMATS, IG_THEMES, type IgFormat } from "@/lib/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// gpt-image-2 can take up to ~60s; Gemini creative drafting another ~5–10s.
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    posts: await listIgPosts(),
    formats: IG_FORMATS,
    themes: IG_THEMES,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const product_id = String(body.product_id ?? "").trim();
  const theme = String(body.theme ?? "").trim();
  const format = String(body.format ?? "feed_1x1").trim() as IgFormat;
  const vibe = typeof body.vibe === "string" ? body.vibe : "";

  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  if (!theme) return NextResponse.json({ error: "theme required" }, { status: 400 });
  if (!IG_FORMATS.some((f) => f.value === format)) {
    return NextResponse.json({ error: `unknown format '${format}'` }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set on the server" }, { status: 500 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  try {
    const post = await generateIgPost({ product_id, theme, format, vibe });
    return NextResponse.json(post);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "ig post generation failed" }, { status: 500 });
  }
}
