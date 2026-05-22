"use client";

// Avatars — house cast for synthetic UGC. Each avatar locks one protagonist
// (the same 10-field persona shape we generate per-script) plus optional face
// reference photos and a TTS voice id. Scripts will pick an avatar (next
// iteration) so the SAME face/voice appears across every script for a brand.

import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Upload, X, Users } from "lucide-react";
import { useToast } from "@/components/toast";

type Persona = {
  age_range: string;
  gender: string;
  ethnicity: string;
  body_type: string;
  hair: string;
  wardrobe: string;
  vibe: string;
  setting: string;
  lighting: string;
  camera_style: string;
};

type Avatar = {
  id: string;
  name: string;
  brand_slug: string | null;
  persona: Persona;
  face_image_urls: string[];
  voice_id: string | null;
  voice_provider: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

type Brand = { brand_slug: string; display_name: string; n_ads: number; is_self: boolean };

const PERSONA_FIELDS: Array<{ key: keyof Persona; label: string; placeholder: string }> = [
  { key: "age_range",   label: "Age range",   placeholder: "early 30s" },
  { key: "gender",      label: "Gender",      placeholder: "woman" },
  { key: "ethnicity",   label: "Ethnicity",   placeholder: "white American" },
  { key: "body_type",   label: "Body type",   placeholder: "average build" },
  { key: "hair",        label: "Hair",        placeholder: "shoulder-length brown waves, no makeup" },
  { key: "wardrobe",    label: "Wardrobe",    placeholder: "oversized cream knit, denim shorts, bare feet" },
  { key: "vibe",        label: "Vibe",        placeholder: "girl-next-door, lived-in, wellness Sunday" },
  { key: "setting",     label: "Setting",     placeholder: "warm-lit primary bedroom with linen sheets" },
  { key: "lighting",    label: "Lighting",    placeholder: "natural window light, warm 4200K" },
  { key: "camera_style", label: "Camera",     placeholder: "handheld iPhone, eye level, shallow DOF" },
];

const DEFAULT_PERSONA: Persona = {
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

export default function AvatarsPage() {
  const toast = useToast();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    brand_slug: string;
    persona: Persona;
    voice_id: string;
    voice_provider: string;
    notes: string;
  }>({
    name: "",
    brand_slug: "",
    persona: { ...DEFAULT_PERSONA },
    voice_id: "",
    voice_provider: "elevenlabs",
    notes: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/avatars", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ avatars: [] })),
      fetch("/api/connoisseur/brands", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ brands: [] })),
    ]).then(([a, b]) => {
      setAvatars(a.avatars ?? []);
      setBrands(b.brands ?? []);
      setLoading(false);
    });
  }, []);

  async function createAvatar() {
    if (!draft.name.trim()) {
      toast.error("Name required", "Give your avatar a name (e.g., \"Rachel — perimenopause real-talker\")");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/avatars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name.trim(),
        brand_slug: draft.brand_slug.trim() || null,
        persona: draft.persona,
        voice_id: draft.voice_id.trim() || null,
        voice_provider: draft.voice_provider.trim() || null,
        notes: draft.notes.trim() || null,
      }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("Couldn't create avatar", data?.error ?? `HTTP ${res.status}`);
      return;
    }
    toast.success("Avatar created", `${data.avatar.name} added to your cast`);
    setAvatars((prev) => [data.avatar, ...prev]);
    setDraft({
      name: "",
      brand_slug: draft.brand_slug,
      persona: { ...DEFAULT_PERSONA },
      voice_id: "",
      voice_provider: "elevenlabs",
      notes: "",
    });
  }

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <span className="eyebrow">House cast</span>
          <h1 style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={22} /> Avatars
          </h1>
          <p className="muted-sm" style={{ marginTop: 6, maxWidth: 660 }}>
            Reusable house cast for synthetic UGC. Each avatar locks a protagonist + setting +
            (optional) face reference photos and a TTS voice. Pick an avatar on the Scripts page
            so every script for a brand stars the same person instead of Gemini re-casting.
          </p>
        </div>
      </div>

      {/* Create form */}
      <section className="card" style={{ marginBottom: 24, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Plus size={16} />
          <h2 style={{ margin: 0 }}>New avatar</h2>
        </div>
        <p className="muted-sm" style={{ marginBottom: 16, maxWidth: 560 }}>
          Give it a name + brand, then describe the protagonist in the 10 persona fields.
          Defaults are pre-filled with a sensible starting point — tweak whichever matter.
          You can upload face reference photos after creating.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Rachel — perimenopause real-talker"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label className="muted-sm" style={{ display: "block", marginBottom: 4 }}>Brand (optional)</label>
            <select
              value={draft.brand_slug}
              onChange={(e) => setDraft({ ...draft, brand_slug: e.target.value })}
              style={{ width: "100%" }}
            >
              <option value="">— unbranded —</option>
              {brands.map((b) => (
                <option key={b.brand_slug} value={b.brand_slug}>
                  {b.display_name}{b.is_self ? " ★" : ""} · {b.n_ads} ads
                </option>
              ))}
            </select>
          </div>
        </div>

        <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: 14 }}>Persona</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {PERSONA_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="muted-sm" style={{ display: "block", marginBottom: 4, fontSize: 11 }}>{f.label}</label>
              <input
                value={draft.persona[f.key]}
                onChange={(e) => setDraft({ ...draft, persona: { ...draft.persona, [f.key]: e.target.value } })}
                placeholder={f.placeholder}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: 14 }}>Voice (TTS)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="muted-sm" style={{ display: "block", marginBottom: 4, fontSize: 11 }}>Provider</label>
            <select
              value={draft.voice_provider}
              onChange={(e) => setDraft({ ...draft, voice_provider: e.target.value })}
              style={{ width: "100%" }}
            >
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI TTS</option>
              <option value="">— none —</option>
            </select>
          </div>
          <div>
            <label className="muted-sm" style={{ display: "block", marginBottom: 4, fontSize: 11 }}>
              Voice id <span style={{ opacity: 0.6 }}>(optional — wired when audio pipeline lands)</span>
            </label>
            <input
              value={draft.voice_id}
              onChange={(e) => setDraft({ ...draft, voice_id: e.target.value })}
              placeholder="e.g. ElevenLabs voice_id"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="muted-sm" style={{ display: "block", marginBottom: 4, fontSize: 11 }}>Notes</label>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            placeholder="any extra direction — e.g., past campaign she was in, do-not-do list…"
            style={{ width: "100%", fontSize: 13 }}
          />
        </div>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={createAvatar} disabled={creating}>
            {creating ? "Creating…" : "Create avatar"}
          </button>
        </div>
      </section>

      {/* Avatar list */}
      <section>
        <h2 style={{ marginBottom: 12 }}>Cast <span className="muted-sm" style={{ fontWeight: 400 }}>· {avatars.length} avatar{avatars.length === 1 ? "" : "s"}</span></h2>
        {loading && <p className="muted-sm">Loading…</p>}
        {!loading && avatars.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <p className="muted-sm">No avatars yet. Use the form above to create your first one.</p>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {avatars.map((a) => (
            <AvatarCard
              key={a.id}
              avatar={a}
              onChanged={(next) => setAvatars((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
              onDeleted={(id) => setAvatars((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AvatarCard({
  avatar,
  onChanged,
  onDeleted,
}: {
  avatar: Avatar;
  onChanged: (next: Avatar) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function uploadFace(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("prefix", `avatars/${avatar.id}/face`);
    const up = await fetch("/api/uploads/image", { method: "POST", body: fd });
    if (!up.ok) {
      setUploading(false);
      const d = await up.json().catch(() => ({}));
      toast.error("Upload failed", d?.error ?? `HTTP ${up.status}`);
      return;
    }
    const { url } = await up.json();
    // Patch the avatar with the appended URL.
    const patch = await fetch(`/api/avatars/${encodeURIComponent(avatar.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_image_urls: [...avatar.face_image_urls, url] }),
    });
    setUploading(false);
    if (!patch.ok) {
      toast.error("Couldn't attach photo", `HTTP ${patch.status}`);
      return;
    }
    const data = await patch.json();
    onChanged(data.avatar);
    toast.success("Face photo added", `${data.avatar.face_image_urls.length} reference${data.avatar.face_image_urls.length === 1 ? "" : "s"} total`);
  }

  async function removeFace(url: string) {
    if (!confirm("Remove this face reference?")) return;
    const next = avatar.face_image_urls.filter((u) => u !== url);
    const r = await fetch(`/api/avatars/${encodeURIComponent(avatar.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_image_urls: next }),
    });
    if (!r.ok) {
      toast.error("Couldn't remove", `HTTP ${r.status}`);
      return;
    }
    const data = await r.json();
    onChanged(data.avatar);
  }

  async function removeAvatar() {
    if (!confirm(`Delete avatar "${avatar.name}"? This can't be undone.`)) return;
    setBusy(true);
    const r = await fetch(`/api/avatars/${encodeURIComponent(avatar.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      toast.error("Couldn't delete", `HTTP ${r.status}`);
      return;
    }
    onDeleted(avatar.id);
    toast.success("Avatar deleted");
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            {avatar.brand_slug ?? "unbranded"}
            {avatar.voice_id && <span style={{ marginLeft: 8 }}>· 🎤 {avatar.voice_provider} {avatar.voice_id}</span>}
          </div>
          <h3 style={{ marginTop: 2, marginBottom: 6 }}>{avatar.name}</h3>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.4, margin: 0 }}>
            <strong>{avatar.persona.age_range}</strong> {avatar.persona.ethnicity} {avatar.persona.gender}, {avatar.persona.body_type}, {avatar.persona.hair}.
            Wardrobe: {avatar.persona.wardrobe}. Vibe: {avatar.persona.vibe}.
          </p>
        </div>
        <button onClick={removeAvatar} disabled={busy} className="btn-ghost btn-sm" title="Delete avatar" style={{ color: "#ff6b6b" }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Face references */}
      <div style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>Face references · {avatar.face_image_urls.length}/3 recommended</span>
          <label
            className="btn-ghost btn-sm"
            style={{ fontSize: 11, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4, cursor: uploading ? "wait" : "pointer" }}
          >
            <Upload size={11} /> {uploading ? "Uploading…" : "Add photo"}
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFace(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {avatar.face_image_urls.length === 0 ? (
          <p className="muted-sm" style={{ fontSize: 11, padding: 8, border: "1px dashed var(--border)", borderRadius: 4 }}>
            No reference photos yet. Upload 1–3 photos of the protagonist's face so gpt-image-2 can ground keyframes against the actual person, not invent one.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {avatar.face_image_urls.map((url) => (
              <div key={url} style={{ position: "relative", width: 80, height: 80, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                <img src={url} alt="face ref" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button
                  onClick={() => removeFace(url)}
                  title="Remove"
                  style={{
                    position: "absolute", top: 2, right: 2, padding: 2, background: "rgba(0,0,0,0.6)",
                    color: "#fff", border: "none", borderRadius: 3, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {avatar.notes && (
        <div style={{ marginTop: 10, padding: 8, background: "var(--surface-2)", borderRadius: 4, fontSize: 11, color: "var(--text-2)" }}>
          <strong>Notes:</strong> {avatar.notes}
        </div>
      )}

      <details style={{ marginTop: 10, fontSize: 11 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)" }}>view full persona</summary>
        <pre
          style={{
            marginTop: 6, padding: 10, background: "var(--surface-2)", borderRadius: 6,
            fontSize: 10, lineHeight: 1.4, whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono, ui-monospace, monospace)", color: "var(--text-2)",
          }}
        >
          {JSON.stringify(avatar.persona, null, 2)}
        </pre>
      </details>
    </div>
  );
}
