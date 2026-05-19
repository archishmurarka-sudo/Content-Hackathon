// GET /api/scripts/export?product_id=<id>&only_approved=1
//
// Streams the saved scripts as a CSV file using Noa's 10-column schema.
// Filename: <brand>-<product>-scripts-<yyyymmdd>.csv

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { listScriptsForProduct } from "@/lib/ad-scripts";
import { csvHeader, toCsvLine } from "@/lib/script-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product_id = req.nextUrl.searchParams.get("product_id");
  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  const only_approved = req.nextUrl.searchParams.get("only_approved") === "1";

  await ensureProductsLoaded();
  const product = findProduct(product_id);

  let scripts = await listScriptsForProduct(product_id);
  if (only_approved) scripts = scripts.filter((s) => s.approved);
  if (scripts.length === 0) {
    return NextResponse.json({ error: "no scripts to export" }, { status: 404 });
  }

  // Ordering: by created_at ASC so the CSV reads top-to-bottom in generation order.
  scripts.sort((a, b) => a.created_at - b.created_at);
  const body = [csvHeader(), ...scripts.map((s) => toCsvLine(s.script_csv))].join("\n");

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `${safeName(product?.brand ?? "")}-${safeName(product?.name ?? product_id)}-scripts-${today}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
