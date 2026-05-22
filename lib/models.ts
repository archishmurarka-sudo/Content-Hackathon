// Single source of truth for Gemini model selection.
//
// Why this exists: Google retires preview/exp model IDs aggressively. If a stale
// model name lives in Railway env (e.g. someone copy-pasted an old .env.example),
// every Gemini call 404s. This module sanitizes the env value so the app
// auto-corrects to a safe default and surfaces what it's actually using.

const SAFE_TEXT_DEFAULT = "gemini-2.5-flash";
const SAFE_IMAGE_DEFAULT = "gemini-2.5-flash-image";
// Script generator uses Pro by default — voice + restraint matters more for
// DR copy than the cost saving on Flash. Beat decomposition / storyboard
// stages stay on Flash via resolveTextModel().
const SAFE_SCRIPT_DEFAULT = "gemini-2.5-pro";

// Models that are known dead / retired / unsafe to default to. Anything matching
// these patterns falls back to the safe default with a server-log warning.
const DEAD_PATTERNS = [
  /-exp$/i,
  /-experimental$/i,
  /^gemini-2\.0-flash-exp$/i,
  /^gemini-2\.0-flash-preview-/i,
  /^gemini-1\.5-flash-001$/i, // retired
  /^gemini-pro$/i, // retired
];

function sanitize(envValue: string | undefined, safeDefault: string, label: string): string {
  const raw = (envValue ?? "").trim();
  if (!raw) return safeDefault;
  if (DEAD_PATTERNS.some((re) => re.test(raw))) {
    console.warn(
      `[models] ${label} env var is "${raw}" which matches a known-dead pattern; ` +
      `falling back to "${safeDefault}". Update Railway → Variables to use a current model.`
    );
    return safeDefault;
  }
  return raw;
}

export function resolveTextModel(): string {
  return sanitize(process.env.GEMINI_MODEL, SAFE_TEXT_DEFAULT, "GEMINI_MODEL");
}

export function resolveImageModel(): string {
  return sanitize(process.env.GEMINI_IMAGE_MODEL, SAFE_IMAGE_DEFAULT, "GEMINI_IMAGE_MODEL");
}

// Dedicated Gemini model for the Meta Scripts copywriter. Defaults to
// gemini-2.5-pro — overrideable via GEMINI_SCRIPT_MODEL if you want to roll
// back to flash for cost or try a newer ID.
export function resolveScriptModel(): string {
  return sanitize(process.env.GEMINI_SCRIPT_MODEL, SAFE_SCRIPT_DEFAULT, "GEMINI_SCRIPT_MODEL");
}
