"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { useVisibleInterval } from "@/lib/use-visible-interval";

type Delivery = {
  status: "queued" | "sent" | "failed";
  channel: "email" | "whatsapp";
  to: string;
  message_id?: string;
  subject?: string;
  sent_at?: number;
  error?: string;
};
type Brief = {
  id: string;
  creator_handle: string;
  product_id: string;
  status: string;
  storyboard?: { hook?: string };
  final_video_url?: string;
  delivery?: Delivery;
  created_at: number;
};

export default function SendsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [filter, setFilter] = useState<"all" | "email" | "whatsapp">("all");

  async function load() {
    const res = await fetch("/api/briefs", { cache: "no-store" });
    const d = await res.json();
    setBriefs(d.briefs ?? []);
  }

  useEffect(() => { load(); }, []);
  useVisibleInterval(load, 5000);

  const sends = useMemo(
    () =>
      briefs
        .filter((b) => b.delivery)
        .filter((b) => (filter === "all" ? true : b.delivery!.channel === filter))
        .sort((a, b) => (b.delivery!.sent_at ?? 0) - (a.delivery!.sent_at ?? 0)),
    [briefs, filter]
  );

  const total = briefs.filter((b) => b.delivery).length;
  const sent = briefs.filter((b) => b.delivery?.status === "sent").length;
  const failed = briefs.filter((b) => b.delivery?.status === "failed").length;

  return (
    <div className="container">
      <span className="eyebrow">Deliveries</span>
      <h1 style={{ marginTop: 6, marginBottom: 24 }}>
        {sent} sent · {failed} failed · {total} total
      </h1>

      <div className="row" style={{ marginBottom: 18 }}>
        {(["all", "email", "whatsapp"] as const).map((opt) => (
          <button
            key={opt}
            className={filter === opt ? "" : "btn-ghost"}
            onClick={() => setFilter(opt)}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {opt[0].toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Creator</th>
              <th>To</th>
              <th>Status</th>
              <th>Sent at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sends.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  No deliveries yet — finish a brief and hit Send.
                </td>
              </tr>
            )}
            {sends.map((b) => {
              const d = b.delivery!;
              const Icon = d.channel === "email" ? Mail : MessageCircle;
              return (
                <tr key={b.id}>
                  <td>
                    <div className="row" style={{ alignItems: "center", gap: 6 }}>
                      <Icon size={14} className="muted" />
                      <span>{d.channel}</span>
                    </div>
                  </td>
                  <td>
                    <Link href={`/creators/${b.creator_handle}`} style={{ fontWeight: 600 }}>
                      @{b.creator_handle}
                    </Link>
                    {b.storyboard?.hook && (
                      <div className="muted-sm" style={{ marginTop: 2, fontStyle: "italic", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        "{b.storyboard.hook}"
                      </div>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{d.to}</td>
                  <td>
                    <span className={`badge badge-${d.status === "sent" ? "succeeded" : d.status === "failed" ? "failed" : "pending"}`}>
                      {d.status}
                    </span>
                    {d.error && <div className="muted-sm" style={{ color: "var(--danger)", marginTop: 4, maxWidth: 240 }}>{d.error}</div>}
                  </td>
                  <td className="muted-sm">{d.sent_at ? new Date(d.sent_at).toLocaleString() : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/briefs/${b.id}`} className="btn-ghost btn-sm" style={{ textDecoration: "none" }}>
                      Open brief
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
