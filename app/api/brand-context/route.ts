// Placeholder endpoint — returns an empty BrandContext until the
// Connoisseur MCP client lands (built in the parallel session).
//
// Contract for whoever wires up MCP later:
//   - GET /api/brand-context?product_id=ashwamag → BrandContext (200)
//   - Should populate sellingPoints / winnerCombos / archetypePerf /
//     complianceGates / voiceAtoms / portfolio from the Connoisseur tools.
//   - On MCP failure: return BrandContext with `available: false` and a
//     `diagnostics.last_error` string. Never 5xx — the UI gracefully
//     renders empty.
//   - Cache server-side ~5 min per product to avoid hammering MCP from
//     dashboard polling.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { emptyBrandContext } from "@/lib/brand-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product_id = (req.nextUrl.searchParams.get("product_id") ?? "").trim();
  if (!product_id) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 });
  }
  // Stub response — empty, but shape-correct, so the UI renders the
  // "Brand intel syncing…" empty state instead of crashing.
  return NextResponse.json(emptyBrandContext(product_id));
}
