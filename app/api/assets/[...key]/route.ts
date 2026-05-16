// Proxy any generated asset (frame image, finished video) through our server.
// URL shape: /api/assets/briefs/<brief_id>/frames/<file>.png
//
// Why this exists: the underlying storage might be a private R2 bucket OR the
// local public/frames/ directory. The browser shouldn't have to know which —
// it always hits this route. The route reads from whichever backend lib/storage
// is configured for and streams the bytes back.

import { NextRequest, NextResponse } from "next/server";
import { readAsset } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: parts } = await params;
  if (!parts || parts.length === 0) return NextResponse.json({ error: "missing key" }, { status: 400 });
  const key = parts.map(decodeURIComponent).join("/");

  // Defense: stop directory traversal.
  if (key.includes("..")) return NextResponse.json({ error: "bad key" }, { status: 400 });

  try {
    const asset = await readAsset(key);
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(asset.body as any, {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.body.length),
        // generated assets are immutable — cache hard
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "read failed" }, { status: 500 });
  }
}
