import { NextRequest, NextResponse } from "next/server";
import {
  PRODUCTS,
  ensureProductsLoaded,
  getAllProducts,
  addProduct,
  findProduct,
  type Product,
} from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureProductsLoaded();
  return NextResponse.json({ products: getAllProducts() });
}

// POST a user-added product. Body shape mirrors the Product type (most fields optional).
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureProductsLoaded();
  const body = await req.json().catch(() => ({}));

  const name = String(body.name ?? "").trim();
  const brand = String(body.brand ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const id = String(body.id ?? slugify(name)).trim();
  if (!id) return NextResponse.json({ error: "id could not be derived from name" }, { status: 400 });
  if (PRODUCTS.find((p) => p.id === id)) {
    return NextResponse.json({ error: `id "${id}" collides with a built-in product` }, { status: 409 });
  }

  const product: Product = {
    id,
    name,
    brand,
    one_liner: String(body.one_liner ?? "").trim(),
    pain_anchors: Array.isArray(body.pain_anchors) ? body.pain_anchors.map((x: any) => String(x).trim()).filter(Boolean) : [],
    hero_image_url: typeof body.hero_image_url === "string" ? body.hero_image_url : null,
    format: typeof body.format === "string" ? body.format : undefined,
    key_ingredients: Array.isArray(body.key_ingredients) ? body.key_ingredients.map((x: any) => String(x).trim()).filter(Boolean) : undefined,
    delivery_tech: typeof body.delivery_tech === "string" ? body.delivery_tech : undefined,
    price_band: typeof body.price_band === "string" ? body.price_band : undefined,
    channel: typeof body.channel === "string" ? body.channel : undefined,
    audience_primary: typeof body.audience_primary === "string" ? body.audience_primary : undefined,
    audience_secondary: typeof body.audience_secondary === "string" ? body.audience_secondary : undefined,
    source: "user",
  };

  const saved = await addProduct(product);
  return NextResponse.json({ product: saved });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
