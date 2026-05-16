import { fetchJob, submitVideoJob, type HiggsfieldJobInput } from "./higgsfield";

export type JobStatus = "pending" | "processing" | "succeeded" | "failed";

export type Job = {
  id: string;
  remote_id?: string;
  prompt: string;
  params: HiggsfieldJobInput;
  status: JobStatus;
  asset_url?: string;
  error?: string;
  created_at: number;
  updated_at: number;
};

// Survives hot-reload in dev by stashing on globalThis.
const g = globalThis as unknown as { __jobs?: Map<string, Job>; __pollerStarted?: boolean };
const store: Map<string, Job> = g.__jobs ?? new Map();
g.__jobs = store;

function uid() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createJob(input: HiggsfieldJobInput): Promise<Job> {
  const job: Job = {
    id: uid(),
    prompt: input.prompt,
    params: input,
    status: "pending",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  store.set(job.id, job);
  try {
    const remote = await submitVideoJob(input);
    job.remote_id = remote.id;
    job.status = mapStatus(remote.status);
    job.asset_url = remote.asset_url;
    job.error = remote.error;
    job.updated_at = Date.now();
  } catch (err: any) {
    job.status = "failed";
    job.error = err?.message ?? "submit failed";
    job.updated_at = Date.now();
  }
  store.set(job.id, job);
  ensurePoller();
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function listJobs(): Job[] {
  return Array.from(store.values()).sort((a, b) => b.created_at - a.created_at);
}

function mapStatus(s: string): JobStatus {
  if (s === "succeeded" || s === "completed" || s === "done") return "succeeded";
  if (s === "failed" || s === "error" || s === "canceled") return "failed";
  if (s === "processing" || s === "running") return "processing";
  return "pending";
}

async function pollOnce() {
  const inflight = listJobs().filter((j) => j.remote_id && (j.status === "pending" || j.status === "processing"));
  await Promise.all(
    inflight.map(async (job) => {
      try {
        const remote = await fetchJob(job.remote_id!);
        job.status = mapStatus(remote.status);
        if (remote.asset_url) job.asset_url = remote.asset_url;
        if (remote.error) job.error = remote.error;
        job.updated_at = Date.now();
        store.set(job.id, job);
      } catch (err: any) {
        // soft-fail; will retry next tick
        job.error = err?.message ?? "poll failed";
        job.updated_at = Date.now();
      }
    })
  );
}

function ensurePoller() {
  if (g.__pollerStarted) return;
  g.__pollerStarted = true;
  setInterval(() => {
    pollOnce().catch(() => {});
  }, 5000);
}
