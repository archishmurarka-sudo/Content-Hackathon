// GET / PATCH / DELETE a single product (by id).
//
// PATCH works on both user-added AND built-in products. For built-ins, the
// patch is merged onto the built-in definition and saved to products_added
// with the same id — getAllProducts() prefers products_added entries, so the
// edit becomes the active version without mutating the built-in source.

import { NextRequest, NextResponse } from "next/server";
import {
  PRODUCTS,
  addProduct,
  findProduct,
  ensureProductsLoaded,
  type Product,
} from "@/lib/data";
import { isAuthed } from "@/lib/auth";
import { hasDb, sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureProductsLoaded();
  const { id } = await params;
  const p = findProduct(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ product: p });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureProductsLoaded();
  const { id } = await params;
  const current = findProduct(id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Only allow updating safe fields. id + source are not patchable.
  const ALLOWED: (keyof Product)[] = [
    "name",
    "brand",
    "one_liner",
    "pain_anchors",
    "hero_image_url",
    "format",
    "key_ingredients",
    "delivery_tech",
    "price_band",
    "channel",
    "audience_primary",
    "audience_secondary",
    "pain_breakdown",
    "consumer_quotes",
  ];
  const patch: Partial<Product> = {};
  for (const k of ALLOWED) {
    if (k in body) (patch as any)[k] = (body as any)[k];
  }

  // Merge onto current; persist via addProduct() (upsert on id).
  const merged: Product = { ...current, ...patch, id: current.id, source: "user" };
  const saved = await addProduct(merged);
  return NextResponse.json({ product: saved });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Refuse to delete built-ins (they'd come back on next deploy anyway and a
  // PATCH back to original is cleaner — but for user-added we hard-delete).
  if (PRODUCTS.find((p) => p.id === id)) {
    return NextResponse.json({ error: "cannot delete a built-in product (PATCH it instead)" }, { status: 400 });
  }

  if (hasDb()) {
    await ensureSchema();
    await sql()`DELETE FROM products_added WHERE id = ${id}`;
  }
  // Drop from in-memory too.
  const g = globalThis as unknown as { __products_added?: Map<string, Product> };
  g.__products_added?.delete(id);
  return NextResponse.json({ ok: true });
}
