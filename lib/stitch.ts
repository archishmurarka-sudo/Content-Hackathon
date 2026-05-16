// Final-video stitcher. Concats per-shot mp4 clips and burns the storyboard's
// text overlay onto each segment via ffmpeg-static. No system ffmpeg required.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { putAsset, readAsset, type PutResult } from "./storage";

const FFMPEG = ffmpegStatic as string | null;

export type StitchClip = {
  shot_idx: number;
  video_url: string;   // /api/assets/... or absolute https
  overlay?: string;    // text to burn at top of the clip
};

export async function stitchFinalVideo(opts: {
  brief_id: string;
  clips: StitchClip[];
}): Promise<PutResult & { duration_s_estimate: number }> {
  if (!FFMPEG) throw new Error("ffmpeg-static binary missing");
  if (opts.clips.length === 0) throw new Error("no clips to stitch");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `stitch-${opts.brief_id}-`));
  try {
    // 1) Download + drawtext each clip → seg_N.mp4 (re-encoded for cleanliness).
    const segments: string[] = [];
    for (const c of opts.clips.sort((a, b) => a.shot_idx - b.shot_idx)) {
      const raw = await fetchVideoBuffer(c.video_url);
      const rawPath = path.join(tmpDir, `raw_${c.shot_idx}.mp4`);
      fs.writeFileSync(rawPath, raw);
      const segPath = path.join(tmpDir, `seg_${c.shot_idx}.mp4`);
      const overlay = (c.overlay ?? "").trim().slice(0, 100);
      const vfilter = overlay
        ? `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,` +
          `drawtext=text='${escapeDrawtext(overlay)}':fontcolor=white:fontsize=44:` +
          `box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=80:line_spacing=8`
        : `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280`;
      await runFfmpeg([
        "-y",
        "-i", rawPath,
        "-vf", vfilter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-an", // we don't preserve audio for now — fal clips are usually silent
        segPath,
      ]);
      segments.push(segPath);
    }

    // 2) Concat with the concat demuxer.
    const listPath = path.join(tmpDir, "list.txt");
    fs.writeFileSync(listPath, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
    const outPath = path.join(tmpDir, "final.mp4");
    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-movflags", "+faststart",
      outPath,
    ]);

    const buf = fs.readFileSync(outPath);
    const stored = await putAsset({
      prefix: `briefs/${opts.brief_id}/final`,
      ext: "mp4",
      body: buf,
      contentType: "video/mp4",
    });

    // Quick duration estimate from ffprobe-less heuristic (sum of metadata via ffmpeg -i would need parsing).
    // We'll let the frontend just trust the stored URL; duration is recoverable client-side from <video>.
    return { ...stored, duration_s_estimate: 0 };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ---------- helpers ----------

async function fetchVideoBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("/api/assets/")) {
    const key = url.replace(/^\/api\/assets\//, "").split("/").map(decodeURIComponent).join("/");
    const r = await readAsset(key);
    if (!r) throw new Error(`local clip not found: ${key}`);
    return r.body;
  }
  const abs = /^https?:\/\//.test(url) ? url : `${publicBase()}${url.startsWith("/") ? "" : "/"}${url}`;
  const res = await fetch(abs);
  if (!res.ok) throw new Error(`clip fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function publicBase(): string {
  const b = process.env.PUBLIC_BASE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN ?? "";
  if (!b) return "";
  return b.startsWith("http") ? b : `https://${b}`;
}

function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}
