// GET /api/connoisseur/tools  →  { tools: Tool[] }
// Server-side proxy to the Connoisseur MCP so we never expose the MCP URL or
// any future auth header to the browser.

import { NextRequest, NextResponse } from "next/server";
import { listTools, connoisseurUrl } from "@/lib/connoisseur";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const tools = await listTools();
    return NextResponse.json({ tools, server_url: connoisseurUrl() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "connoisseur tools/list failed" }, { status: 502 });
  }
}
