// Tiny storage abstraction.
// - If R2 env vars are set, uploads to Cloudflare R2 via S3 API (returns public/signed URL).
// - Otherwise writes to /public/frames/<id>.png and returns /frames/<id>.png (local).
//
// Local mode is wiped on every Railway deploy. Use R2 for anything you want to keep.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type PutResult = { url: string; key: string };

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const ACCESS = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE; // optional custom domain like https://assets.example.com

export function hasR2() {
  return Boolean(ACCOUNT && ACCESS && SECRET && BUCKET);
}

async function putR2(key: string, body: Buffer, contentType: string): Promise<PutResult> {
  const host = `${BUCKET}.${ACCOUNT}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${encodeURIComponent(key)}`;
  const sig = await sigv4Put({ host, key, body, contentType });
  const res = await fetch(url, { method: "PUT", headers: sig.headers, body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`R2 put failed ${res.status}: ${t.slice(0, 300)}`);
  }
  const publicUrl = PUBLIC_BASE ? `${PUBLIC_BASE.replace(/\/$/, "")}/${key}` : url;
  return { url: publicUrl, key };
}

function putLocal(key: string, body: Buffer): PutResult {
  const dir = path.join(process.cwd(), "public", "frames");
  fs.mkdirSync(dir, { recursive: true });
  const filename = key.split("/").pop()!;
  fs.writeFileSync(path.join(dir, filename), body);
  return { url: `/frames/${filename}`, key };
}

export async function putAsset(opts: {
  prefix: string;
  ext: string;
  body: Buffer;
  contentType: string;
}): Promise<PutResult> {
  const id = crypto.randomBytes(8).toString("hex");
  const key = `${opts.prefix}/${id}.${opts.ext}`;
  if (hasR2()) return putR2(key, opts.body, opts.contentType);
  return putLocal(key, opts.body);
}

// --- minimal AWS SigV4 signer for R2 PUT (no SDK dependency) ---
async function sigv4Put(opts: { host: string; key: string; body: Buffer; contentType: string }) {
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(opts.body);
  const canonicalUri = "/" + encodeURIComponent(opts.key);
  const canonicalHeaders =
    `content-type:${opts.contentType}\n` +
    `host:${opts.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${SECRET!}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      "Content-Type": opts.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    } as Record<string, string>,
  };
}

function sha256Hex(input: Buffer | string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
