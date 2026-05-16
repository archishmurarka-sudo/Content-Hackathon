// GET /api/events
//   Default: returns the last N events as JSON.
//   ?brief_id=...  filter to one brief
//   ?type=...      filter to one event type (e.g. "frame.regenerated")
//   ?limit=...     default 500, max 5000
//   ?format=jsonl  stream as newline-delimited JSON (one event per line) —
//                  this is the shape most training pipelines expect.

import { NextRequest, NextResponse } from "next/server";
import { listEvents, type EventType } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = req.nextUrl;
  const brief_id = u.searchParams.get("brief_id") ?? undefined;
  const typeRaw = u.searchParams.get("type") ?? undefined;
  const limit = Math.min(Number(u.searchParams.get("limit") ?? "500") || 500, 5000);
  const format = (u.searchParams.get("format") ?? "json").toLowerCase();

  const events = await listEvents({
    brief_id,
    type: typeRaw as EventType | undefined,
    limit,
  });

  if (format === "jsonl") {
    const body = events.map((e) => JSON.stringify(e)).join("\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="events_${Date.now()}.jsonl"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ events, count: events.length });
}
