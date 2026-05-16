// Tiny in-process counter so the dashboard can show how many AI calls
// have been made in this server process. Resets on every redeploy.
// Lets you keep an eye on token spend during trials.

type UsageKind = "storyboard" | "frame_image" | "video_render";

const g = globalThis as unknown as {
  __usage?: Record<UsageKind, number>;
};
const counts: Record<UsageKind, number> = g.__usage ?? {
  storyboard: 0,
  frame_image: 0,
  video_render: 0,
};
g.__usage = counts;

export function bump(kind: UsageKind, n = 1) {
  counts[kind] = (counts[kind] ?? 0) + n;
}

export function getUsage() {
  // Approximate costs per call (USD). Update if pricing changes.
  const unit = {
    storyboard: 0.002, // gemini-2.0-flash text call, ~few k tokens
    frame_image: 0.04, // image-generation model
    video_render: 0.25, // higgsfield video clip (placeholder)
  };
  const cost =
    counts.storyboard * unit.storyboard +
    counts.frame_image * unit.frame_image +
    counts.video_render * unit.video_render;
  return { ...counts, estimated_cost_usd: Number(cost.toFixed(2)) };
}
