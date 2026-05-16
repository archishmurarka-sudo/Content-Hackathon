"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  winners: number;
  top_pain: string;
  energy_rating: number | null;
  dossier_excerpt: string | null;
  has_dossier: boolean;
};

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [q, setQ] = useState("");
  const [archetype, setArchetype] = useState<string>("");

  useEffect(() => {
    fetch("/api/creators?q=", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCreators(d.creators ?? []));
  }, []);

  const archetypes = Array.from(new Set(creators.map((c) => c.archetype))).sort();
  const filtered = creators
    .filter((c) => (q ? c.handle.toLowerCase().includes(q.toLowerCase()) || c.top_pain.toLowerCase().includes(q.toLowerCase()) : true))
    .filter((c) => (archetype ? c.archetype === archetype : true));

  const totalGmv = creators.reduce((s, c) => s + (c.kalo_gmv ?? 0), 0);

  return (
    <div className="container">
      <span className="eyebrow">Creators</span>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: 6, marginBottom: 28 }}>
        <h1>{creators.length} creators · ${(totalGmv / 1_000_000).toFixed(1)}M tracked GMV</h1>
      </div>

      <div className="row" style={{ marginBottom: 18, gap: 12 }}>
        <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search handle or pain point…"
            style={{ width: "100%", paddingLeft: 34 }}
          />
        </div>
        <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
          <option value="">All archetypes</option>
          {archetypes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Creator</th>
              <th>Archetype</th>
              <th>Top pain</th>
              <th style={{ textAlign: "right" }}>GMV</th>
              <th style={{ textAlign: "center" }}>Winners</th>
              <th style={{ textAlign: "center" }}>Energy</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={c.handle}>
                <td style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>@{c.handle}</div>
                  {c.dossier_excerpt && (
                    <div className="muted-sm" style={{ marginTop: 2, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.dossier_excerpt}
                    </div>
                  )}
                </td>
                <td><span className="muted-sm">{c.archetype}</span></td>
                <td><span className="muted-sm">{c.top_pain}</span></td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {c.kalo_gmv ? `$${c.kalo_gmv.toLocaleString()}` : <span className="muted-sm">—</span>}
                </td>
                <td style={{ textAlign: "center" }}>{c.winners}</td>
                <td style={{ textAlign: "center" }}>{c.energy_rating ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ marginTop: 14, textAlign: "center", color: "var(--muted)" }}>
          No creators match this filter.
        </div>
      )}
    </div>
  );
}
