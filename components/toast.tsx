"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; title: string; body?: string };

type Ctx = {
  push: (kind: ToastKind, title: string, body?: string) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Allow components to call useToast without a provider (no-ops). Avoids
    // crashing if the provider isn't mounted yet during hydration.
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, title: string, body?: string) => {
    const t: Toast = { id: nextId++, kind, title, body };
    setToasts((arr) => [...arr, t]);
    setTimeout(() => dismiss(t.id), kind === "error" ? 8000 : 4500);
  }, [dismiss]);

  const ctx: Ctx = {
    push,
    success: (title, body) => push("success", title, body),
    error: (title, body) => push("error", title, body),
    info: (title, body) => push("info", title, body),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 340,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? AlertCircle : Info;
  const color = toast.kind === "success" ? "var(--accent)" : toast.kind === "error" ? "var(--danger)" : "var(--info)";
  const bg = toast.kind === "success" ? "var(--accent-soft)" : toast.kind === "error" ? "var(--danger-soft)" : "rgba(122,168,214,.12)";
  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${color}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        boxShadow: "var(--shadow)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        pointerEvents: "auto",
        animation: "toast-in 180ms ease-out",
      }}
    >
      <Icon size={16} style={{ color, flexShrink: 0, marginTop: 1, background: bg, borderRadius: "50%", padding: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{toast.title}</div>
        {toast.body && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{toast.body}</div>}
      </div>
      <button
        onClick={onClose}
        aria-label="dismiss"
        style={{
          background: "transparent",
          border: 0,
          color: "var(--muted-2)",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <X size={14} />
      </button>
      <style jsx>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0);   }
        }
      `}</style>
    </div>
  );
}
