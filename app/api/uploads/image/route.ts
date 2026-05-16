// POST /api/uploads/image  (multipart/form-data, field: "file", optional "prefix")
//
// Generic image upload via lib/storage.putAsset. Used by the product-onboarding
// form (hero image) and anywhere else we need a user-uploaded asset.

import { NextRequest, NextResponse } from "next/server";
import { putAsset } from "@/lib/storage";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "field 'file' required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });

  const mime = file.type || "image/png";
  if (!mime.startsWith("image/")) return NextResponse.json({ error: "only image/* mime types accepted" }, { status: 400 });

  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "bin";
  const prefix = String(form.get("prefix") ?? "uploads").replace(/[^a-zA-Z0-9_\-/]/g, "").slice(0, 80) || "uploads";

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await putAsset({ prefix, ext, body: buf, contentType: mime });
  return NextResponse.json({ url: result.url, key: result.key, content_type: mime, size_bytes: buf.length });
}
