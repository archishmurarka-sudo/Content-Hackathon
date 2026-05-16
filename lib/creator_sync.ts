// Apify post payload → Creator dossier via Gemini synthesis.
// Output shape matches our existing creators.json entries so the new
// creator is immediately usable in the brief flow.

import type { Creator } from "./data";
import type { ApifyTikTokPost } from "./apify";
import { bump } from "./usage";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function synthesizeCreatorFromPosts(posts: ApifyTikTokPost[]): Promise<Creator> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const author = posts[0]?.authorMeta ?? {};
  const handle = String(author.name ?? author.nickName ?? "").replace(/^@/, "");
  if (!handle) throw new Error("Apify result has no author handle");

  const postSummary = posts
    .slice(0, 10)
    .map(
      (p, i) =>
        `POST ${i + 1}: "${(p.text ?? "").slice(0, 200)}" | likes=${p.diggCount ?? "?"} plays=${p.playCount ?? "?"} comments=${p.commentCount ?? "?"} | hashtags=${(p.hashtags ?? []).map((h) => h.name).filter(Boolean).slice(0, 6).join(", ")}`
    )
    .join("\n");

  const prompt = `You are profiling a TikTok creator for a wellness brand's UGC roster. Classify them from their recent posts.

CREATOR
Handle: @${handle}
Bio: ${author.signature ?? "(none)"}
Followers: ${author.fans ?? "?"}

RECENT POSTS
${postSummary}

OUTPUT — pure JSON object, no markdown, no commentary:
{
  "archetype": "one of: pharmacist | health_educator | wellness_influencer | deal_hunter | product_reviewer | beauty_guru | esthetician | grooming_influencer | other",
  "top_pain": "the primary health/beauty pain they speak to (e.g. 'sleep', 'stress_cortisol', 'energy', 'hair_thinning', 'skin')",
  "energy_rating": <integer 1-10, how high-energy their on-camera delivery reads>,
  "dossier_excerpt": "2-3 sentences on their voice, format, hook style, and what makes them convert."
}`;

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini synthesis ${res.status}: ${t.slice(0, 300)}`);
  }
  bump("storyboard");
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const p = JSON.parse(cleaned);

  return {
    handle,
    archetype: String(p.archetype ?? "other"),
    kalo_gmv: null,
    winners: 0,
    top_pain: String(p.top_pain ?? "unknown"),
    energy_rating: Number.isFinite(Number(p.energy_rating)) ? Number(p.energy_rating) : null,
    dossier_excerpt: String(p.dossier_excerpt ?? ""),
    has_dossier: true,
  };
}
