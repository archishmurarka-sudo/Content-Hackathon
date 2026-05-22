// GET /api/connoisseur/brands  → list of brands available in the Connoisseur
// corpus (self + peer). Powers the brand dropdown in the Connoisseur panel.

import { NextRequest, NextResponse } from "next/server";
import { callTool, extractToolJson } from "@/lib/connoisseur";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await callTool("list_brands", {});
    let raw: any = extractToolJson(result);
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch {} }
    if (raw && typeof raw === "object" && "result" in raw) raw = typeof raw.result === "string" ? JSON.parse(raw.result) : raw.result;
    const brands = (Array.isArray(raw) ? raw : []).map((b: any) => ({
      brand_slug: String(b.brand_slug ?? ""),
      display_name: String(b.display_name ?? b.brand_slug ?? ""),
      n_ads: Number(b.n_ads ?? 0),
      is_self: Boolean(b.is_self),
    })).filter((b) => b.brand_slug);
    // Self brands first, then by ad count desc.
    brands.sort((a, b) => Number(b.is_self) - Number(a.is_self) || b.n_ads - a.n_ads);
    return NextResponse.json({ brands });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "list_brands failed" }, { status: 502 });
  }
}
