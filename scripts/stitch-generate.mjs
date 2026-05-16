// Calls Google Stitch (https://stitch.googleapis.com/mcp) to generate UI mockups
// from one of 3 design-direction prompts. Saves HTML + screenshot URLs into
// docs/stitch-mockups/ for review.
//
// Run:  node scripts/stitch-generate.mjs <A|B|C|all>
//
// Requires in .env (locally) or Railway Variables:
//   STITCH_API_KEY=AQ.Ab8R...
//   STITCH_PROJECT_ID=<your Stitch project id>

import fs from "node:fs";
import path from "node:path";
import { stitch } from "@google/stitch-sdk";

// --- env -----------------------------------------------------------------
try {
  const envPath = path.resolve(".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch {}

const KEY = process.env.STITCH_API_KEY;
const PROJECT = process.env.STITCH_PROJECT_ID;
if (!KEY) {
  console.error("STITCH_API_KEY missing (add to .env or env).");
  process.exit(1);
}
if (!PROJECT) {
  console.error("STITCH_PROJECT_ID missing (add to .env or env).");
  process.exit(1);
}

// --- prompts -------------------------------------------------------------
const PROMPTS = {
  A: {
    name: "Mission Control",
    prompt: `Design a desktop web dashboard called "Mosaic Creator Engine" for an
ops team running 20+ video briefs per day for TikTok Shop creators.

Layout:
- Vertical sidebar nav on the left, dark background, 220px wide. Items: Dashboard, Briefs, Creators, Products, Sends, Settings. Active item highlighted.
- Top bar across the rest of the screen: global search input, AI usage meter ($X.XX today), deploy commit hash badge, user avatar dropdown.
- Main area is a 3-column grid:
  - LEFT 240px: filter panel — status checkboxes, product picker, creator multi-select, "Saved Views" list.
  - CENTER (flex): live brief list. Each brief row shows: status pill, creator avatar + handle, product, 5 thumbnail strip of frames, hook text in italics, 4 small action icons (regenerate, approve all, send, delete). Hover row shows side-by-side diff.
  - RIGHT 320px: quick-action drawer — selected brief preview, batch operations, recent activity log.

Style: dark theme like Linear / Vercel. Sharp 8px corners. Monospace font (Geist Mono) for IDs and timestamps. Color accents: subtle blue for primary, green for approved, amber for pending, red for failed. Dense, information-rich, sharp.`,
  },
  B: {
    name: "Creator Workspace",
    prompt: `Design a creator-CRM web page called "@cakedfinds" profile inside
a tool called "Mosaic Creator Engine". This page is for a creator we partner with on TikTok Shop.

Layout:
- Header card: large circular avatar (TikTok profile pic), handle "@cakedfinds", archetype badge ("deal_hunter"), top pain ("missing out on a discount"), energy rating 8/10, lifetime GMV "$504,440", # of videos delivered "23", quick CTA buttons: "New brief", "Send via WhatsApp".
- Below: 4 tabs — Briefs · Approved Videos · Performance · Voice.
- Briefs tab (default): vertical timeline of brief cards, newest first. Each card: thumbnail strip of frames, hook, status pill, "Open" button.
- Approved Videos tab: gallery grid of finished 9:16 video thumbnails with play buttons and per-video "Send to WhatsApp" button.
- Performance tab: 2 charts — views per video over time (line), GMV per video (bar). Below: table of last 10 videos with view count + GMV.
- Voice tab: chips showing the creator's typical hook openers ("Tap that orange cart..."), narrative directions she uses most ("deal_stacking_tutorial"), and 3 example transcript snippets.
- Left sidebar: searchable list of all 47 creators sorted by GMV — each row a mini avatar + handle + GMV.

Style: warm dark theme, large avatars front-and-center, generous spacing, photography-grade thumbnails. CRM/Linear hybrid feel. Use creator imagery to give it personality.`,
  },
  C: {
    name: "Pipeline Kanban",
    prompt: `Design a horizontal kanban board for a tool called "Mosaic Creator Engine".
The board moves video briefs through their lifecycle.

Layout:
- Top bar: tool name, daily progress "12 delivered today / 30 target" with a progress bar, AI cost today, user avatar.
- 5 columns left-to-right, equal width, each with a count badge:
  1. Storyboard Drafting (Gemini writing script)
  2. Frames Pending (Nano Banana generating images)
  3. Frames Approved (human approved, ready for video)
  4. Video Rendering (Higgsfield turning frames into video)
  5. Delivered (sent to creator via WhatsApp)
- Each card: creator avatar + handle, product chip, 5 thumbnail strip, hook line, time-in-column, inline button for the next action.
- Drag-and-drop affordance — slight elevation on hover, drop zones between cards.
- Bottom bar shows real-time activity log: "Frame 3 ready for @rphreviews", "Video delivered to @cakedfinds — 0.5s ago".

Style: clean dark theme, cards with subtle gradient backgrounds matched to column color, soft 12px corners. Movement and animation focus — designed so an operator can watch the whole pipeline flow live across 30 briefs at once.`,
  },
};

// --- run -----------------------------------------------------------------
const target = (process.argv[2] || "").toUpperCase();
const targets = target === "ALL" ? ["A", "B", "C"] : [target];
if (!targets.every((t) => PROMPTS[t])) {
  console.error("Usage: node scripts/stitch-generate.mjs <A|B|C|all>");
  process.exit(1);
}

const outDir = path.resolve("docs/stitch-mockups");
fs.mkdirSync(outDir, { recursive: true });

const manifestPath = path.join(outDir, "manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : { runs: [] };

const project = stitch.project(PROJECT);

for (const t of targets) {
  const spec = PROMPTS[t];
  console.log(`\n→ ${t}  ${spec.name}`);
  try {
    const screen = await project.generate(spec.prompt);
    const html = await screen.getHtml();
    const image = await screen.getImage();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const record = {
      direction: t,
      name: spec.name,
      generated_at: new Date().toISOString(),
      html_url: html,
      image_url: image,
      prompt: spec.prompt,
    };
    manifest.runs.push(record);
    fs.writeFileSync(
      path.join(outDir, `${t.toLowerCase()}_${stamp}.json`),
      JSON.stringify(record, null, 2)
    );
    console.log(`  HTML:   ${html}`);
    console.log(`  Image:  ${image}`);
  } catch (err) {
    console.error(`  failed: ${err?.message ?? err}`);
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest: docs/stitch-mockups/manifest.json`);
