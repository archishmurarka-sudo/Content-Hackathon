// Adapted from aself101/kling-api `src/utils/polling.ts` (MIT).
// Stripped of the `ora` CLI spinner — this version is server-only and
// just exposes the polling primitive + small time helpers. The shape of
// `pollUntil` matches the original `pollWithSpinner` so we get the same
// "checkFn + isComplete + timeout" contract any caller of theirs would expect.

export interface PollOptions {
  interval?: number;
  timeout?: number;
  onTick?: (info: { elapsedMs: number; tick: number; latest: unknown }) => void;
}

export async function pollUntil<T>(
  checkFn: () => Promise<T>,
  isComplete: (result: T) => boolean,
  options: PollOptions = {}
): Promise<T> {
  const interval = options.interval ?? 3000;
  const timeout = options.timeout ?? 600_000;
  const start = Date.now();
  let tick = 0;

  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed >= timeout) {
      throw new Error(`Polling timeout after ${Math.round(timeout / 1000)}s`);
    }
    const latest = await checkFn();
    options.onTick?.({ elapsedMs: elapsed, tick: ++tick, latest });
    if (isComplete(latest)) return latest;
    await sleep(interval);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rem}s` : `${seconds}s`;
}
