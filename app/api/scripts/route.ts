// GET  /api/scripts?product_id=<id>   list saved direct-response scripts
// POST /api/scripts                    generate a new batch (NOT WIRED YET)
//
// Backend is intentionally a stub for now — the frontend builds against this
// shape so the table renders an empty/coming-soon state, and the generate
// button surfaces a clear "wiring pending" error instead of a silent fail.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdScript = {
  id: string;
  product_id: string;
  source_kind: "swipe_prototype" | "swipe_creator" | "original";
  source_ref: string | null;
  creator_handle: string | null;
  script_csv: Record<string, string>;     // the 10-column row
  approved: boolean;
  sheet_url: string | null;
  created_at: number;
};

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const _product_id = req.nextUrl.searchParams.get("product_id");
  // TODO: when ad_scripts table lands, query by product_id.
  return NextResponse.json({ scripts: [] as AdScript[] });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(
    {
      error: "script generation not yet wired — UI is in place, generator coming next",
      hint: "frontend ships first; backend lands in the follow-up PR",
    },
    { status: 501 }
  );
}
