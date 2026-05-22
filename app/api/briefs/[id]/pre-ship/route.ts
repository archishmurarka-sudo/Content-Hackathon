// GET /api/briefs/:id/pre-ship  →  { flags: PreShipFlag[], passed: boolean, checked_at: number | null, ok: boolean }
//
// Returns the most recent Connoisseur pre_ship_check result for this brief.
// The check runs fire-and-forget right after storyboard generation in
// app/api/briefs/route.ts and logs into the events table.

import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const events = await listEvents({ brief_id: id, type: "brief.pre_ship_check", limit: 1 });
  const latest = events[0];
  if (!latest) {
    return NextResponse.json({ flags: [], passed: null, checked_at: null, ok: null });
  }
  const outcome = (latest.outcome ?? {}) as any;
  const payload = (latest.payload ?? {}) as any;
  return NextResponse.json({
    flags: Array.isArray(outcome.flags) ? outcome.flags : [],
    passed: outcome.passed ?? null,
    flag_count: outcome.flag_count ?? 0,
    checked_at: latest.created_at,
    ok: payload.tool_ok ?? null,
    brand_slug: payload.brand_slug ?? null,
  });
}
