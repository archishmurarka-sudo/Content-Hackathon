// GET    /api/avatars/:id   fetch one avatar
// PATCH  /api/avatars/:id   update name / brand / persona / voice / notes
// DELETE /api/avatars/:id   remove

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAvatar, updateAvatar, deleteAvatar } from "@/lib/avatars";
import type { ScriptPersona } from "@/lib/script-beats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const avatar = await getAvatar(id);
  if (!avatar) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ avatar });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));

  // Build the patch — only forward fields the client actually sent so we
  // don't accidentally null-out columns by passing undefined as null.
  const patch: Parameters<typeof updateAvatar>[1] = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("brand_slug" in body) patch.brand_slug = body.brand_slug ? String(body.brand_slug).trim() : null;
  if ("voice_id" in body) patch.voice_id = body.voice_id ? String(body.voice_id).trim() : null;
  if ("voice_provider" in body) patch.voice_provider = body.voice_provider ? String(body.voice_provider).trim() : null;
  if ("notes" in body) patch.notes = body.notes != null ? String(body.notes) : null;
  if ("face_image_urls" in body) patch.face_image_urls = Array.isArray(body.face_image_urls) ? body.face_image_urls.map(String) : [];

  // Persona is a full-replace by design — partial-merge would silently keep
  // stale fields when the operator clears a value in the form.
  if (body.persona && typeof body.persona === "object") {
    const p = body.persona as Partial<ScriptPersona>;
    patch.persona = {
      age_range: String(p.age_range ?? ""),
      gender: String(p.gender ?? ""),
      ethnicity: String(p.ethnicity ?? ""),
      body_type: String(p.body_type ?? ""),
      hair: String(p.hair ?? ""),
      wardrobe: String(p.wardrobe ?? ""),
      vibe: String(p.vibe ?? ""),
      setting: String(p.setting ?? ""),
      lighting: String(p.lighting ?? ""),
      camera_style: String(p.camera_style ?? ""),
    };
  }

  const avatar = await updateAvatar(id, patch);
  if (!avatar) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ avatar });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteAvatar(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
