// PATCH  /api/scripts/:id  body: { approved: boolean }   toggle approval
// DELETE /api/scripts/:id                                  remove a script

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { deleteScript, setApproved } from "@/lib/ad-scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const approved = typeof body.approved === "boolean" ? body.approved : undefined;
  if (approved === undefined) return NextResponse.json({ error: "approved boolean required" }, { status: 400 });
  const updated = await setApproved(id, approved);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ script: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteScript(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
