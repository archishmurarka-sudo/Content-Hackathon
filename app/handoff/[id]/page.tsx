// Public creator-facing handoff page. No auth — anyone with the URL sees
// the brief title, an embedded preview, and a download button.
// The URL is sent to the creator via WhatsApp; we keep this view minimal
// so it reads as a deliverable, not a dashboard.

import { notFound } from "next/navigation";
import { getBrief } from "@/lib/briefs";
import { findCreator, findProduct, ensureCreatorsLoaded, ensureProductsLoaded } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Handoff({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await Promise.all([ensureCreatorsLoaded(), ensureProductsLoaded()]);
  const brief = await getBrief(id);
  if (!brief) notFound();

  const creator = findCreator(brief.creator_handle);
  const product = findProduct(brief.product_id);

  const finalUrl = brief.final_video_url || null;
  const downloadHref = finalUrl
    ? `${finalUrl}${finalUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(
        `${brief.creator_handle}-${brief.product_id}-${brief.target_duration_s}s.mp4`
      )}`
    : null;

  const shotsWithVideo = (brief.frames ?? [])
    .filter((f) => f.video_status === "ready" && f.video_url)
    .sort((a, b) => a.shot_idx - b.shot_idx);

  return (
    <div style={{
      maxWidth: 560,
      margin: "0 auto",
      padding: "40px 20px 80px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
    }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: "#7a7a7a",
          fontWeight: 600,
        }}>
          Brief for @{brief.creator_handle}
        </div>
        <h1 style={{ fontSize: 22, lineHeight: 1.25, marginTop: 8, marginBottom: 0, fontWeight: 700 }}>
          {brief.storyboard?.hook ? `"${brief.storyboard.hook}"` : `Your ${product?.name ?? brief.product_id} brief`}
        </h1>
        <p style={{ marginTop: 10, color: "#666", fontSize: 14 }}>
          {product?.name ?? brief.product_id}
          {product?.brand ? ` · ${product.brand}` : ""}
          {brief.target_duration_s ? ` · ${brief.target_duration_s}s` : ""}
          {brief.storyboard?.shots?.length ? ` · ${brief.storyboard.shots.length} shots` : ""}
        </p>
      </div>

      {finalUrl ? (
        <>
          <div style={{
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
            aspectRatio: "9 / 16",
            maxHeight: 720,
            margin: "0 auto",
          }}>
            <video
              src={finalUrl}
              controls
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
            />
          </div>
          {downloadHref && (
            <a
              href={downloadHref}
              download
              style={{
                display: "block",
                marginTop: 20,
                padding: "16px 20px",
                background: "#111",
                color: "white",
                fontSize: 15,
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
                borderRadius: 10,
                letterSpacing: 0.2,
              }}
            >
              Download MP4
            </a>
          )}
        </>
      ) : shotsWithVideo.length > 0 ? (
        <div>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
            The final stitched video isn't ready yet — here are the individual shots in order:
          </p>
          <div style={{ display: "grid", gap: 16 }}>
            {shotsWithVideo.map((f) => (
              <div key={f.shot_idx} style={{ background: "#000", borderRadius: 10, overflow: "hidden" }}>
                <video
                  src={f.video_url!}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", display: "block", background: "#000" }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "24px 20px", background: "#f5f5f5", borderRadius: 10, color: "#666", fontSize: 14 }}>
          The brief is still rendering — check back in a few minutes.
        </div>
      )}

      {brief.storyboard?.rationale && (
        <div style={{ marginTop: 36 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#7a7a7a", fontWeight: 600, marginBottom: 8 }}>
            Why this works for you
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "#333", margin: 0 }}>
            {brief.storyboard.rationale}
          </p>
        </div>
      )}

      <div style={{ marginTop: 48, paddingTop: 20, borderTop: "1px solid #ececec", fontSize: 12, color: "#999" }}>
        Sent by Root Labs · Mosaic Creator Engine
      </div>
    </div>
  );
}
