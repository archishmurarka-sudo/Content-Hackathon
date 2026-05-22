// POST /api/connoisseur/call  →  { name: string, arguments?: object }
//                              ←  { content: [...], structured?: any, json?: any, text?: string }
//
// Server-side proxy to MCP tools/call. We unwrap the most common Connoisseur
// response shape (single text part with JSON inside) into a `json` field for
// easy client rendering, while still returning the raw `content` for the
// few tools that return images or multiple parts.

import { NextRequest, NextResponse } from "next/server";
import { callTool, extractToolJson, extractToolText } from "@/lib/connoisseur";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const args = (body?.arguments && typeof body.arguments === "object") ? body.arguments : {};

  try {
    const result = await callTool(name, args);
    const json = extractToolJson(result);
    const text = extractToolText(result);
    return NextResponse.json({
      content: result.content,
      structured: result.structuredContent,
      json,
      text,
      isError: Boolean(result.isError),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? `tool ${name} failed` }, { status: 502 });
  }
}
