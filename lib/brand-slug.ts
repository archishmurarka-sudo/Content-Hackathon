// Client-safe mapping: product → Connoisseur corpus slug.
//
// Split from lib/connoisseur_enrichment.ts so the scripts page (a client
// component) can import the pure mapping without pulling in MCP HTTP code.
// connoisseur_enrichment re-exports brandSlugForProduct from here.

import type { Product } from "./data";

// Map a product to its corpus slug. ONLY products that actually have a
// corpus on the MCP get a slug — everything else returns null so the caller
// can decide to skip enrichment.
const PRODUCT_ID_TO_BRAND_SLUG: Record<string, string> = {
  ashwamag: "ashwamag",
  // alpha (Alpha Shilajit) and hgr (HGR Hair) intentionally OMITTED — no
  // corpus on the MCP, would only contaminate the prompt.
};

const NAME_HINT_TO_BRAND_SLUG: Record<string, string> = {
  "ashwamag": "ashwamag",
  "mag ashwa": "ashwamag",
  "magashwa": "ashwamag",
  "mag ashwa gummies": "ashwamag",
};

export function brandSlugForProduct(product: Pick<Product, "id" | "brand" | "name">): string | null {
  if (product.id && PRODUCT_ID_TO_BRAND_SLUG[product.id]) return PRODUCT_ID_TO_BRAND_SLUG[product.id];
  const candidates = [product.brand, product.name].filter(Boolean).map((s) => String(s).toLowerCase().trim());
  for (const c of candidates) {
    if (NAME_HINT_TO_BRAND_SLUG[c]) return NAME_HINT_TO_BRAND_SLUG[c];
  }
  return null;
}

export function productHasCorpus(product: Pick<Product, "id" | "brand" | "name">): boolean {
  return brandSlugForProduct(product) !== null;
}
