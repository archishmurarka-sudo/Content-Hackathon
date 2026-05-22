// Avatars — reusable house cast for synthetic UGC.
//
// An Avatar = one locked human protagonist + optional face reference photos
// + optional TTS voice_id. Scripts that pick an avatar reuse its persona
// verbatim (skipping the per-script Gemini persona pick) and pass the face
// photos to gpt-image-2 as additional references alongside the product photo.
//
// Storage is Postgres-when-available, in-memory Map otherwise — same dual
// mode as ad-scripts.ts and briefs.ts.

import { hasDb, sql, ensureSchema } from "./db";
import type { ScriptPersona } from "./script-beats";

export type Avatar = {
  id: string;
  name: string;
  brand_slug: string | null;
  persona: ScriptPersona;
  face_image_urls: string[];
  voice_id: string | null;
  voice_provider: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

const g = globalThis as unknown as { __avatars?: Map<string, Avatar> };
const mem: Map<string, Avatar> = g.__avatars ?? new Map();
g.__avatars = mem;

function uid(): string {
  return `avatar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type CreateAvatarInput = {
  name: string;
  brand_slug?: string | null;
  persona: ScriptPersona;
  face_image_urls?: string[];
  voice_id?: string | null;
  voice_provider?: string | null;
  notes?: string | null;
};

export async function createAvatar(input: CreateAvatarInput): Promise<Avatar> {
  const now = Date.now();
  const row: Avatar = {
    id: uid(),
    name: input.name,
    brand_slug: input.brand_slug ?? null,
    persona: input.persona,
    face_image_urls: input.face_image_urls ?? [],
    voice_id: input.voice_id ?? null,
    voice_provider: input.voice_provider ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  };

  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      INSERT INTO avatars (id, name, brand_slug, persona, face_image_urls, voice_id, voice_provider, notes, created_at, updated_at)
      VALUES (${row.id}, ${row.name}, ${row.brand_slug}, ${s.json(row.persona as any)}, ${s.json(row.face_image_urls as any)}, ${row.voice_id}, ${row.voice_provider}, ${row.notes}, ${row.created_at}, ${row.updated_at})
    `;
    return row;
  }
  mem.set(row.id, row);
  return row;
}

export async function listAvatars(brandSlug?: string | null): Promise<Avatar[]> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    // Postgres driver doesn't bind null neatly in a conditional WHERE — branch
    // on the operator's intent and run the matching query.
    const rs = brandSlug
      ? await s`SELECT * FROM avatars WHERE brand_slug = ${brandSlug} ORDER BY created_at DESC LIMIT 500`
      : await s`SELECT * FROM avatars ORDER BY created_at DESC LIMIT 500`;
    return rs.map(rowToAvatar);
  }
  return Array.from(mem.values())
    .filter((a) => (brandSlug ? a.brand_slug === brandSlug : true))
    .sort((a, b) => b.created_at - a.created_at);
}

export async function getAvatar(id: string): Promise<Avatar | undefined> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    const rs = await s`SELECT * FROM avatars WHERE id = ${id} LIMIT 1`;
    if (rs.length === 0) return undefined;
    return rowToAvatar(rs[0]);
  }
  return mem.get(id);
}

export type UpdateAvatarInput = Partial<Omit<CreateAvatarInput, "name"> & { name: string }>;

export async function updateAvatar(id: string, patch: UpdateAvatarInput): Promise<Avatar | undefined> {
  const cur = await getAvatar(id);
  if (!cur) return undefined;
  const next: Avatar = {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.brand_slug !== undefined ? { brand_slug: patch.brand_slug } : {}),
    ...(patch.persona !== undefined ? { persona: patch.persona } : {}),
    ...(patch.face_image_urls !== undefined ? { face_image_urls: patch.face_image_urls } : {}),
    ...(patch.voice_id !== undefined ? { voice_id: patch.voice_id } : {}),
    ...(patch.voice_provider !== undefined ? { voice_provider: patch.voice_provider } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    updated_at: Date.now(),
  };
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    await s`
      UPDATE avatars SET
        name            = ${next.name},
        brand_slug      = ${next.brand_slug},
        persona         = ${s.json(next.persona as any)},
        face_image_urls = ${s.json(next.face_image_urls as any)},
        voice_id        = ${next.voice_id},
        voice_provider  = ${next.voice_provider},
        notes           = ${next.notes},
        updated_at      = ${next.updated_at}
      WHERE id = ${id}
    `;
    return next;
  }
  mem.set(id, next);
  return next;
}

export async function deleteAvatar(id: string): Promise<boolean> {
  if (hasDb()) {
    await ensureSchema();
    const s = sql();
    const r = await s`DELETE FROM avatars WHERE id = ${id}`;
    return r.count > 0;
  }
  return mem.delete(id);
}

// Append a freshly-uploaded face photo URL to the avatar's list. Used by the
// upload endpoint so multiple uploads accumulate instead of overwriting.
export async function appendFaceImage(id: string, url: string): Promise<Avatar | undefined> {
  const cur = await getAvatar(id);
  if (!cur) return undefined;
  return updateAvatar(id, { face_image_urls: [...cur.face_image_urls, url] });
}

function rowToAvatar(r: any): Avatar {
  return {
    id: r.id,
    name: r.name,
    brand_slug: r.brand_slug ?? null,
    persona: r.persona as ScriptPersona,
    face_image_urls: Array.isArray(r.face_image_urls) ? r.face_image_urls : [],
    voice_id: r.voice_id ?? null,
    voice_provider: r.voice_provider ?? null,
    notes: r.notes ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

// Default persona seed for the "New avatar" form so the operator isn't
// staring at 10 empty inputs. Operators almost always tweak from here.
export function defaultPersonaSeed(): ScriptPersona {
  return {
    age_range: "early 30s",
    gender: "woman",
    ethnicity: "white American",
    body_type: "average build",
    hair: "shoulder-length brown waves, no makeup",
    wardrobe: "oversized cream knit sweater, denim shorts, bare feet",
    vibe: "girl-next-door, lived-in, low-key wellness",
    setting: "warm-lit primary bedroom with linen sheets",
    lighting: "natural window light, warm 4200K, soft shadows",
    camera_style: "handheld iPhone, eye level, shallow depth of field",
  };
}
