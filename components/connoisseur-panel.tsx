"use client";

// Connoisseur panel — opens from the ConnoisseurToggle "Customize" button.
//
// Lets the operator:
//   1. Pick ONE OR MORE brand corpora to draw from (default: every brand
//      the MCP exposes — operator can "Deselect all" then re-tick).
//   2. Preview the 5 categories of items the MCP returns for that union of
//      brands (deduped by canonical key, tagged with their source brand).
//   3. Tick / untick individual items to build a priority subset.
//
// The selected subset is emitted via `onChange` as a ScriptEnrichment-shaped
// override blob. The parent page passes it in the generate POST as
// `enrichment_override`, which the server uses verbatim instead of fetching.
//
// "All ticked" (the default) reproduces the union of all brands' enrichment.
// Untick brands to narrow the corpus; untick individual items to refine.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronDown, RefreshCw, AlertCircle } from "lucide-react";

type Brand = { brand_slug: string; display_name: string; n_ads: number; is_self: boolean };

type VoiceAtom = { atom_id?: number; phrase: string; category?: string | null; approved?: boolean | null; source_brand?: string };
type SellingPoint = { point: string; mechanism?: string | null; source?: string | null; source_brand?: string };
type WinnerCombo = { combo: string; evidence?: string | null; performance?: string | null; source_brand?: string };
type ComplianceGate = { pattern: string; severity: string; gate_type?: string | null; safer_alternative?: string | null; rationale?: string | null; source_brand?: string };
type ArchetypePerf = { archetype: string; performance?: string | null; notes?: string | null; source_brand?: string };

export type EnrichmentOverride = {
  brand_slug: string;   // canonical brand for the row; comma-joined slugs when union
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
  // Initial brand to seed the union with — when the brand list loads we
  // expand to "all brands" so the operator's first action is to deselect.
  initialBrandSlug?: string;
  // Called whenever the operator changes brand set or ticks/unticks an item.
  // Parent stashes the latest value and passes it in the generate POST body.
  onChange: (override: EnrichmentOverride | null) => void;
};

// Category metadata — keeps the JSX terse and the merge logic generic.
type CategoryKey = "voice_atoms" | "selling_points" | "winner_combos" | "compliance_gates" | "archetype_performance";
const CATEGORY_KEY_OF: Record<CategoryKey, (x: any) => string> = {
  voice_atoms: (x) => x.phrase,
  selling_points: (x) => x.point,
  winner_combos: (x) => x.combo,
  compliance_gates: (x) => x.pattern,
  archetype_performance: (x) => x.archetype,
};

export function ConnoisseurPanel({ open, onClose, initialBrandSlug = "ashwamag", onChange }: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  // Multi-select of brand slugs. Default is empty → seeded with all brand
  // slugs once the brand list lands so "all on" is the operator's starting
  // point.
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const seededRef = useRef(false);

  // Merged bundle across all selected brands.
  const [bundle, setBundle] = useState<EnrichmentOverride | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-brand cache so toggling a brand on/off doesn't re-fetch.
  const previewCache = useRef<Record<string, EnrichmentOverride>>({});

  // Selection state keyed by category — each is a Set<string> of item keys.
  const [picked, setPicked] = useState<Record<CategoryKey, Set<string>>>({
    voice_atoms: new Set(),
    selling_points: new Set(),
    winner_combos: new Set(),
    compliance_gates: new Set(),
    archetype_performance: new Set(),
  });

  // 1) Load brands once when the panel first opens.
  useEffect(() => {
    if (!open || brands.length > 0) return;
    fetch("/api/connoisseur/brands", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
      .catch(() => {});
  }, [open, brands.length]);

  // 2) Once brands land, seed the selection with ALL of them (default-on).
  //    If the brand list comes back empty, fall back to the initial slug so
  //    the panel still works.
  useEffect(() => {
    if (seededRef.current) return;
    if (brands.length === 0) return;
    seededRef.current = true;
    setSelectedBrands(new Set(brands.map((b) => b.brand_slug)));
  }, [brands]);

  // Also handle the empty-brands case: if MCP didn't return any brands,
  // seed with the initial slug so the operator can still preview.
  useEffect(() => {
    if (!open) return;
    if (seededRef.current) return;
    if (brands.length > 0) return;
    const t = setTimeout(() => {
      if (seededRef.current) return;
      seededRef.current = true;
      setSelectedBrands(new Set([initialBrandSlug]));
    }, 1500);
    return () => clearTimeout(t);
  }, [open, brands.length, initialBrandSlug]);

  // 3) Whenever the selected-brand set changes, fetch any missing previews
  //    in parallel + rebuild the merged bundle from cache.
  useEffect(() => {
    if (!open) return;
    if (selectedBrands.size === 0) {
      setBundle(emptyBundle("(none)"));
      return;
    }
    let cancelled = false;
    setError(null);

    const slugs = Array.from(selectedBrands);
    const missing = slugs.filter((s) => !previewCache.current[s]);

    const work = missing.length > 0 ? (() => {
      setLoading(true);
      return Promise.all(
        missing.map((slug) =>
          fetch(`/api/connoisseur/preview?brand_slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
              if (d?.error) throw new Error(d.error);
              previewCache.current[slug] = tagBundleWithBrand(d, slug);
            })
            .catch((err) => {
              // Cache a failure marker so we don't retry on every toggle —
              // operator can click Reload to clear and try again.
              previewCache.current[slug] = { ...emptyBundle(slug), tool_status: { error: String(err?.message ?? err) } };
            })
        )
      );
    })() : Promise.resolve();

    work.finally(() => {
      if (cancelled) return;
      setLoading(false);
      const merged = mergeBundles(slugs.map((s) => previewCache.current[s]).filter(Boolean));
      setBundle(merged);
      // Reset the picked set to "everything ticked" whenever the brand
      // union changes — operator's mental model is "narrow from the full
      // set," not "start empty."
      setPicked({
        voice_atoms: new Set(merged.voice_atoms.map((x) => x.phrase)),
        selling_points: new Set(merged.selling_points.map((x) => x.point)),
        winner_combos: new Set(merged.winner_combos.map((x) => x.combo)),
        compliance_gates: new Set(merged.compliance_gates.map((x) => x.pattern)),
        archetype_performance: new Set(merged.archetype_performance.map((x) => x.archetype)),
      });
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedBrands]);

  // 4) Emit the filtered override every time picked or bundle changes.
  useEffect(() => {
    if (!bundle) { onChange(null); return; }
    const slugLabel = Array.from(selectedBrands).sort().join(",") || bundle.brand_slug || "(none)";
    onChange({
      brand_slug: slugLabel,
      voice_atoms: bundle.voice_atoms.filter((x) => picked.voice_atoms.has(x.phrase)),
      selling_points: bundle.selling_points.filter((x) => picked.selling_points.has(x.point)),
      winner_combos: bundle.winner_combos.filter((x) => picked.winner_combos.has(x.combo)),
      compliance_gates: bundle.compliance_gates.filter((x) => picked.compliance_gates.has(x.pattern)),
      archetype_performance: bundle.archetype_performance.filter((x) => picked.archetype_performance.has(x.archetype)),
      tool_status: bundle.tool_status,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, picked, selectedBrands]);

  function toggleBrand(slug: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }
  function selectAllBrands() { setSelectedBrands(new Set(brands.map((b) => b.brand_slug))); }
  function deselectAllBrands() { setSelectedBrands(new Set()); }
  function reloadPreviews() {
    // Clear the per-brand cache and re-trigger the effect.
    previewCache.current = {};
    setSelectedBrands((s) => new Set(s));
  }

  function togglePick(category: CategoryKey, key: string) {
    setPicked((prev) => {
      const next = new Set(prev[category]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [category]: next };
    });
  }
  function tickAll(category: CategoryKey, items: string[]) {
    setPicked((prev) => ({ ...prev, [category]: new Set(items) }));
  }
  function tickNone(category: CategoryKey) {
    setPicked((prev) => ({ ...prev, [category]: new Set() }));
  }

  const totalPicked = Object.values(picked).reduce((sum, s) => sum + s.size, 0);
  const totalAvailable = bundle
    ? bundle.voice_atoms.length + bundle.selling_points.length + bundle.winner_combos.length + bundle.compliance_gates.length + bundle.archetype_performance.length
    : 0;

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
              Pick which brand corpora + items the prompt should emphasize. Default: every brand on.
              <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 600 }}>
                {totalPicked} / {totalAvailable} items
              </span>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm" style={{ padding: 6, display: "flex" }}>
            <X size={14} />
          </button>
        </div>

        {/* Brand multi-select */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Brand corpora
              <span style={{ marginLeft: 8, color: brands.length === selectedBrands.size ? "var(--accent)" : "var(--text-2)", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                {selectedBrands.size} / {brands.length} selected
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={selectAllBrands}
                disabled={brands.length === 0 || selectedBrands.size === brands.length}
                className="btn-ghost btn-sm"
                style={{ fontSize: 11, padding: "4px 10px" }}
              >Select all</button>
              <button
                onClick={deselectAllBrands}
                disabled={selectedBrands.size === 0}
                className="btn-ghost btn-sm"
                style={{ fontSize: 11, padding: "4px 10px" }}
              >Deselect all</button>
              <button
                onClick={reloadPreviews}
                disabled={loading}
                className="btn-ghost btn-sm"
                style={{ fontSize: 11, padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
                title="Clear the per-brand preview cache and re-fetch from the MCP"
              >
                <RefreshCw size={11} className={loading ? "spin" : ""} /> Reload
              </button>
            </div>
          </div>
          {brands.length === 0 ? (
            <div className="muted-sm" style={{ fontSize: 11, padding: 8 }}>
              {loading ? "Loading brands…" : "No brands returned by the MCP yet."}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {brands.map((b) => {
                const on = selectedBrands.has(b.brand_slug);
                return (
                  <button
                    key={b.brand_slug}
                    onClick={() => toggleBrand(b.brand_slug)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: on ? "var(--accent-soft)" : "var(--surface-2)",
                      color: on ? "var(--accent)" : "var(--muted)",
                      border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                      cursor: "pointer",
                      transition: "background 120ms, color 120ms, border-color 120ms",
                    }}
                    title={`${b.n_ads} ads in corpus${b.is_self ? " · self" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      readOnly
                      style={{ pointerEvents: "none", margin: 0 }}
                    />
                    {b.display_name}{b.is_self ? " ★" : ""}
                    <span className="muted-sm" style={{ fontSize: 10, fontWeight: 400 }}>· {b.n_ads}</span>
                  </button>
                );
              })}
            </div>
          )}
          {loading && <div className="muted-sm" style={{ fontSize: 11, marginTop: 6 }}>fetching preview for newly-selected brand(s)…</div>}
        </div>

        {/* Body — 5 category sections, merged across selected brands */}
        <div style={{ overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 6, fontSize: 12 }}>
              <AlertCircle size={13} /> {error}
            </div>
          )}
          {selectedBrands.size === 0 && (
            <div className="muted-sm" style={{ fontSize: 12, padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
              No brands selected — the generator will skip Connoisseur enrichment for this run. Tick at least one brand above to populate the corpus.
            </div>
          )}
          {bundle && selectedBrands.size > 0 && (
            <>
              <CategorySection
                label="Consumer voice atoms (Reddit-sourced)"
                items={bundle.voice_atoms.map((x) => ({ key: x.phrase, primary: x.phrase, secondary: x.category ?? null, source: x.source_brand ?? null }))}
                pickedSet={picked.voice_atoms}
                onToggle={(k) => togglePick("voice_atoms", k)}
                onAll={() => tickAll("voice_atoms", bundle.voice_atoms.map((x) => x.phrase))}
                onNone={() => tickNone("voice_atoms")}
              />
              <CategorySection
                label="Selling points"
                items={bundle.selling_points.map((x) => ({ key: x.point, primary: x.point, secondary: x.mechanism ?? null, source: x.source_brand ?? null }))}
                pickedSet={picked.selling_points}
                onToggle={(k) => togglePick("selling_points", k)}
                onAll={() => tickAll("selling_points", bundle.selling_points.map((x) => x.point))}
                onNone={() => tickNone("selling_points")}
              />
              <CategorySection
                label="Winner combos"
                items={bundle.winner_combos.map((x) => ({ key: x.combo, primary: x.combo, secondary: x.performance ?? null, source: x.source_brand ?? null }))}
                pickedSet={picked.winner_combos}
                onToggle={(k) => togglePick("winner_combos", k)}
                onAll={() => tickAll("winner_combos", bundle.winner_combos.map((x) => x.combo))}
                onNone={() => tickNone("winner_combos")}
              />
              <CategorySection
                label="Compliance gates (banned phrases)"
                items={bundle.compliance_gates.map((x) => ({ key: x.pattern, primary: `avoid "${x.pattern}"`, secondary: x.safer_alternative ? `→ "${x.safer_alternative}"` : null, severity: x.severity, source: x.source_brand ?? null }))}
                pickedSet={picked.compliance_gates}
                onToggle={(k) => togglePick("compliance_gates", k)}
                onAll={() => tickAll("compliance_gates", bundle.compliance_gates.map((x) => x.pattern))}
                onNone={() => tickNone("compliance_gates")}
              />
              <CategorySection
                label="Archetype performance"
                items={bundle.archetype_performance.map((x) => ({ key: x.archetype, primary: x.archetype, secondary: x.performance ?? null, source: x.source_brand ?? null }))}
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

// ---- helpers -----------------------------------------------------------

function emptyBundle(slug: string): EnrichmentOverride {
  return {
    brand_slug: slug,
    voice_atoms: [],
    selling_points: [],
    winner_combos: [],
    compliance_gates: [],
    archetype_performance: [],
    tool_status: {},
  };
}

// Mark every item with the brand it came from so the UI can show "[ashwamag]"
// alongside the row.
function tagBundleWithBrand(b: EnrichmentOverride, slug: string): EnrichmentOverride {
  return {
    brand_slug: slug,
    voice_atoms: (b.voice_atoms ?? []).map((x) => ({ ...x, source_brand: slug })),
    selling_points: (b.selling_points ?? []).map((x) => ({ ...x, source_brand: slug })),
    winner_combos: (b.winner_combos ?? []).map((x) => ({ ...x, source_brand: slug })),
    compliance_gates: (b.compliance_gates ?? []).map((x) => ({ ...x, source_brand: slug })),
    archetype_performance: (b.archetype_performance ?? []).map((x) => ({ ...x, source_brand: slug })),
    tool_status: b.tool_status,
  };
}

// Concat all bundles, then dedupe each category by its canonical key. First
// occurrence wins (so the earliest-listed brand "owns" a duplicate phrase /
// pattern — typically self before peer).
function mergeBundles(bundles: EnrichmentOverride[]): EnrichmentOverride {
  const seen: Record<CategoryKey, Set<string>> = {
    voice_atoms: new Set(),
    selling_points: new Set(),
    winner_combos: new Set(),
    compliance_gates: new Set(),
    archetype_performance: new Set(),
  };
  const out = emptyBundle(bundles.map((b) => b.brand_slug).filter(Boolean).join(","));
  for (const b of bundles) {
    for (const cat of Object.keys(seen) as CategoryKey[]) {
      const keyFn = CATEGORY_KEY_OF[cat];
      const items: any[] = (b[cat] ?? []) as any;
      for (const it of items) {
        const k = keyFn(it);
        if (!k || seen[cat].has(k)) continue;
        seen[cat].add(k);
        (out[cat] as any[]).push(it);
      }
    }
  }
  return out;
}

// ---- category section --------------------------------------------------

type CategoryItem = { key: string; primary: string; secondary: string | null; severity?: string; source?: string | null };

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
          {items.length === 0 && <div className="muted-sm" style={{ padding: 10, fontSize: 11 }}>No items returned by the MCP for the selected brand(s).</div>}
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
                    {it.source && (
                      <span
                        style={{
                          marginLeft: 8, fontSize: 9, padding: "1px 6px", borderRadius: 999,
                          background: "var(--surface-3)", color: "var(--muted-2)", fontWeight: 500, letterSpacing: 0.3,
                        }}
                        title="Source brand corpus"
                      >
                        {it.source}
                      </span>
                    )}
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
