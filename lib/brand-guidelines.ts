// Per-brand voice + visual + compliance guidelines fed into every owned-channel
// generation prompt (Instagram, future newsletter, future LinkedIn).
//
// These are deliberately concrete, not vibes — the model gets specific
// constraints it can check itself against ("avoid 'cure' or 'treat'",
// "no fearmongering about aging") rather than abstract adjectives.

export type BrandGuidelines = {
  brand: string;
  tone: string;        // 1-paragraph voice guide
  do: string[];        // concrete dos
  dont: string[];      // concrete don'ts (compliance + sensitivity)
  visual: string;      // 1-paragraph art-direction guide
  palette: string[];   // hex codes for image-prompt anchoring
  standard_hashtags: string[];
};

export const BRAND_GUIDELINES: Record<string, BrandGuidelines> = {
  "Root Labs": {
    brand: "Root Labs",
    tone:
      "Warm, science-grounded, peer-to-peer. Like a knowledgeable friend who reads the studies but talks like a human. Confident without being preachy. Never fearmongering, never shaming, never alarmist. Acknowledge complexity (sleep is multi-causal, hormones are individual) instead of one-size-fits-all promises.",
    do: [
      "Use plain language for science — 'glycinate is gentler on the stomach' beats 'enhanced bioavailability'.",
      "Mention specific ingredients + their evidence ('300mg KSM-66 ashwagandha', 'magnesium glycinate beadlets').",
      "Validate the reader's experience ('peri sleep is its own beast', 'stress shows up in your jaw before your head').",
      "Use second-person ('your', 'you') — feels like a DM, not a press release.",
      "Be specific about formats and rituals (e.g. 'two gummies, 30 min before bed').",
    ],
    dont: [
      "No 'cure', 'treat', 'heal', 'prevent', 'reverse' — supplement compliance (FDA structure-function only).",
      "No before/after weight or skin claims that imply a guaranteed outcome.",
      "No fearmongering about aging, perimenopause, low testosterone, or stress — these are normal human experiences, not crises.",
      "No body-shaming, weight-loss promises, or appearance pressure.",
      "No celebrity name-dropping, no fake 'as seen on'.",
      "No emojis at the start of a hook; max 2 emojis total in the body.",
      "No all-caps hooks. No more than one exclamation mark per caption.",
    ],
    visual:
      "Photoreal, smartphone-aesthetic, premium-feeling but never sterile. Warm natural daylight, real fabric/wood/ceramic/skin textures, shallow depth of field. Product is the hero but framed inside an actual moment (a hand opening the bottle on a counter, gummies arranged next to a coffee mug, the bottle on a nightstand). Avoid: floating-on-gradient ad shots, glossy CGI, fake glass refractions, AI-illustration look. The frame must pass for an actual photo on a real surface.",
    palette: [
      "#1F1A14", // espresso (text / branded dark)
      "#F4EFE6", // off-white linen
      "#C9A66B", // amber gold (accent — the orange-cart energy)
      "#8B9D83", // soft sage (calm wellness pop)
      "#E8DCC8", // warm cream
    ],
    standard_hashtags: [
      "rootlabs",
      "magashwa",
      "ashwagandha",
      "magnesium",
      "supplements",
      "wellness",
    ],
  },

  "Be Bodywise": {
    brand: "Be Bodywise",
    tone:
      "Confident, modern, body-positive. Speaks to adults navigating their own bodies without judgment. Same plain-language science principle as Root Labs but with a slightly younger / more direct edge. Pro-routine, not pro-perfection.",
    do: [
      "Treat hair / skin / intimate health as normal life topics, not embarrassments.",
      "Be explicit about the product's category (hair regrowth, sleep, etc.) instead of euphemisms.",
      "Use 'we' / 'us' for community framing where it fits.",
    ],
    dont: [
      "No 'cure', 'treat', 'heal', 'prevent' for hair or skin conditions.",
      "No comparisons to other people's hairlines / skin / bodies.",
      "No fearmongering about hair loss as identity loss.",
      "No emojis at the start of a hook.",
    ],
    visual:
      "Bright, modern, slightly bolder than Root Labs. Real bathroom counters, gym lockers, morning routines. Warm but with cleaner whites. Subjects of all ages and skin tones.",
    palette: ["#111111", "#FFFFFF", "#F26B5E", "#F3F1EC"],
    standard_hashtags: ["bebodywise", "haircare", "scalpcare", "selfcare"],
  },
};

export function brandGuidelinesFor(brandName: string): BrandGuidelines | null {
  return BRAND_GUIDELINES[brandName] ?? null;
}

// Inline-ready summary used inside Gemini prompts. Compact but specific.
export function renderGuidelinesForPrompt(g: BrandGuidelines): string {
  return [
    `BRAND VOICE — ${g.brand}`,
    g.tone,
    "",
    "DO:",
    ...g.do.map((d) => `  - ${d}`),
    "",
    "DON'T (compliance + sensitivity):",
    ...g.dont.map((d) => `  - ${d}`),
    "",
    `VISUAL DIRECTION: ${g.visual}`,
    `Palette anchors: ${g.palette.join(", ")}`,
  ].join("\n");
}
