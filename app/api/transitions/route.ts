// Computes shot-to-shot transition prompts for an existing brief whose
// frame images have already been generated. Wires up `lib/transitions.ts`
// (port of StoryGen-Atelier's `analyzeShotTransition`).

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getBrief } from "@/lib/briefs";
import { analyzeShotTransition, type TransitionInput } from "@/lib/transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const brief_id = String(body.brief_id ?? "").trim();
  if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

  const brief = await getBrief(brief_id);
  if (!brief?.storyboard) return NextResponse.json({ error: "brief or storyboard not found" }, { status: 404 });
  const frames = brief.frames ?? [];
  if (frames.length < 2) return NextResponse.json({ error: "need at least 2 ready frames" }, { status: 400 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  const shots = brief.storyboard.shots;
  const inputs: TransitionInput[] = frames
    .filter((f) => f.image_url)
    .sort((a, b) => a.shot_idx - b.shot_idx)
    .map((f) => ({
      imageUrl: f.image_url as string,
      story: shots[f.shot_idx]?.visual ?? "",
    }));

  if (inputs.length < 2) return NextResponse.json({ error: "need at least 2 frames with image_url" }, { status: 400 });

  const transitions: Array<{ from: number; to: number; transition_prompt: string; duration_s: number }> = [];
  for (let i = 0; i < inputs.length - 1; i++) {
    try {
      const t = await analyzeShotTransition(inputs[i], inputs[i + 1]);
      transitions.push({ from: i, to: i + 1, ...t });
    } catch (err: any) {
      transitions.push({
        from: i,
        to: i + 1,
        transition_prompt: `(failed: ${err?.message ?? "unknown"})`,
        duration_s: 6,
      });
    }
  }

  return NextResponse.json({ brief_id, transitions });
}
