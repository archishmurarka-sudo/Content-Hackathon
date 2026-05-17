"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, FileVideo2, Users, Package, Send, Settings, Activity, Presentation } from "lucide-react";

type Usage = { storyboard: number; frame_image: number; video_render: number; estimated_cost_usd: number };
type Health = { commit_sha: string | null; db: { reachable: boolean; brief_count: number | null } };

const NAV: Array<{ section?: string; items: { href: string; label: string; icon: React.ComponentType<any> }[] }> = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/briefs", label: "Briefs", icon: FileVideo2 },
      { href: "/creators", label: "Creators", icon: Users },
      { href: "/products", label: "Products", icon: Package },
    ],
  },
  {
    section: "delivery",
    items: [
      { href: "/sends", label: "Sends", icon: Send },
    ],
  },
  {
    section: "system",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Static-file pages served from /public — kept out of NAV[] because they
// aren't Next routes (clicking them does a full browser navigation, not a
// client transition). Add new entries here, not above.
const STATIC_LINKS: { href: string; label: string; icon: React.ComponentType<any>; section?: string }[] = [
  { href: "/pitch.html", label: "Pitch", icon: Presentation, section: "deck" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = pathname === "/login";
  const [usage, setUsage] = useState<Usage | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    if (isStandalone) return;
    let alive = true;
    async function load() {
      const [u, h] = await Promise.all([
        fetch("/api/usage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/health", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      if (u) setUsage(u);
      if (h) setHealth(h);
    }
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [isStandalone]);

  // Login page renders standalone — no sidebar/topbar chrome.
  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="sidebar-brand-mark">M</span>
          <span className="sidebar-brand-name">Mosaic Engine</span>
        </Link>
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.section && <div className="sidebar-section">{group.section}</div>}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={`sidebar-link ${active ? "active" : ""}`}>
                  <Icon size={15} className="sidebar-link-icon" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        {STATIC_LINKS.length > 0 && (
          <div>
            {STATIC_LINKS[0].section && <div className="sidebar-section">{STATIC_LINKS[0].section}</div>}
            {STATIC_LINKS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <a key={item.href} href={item.href} className={`sidebar-link ${active ? "active" : ""}`}>
                  <Icon size={15} className="sidebar-link-icon" />
                  {item.label}
                </a>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: "auto", padding: "8px 10px", fontSize: 11, color: "var(--muted-2)" }}>
          {health?.commit_sha && (
            <div className="mono" title="Deployed commit">{health.commit_sha.slice(0, 7)}</div>
          )}
          <div style={{ marginTop: 2 }}>
            DB {health?.db?.reachable ? "✓" : "—"}{" "}
            {health?.db?.brief_count != null ? `· ${health.db.brief_count} briefs` : ""}
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            <Breadcrumb pathname={pathname} />
          </div>
          <div className="topbar-right">
            <span className="topbar-chip" title="AI spend in this server process">
              <Activity size={12} />
              <strong>${usage?.estimated_cost_usd?.toFixed(2) ?? "0.00"}</strong> usage
            </span>
            {usage && (
              <span className="topbar-chip">
                {usage.storyboard} scripts · {usage.frame_image} frames
              </span>
            )}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return <span>Dashboard</span>;
  return (
    <span>
      <Link href="/">Dashboard</Link>
      {parts.map((p, i) => {
        const href = "/" + parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        return (
          <span key={href}>
            <span style={{ margin: "0 8px", color: "var(--muted-2)" }}>/</span>
            {isLast ? (
              <span style={{ color: "var(--text-2)" }}>{prettify(p)}</span>
            ) : (
              <Link href={href}>{prettify(p)}</Link>
            )}
          </span>
        );
      })}
    </span>
  );
}

function prettify(seg: string) {
  if (seg.startsWith("brief_")) return seg.slice(0, 14) + "…";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}
