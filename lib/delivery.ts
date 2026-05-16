// WhatsApp delivery via Periskope (https://periskope.app).
//
// Periskope exposes a REST API that mirrors WhatsApp Cloud-style sends.
// Set PERISKOPE_API_KEY and PERISKOPE_PHONE (your sending number, with
// country code, no '+').
//
// SAFETY: when PERISKOPE_TEST_MODE=true, sends are restricted to numbers
// in PERISKOPE_ALLOWLIST (comma-separated, normalized, no '+'). Any other
// recipient throws before a Periskope API call is made — this protects
// against accidental messages while we're testing on a real WhatsApp
// number. Remove TEST_MODE in production after the flow is verified.
//
// We send the final assembled clip if available; otherwise we send one message
// per shot clip in order. The dashboard URL is included so the creator can
// open the full brief.

import fs from "node:fs";
import path from "node:path";

const PERISKOPE_BASE = process.env.PERISKOPE_API_BASE || "https://api.periskope.app/v1";

function isTestMode(): boolean {
  const v = (process.env.PERISKOPE_TEST_MODE ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function allowlist(): Set<string> {
  return new Set(
    (process.env.PERISKOPE_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().replace(/[^0-9]/g, ""))
      .filter(Boolean)
  );
}

export function assertRecipientAllowed(to: string): void {
  if (!isTestMode()) return;
  const norm = to.replace(/[^0-9]/g, "");
  const allow = allowlist();
  if (allow.size === 0) {
    throw new Error("PERISKOPE_TEST_MODE is on but PERISKOPE_ALLOWLIST is empty — refusing to send.");
  }
  if (!allow.has(norm)) {
    throw new Error(
      `PERISKOPE_TEST_MODE blocked send to ${norm}. Only ${[...allow].join(", ")} is allowed during testing.`
    );
  }
}

export type SendInput = {
  to: string;                  // E.164 number, e.g. "919999999999" (no +)
  media_urls: string[];        // public-reachable URLs (R2 or our /api/assets proxy)
  caption: string;             // message body
};

export type SendResult = {
  message_id: string;
  to: string;
};

export async function sendWhatsAppVideos(input: SendInput): Promise<SendResult> {
  const key = process.env.PERISKOPE_API_KEY;
  const from = process.env.PERISKOPE_PHONE;
  if (!key) throw new Error("PERISKOPE_API_KEY not set");
  if (!from) throw new Error("PERISKOPE_PHONE not set");
  if (!input.media_urls.length) throw new Error("no media to send");
  const to = normalizePhone(input.to);
  // Hard gate — refuse non-allowlisted recipients when TEST_MODE is on.
  assertRecipientAllowed(to);

  // Send caption + first video as the main message; trail with the rest.
  const first = input.media_urls[0];
  const main = await postMessage({
    key,
    from,
    to,
    type: "video",
    body: {
      to,
      phone: from,
      type: "video",
      video: { link: first, caption: input.caption },
    },
  });
  for (const url of input.media_urls.slice(1)) {
    await postMessage({
      key,
      from,
      to,
      type: "video",
      body: { to, phone: from, type: "video", video: { link: url } },
    });
  }
  return { message_id: main.message_id, to };
}

async function postMessage(opts: { key: string; from: string; to: string; type: string; body: any }): Promise<{ message_id: string }> {
  const url = `${PERISKOPE_BASE}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Periskope ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json().catch(() => ({}));
  const id = data?.message_id ?? data?.id ?? data?.messages?.[0]?.id ?? `periskope_${Date.now()}`;
  return { message_id: String(id) };
}

function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

// ---- creator contact directory ----
//
// We keep phone numbers (and any other contact details) in a small JSON file
// outside of the public creator dataset because they're PII. The file is
// optional — if it's not present we just return undefined and the UI prompts
// the user for the number at send time.

type ContactBook = Record<string, { phone?: string; name?: string }>;

const g = globalThis as unknown as { __contactBook?: ContactBook };

function loadBook(): ContactBook {
  if (g.__contactBook) return g.__contactBook;
  try {
    const p = path.join(process.cwd(), "data", "creator_contacts.json");
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as ContactBook;
      g.__contactBook = parsed;
      return parsed;
    }
  } catch {
    // ignore — fall through to empty
  }
  g.__contactBook = {};
  return g.__contactBook;
}

export function getCreatorPhone(handle: string): string | undefined {
  const book = loadBook();
  const key = handle.replace(/^@/, "").toLowerCase();
  return book[key]?.phone;
}

export function setCreatorPhone(handle: string, phone: string): void {
  const book = loadBook();
  const key = handle.replace(/^@/, "").toLowerCase();
  book[key] = { ...(book[key] ?? {}), phone: normalizePhone(phone) };
  try {
    const p = path.join(process.cwd(), "data", "creator_contacts.json");
    fs.writeFileSync(p, JSON.stringify(book, null, 2));
  } catch {
    // best-effort; in serverless this may be ephemeral but in-memory still works
    // for the life of the process
  }
}
