"use client";

// Operator toggle — "Enrich by Connoisseur".
//
// Used on every generation surface (Scripts, Briefs, Instagram). When ON,
// the POST body carries `enrich_with_connoisseur: true` and the API route
// fetches the corpus bundle (voice atoms, selling points, winner combos,
// compliance gates, archetype perf) before calling Gemini.
//
// Default ON — the integration's whole point is enriched output. The toggle
// exists so the operator can flip it off to A/B compare or to debug a Gemini
// regression without MCP noise.

type Props = {
  enabled: boolean;
  onChange: (next: boolean) => void;
  // Optional small subtitle ("11 voice atoms · 12 selling points · …")
  // shown when enriched output came back from the last call. Caller passes
  // a string or null; null hides the line.
  lastSummary?: string | null;
  // Optional override for the label (e.g. "Enrich Instagram by Connoisseur").
  label?: string;
};

export function ConnoisseurToggle({ enabled, onChange, lastSummary, label }: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: enabled ? "var(--accent-bg, #f1eef8)" : "var(--surface-2, #f6f6f6)",
        border: `1px solid ${enabled ? "var(--accent, #6c4cb5)" : "var(--border, #ddd)"}`,
        borderRadius: 10,
        fontSize: 12,
        color: enabled ? "var(--accent, #6c4cb5)" : "var(--muted, #777)",
        transition: "background 120ms, color 120ms, border-color 120ms",
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      title={enabled ? "Click to disable Connoisseur enrichment for the next generate" : "Click to enable Connoisseur enrichment"}
    >
      {/* Track */}
      <div
        style={{
          position: "relative",
          width: 30,
          height: 16,
          borderRadius: 999,
          background: enabled ? "var(--accent, #6c4cb5)" : "var(--border, #ccc)",
          transition: "background 120ms",
          flexShrink: 0,
        }}
      >
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            top: 2,
            left: enabled ? 16 : 2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 120ms",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </div>
      <span style={{ fontWeight: 600 }}>
        🍄 {label ?? "Enrich by Connoisseur"}
      </span>
      {lastSummary && (
        <span style={{ color: "var(--muted-2, #999)", fontWeight: 400, fontSize: 11 }}>
          · {lastSummary}
        </span>
      )}
    </div>
  );
}
