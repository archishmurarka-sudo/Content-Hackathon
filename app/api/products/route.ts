import { NextRequest, NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ products: PRODUCTS });
}
