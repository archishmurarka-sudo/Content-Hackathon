"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BriefFrame = { shot_idx: number; status: string; image_url?: string };
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: string;
  storyboard?: { hook: string; total_duration_s: number; shots: any[] };
  frames?: BriefFrame[];
  error?: string;
  created_at: number;
};

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");

  async function load() {
    const res = await fetch("/api/briefs", { cache: "no-store" });
    const d = await res.json();
    setBriefs(d.briefs ?? []);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const statuses = Array.from(new Set(briefs.map((b) => b.status))).sort();
  const filtered = statusFilter ? briefs.filter((b) => b.status === statusFilter) : briefs;

  return (
    <div className="container">
      <span className="eyebrow">Briefs</span>
      <h1 style={{ marginTop: 6, marginBottom: 24 }}>{briefs.length} total · {briefs.filter((b) => !["delivered", "failed"].includes(b.status)).length} in flight</h1>

      <div className="row" style={{ marginBottom: 18 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      <div className="col">
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
            No briefs match this filter.
          </div>
        )}
        {filtered.map((b) => {
          const readyFrames = (b.frames ?? []).filter((f) => f.image_url);
          const approved = (b.frames ?? []).filter((f) => f.status === "approved").length;
          return (
            <Link key={b.id} href={`/briefs/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card card-hover" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {Array.from({ length: 5 }).map((_, i) => {
                    const f = readyFrames[i];
                    return f?.image_url ? (
                      <img key={i} src={f.image_url} alt="" style={{ width: 38, height: 67, objectFit: "cover", borderRadius: 4, background: "#000" }} />
                    ) : (
                      <div key={i} style={{ width: 38, height: 67, borderRadius: 4, background: "var(--surface-3)" }} />
                    );
                  })}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>@{b.creator_handle}</span>
                    <span className="muted-sm">{b.product_id} · {b.target_duration_s}s</span>
                    <span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, " ")}</span>
                  </div>
                  {b.storyboard?.hook && (
                    <div className="muted" style={{ fontStyle: "italic", marginTop: 4, fontSize: 13 }}>
                      "{b.storyboard.hook}"
                    </div>
                  )}
                  <div className="muted-sm" style={{ marginTop: 4 }}>
                    {b.storyboard ? `${b.storyboard.shots.length} shots · ${b.storyboard.total_duration_s}s` : "drafting…"}
                    {b.frames && b.frames.length > 0 && ` · ${readyFrames.length}/${b.frames.length} frames · ${approved} approved`}
                  </div>
                </div>
                <div className="muted-sm" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {new Date(b.created_at).toLocaleString()}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
