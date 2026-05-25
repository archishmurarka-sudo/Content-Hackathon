"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginInner() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d?.error ?? "wrong password");
      return;
    }
    // Force a full navigation so the middleware sees the new cookie on the
    // very next request — Next's client router caches without it.
    window.location.href = next;
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      background:
        "radial-gradient(900px 600px at 90% 10%, rgba(200,255,94,0.08), transparent 60%)," +
        "linear-gradient(160deg, #0b0d0c 0%, #131715 100%)",
      color: "#fff",
      fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
    }}>
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 380,
          padding: "32px 28px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 14,
        }}
      >
        <div style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "#c8ff5e",
          fontWeight: 700,
        }}>Mosaic Engine</div>
        <h1 style={{
          fontSize: 26,
          fontWeight: 700,
          margin: "10px 0 6px",
          letterSpacing: "-0.01em",
        }}>Sign in</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: 0 }}>
          Enter the team password to continue.
        </p>

        <label style={{
          display: "block",
          marginTop: 22,
          marginBottom: 6,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "rgba(255,255,255,0.6)",
          fontWeight: 600,
        }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          autoComplete="current-password"
          placeholder="••••••••"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8,
            color: "#fff",
            fontSize: 15,
            outline: "none",
          }}
        />

        {error && (
          <p style={{ color: "#ff8a7a", fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "10px 16px",
            background: busy || !password ? "rgba(200,255,94,0.4)" : "#c8ff5e",
            color: "#0b0d0c",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: busy || !password ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
