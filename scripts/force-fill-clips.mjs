// One-shot: slot two local mp4s into the two shots of a brief.
// Used to demo / force-fill the BOF pipeline when you don't want Veo to render.
//
// Usage:
//   node scripts/force-fill-clips.mjs <brief_id> <shot1.mp4> <shot2.mp4>
//
// Optional env:
//   DASHBOARD_BASE  defaults to the live Railway URL.
//
// Each file is uploaded via /api/briefs/<id>/videos/<idx>/upload which stores
// the bytes in R2, sets frame.video_status=ready with the proxy URL, and logs
// a video.uploaded event. After both clips are in, open the brief detail page
// and click "Stitch final video".

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.DASHBOARD_BASE || "https://content-hackathon-production.up.railway.app";

const [, , briefId, shot1Path, shot2Path] = process.argv;
if (!briefId || !shot1Path || !shot2Path) {
  console.error("usage: node scripts/force-fill-clips.mjs <brief_id> <shot1.mp4> <shot2.mp4>");
  process.exit(1);
}
for (const p of [shot1Path, shot2Path]) {
  if (!fs.existsSync(p)) {
    console.error(`missing file: ${p}`);
    process.exit(1);
  }
}

const items = [
  { shotIdx: 0, filePath: shot1Path },
  { shotIdx: 1, filePath: shot2Path },
];

for (const it of items) {
  const filename = path.basename(it.filePath);
  const bytes = fs.readFileSync(it.filePath);
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "") || "mp4";
  const mime =
    ext === "webm" ? "video/webm" :
    ext === "mov" ? "video/quicktime" :
    "video/mp4";

  console.log(`\n→ shot ${it.shotIdx + 1}  ${filename}  ${(bytes.length / 1024 / 1024).toFixed(1)} MB  ${mime}`);

  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mime }), filename);

  const url = `${BASE}/api/briefs/${encodeURIComponent(briefId)}/videos/${it.shotIdx}/upload`;
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`  FAIL ${res.status}: ${txt.slice(0, 400)}`);
    process.exit(1);
  }
  const data = await res.json();
  console.log(`  ✓ uploaded → ${data.video_url}`);
}

console.log("\nAll clips slotted into the brief.");
console.log(`Open: ${BASE}/briefs/${briefId}  →  Stitch final video.`);
