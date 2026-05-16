"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

type Creator = {
  handle: string;
  archetype: string;
  kalo_gmv: number | null;
  winners: number;
  top_pain: string;
  energy_rating: number | null;
  dossier_excerpt: string | null;
};
type BriefFrame = { shot_idx: number; status: string; image_url?: string };
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  target_duration_s: number;
  status: string;
  storyboard?: { hook: string; total_duration_s: number; shots: any[] };
  frames?: BriefFrame[];
  created_at: number;
};

export default function CreatorProfile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const cRes = await fetch(`/api/creators?handle=${encodeURIComponent(handle)}`, { cache: "no-store" });
      if (cRes.status === 404) { if (alive) setNotFound(true); return; }
      const c = await cRes.json();
      const bRes = await fetch("/api/briefs", { cache: "no-store" });
      const b = (await bRes.json()).briefs ?? [];
      if (!alive) return;
      setCreator(c);
      setBriefs(b.filter((x: Brief) => x.creator_handle.toLowerCase() === handle.toLowerCase()));
    }
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [handle]);

  if (notFound) {
    return <div className="container"><p className="muted">Creator @{handle} not found in catalog.</p></div>;
  }
  if (!creator) return <div className="container"><p className="muted">Loading…</p></div>;

  return (
    <div className="container">
      <span className="eyebrow">Creator</span>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 20, alignItems: "flex-start", marginTop: 8, marginBottom: 28 }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, background: "linear-gradient(135deg, var(--accent) 0%, #4f8a4f 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-serif)", fontSize: 40, color: "var(--accent-fg)", fontWeight: 500 }}>
          {creator.handle[0].toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ marginTop: 0 }}>@{creator.handle}</h1>
          <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 10 }}>
            <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>{creator.archetype}</span>
            <span className="muted-sm">energy {creator.energy_rating ?? "?"}/10</span>
            <span className="muted-sm">·</span>
            <span className="muted-sm">{creator.winners} winners</span>
          </div>
          {creator.dossier_excerpt && (
            <p className="muted" style={{ marginTop: 14, maxWidth: 640 }}>{creator.dossier_excerpt}</p>
          )}
        </div>
        <Link href={`/?prefill=${creator.handle}`} className="btn" style={{ textDecoration: "none" }}>
          New brief <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 32 }}>
        <Stat label="Kalo GMV" value={creator.kalo_gmv ? `$${(creator.kalo_gmv / 1000).toFixed(0)}k` : "—"} />
        <Stat label="Winner videos" value={creator.winners.toString()} />
        <Stat label="Briefs generated" value={briefs.length.toString()} />
        <Stat label="Top pain" value={creator.top_pain} small />
      </div>

      <span className="eyebrow">Briefs</span>
      <h2 style={{ marginTop: 6, marginBottom: 14 }}>Generated for @{creator.handle}</h2>

      {briefs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          <Sparkles size={20} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div>No briefs yet — <Link href={`/?prefill=${creator.handle}`}>spin up the first one</Link>.</div>
        </div>
      ) : (
        <div className="col">
          {briefs.map((b) => {
            const ready = (b.frames ?? []).filter((f) => f.image_url);
            const approved = (b.frames ?? []).filter((f) => f.status === "approved").length;
            return (
              <Link key={b.id} href={`/briefs/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card card-hover" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: 5 }).map((_, i) => ready[i]?.image_url ? (
                      <img key={i} src={ready[i].image_url} alt="" style={{ width: 38, height: 67, objectFit: "cover", borderRadius: 4, background: "#000" }} />
                    ) : (
                      <div key={i} style={{ width: 38, height: 67, borderRadius: 4, background: "var(--surface-3)" }} />
                    ))}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ alignItems: "center", gap: 8 }}>
                      <span className="muted-sm">{b.product_id} · {b.target_duration_s}s</span>
                      <span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, " ")}</span>
                    </div>
                    {b.storyboard?.hook && (
                      <div className="muted" style={{ fontStyle: "italic", marginTop: 4, fontSize: 13 }}>"{b.storyboard.hook}"</div>
                    )}
                    <div className="muted-sm" style={{ marginTop: 4 }}>
                      {b.storyboard && `${b.storyboard.shots.length} shots`}
                      {b.frames && b.frames.length > 0 && ` · ${ready.length}/${b.frames.length} frames · ${approved} approved`}
                    </div>
                  </div>
                  <div className="muted-sm" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {new Date(b.created_at).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={small ? "" : "stat-value"} style={small ? { marginTop: 6, fontSize: 16, fontWeight: 500 } : { marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}
