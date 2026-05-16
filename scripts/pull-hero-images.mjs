// Pull the 3 product hero images from the brands' public CDNs, push each to
// the live /api/uploads/image route on Railway, then PATCH the corresponding
// product to point at the uploaded URL.
//
// Run:  node scripts/pull-hero-images.mjs
//
// No secrets needed — the dashboard endpoint accepts public POSTs (auth is off
// for the trial). If auth comes back, add a Cookie header.

const BASE = process.env.DASHBOARD_BASE || "https://content-hackathon-production.up.railway.app";

const HEROES = [
  {
    product_id: "ashwamag",
    source_url: "https://rootlabs.co/cdn/shop/files/Rootlabsfv_5d749ab8-3075-4728-8fcc-a067ed772152.png?v=1739350467",
    filename: "ashwamag-hero.png",
  },
  {
    product_id: "alpha",
    source_url: "https://rootlabs.co/cdn/shop/files/front-removebg-preview.png?v=1752231467",
    filename: "alpha-hero.png",
  },
  {
    product_id: "hgr",
    source_url: "https://i.mscwlns.co/media/misc/pdp_rcl/hair-growth-serum-roll-on/Normal%20PDP%20Intro_arvlgb.jpg",
    filename: "hgr-hero.jpg",
  },
];

for (const item of HEROES) {
  process.stdout.write(`\n→ ${item.product_id}\n`);
  process.stdout.write(`  downloading ${item.source_url}\n`);
  const dl = await fetch(item.source_url);
  if (!dl.ok) { console.error(`  FAIL download ${dl.status}`); continue; }
  const ct = dl.headers.get("content-type") || (item.filename.endsWith(".jpg") ? "image/jpeg" : "image/png");
  const bytes = new Uint8Array(await dl.arrayBuffer());
  process.stdout.write(`  ${(bytes.length / 1024).toFixed(0)} KB · ${ct}\n`);

  process.stdout.write(`  uploading to ${BASE}/api/uploads/image\n`);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: ct }), item.filename);
  fd.append("prefix", `products/${item.product_id}/hero`);
  const up = await fetch(`${BASE}/api/uploads/image`, { method: "POST", body: fd });
  if (!up.ok) { console.error(`  FAIL upload ${up.status}: ${(await up.text()).slice(0, 200)}`); continue; }
  const upd = await up.json();
  process.stdout.write(`  uploaded → ${upd.url}\n`);

  process.stdout.write(`  PATCH /api/products/${item.product_id}\n`);
  const patch = await fetch(`${BASE}/api/products/${item.product_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hero_image_url: upd.url }),
  });
  if (!patch.ok) { console.error(`  FAIL patch ${patch.status}: ${(await patch.text()).slice(0, 200)}`); continue; }
  const pd = await patch.json();
  process.stdout.write(`  ✓ ${item.product_id} → ${pd.product?.hero_image_url ?? "?"}\n`);
}

process.stdout.write("\nDone.\n");
