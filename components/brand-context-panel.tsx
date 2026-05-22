"use client";

// Pure-presentation panel for Connoisseur brand-context data.
// Accepts a BrandContext object and renders it; when ctx.available is
// false (no MCP data yet) it shows a skeleton with the slot labels so
// the operator knows what will appear once Connoisseur is wired up.
//
// This component never fetches. The parent page fetches and passes the
// result in. Keeps the panel reusable across surfaces (IG page, brief
// detail page, future brand page).

import { Sparkles, ShieldAlert, Quote, BarChart3, RefreshCw } from "lucide-react";
import type { BrandContext } from "@/lib/brand-context";

export function BrandContextPanel({ ctx, loading }: { ctx: BrandContext | null; loading?: boolean }) {
  const available = Boolean(ctx?.available);

  return (
    <div
      className="card"
      style={{
        padding: 16,
        border: available ? "1px solid var(--accent, #111)" : "1px dashed var(--border, #ddd)",
        background: available ? "white" : "rgba(0,0,0,0.02)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 8 }}>
        <div>
          <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={11} /> Brand intelligence
          </span>
          <h3 style={{ marginTop: 4, marginBottom: 0, fontSize: 14, fontWeight: 600 }}>
            {available ? (ctx?.brand ?? "Connoisseur") : "Connoisseur · syncing"}
          </h3>
        </div>
        {available && ctx?.fetched_at && (
          <span className="muted-sm" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <RefreshCw size={10} /> {new Date(ctx.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {!available && (
          <span className="muted-sm" style={{ fontSize: 10 }}>
            {loading ? "Loading…" : "Awaiting MCP wire-up"}
          </span>
        )}
      </div>

      {!available && (
        <p className="muted-sm" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
          When the Connoisseur MCP client lands, this panel will surface
          per-product selling points, winning hook/visual combos, archetype
          performance, compliance gates, and voice atoms — fed straight
          into the generation prompts.
        </p>
      )}

      {available && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          {ctx!.sellingPoints.length > 0 && (
            <Slot label="Top selling points">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ctx!.sellingPoints.slice(0, 8).map((sp, i) => (
                  <span
                    key={`${sp.label}-${i}`}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      border: "1px solid var(--border, #ddd)",
                      borderRadius: 999,
                      background: "white",
                    }}
                    title={sp.evidence ?? ""}
                  >
                    {sp.rank != null && (
                      <span style={{ color: "var(--muted, #888)", marginRight: 4 }}>#{sp.rank}</span>
                    )}
                    {sp.label}
                  </span>
                ))}
              </div>
            </Slot>
          )}

          {ctx!.winnerCombos.length > 0 && (
            <Slot label="Winning hook / visual combos">
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
                {ctx!.winnerCombos.slice(0, 5).map((c, i) => (
                  <li key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {c.archetype && <strong>{c.archetype}: </strong>}
                    {c.hook && <span>"{c.hook}" </span>}
                    {c.visual && <span style={{ color: "var(--muted, #666)" }}>· {c.visual}</span>}
                    {c.win_rate != null && (
                      <span style={{ color: "var(--accent, #1f6dd0)", marginLeft: 4 }}>
                        ({Math.round(c.win_rate * 100)}% win{c.sample_size ? ` · n=${c.sample_size}` : ""})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Slot>
          )}

          {ctx!.archetypePerf.length > 0 && (
            <Slot label="Archetype performance" icon={<BarChart3 size={11} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                {ctx!.archetypePerf.slice(0, 6).map((a) => (
                  <div key={a.archetype} style={{
                    padding: 8,
                    border: "1px solid var(--border, #eee)",
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.02)",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{a.archetype}</div>
                    {a.win_rate != null && (
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                        {Math.round(a.win_rate * 100)}%
                      </div>
                    )}
                    <div className="muted-sm" style={{ fontSize: 10 }}>
                      {a.ads_count != null && `${a.ads_count} ads`}
                      {a.ads_count != null && a.tenure_days != null && " · "}
                      {a.tenure_days != null && `${a.tenure_days}d tenure`}
                    </div>
                  </div>
                ))}
              </div>
            </Slot>
          )}

          {ctx!.complianceGates.length > 0 && (
            <Slot label="Compliance gates" icon={<ShieldAlert size={11} />}>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
                {ctx!.complianceGates.slice(0, 6).map((g, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: g.severity === "hard" ? "rgba(220,40,40,0.06)" : "rgba(0,0,0,0.03)",
                      color: g.severity === "hard" ? "var(--danger, #c33)" : "var(--text, #333)",
                      borderLeft: `3px solid ${g.severity === "hard" ? "var(--danger, #c33)" : "var(--border, #ccc)"}`,
                    }}
                  >
                    {g.rule}
                    {g.source && (
                      <span className="muted-sm" style={{ marginLeft: 6, fontSize: 10 }}>· {g.source}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Slot>
          )}

          {ctx!.voiceAtoms.length > 0 && (
            <Slot label="Voice atoms" icon={<Quote size={11} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ctx!.voiceAtoms.slice(0, 4).map((v, i) => (
                  <blockquote
                    key={i}
                    style={{
                      margin: 0,
                      paddingLeft: 10,
                      borderLeft: "2px solid var(--border, #ddd)",
                      fontSize: 12,
                      fontStyle: "italic",
                      color: "var(--text, #333)",
                    }}
                  >
                    "{v.text}"
                    {v.archetype && (
                      <span className="muted-sm" style={{ marginLeft: 6, fontStyle: "normal", fontSize: 10 }}>
                        — {v.archetype}
                      </span>
                    )}
                  </blockquote>
                ))}
              </div>
            </Slot>
          )}

          {ctx!.portfolio && (
            <div className="muted-sm" style={{ fontSize: 10, paddingTop: 6, borderTop: "1px dashed var(--border, #eee)" }}>
              {ctx!.portfolio.total_ads != null && `${ctx!.portfolio.total_ads.toLocaleString()} ads indexed`}
              {ctx!.portfolio.brands_tracked != null && ` · ${ctx!.portfolio.brands_tracked} brands`}
              {ctx!.portfolio.refreshed_at && ` · refreshed ${new Date(ctx!.portfolio.refreshed_at).toLocaleDateString()}`}
              {ctx!.source && ` · via ${ctx!.source}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Slot({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="muted-sm" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}
