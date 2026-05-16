// Mirror a remote image URL into our R2 bucket (or local public/ in dev).
// Returns a `/api/assets/<key>` URL that is stable for the lifetime of the
// asset — important because TikTok CDN URLs are signed and expire in hours.

import { putAsset, type PutResult } from "./storage";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export type FetchedImage = { buf: Buffer; mime: string };

export async function fetchRemoteImage(remoteUrl: string): Promise<FetchedImage | null> {
  if (!remoteUrl || !remoteUrl.startsWith("http")) return null;
  try {
    const res = await fetch(remoteUrl, {
      // TikTok CDN rejects requests without a browser-ish UA + accept header.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
      // Don't hang the scrape if a CDN edge is slow.
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const mime = ALLOWED_MIME.has(ct) ? ct : "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { buf, mime };
  } catch {
    return null;
  }
}

export async function putImageAsset(img: FetchedImage, prefix: string): Promise<PutResult> {
  const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg";
  return await putAsset({ prefix, ext, body: img.buf, contentType: img.mime });
}

export async function mirrorRemoteImage(remoteUrl: string, prefix: string): Promise<PutResult | null> {
  const fetched = await fetchRemoteImage(remoteUrl);
  if (!fetched) return null;
  return await putImageAsset(fetched, prefix);
}
