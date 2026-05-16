"use client";

import { useEffect, useState } from "react";

type Job = {
  id: string;
  prompt: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  asset_url?: string;
  error?: string;
  created_at: number;
  params: { duration_seconds?: number; aspect_ratio?: string };
};

export default function Home() {
  const [authNeeded, setAuthNeeded] = useState(false);
  const [password, setPassword] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [duration, setDuration] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/higgsfield/jobs", { cache: "no-store" });
    if (res.status === 401) {
      setAuthNeeded(true);
      return;
    }
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  async function login() {
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Wrong password");
      return;
    }
    setAuthNeeded(false);
    refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/higgsfield/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, aspect_ratio: aspect, duration_seconds: duration }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "submit failed");
      return;
    }
    setPrompt("");
    refresh();
  }

  if (authNeeded) {
    return (
      <div className="container" style={{ maxWidth: 380 }}>
        <h1>Higgsfield Dashboard</h1>
        <div className="card">
          <p className="muted">Enter the shared password to continue.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && login()}
            />
            <button onClick={login}>Sign in</button>
          </div>
          {error && <p style={{ color: "#ff6b6b", marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Higgsfield Video Dashboard</h1>
      <p className="muted">Hosted backend — runs even when your Claude isn't.</p>

      <form className="card" onSubmit={submit} style={{ marginTop: 16 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the video you want…"
          rows={4}
          style={{ width: "100%" }}
        />
        <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
          <label className="muted">Aspect
            <select value={aspect} onChange={(e) => setAspect(e.target.value as any)} style={{ marginLeft: 8 }}>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="1:1">1:1</option>
            </select>
          </label>
          <label className="muted">Duration (s)
            <input
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ marginLeft: 8, width: 80 }}
            />
          </label>
          <div style={{ flex: 1 }} />
          <button type="submit" disabled={submitting || !prompt.trim()}>
            {submitting ? "Submitting…" : "Generate"}
          </button>
        </div>
        {error && <p style={{ color: "#ff6b6b", marginTop: 12 }}>{error}</p>}
      </form>

      <h2 style={{ marginTop: 32 }}>History</h2>
      <div className="grid">
        {jobs.length === 0 && <p className="muted">No jobs yet.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className={`badge badge-${j.status}`}>{j.status}</span>
              <span className="muted">{new Date(j.created_at).toLocaleTimeString()}</span>
            </div>
            <p style={{ margin: "10px 0", fontSize: 14 }}>{j.prompt}</p>
            <p className="muted" style={{ marginTop: 0 }}>
              {j.params.aspect_ratio} · {j.params.duration_seconds}s
            </p>
            {j.asset_url && (
              <video src={j.asset_url} controls playsInline />
            )}
            {j.error && <p style={{ color: "#ff6b6b", fontSize: 13 }}>{j.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
