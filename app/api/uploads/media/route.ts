// POST /api/uploads/media  (multipart/form-data)
//   field: "file"    — image/*, audio/*, or video/*
//   field: "prefix"  — optional R2 prefix (defaults to "uploads")
//
// Generic media upload. Distinct from /api/uploads/image which is image-only
// — this one accepts audio (voice samples) and video (UGC references) too.
// Used by the Avatars page for face photos + voice samples in one endpoint.

import { NextRequest, NextResponse } from "next/server";
import { putAsset } from "@/lib/storage";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-type byte caps. Images stay small (5 MB), audio mid (20 MB for a
// short voice sample), video larger (50 MB ceiling — anything beefier
// belongs in R2 directly via signed URL).
const MAX_BYTES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

// Mime → file extension. Anything missing falls back to "bin".
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "field 'file' required" }, { status: 400 });

  const mime = (file.type || "application/octet-stream").split(";")[0].trim();
  const category = mime.split("/")[0];
  if (!["image", "audio", "video"].includes(category)) {
    return NextResponse.json({ error: `unsupported mime type: ${mime}` }, { status: 400 });
  }
  const cap = MAX_BYTES[category];
  if (file.size > cap) {
    return NextResponse.json({ error: `file too large (max ${cap / 1024 / 1024} MB for ${category})` }, { status: 413 });
  }

  const ext = EXT_BY_MIME[mime] ?? "bin";
  const prefix = String(form.get("prefix") ?? "uploads").replace(/[^a-zA-Z0-9_\-/]/g, "").slice(0, 80) || "uploads";

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await putAsset({ prefix, ext, body: buf, contentType: mime });
  return NextResponse.json({
    url: result.url,
    key: result.key,
    content_type: mime,
    category,
    size_bytes: buf.length,
  });
}
