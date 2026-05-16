import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const job = await createJob({
    prompt,
    duration_seconds: clampNumber(body.duration_seconds, 1, 30, 5),
    aspect_ratio: ["16:9", "9:16", "1:1"].includes(body.aspect_ratio) ? body.aspect_ratio : "9:16",
    reference_image_url: typeof body.reference_image_url === "string" ? body.reference_image_url : undefined,
  });

  return NextResponse.json(job);
}

function clampNumber(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
