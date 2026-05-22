"use client";

// Connoisseur panel — opens from the ConnoisseurToggle "Customize" button.
//
// Lets the operator:
//   1. Pick which brand corpus to draw from (defaults to ashwamag)
//   2. Preview the 5 categories of items the MCP returns for that brand
//   3. Tick / untick items to build a priority subset
//
// The selected subset is emitted via `onChange` as a ScriptEnrichment-shaped
// override blob. The parent page passes it in the generate POST as
// `enrichment_override`, which the server uses verbatim instead of fetching.
//
// "All ticked" (the default) reproduces the current behavior — the override
// blob has exactly what the MCP would have returned, so output is unchanged.
// Untick items to filter them out; tick a smaller subset to focus the model.

import { useEffect, useMemo, useState } from "react";
import { X, ChevronDown, RefreshCw, AlertCircle } from "lucide-react";

type Brand = { brand_slug: string; display_name: string; n_ads: number; is_self: boolean };

type VoiceAtom = { atom_id?: number; phrase: string; category?: string | null; approved?: boolean | null };
type SellingPoint = { point: string; mechanism?: string | null; source?: string | null };
type WinnerCombo = { combo: string; evidence?: string | null; performance?: string | null };
type ComplianceGate = { pattern: string; severity: string; gate_type?: string | null; safer_alternative?: string | null; rationale?: string | null };
type ArchetypePerf = { archetype: string; performance?: string | null; notes?: string | null };

export type EnrichmentOverride = {
  brand_slug: string;
  voice_atoms: VoiceAtom[];
  selling_points: SellingPoint[];
  winner_combos: WinnerCombo[];
  compliance_gates: ComplianceGate[];
  archetype_performance: ArchetypePerf[];
  tool_status?: Record<string, string>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  // Initial brand to load; defaults to "ashwamag". The operator can switch.
  initialBrandSlug?: string;
  // Called whenever the operator changes brand or ticks/unticks an item.
  // Parent stashes the latest value and passes it in the generate POST body.
  onChange: (override: EnrichmentOverride | null) => void;
};

export function ConnoisseurPanel({ open, onClose, initialBrandSlug = "ashwamag", onChange }: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandSlug, setBrandSlug] = useState(initialBrandSlug);
  const [bundle, setBundle] = useState<EnrichmentOverride | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state keyed by category — each is a Set<string> of item keys
  // ("phrase" for voice atoms, "point" for selling points, etc.).
  const [picked, setPicked] = useState<Record<string, Set<string>>>({
    voice_atoms: new Set(),
    selling_points: new Set(),
    winner_combos: new Set(),
    compliance_gates: new Set(),
    archetype_performance: new Set(),
  });

  // Load brands once when the panel first opens.
  useEffect(() => {
    if (!open || brands.length > 0) return;
    fetch("/api/connoisseur/brands", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
      .catch(() => {});
  }, [open, brands.length]);

  // Load (or reload) the preview bundle whenever brand changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/connoisseur/preview?brand_slug=${encodeURIComponent(brandSlug)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) { setError(d.error); setBundle(null); return; }
        setBundle(d as EnrichmentOverride);
        // Default: everything ticked so the operator's first action is just
        // to UNTICK what they don't want, not click 50 things to opt in.
        setPicked({
          voice_atoms: new Set((d.voice_atoms ?? []).map((x: VoiceAtom) => x.phrase)),
          selling_points: new Set((d.selling_points ?? []).map((x: SellingPoint) => x.point)),
          winner_combos: new Set((d.winner_combos ?? []).map((x: WinnerCombo) => x.combo)),
          compliance_gates: new Set((d.compliance_gates ?? []).map((x: ComplianceGate) => x.pattern)),
          archetype_performance: new Set((d.archetype_performance ?? []).map((x: ArchetypePerf) => x.archetype)),
        });
      })
      .catch((e) => !cancelled && setError(e?.message ?? "failed to load preview"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, brandSlug]);

  // Emit the filtered override every time picked changes.
  useEffect(() => {
    if (!bundle) { onChange(null); return; }
    onChange({
      brand_slug: bundle.brand_slug,
      voice_atoms: bundle.voice_atoms.filter((x) => picked.voice_atoms.has(x.phrase)),
      selling_points: bundle.selling_points.filter((x) => picked.selling_points.has(x.point)),
      winner_combos: bundle.winner_combos.filter((x) => picked.winner_combos.has(x.combo)),
      compliance_gates: bundle.compliance_gates.filter((x) => picked.compliance_gates.has(x.pattern)),
      archetype_performance: bundle.archetype_performance.filter((x) => picked.archetype_performance.has(x.archetype)),
      tool_status: bundle.tool_status,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, picked]);

  function togglePick(category: keyof typeof picked, key: string) {
    setPicked((prev) => {
      const next = new Set(prev[category]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [category]: next };
    });
  }

  function tickAll(category: keyof typeof picked, items: string[]) {
    setPicked((prev) => ({ ...prev, [category]: new Set(items) }));
  }

  function tickNone(category: keyof typeof picked) {
    setPicked((prev) => ({ ...prev, [category]: new Set() }));
  }

  const totalPicked = Object.values(picked).reduce((sum, s) => sum + s.size, 0);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface, #1a1820)", border: "1px solid var(--border)", borderRadius: 14,
          width: "100%", maxWidth: 760, maxHeight: "90vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              🍄 Connoisseur priorities
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Pick which corpus items the prompt should emphasize. Default: all on.
              <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 600 }}>{totalPicked} selected</span>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm" style={{ padding: 6, display: "flex" }}>
            <X size={14} />
          </button>
        </div>

        {/* Brand picker */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
            Brand corpus
            <select
              value={brandSlug}
              onChange={(e) => setBrandSlug(e.target.value)}
              style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", minWidth: 200 }}
            >
              {brands.length === 0 && <option value={brandSlug}>{brandSlug}</option>}
              {brands.map((b) => (
                <option key={b.brand_slug} value={b.brand_slug}>
                  {b.display_name} {b.is_self ? "★" : ""} · {b.n_ads} ads
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setBrandSlug((s) => s)}
            disabled={loading}
            className="btn-ghost btn-sm"
            style={{ padding: "6px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}
          >
            <RefreshCw size={11} className={loading ? "spin" : ""} /> Reload
          </button>
          {loading && <span className="muted-sm" style={{ fontSize: 11 }}>loading…</span>}
        </div>

        {/* Body — 5 category sections */}
        <div style={{ overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 6, fontSize: 12 }}>
              <AlertCircle size={13} /> {error}
            </div>
          )}
          {bundle && (
            <>
              <CategorySection
                label="Consumer voice atoms (Reddit-sourced)"
                items={bundle.voice_atoms.map((x) => ({ key: x.phrase, primary: x.phrase, secondary: x.category ?? null }))}
                pickedSet={picked.voice_atoms}
                onToggle={(k) => togglePick("voice_atoms", k)}
                onAll={() => tickAll("voice_atoms", bundle.voice_atoms.map((x) => x.phrase))}
                onNone={() => tickNone("voice_atoms")}
              />
              <CategorySection
                label="Selling points"
                items={bundle.selling_points.map((x) => ({ key: x.point, primary: x.point, secondary: x.mechanism ?? null }))}
                pickedSet={picked.selling_points}
                onToggle={(k) => togglePick("selling_points", k)}
                onAll={() => tickAll("selling_points", bundle.selling_points.map((x) => x.point))}
                onNone={() => tickNone("selling_points")}
              />
              <CategorySection
                label="Winner combos"
                items={bundle.winner_combos.map((x) => ({ key: x.combo, primary: x.combo, secondary: x.performance ?? null }))}
                pickedSet={picked.winner_combos}
                onToggle={(k) => togglePick("winner_combos", k)}
                onAll={() => tickAll("winner_combos", bundle.winner_combos.map((x) => x.combo))}
                onNone={() => tickNone("winner_combos")}
              />
              <CategorySection
                label="Compliance gates (banned phrases)"
                items={bundle.compliance_gates.map((x) => ({ key: x.pattern, primary: `avoid "${x.pattern}"`, secondary: x.safer_alternative ? `→ "${x.safer_alternative}"` : null, severity: x.severity }))}
                pickedSet={picked.compliance_gates}
                onToggle={(k) => togglePick("compliance_gates", k)}
                onAll={() => tickAll("compliance_gates", bundle.compliance_gates.map((x) => x.pattern))}
                onNone={() => tickNone("compliance_gates")}
              />
              <CategorySection
                label="Archetype performance"
                items={bundle.archetype_performance.map((x) => ({ key: x.archetype, primary: x.archetype, secondary: x.performance ?? null }))}
                pickedSet={picked.archetype_performance}
                onToggle={(k) => togglePick("archetype_performance", k)}
                onAll={() => tickAll("archetype_performance", bundle.archetype_performance.map((x) => x.archetype))}
                onNone={() => tickNone("archetype_performance")}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted-sm" style={{ fontSize: 11 }}>
            Selections apply to the next generate. Closing keeps them.
          </span>
          <button onClick={onClose} className="btn btn-primary btn-sm">Done</button>
        </div>
      </div>
    </div>
  );
}

type CategoryItem = { key: string; primary: string; secondary: string | null; severity?: string };

function CategorySection({
  label, items, pickedSet, onToggle, onAll, onNone,
}: {
  label: string;
  items: CategoryItem[];
  pickedSet: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pickedCount = items.filter((i) => pickedSet.has(i.key)).length;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--surface-2)", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}>
          <ChevronDown size={12} style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 120ms" }} />
          {label}
          <span className="muted-sm" style={{ fontSize: 11, fontWeight: 400 }}>
            {pickedCount} / {items.length} selected
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button onClick={onAll} className="btn-ghost btn-sm" style={{ fontSize: 10, padding: "3px 8px" }}>All</button>
          <button onClick={onNone} className="btn-ghost btn-sm" style={{ fontSize: 10, padding: "3px 8px" }}>None</button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ padding: 4, maxHeight: 280, overflowY: "auto" }}>
          {items.length === 0 && <div className="muted-sm" style={{ padding: 10, fontSize: 11 }}>No items returned by the MCP for this brand.</div>}
          {items.map((it) => {
            const picked = pickedSet.has(it.key);
            return (
              <label
                key={it.key}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px",
                  borderRadius: 4, cursor: "pointer", fontSize: 12,
                  background: picked ? "var(--accent-soft, rgba(108,76,181,0.12))" : "transparent",
                  color: picked ? "var(--text)" : "var(--muted)",
                }}
              >
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => onToggle(it.key)}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: picked ? 500 : 400 }}>
                    {it.severity && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: it.severity === "block" ? "var(--danger)" : "var(--muted)", marginRight: 6, textTransform: "uppercase" }}>
                        [{it.severity}]
                      </span>
                    )}
                    {it.primary}
                  </div>
                  {it.secondary && (
                    <div className="muted-sm" style={{ fontSize: 10, marginTop: 2 }}>{it.secondary}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
