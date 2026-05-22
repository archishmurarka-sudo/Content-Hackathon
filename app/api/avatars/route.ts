// GET  /api/avatars[?brand_slug=...]   list avatars (optionally filtered)
// POST /api/avatars                     create a new avatar

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { createAvatar, listAvatars, defaultPersonaSeed } from "@/lib/avatars";
import type { ScriptPersona } from "@/lib/script-beats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const brand_slug = req.nextUrl.searchParams.get("brand_slug") ?? undefined;
  const avatars = await listAvatars(brand_slug);
  return NextResponse.json({ avatars });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // Persona — fall back to the default seed for any missing field so the
  // operator can supply a partial form and get a coherent starting point.
  const seed = defaultPersonaSeed();
  const personaInput = (body.persona ?? {}) as Partial<ScriptPersona>;
  const persona: ScriptPersona = {
    age_range: String(personaInput.age_range ?? seed.age_range),
    gender: String(personaInput.gender ?? seed.gender),
    ethnicity: String(personaInput.ethnicity ?? seed.ethnicity),
    body_type: String(personaInput.body_type ?? seed.body_type),
    hair: String(personaInput.hair ?? seed.hair),
    wardrobe: String(personaInput.wardrobe ?? seed.wardrobe),
    vibe: String(personaInput.vibe ?? seed.vibe),
    setting: String(personaInput.setting ?? seed.setting),
    lighting: String(personaInput.lighting ?? seed.lighting),
    camera_style: String(personaInput.camera_style ?? seed.camera_style),
  };

  const avatar = await createAvatar({
    name,
    brand_slug: typeof body.brand_slug === "string" && body.brand_slug.trim() ? body.brand_slug.trim() : null,
    persona,
    face_image_urls: Array.isArray(body.face_image_urls) ? body.face_image_urls.map(String) : [],
    voice_id: typeof body.voice_id === "string" && body.voice_id.trim() ? body.voice_id.trim() : null,
    voice_provider: typeof body.voice_provider === "string" && body.voice_provider.trim() ? body.voice_provider.trim() : null,
    voice_sample_url: typeof body.voice_sample_url === "string" && body.voice_sample_url.trim() ? body.voice_sample_url.trim() : null,
    notes: typeof body.notes === "string" ? body.notes : null,
  });

  return NextResponse.json({ avatar });
}
