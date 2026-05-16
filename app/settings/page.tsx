"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/toast";

type Health = {
  ok: boolean;
  env: Record<string, any>;
  resolved: { gemini_text_model: string; gemini_image_model: string };
  db: { configured: boolean; reachable: boolean; brief_count: number | null; error: string | null };
  commit_sha: string | null;
  deploy_time: string | null;
};

type Usage = { storyboard: number; frame_image: number; video_render: number; estimated_cost_usd: number };

const REQUIRED: Array<{ key: string; label: string; setup: string }> = [
  { key: "GEMINI_API_KEY", label: "Gemini (storyboard + frames)", setup: "https://aistudio.google.com/app/apikey" },
  { key: "DATABASE_URL", label: "Postgres (brief persistence)", setup: "Railway → Postgres plugin → reference DATABASE_URL into web service" },
];

const OPTIONAL: Array<{ key: string; label: string; setup: string; what: string }> = [
  { key: "FAL_API_KEY", label: "fal.ai (video render)", setup: "https://fal.ai/dashboard/keys", what: "Kling 2.1 image→video. ~$0.25 per clip." },
  { key: "RESEND_API_KEY", label: "Resend (email delivery)", setup: "https://resend.com/api-keys", what: "Free 100/day. Sends final video link to creator." },
  { key: "YOUTUBE_API_KEY", label: "YouTube Data API (reference ingest)", setup: "https://console.cloud.google.com/apis/credentials", what: "Lets you paste a YouTube URL as additional storyboard inspiration." },
  { key: "APIFY_TOKEN", label: "Apify (TikTok scrape)", setup: "https://console.apify.com/account/integrations", what: "Powers the 'Onboard new creator' flow on /creators." },
  { key: "PERISKOPE_API_KEY", label: "Periskope (WhatsApp delivery)", setup: "https://console.periskope.app/settings/integrations/api", what: "Optional alternative to email delivery." },
];

const R2_KEYS = ["R2_BUCKET", "R2_ENDPOINT_SET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

export default function SettingsPage() {
  const toast = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  async function reload() {
    const [h, u] = await Promise.all([
      fetch("/api/health", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/usage", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setHealth(h);
    setUsage(u);
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container">
      <span className="eyebrow">Settings</span>
      <h1 style={{ marginTop: 6, marginBottom: 24 }}>System health & configuration</h1>

      {/* Top status row */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <Stat label="Deployed commit" value={health?.commit_sha?.slice(0, 7) ?? "—"} mono />
        <Stat label="Postgres" value={health?.db?.reachable ? `${health.db.brief_count ?? 0} briefs` : "offline"} ok={health?.db?.reachable} />
        <Stat label="R2 storage" value={health?.env?.R2_CONFIGURED ? health?.env?.R2_BUCKET ?? "configured" : "off"} ok={Boolean(health?.env?.R2_CONFIGURED)} />
        <Stat label="AI usage this run" value={usage ? `$${usage.estimated_cost_usd.toFixed(2)}` : "—"} sub={usage ? `${usage.storyboard} scripts · ${usage.frame_image} frames · ${usage.video_render} videos` : undefined} />
      </div>

      {/* Models in use */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Models in use</span>
        <div className="row" style={{ marginTop: 10, gap: 24 }}>
          <KV label="Storyboard (text)" value={health?.resolved?.gemini_text_model ?? "—"} />
          <KV label="Frame image" value={health?.resolved?.gemini_image_model ?? "—"} />
          <KV label="Video render" value={health?.env?.FAL_VIDEO_MODEL ?? "fal-ai/kling-video/v2.1/standard/image-to-video"} />
        </div>
      </div>

      {/* Required env */}
      <h2 style={{ marginBottom: 12 }}>Required keys</h2>
      <div className="col" style={{ marginBottom: 24 }}>
        {REQUIRED.map((r) => (
          <EnvRow key={r.key} label={r.label} envKey={r.key} ok={Boolean(health?.env?.[r.key])} setup={r.setup} required />
        ))}
      </div>

      {/* Optional env */}
      <h2 style={{ marginBottom: 12 }}>Optional stages</h2>
      <p className="muted-sm" style={{ marginBottom: 14 }}>
        Without these, the corresponding stage is disabled but the rest of the pipeline keeps working.
      </p>
      <div className="col" style={{ marginBottom: 24 }}>
        {OPTIONAL.map((o) => (
          <EnvRow key={o.key} label={o.label} envKey={o.key} ok={Boolean(health?.env?.[o.key])} setup={o.setup} note={o.what} />
        ))}
      </div>

      {/* R2 detail */}
      <h2 style={{ marginBottom: 12 }}>Object storage (Cloudflare R2)</h2>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <table>
          <tbody>
            {R2_KEYS.map((k) => (
              <tr key={k}>
                <td style={{ width: 240 }}><span className="mono">{k}</span></td>
                <td>
                  {(health?.env?.[k] === true) ? <span className="badge badge-succeeded">set</span> : (health?.env?.[k] === false) ? <span className="badge badge-failed">missing</span> : <span className="muted-sm">{String(health?.env?.[k] ?? "—")}</span>}
                </td>
              </tr>
            ))}
            <tr>
              <td className="mono">R2_CONFIGURED</td>
              <td>
                {health?.env?.R2_CONFIGURED ? <span className="badge badge-succeeded">yes</span> : <span className="badge badge-failed">no</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Danger zone */}
      <h2 style={{ marginBottom: 12, color: "var(--danger)" }}>Danger zone</h2>
      <div className="card" style={{ borderColor: "var(--danger)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Clear all failed briefs</strong>
            <div className="muted-sm" style={{ marginTop: 4 }}>
              Permanently removes every brief in <code>status = "failed"</code>. Cannot be undone.
            </div>
          </div>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm("Delete every failed brief?")) return;
              const r = await fetch("/api/briefs/purge-failed", { method: "POST" });
              const d = await r.json();
              if (r.ok) toast.success("Purged failed briefs", `Removed ${d.purged}`);
              else toast.error("Purge failed", d?.error);
              reload();
            }}
          >
            Clear failed briefs
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, ok, mono }: { label: string; value: string; sub?: string; ok?: boolean; mono?: boolean }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={mono ? "mono" : "stat-value"} style={mono ? { fontSize: 18, marginTop: 8, color: "var(--text)" } : { marginTop: 8, color: ok === false ? "var(--danger)" : undefined }}>
        {value}
      </div>
      {sub && <div className="muted-sm" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted-sm">{label}</div>
      <div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function EnvRow({ label, envKey, ok, setup, required, note }: {
  label: string; envKey: string; ok: boolean; setup: string;
  required?: boolean; note?: string;
}) {
  const Icon = ok ? CheckCircle2 : XCircle;
  const color = ok ? "var(--accent)" : (required ? "var(--danger)" : "var(--muted-2)");
  const isUrl = setup.startsWith("http");
  return (
    <div className="card" style={{ borderColor: ok ? "var(--border)" : (required ? "rgba(232,116,102,.4)" : "var(--border)") }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ alignItems: "center", gap: 8 }}>
            <Icon size={16} style={{ color }} />
            <strong>{label}</strong>
            <code className="mono muted-sm">{envKey}</code>
            {ok ? <span className="badge badge-succeeded">set</span> : <span className={`badge ${required ? "badge-failed" : "badge-pending"}`}>{required ? "missing" : "off"}</span>}
          </div>
          {note && <div className="muted-sm" style={{ marginTop: 6 }}>{note}</div>}
          <div className="muted-sm" style={{ marginTop: 6 }}>
            {isUrl ? (
              <a href={setup} target="_blank" rel="noopener noreferrer">
                {setup} <ExternalLink size={11} style={{ display: "inline-block", verticalAlign: "middle" }} />
              </a>
            ) : (
              setup
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
