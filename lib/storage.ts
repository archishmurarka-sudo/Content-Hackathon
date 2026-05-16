// Storage abstraction for binary assets (frame images, finished videos).
//
// All assets are addressed by a key like "briefs/<brief_id>/frames/<rand>.png".
// Storage backend:
//   - R2 (Cloudflare) if R2_ENDPOINT (or R2_ACCOUNT_ID) + access keys + bucket are set.
//   - Local public/frames/ otherwise.
//
// Reads + writes both go through this file. URLs returned to the browser ALWAYS
// point at /api/assets/<key> — our own route — so the bucket can stay private
// and local-disk URLs don't break when the bucket is added later. The proxy
// route hands off to readAsset() below.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type PutResult = { url: string; key: string };
export type ReadResult = { body: Buffer; contentType: string };

// ---------- backend detection ----------

function r2Endpoint(): { host: string; pathStyle: boolean } | null {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) return null;
  const explicitEndpoint = process.env.R2_ENDPOINT;
  if (explicitEndpoint) {
    const u = new URL(explicitEndpoint);
    return { host: u.host, pathStyle: true };
  }
  const accountId = process.env.R2_ACCOUNT_ID;
  if (accountId) {
    return { host: `${bucket}.${accountId}.r2.cloudflarestorage.com`, pathStyle: false };
  }
  return null;
}

export function hasR2() {
  return Boolean(
    r2Endpoint() &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

// ---------- write path ----------

export async function putAsset(opts: {
  prefix: string;
  ext: string;
  body: Buffer;
  contentType: string;
}): Promise<PutResult> {
  const id = crypto.randomBytes(8).toString("hex");
  const key = `${opts.prefix}/${id}.${opts.ext}`;
  if (hasR2()) await putR2(key, opts.body, opts.contentType);
  else putLocal(key, opts.body);
  // Browser-facing URL always goes through our proxy route.
  return { url: assetUrl(key), key };
}

function assetUrl(key: string) {
  // each path segment encoded separately so slashes survive
  const safe = key.split("/").map((s) => encodeURIComponent(s)).join("/");
  return `/api/assets/${safe}`;
}

async function putR2(key: string, body: Buffer, contentType: string): Promise<void> {
  const ep = r2Endpoint();
  if (!ep) throw new Error("R2 not configured");
  const bucket = process.env.R2_BUCKET!;
  const requestPath = ep.pathStyle
    ? `/${encodeURIComponent(bucket)}/${encodePath(key)}`
    : `/${encodePath(key)}`;
  const url = `https://${ep.host}${requestPath}`;
  const sig = await sigv4("PUT", { host: ep.host, requestPath, body, contentType });
  const res = await fetch(url, { method: "PUT", headers: sig.headers, body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`R2 put failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

function putLocal(key: string, body: Buffer): void {
  const localPath = localPathForKey(key);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, body);
}

// ---------- read path (used by /api/assets/[...key]) ----------

export async function readAsset(key: string): Promise<ReadResult | null> {
  if (hasR2()) {
    return readR2(key);
  }
  return readLocal(key);
}

async function readR2(key: string): Promise<ReadResult | null> {
  const ep = r2Endpoint();
  if (!ep) return null;
  const bucket = process.env.R2_BUCKET!;
  const requestPath = ep.pathStyle
    ? `/${encodeURIComponent(bucket)}/${encodePath(key)}`
    : `/${encodePath(key)}`;
  const url = `https://${ep.host}${requestPath}`;
  const sig = await sigv4("GET", { host: ep.host, requestPath, body: Buffer.alloc(0), contentType: "" });
  const res = await fetch(url, { method: "GET", headers: sig.headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`R2 get failed ${res.status}: ${t.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return {
    body: Buffer.from(ab),
    contentType: res.headers.get("content-type") ?? guessContentType(key),
  };
}

function readLocal(key: string): ReadResult | null {
  const p = localPathForKey(key);
  if (!fs.existsSync(p)) return null;
  return { body: fs.readFileSync(p), contentType: guessContentType(key) };
}

function localPathForKey(key: string): string {
  // Mirror the R2 layout under public/frames so files round-trip predictably.
  return path.join(process.cwd(), "public", "frames", ...key.split("/"));
}

function guessContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  return "application/octet-stream";
}

function encodePath(key: string) {
  return key.split("/").map((s) => encodeURIComponent(s)).join("/");
}

// ---------- minimal AWS SigV4 signer (PUT + GET) ----------

async function sigv4(
  method: "PUT" | "GET",
  opts: { host: string; requestPath: string; body: Buffer; contentType: string }
) {
  const access = process.env.R2_ACCESS_KEY_ID!;
  const secret = process.env.R2_SECRET_ACCESS_KEY!;
  const region = process.env.R2_REGION ?? "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = method === "PUT" ? sha256Hex(opts.body) : sha256Hex(Buffer.alloc(0));
  const canonicalUri = opts.requestPath;
  const headerLines: string[] = [];
  const signedNames: string[] = [];
  if (method === "PUT") {
    headerLines.push(`content-type:${opts.contentType}`);
    signedNames.push("content-type");
  }
  headerLines.push(`host:${opts.host}`);
  signedNames.push("host");
  headerLines.push(`x-amz-content-sha256:${payloadHash}`);
  signedNames.push("x-amz-content-sha256");
  headerLines.push(`x-amz-date:${amzDate}`);
  signedNames.push("x-amz-date");
  const canonicalHeaders = headerLines.join("\n") + "\n";
  const signedHeaders = signedNames.join(";");

  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  };
  if (method === "PUT") headers["Content-Type"] = opts.contentType;
  return { headers };
}

function sha256Hex(input: Buffer | string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
