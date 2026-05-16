import { NextRequest, NextResponse } from "next/server";
import { getCreatorPhone, setCreatorPhone } from "@/lib/delivery";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return NextResponse.json({ handle, phone: getCreatorPhone(handle) ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { handle } = await params;
  const body = await req.json().catch(() => ({} as any));
  const phone = String(body.phone ?? "").trim();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  setCreatorPhone(handle, phone);
  return NextResponse.json({ handle, phone: getCreatorPhone(handle) });
}
