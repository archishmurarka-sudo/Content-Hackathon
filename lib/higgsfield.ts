const BASE = process.env.HIGGSFIELD_API_BASE ?? "https://api.higgsfield.ai";
const KEY = process.env.HIGGSFIELD_API_KEY;
const MODEL = process.env.HIGGSFIELD_VIDEO_MODEL ?? "dop";

export type HiggsfieldJobInput = {
  prompt: string;
  duration_seconds?: number;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  reference_image_url?: string;
};

export type HiggsfieldRemoteJob = {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | string;
  asset_url?: string;
  error?: string;
};

function headers() {
  if (!KEY) throw new Error("HIGGSFIELD_API_KEY is not set");
  return {
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
}

// NOTE: the exact path + payload shape depends on the Higgsfield account/plan.
// Replace `/v1/video/generations` and the body keys with the values from the
// Higgsfield docs you have access to. Everything else in this app stays the same.
export async function submitVideoJob(input: HiggsfieldJobInput): Promise<HiggsfieldRemoteJob> {
  const res = await fetch(`${BASE}/v1/video/generations`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: MODEL,
      prompt: input.prompt,
      duration: input.duration_seconds ?? 5,
      aspect_ratio: input.aspect_ratio ?? "9:16",
      reference_image_url: input.reference_image_url,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield submit failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return normalize(data);
}

export async function fetchJob(remoteId: string): Promise<HiggsfieldRemoteJob> {
  const res = await fetch(`${BASE}/v1/video/generations/${remoteId}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield fetch failed: ${res.status} ${text}`);
  }
  return normalize(await res.json());
}

function normalize(data: any): HiggsfieldRemoteJob {
  return {
    id: data.id ?? data.job_id,
    status: data.status ?? "queued",
    asset_url: data.asset_url ?? data.output?.video_url ?? data.video_url,
    error: data.error?.message ?? data.error,
  };
}
