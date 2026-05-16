// Public creator-facing handoff page. No auth — anyone with the URL sees
// the brief title, an embedded preview, and a download button.
// The URL is sent to the creator via WhatsApp.

import { notFound } from "next/navigation";
import { getBrief } from "@/lib/briefs";
import { findCreator, findProduct, ensureCreatorsLoaded, ensureProductsLoaded } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function funnelLabel(cta: string): string {
  const c = cta.toLowerCase();
  if (/(\bbuy\b|cart|deal|sale|today|tonight)/.test(c)) return "Bottom-of-funnel";
  if (/(link in bio|see why|learn|why i)/.test(c)) return "Middle-of-funnel";
  return "Top-of-funnel";
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const PALETTE = {
  text: "#1a1a1a",
  muted: "#6a6a6a",
  faint: "#9a9a9a",
  border: "#ececec",
  card: "#fafafa",
  accent: "#1f6dd0",
};

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

  const shots = brief.storyboard?.shots ?? [];
  const framesByIdx: Record<number, NonNullable<typeof brief.frames>[number]> = {};
  (brief.frames ?? []).forEach((f) => (framesByIdx[f.shot_idx] = f));

  const shotsWithVideo = (brief.frames ?? [])
    .filter((f) => f.video_status === "ready" && f.video_url)
    .sort((a, b) => a.shot_idx - b.shot_idx);

  const funnel = brief.storyboard?.cta ? funnelLabel(brief.storyboard.cta) : null;

  return (
    <div style={{
      maxWidth: 680,
      margin: "0 auto",
      padding: "32px 20px 80px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: PALETTE.text,
    }}>
      {/* Personalized header — creator DP + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        {creator?.avatar_url ? (
          <img
            src={creator.avatar_url}
            alt=""
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              border: `1px solid ${PALETTE.border}`,
            }}
          />
        ) : (
          <div style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#e8e8e8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            color: "#999",
            flexShrink: 0,
          }}>
            {brief.creator_handle.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: PALETTE.faint,
            fontWeight: 600,
          }}>
            Brief for
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>@{brief.creator_handle}</div>
          {creator?.archetype && (
            <div style={{ fontSize: 12, color: PALETTE.muted, marginTop: 2 }}>
              {creator.archetype}
              {creator.followers != null && ` · ${formatCount(creator.followers)} followers`}
              {creator.energy_rating != null && ` · energy ${creator.energy_rating}/10`}
            </div>
          )}
        </div>
      </div>

      {/* Brief title — hook in quotes */}
      <h1 style={{ fontSize: 24, lineHeight: 1.25, marginTop: 0, marginBottom: 8, fontWeight: 700 }}>
        {brief.storyboard?.hook ? `"${brief.storyboard.hook}"` : `Your ${product?.name ?? brief.product_id} brief`}
      </h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, marginBottom: 24 }}>
        {product?.name && <Pill>{product.name}</Pill>}
        {product?.brand && <Pill>{product.brand}</Pill>}
        {brief.target_duration_s && <Pill>{brief.target_duration_s}s</Pill>}
        {shots.length > 0 && <Pill>{shots.length} shots</Pill>}
        {funnel && <Pill highlight>{funnel}</Pill>}
      </div>

      {/* Video / preview block */}
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
                marginTop: 16,
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
          <p style={{ color: PALETTE.muted, fontSize: 13, marginBottom: 12 }}>
            Stitched cut not ready yet — individual shots in order:
          </p>
          <div style={{ display: "grid", gap: 12 }}>
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
        <div style={{ padding: "20px 20px", background: PALETTE.card, borderRadius: 10, color: PALETTE.muted, fontSize: 14 }}>
          Video render still in progress — refresh in a few minutes. Frames are below.
        </div>
      )}

      {/* Product info card */}
      {product && (
        <Section eyebrow="Product">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {product.hero_image_url && (
              <img
                src={product.hero_image_url}
                alt=""
                style={{
                  width: 80,
                  height: 80,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: `1px solid ${PALETTE.border}`,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {product.name}
                {product.brand && <span style={{ color: PALETTE.muted, fontWeight: 400 }}> · {product.brand}</span>}
              </div>
              {product.one_liner && (
                <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: PALETTE.muted, lineHeight: 1.5 }}>
                  {product.one_liner}
                </p>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Creator profile card */}
      {creator && (
        <Section eyebrow="Creator profile">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {creator.avatar_url && (
              <img
                src={creator.avatar_url}
                alt=""
                style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: `1px solid ${PALETTE.border}` }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>@{creator.handle}</div>
              {creator.bio && (
                <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: PALETTE.muted, fontStyle: "italic" }}>
                  {creator.bio}
                </p>
              )}
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: PALETTE.text }}>
                <strong>Top pain:</strong> <span style={{ color: PALETTE.muted }}>{creator.top_pain}</span>
              </p>
            </div>
          </div>
          {creator.persona && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
              {creator.persona.gender_presentation && creator.persona.gender_presentation !== "unclear" && (
                <Chip label="Gender">{creator.persona.gender_presentation}</Chip>
              )}
              {creator.persona.apparent_ethnicity && creator.persona.apparent_ethnicity !== "unclear" && (
                <Chip label="Ethnicity">{creator.persona.apparent_ethnicity.replace(/_/g, " ")}</Chip>
              )}
              {creator.persona.apparent_age_range && creator.persona.apparent_age_range !== "unclear" && (
                <Chip label="Age">{creator.persona.apparent_age_range}</Chip>
              )}
            </div>
          )}
          {creator.persona?.speech_style && (
            <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: PALETTE.text }}>
              <strong>Speech style:</strong> <span style={{ color: PALETTE.muted }}>{creator.persona.speech_style}</span>
            </p>
          )}
          {creator.persona?.appearance_description && (
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: PALETTE.text }}>
              <strong>Appearance:</strong> <span style={{ color: PALETTE.muted }}>{creator.persona.appearance_description}</span>
            </p>
          )}
          {creator.dossier_excerpt && (
            <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: PALETTE.muted, lineHeight: 1.55 }}>
              {creator.dossier_excerpt}
            </p>
          )}
          {creator.recent_videos && creator.recent_videos.some((v) => v.cover_url) && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: PALETTE.faint, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Recent posts
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                {creator.recent_videos.slice(0, 6).map((v, i) => v.cover_url && (
                  <a
                    key={i}
                    href={v.web_video_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    title={v.caption ?? ""}
                    style={{ display: "block", flexShrink: 0, width: 70 }}
                  >
                    <img
                      src={v.cover_url}
                      alt=""
                      style={{ width: 70, height: 94, objectFit: "cover", borderRadius: 6, border: `1px solid ${PALETTE.border}` }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Storyboard — shot-by-shot breakdown */}
      {shots.length > 0 && (
        <Section eyebrow="Shot list">
          <div style={{ display: "grid", gap: 14 }}>
            {shots.map((shot) => {
              const frame = framesByIdx[shot.idx];
              return (
                <div
                  key={shot.idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "84px 1fr",
                    gap: 12,
                    padding: 12,
                    background: PALETTE.card,
                    border: `1px solid ${PALETTE.border}`,
                    borderRadius: 10,
                  }}
                >
                  <div style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "9 / 16", background: "#000" }}>
                    {frame?.image_url ? (
                      <img
                        src={frame.image_url}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 11 }}>
                        Shot {shot.idx + 1}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.muted }}>
                        Shot {shot.idx + 1} · {shot.duration_s}s
                      </div>
                      {shot.speech_tone && (
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: PALETTE.faint, fontWeight: 600 }}>
                          {shot.speech_tone}
                        </div>
                      )}
                    </div>
                    {shot.speech && (
                      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, lineHeight: 1.5, color: PALETTE.text }}>
                        {shot.speech}
                      </p>
                    )}
                    {shot.overlay && (
                      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: PALETTE.muted }}>
                        <strong>Overlay:</strong> {shot.overlay}
                      </p>
                    )}
                    {shot.product_action && shot.product_action !== "none" && (
                      <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: PALETTE.muted }}>
                        <strong>Action:</strong> {shot.product_action.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* CTA box */}
      {brief.storyboard?.cta && (
        <Section eyebrow="Closing line">
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, fontStyle: "italic" }}>
            "{brief.storyboard.cta}"
          </p>
        </Section>
      )}

      {/* Rationale */}
      {brief.storyboard?.rationale && (
        <Section eyebrow="Why this works for you">
          <p style={{ fontSize: 13, lineHeight: 1.6, color: PALETTE.muted, margin: 0 }}>
            {brief.storyboard.rationale}
          </p>
        </Section>
      )}

      <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${PALETTE.border}`, fontSize: 11, color: PALETTE.faint, textAlign: "center" }}>
        Sent by Root Labs · Mosaic Creator Engine
      </div>
    </div>
  );
}

function Section({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        color: PALETTE.faint,
        fontWeight: 600,
        marginBottom: 10,
      }}>
        {eyebrow}
      </div>
      {children}
    </div>
  );
}

function Pill({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <span style={{
      padding: "4px 10px",
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 999,
      border: `1px solid ${highlight ? "#111" : PALETTE.border}`,
      color: highlight ? "white" : PALETTE.muted,
      background: highlight ? "#111" : "white",
      letterSpacing: 0.3,
    }}>
      {children}
    </span>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{
      padding: "4px 10px",
      fontSize: 11,
      border: `1px solid ${PALETTE.border}`,
      borderRadius: 999,
      background: "white",
      color: PALETTE.text,
    }}>
      <span style={{ color: PALETTE.faint, marginRight: 4 }}>{label}:</span>
      <strong>{children}</strong>
    </span>
  );
}
