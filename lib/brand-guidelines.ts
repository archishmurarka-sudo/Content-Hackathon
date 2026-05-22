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
    // Voice extracted from rootlabs.co — warm + accessible + science-confident
    // without clinical jargon. Heritage-driven ("handpicked in nature,
    // perfected in science"), bridges traditional herbal wisdom with modern
    // bioavailability science. "Made for the American customer." Aspirational
    // yet grounded; speaks to performance-oriented adults (creators,
    // professionals, athletes) who want real benefits without crashes.
    tone:
      "Warm, accessible, science-confident — not clinical. 'Handpicked in nature, perfected in science.' Bridges traditional herbal wisdom (ashwagandha, shilajit, sea moss, turmeric) with modern bioavailability science. Speaks to performance-oriented Americans — creators, business owners, trainers — who want sustained energy and real wellness without crashes or compromise on taste. Confident but conversational; the friend who reads the studies but talks like a human.",
    do: [
      // From rootlabs.co recurring vocabulary
      "Use the brand's own words: 'bioavailability', 'handpicked', 'perfected', 'roots', 'science-backed', 'maximum absorption', 'carefully crafted', 'real benefits', 'no crashes'.",
      "Anchor on heritage + science together — single-ingredient stories that explain WHY the form factor matters ('beadlet delivery protects magnesium through digestion').",
      "Mention specific ingredients + dosage + form factor ('4000mg shilajit gold, 75% fulvic acid', 'KSM-66 ashwagandha', 'magnesium glycinate beadlets').",
      "Validate the reader's experience without alarmism ('peri sleep is its own beast', 'energy that doesn't crash at 3pm').",
      "Use second-person ('your', 'you') — feels like a DM, not a press release.",
      "Be specific about formats and rituals ('two gummies, 30 min before bed').",
      "Per Root Labs site language: prefer 'supports' / 'helps' / 'benefits' over medical claims.",
    ],
    dont: [
      // Compliance — supplement structure-function only
      "No 'cure', 'treat', 'heal', 'prevent', 'reverse' — supplement compliance (FDA structure-function only).",
      "No 'as seen on' / fake credentials / celebrity name-drops.",
      "No before/after weight or skin claims that imply a guaranteed outcome.",
      // Sensitivity — these are normal life stages, not crises
      "No fearmongering about aging, perimenopause, menopause, low testosterone, stress, or hair loss — these are normal human experiences.",
      "No body-shaming, weight-loss promises, or appearance pressure.",
      // Voice
      "No clinical jargon dump — translate science into plain language (rootlabs.co never reads like a label).",
      "No emojis at the start of a hook; max 2 emojis total in the body.",
      "No all-caps hooks. No more than one exclamation mark per caption.",
      "Do NOT invent a 'natural cure' for anything; rootlabs.co is supplements + rituals, not medicine.",
    ],
    // Visual scraped from rootlabs.co + product photography style
    visual:
      "Clean, modern product photography on neutral / earthy backgrounds. Photoreal smartphone-aesthetic, premium-feeling but never sterile. Warm natural daylight, real fabric/wood/ceramic/skin textures, shallow depth of field. Product is the hero but framed inside an actual moment — a hand opening the jar, gummies arranged next to a coffee mug, the bottle on a nightstand at golden hour. Botanical / ingredient imagery (raw ashwagandha root, shilajit resin, sea moss) makes a good supporting layer. Avoid: floating-on-gradient ad shots, glossy CGI, fake glass refractions, AI-illustration look. The frame must pass for an actual editorial product photo on a real surface.",
    palette: [
      "#1F1A14", // espresso (text / branded dark — Root Labs neutral)
      "#F4EFE6", // off-white linen background
      "#C9A66B", // amber gold (TikTok Shop orange-cart energy)
      "#8B9D83", // soft sage (botanical / wellness)
      "#E8DCC8", // warm cream
      "#3D2818", // dark walnut (heritage / shilajit)
    ],
    // Confirmed from rootlabs.co — @rootlabsco is the Instagram handle.
    standard_hashtags: [
      "rootlabs",
      "rootlabsco",
      "handpicked",
      "bioavailability",
      "ashwagandha",
      "magnesium",
      "shilajit",
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
