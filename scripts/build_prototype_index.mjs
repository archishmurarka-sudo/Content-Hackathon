// Flattens the BOF videos in the magcontentinator package into a single
// JSON the storyboard generator can search over.
//
// Run: node scripts/build_prototype_index.mjs
// Output: data/bof_prototypes.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "magcontentinator_package copy");
const OUT_DIR = path.resolve(ROOT, "data");
const OUT_FILE = path.join(OUT_DIR, "bof_prototypes.json");

const SOURCES = [
  { dir: path.join(PKG, "3_mid_bottom_funnel/BOF"), bucket: "BOF" },
  { dir: path.join(PKG, "3_mid_bottom_funnel/MOF"), bucket: "MOF" },
  { dir: path.join(PKG, "3_mid_bottom_funnel/under_30s_problem_fix"), bucket: "BOF_under30s" },
];

function parseIndex() {
  const indexPath = path.join(PKG, "2_ashwamag_videos/INDEX.csv");
  const csv = fs.readFileSync(indexPath, "utf8").trim().split("\n");
  const header = csv[0].split(",");
  return csv.slice(1).map((row) => {
    const cols = row.split(",");
    const rec = {};
    header.forEach((h, i) => (rec[h] = cols[i]));
    return rec;
  });
}

function summarizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];
  return timeline.map((t, idx) => ({
    idx,
    start: t.start,
    end: t.end,
    speech: t.speech ?? "",
    speech_tone: t.speech_tone ?? "",
    visual: t.visuals ?? "",
    overlay: t.text_overlay ?? "",
    overlay_style: t.text_overlay_style ?? "",
    product_action: t.product_action ?? "",
    transition: t.transition ?? "",
  }));
}

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const indexLookup = new Map();
parseIndex().forEach((r) => indexLookup.set(r.video_id, r));

const prototypes = [];
for (const src of SOURCES) {
  if (!fs.existsSync(src.dir)) continue;
  for (const fname of fs.readdirSync(src.dir)) {
    if (!fname.endsWith(".json")) continue;
    const videoId = fname.replace(/\.json$/, "");
    const data = read(path.join(src.dir, fname));
    if (!data) continue;
    const meta = indexLookup.get(videoId) ?? {};
    prototypes.push({
      video_id: videoId,
      source_bucket: src.bucket,
      creator_handle: meta.creator ?? null,
      product: meta.product ?? null,
      duration_seconds: Number(meta.duration_seconds ?? data.duration_seconds ?? 0),
      funnel_stage: meta.funnel_stage ?? null,
      narrative_direction: meta.narrative_direction ?? null,
      video_format: meta.video_format ?? null,
      shots: summarizeTimeline(data.timeline),
      voice_style: data.audio?.voice_style ?? null,
      music: data.audio?.music ?? null,
      product_first_appearance_seconds: data.product_first_appearance_seconds ?? null,
    });
  }
}

// dedupe — same video can live in multiple buckets
const seen = new Set();
const unique = prototypes.filter((p) => {
  if (seen.has(p.video_id)) return false;
  seen.add(p.video_id);
  return true;
});

unique.sort((a, b) => a.duration_seconds - b.duration_seconds);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2));

const under30 = unique.filter((p) => p.duration_seconds > 0 && p.duration_seconds < 30).length;
console.log(`Wrote ${unique.length} prototypes to ${path.relative(ROOT, OUT_FILE)}`);
console.log(`  under-30s: ${under30}`);
console.log(`  with shots: ${unique.filter((p) => p.shots.length > 0).length}`);
console.log(`  unique creators: ${new Set(unique.map((p) => p.creator_handle).filter(Boolean)).size}`);
console.log(`  unique narratives: ${new Set(unique.map((p) => p.narrative_direction).filter(Boolean)).size}`);
