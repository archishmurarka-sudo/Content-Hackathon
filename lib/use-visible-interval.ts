"use client";

// Visibility-aware setInterval replacement.
//
// Pauses polling when the tab is hidden (document.visibilityState !== "visible")
// or the window has lost focus, and runs an immediate refresh the moment the
// tab comes back. Without this, our pages were hitting /api/briefs /api/creators
// /api/products every 3–5s indefinitely on idle tabs — meaningful Postgres churn
// once multiple operators left dashboards open overnight.
//
// Usage:
//   useVisibleInterval(refresh, 5000);
//
// Pass `enabled: false` to short-circuit (e.g. on /login).

import { useEffect, useRef } from "react";

export function useVisibleInterval(callback: () => void, intervalMs: number, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  // Latest-callback ref so we don't restart the interval when the parent
  // re-renders with a new closure — only restart when intervalMs/enabled change.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer != null) return;
      timer = setInterval(() => cbRef.current(), intervalMs);
    }
    function stop() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        // Immediate refresh on resume so the UI feels live, then resume polling.
        cbRef.current();
        start();
      } else {
        stop();
      }
    }

    // Kick off in the right state for current visibility.
    if (document.visibilityState === "visible") start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
