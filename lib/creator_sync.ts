// Apify post payload → Creator dossier via Gemini multimodal synthesis.
// Uses the creator's avatar image as visual grounding so persona fields
// (gender presentation, apparent ethnicity, age range, appearance) are
// *observed*, not guessed from text. These attributes are needed downstream
// to keep generated UGC visually consistent with the real creator.

import type { Creator, CreatorRecentVideo } from "./data";
import type { ApifyTikTokPost } from "./apify";
import { bump } from "./usage";
import { fetchRemoteImage, putImageAsset, mirrorRemoteImage } from "./media_mirror";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function synthesizeCreatorFromPosts(posts: ApifyTikTokPost[]): Promise<Creator> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const author = posts[0]?.authorMeta ?? {};
  const handle = String(author.name ?? author.nickName ?? "").replace(/^@/, "");
  if (!handle) throw new Error("Apify result has no author handle");

  // Fetch avatar bytes ONCE — reused for R2 mirror + Gemini multimodal input.
  const avatarFetch = author.avatar ? await fetchRemoteImage(author.avatar) : null;
  const avatarMirror = avatarFetch
    ? await putImageAsset(avatarFetch, `creators/${handle}/avatar`)
    : null;

  const postSummary = posts
    .slice(0, 10)
    .map(
      (p, i) =>
        `POST ${i + 1}: "${(p.text ?? "").slice(0, 200)}" | likes=${p.diggCount ?? "?"} plays=${p.playCount ?? "?"} comments=${p.commentCount ?? "?"} | hashtags=${(p.hashtags ?? []).map((h) => h.name).filter(Boolean).slice(0, 6).join(", ")}`
    )
    .join("\n");

  const prompt = `You are profiling a TikTok creator for a wellness brand's UGC roster. The brand needs an accurate creative profile so AI-generated videos featuring this creator stay visually and tonally consistent with their real public presence.

CREATOR
Handle: @${handle}
Bio: ${author.signature ?? "(none)"}
Followers: ${author.fans ?? "?"}

RECENT POSTS
${postSummary}

${avatarFetch ? "The creator's public profile avatar is attached below. Use it to ground the persona fields." : "No avatar image available — infer persona fields from text only and flag uncertainty in the 'apparent_ethnicity' / 'gender_presentation' fields as 'unclear' where appropriate."}

Output a single raw JSON object — no markdown, no commentary — with EXACTLY these keys:

{
  "archetype": "one of: pharmacist | health_educator | wellness_influencer | deal_hunter | product_reviewer | beauty_guru | esthetician | grooming_influencer | other",
  "top_pain": "the primary health/beauty pain they speak to (e.g. 'sleep', 'stress_cortisol', 'energy', 'hair_thinning', 'skin')",
  "energy_rating": <integer 1-10, how high-energy their on-camera delivery reads>,
  "gender_presentation": "one of: male | female | non_binary | unclear",
  "apparent_ethnicity": "one of: white | black | east_asian | south_asian | hispanic_latino | middle_eastern | mixed | unclear",
  "apparent_age_range": "20s | 30s | 40s | 50s+ — pick the closest band",
  "speech_style": "ONE sentence describing cadence, tone, vocabulary (e.g. 'Calm clinical cadence, plain-language explainers, occasional dry humour')",
  "appearance_description": "TWO sentences describing visual identity for image-generation consistency — build, hair, on-camera dress style, any distinctive features. Concrete and concise.",
  "dossier_excerpt": "2-3 sentences on voice, format, hook style, and what converts for them."
}

Rules:
- Persona fields describe OBSERVED public-profile attributes for the purpose of generating videos that *look like them*. Do not editorialize or speculate beyond what is visible.
- If you cannot confidently determine a persona field from the inputs, set it to "unclear".
- Do not include any field other than the 10 listed above.`;

  const parts: any[] = [{ text: prompt }];
  if (avatarFetch) {
    parts.push({
      inlineData: { data: avatarFetch.buf.toString("base64"), mimeType: avatarFetch.mime },
    });
  }

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
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

  // Mirror video covers in parallel — runs while we're returning the row.
  const recentSlice = posts.slice(0, 6);
  const mirroredCovers = await Promise.all(
    recentSlice.map((post) => {
      const url = post.videoMeta?.coverUrl || post.videoMeta?.originalCoverUrl;
      return url ? mirrorRemoteImage(url, `creators/${handle}/covers`) : Promise.resolve(null);
    })
  );
  const recent_videos: CreatorRecentVideo[] = recentSlice.map((post, i) => ({
    web_video_url: post.webVideoUrl ?? null,
    cover_url: mirroredCovers[i]?.url ?? null,
    duration_s: post.videoMeta?.duration ?? null,
    like_count: post.diggCount ?? null,
    play_count: post.playCount ?? null,
    caption: (post.text ?? "").slice(0, 240) || null,
  }));

  const allowedGender = new Set(["male", "female", "non_binary", "unclear"]);
  const allowedEthnicity = new Set([
    "white",
    "black",
    "east_asian",
    "south_asian",
    "hispanic_latino",
    "middle_eastern",
    "mixed",
    "unclear",
  ]);

  return {
    handle,
    archetype: String(p.archetype ?? "other"),
    kalo_gmv: null,
    winners: 0,
    top_pain: String(p.top_pain ?? "unknown"),
    energy_rating: Number.isFinite(Number(p.energy_rating)) ? Number(p.energy_rating) : null,
    dossier_excerpt: String(p.dossier_excerpt ?? ""),
    has_dossier: true,
    avatar_url: avatarMirror?.url ?? null,
    bio: author.signature ?? null,
    followers: author.fans ?? null,
    source: "tiktok_scrape",
    recent_videos,
    persona: {
      gender_presentation: allowedGender.has(p.gender_presentation) ? p.gender_presentation : "unclear",
      apparent_ethnicity: allowedEthnicity.has(p.apparent_ethnicity) ? p.apparent_ethnicity : "unclear",
      apparent_age_range: String(p.apparent_age_range ?? "unclear"),
      speech_style: String(p.speech_style ?? ""),
      appearance_description: String(p.appearance_description ?? ""),
    },
  };
}
