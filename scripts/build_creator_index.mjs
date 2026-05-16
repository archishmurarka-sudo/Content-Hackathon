// Parses the creator catalog + per-creator dossier markdown into structured JSON.
//
// Run: node scripts/build_creator_index.mjs
// Output: data/creators.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOSSIER_DIR = path.join(ROOT, "magcontentinator_package copy/2_ashwamag_videos/creator_dossiers");
const OUT_DIR = path.resolve(ROOT, "data");
const OUT_FILE = path.join(OUT_DIR, "creators.json");

function parseCatalog() {
  const catalogPath = path.join(DOSSIER_DIR, "_catalog.md");
  const lines = fs.readFileSync(catalogPath, "utf8").split("\n");
  const rows = lines
    .filter((l) => l.startsWith("| @"))
    .map((l) =>
      l
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
    );
  return rows.map(([handle, archetype, gmvStr, winnersStr, top_pain, energyStr]) => ({
    handle: handle.replace(/^@/, ""),
    archetype,
    kalo_gmv: gmvStr === "N/A" ? null : Number(gmvStr.replace(/[$,]/g, "")),
    winners: Number(winnersStr) || 0,
    top_pain,
    energy_rating: energyStr ? Number(energyStr.split("/")[0]) : null,
  }));
}

function readDossierFor(handle) {
  const candidates = [
    `${handle}.md`,
    `${handle.toLowerCase()}.md`,
    `_${handle}.md`,
  ];
  for (const fname of candidates) {
    const p = path.join(DOSSIER_DIR, fname);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

function extractFirstParagraph(md) {
  if (!md) return null;
  const blocks = md.split("\n\n").map((b) => b.trim()).filter(Boolean);
  // skip headings
  const para = blocks.find((b) => !b.startsWith("#"));
  return para ? para.slice(0, 600) : null;
}

const catalog = parseCatalog();
const creators = catalog.map((c) => {
  const md = readDossierFor(c.handle);
  return {
    ...c,
    dossier_excerpt: extractFirstParagraph(md),
    has_dossier: Boolean(md),
  };
});

creators.sort((a, b) => (b.kalo_gmv ?? 0) - (a.kalo_gmv ?? 0));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(creators, null, 2));

const withDossier = creators.filter((c) => c.has_dossier).length;
const withGmv = creators.filter((c) => c.kalo_gmv).length;
const topTen = creators.filter((c) => c.kalo_gmv).slice(0, 10);
const totalGmv = creators.reduce((s, c) => s + (c.kalo_gmv ?? 0), 0);
console.log(`Wrote ${creators.length} creators to ${path.relative(ROOT, OUT_FILE)}`);
console.log(`  with full dossier: ${withDossier}`);
console.log(`  with GMV data:     ${withGmv}`);
console.log(`  total GMV indexed: $${totalGmv.toLocaleString()}`);
console.log(`  top 10 GMV:`);
topTen.forEach((c) =>
  console.log(`    @${c.handle.padEnd(28)} ${c.archetype.padEnd(22)} $${c.kalo_gmv.toLocaleString()}`)
);
