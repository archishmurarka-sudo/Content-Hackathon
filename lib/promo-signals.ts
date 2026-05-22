// Shared promo-signal extractor used by every operator-facing generator
// (Instagram, Scripts, Briefs, frame images, etc.).
//
// The structural problem this solves: when an operator types "$27 Prime Day"
// into a free-text vibe field, that information used to end up in the caption
// only — not rendered in the image, not enforced in script copy. Each
// generator now uses this util to pull out prices / percent-off / event names
// and inject a structured PROMO OVERLAY block into its prompt, so the
// operator's selection becomes a first-class headline instead of background
// context.

export type PromoSignals = {
  has: boolean;
  prices: string[];
  percents: string[];
  events: string[];
  raw: string;
};

export function extractPromoSignals(vibe: string | null | undefined): PromoSignals {
  if (!vibe) return { has: false, prices: [], percents: [], events: [], raw: "" };
  const prices = Array.from(vibe.matchAll(/\$\s?\d{1,5}(?:\.\d{1,2})?/g))
    .map((m) => m[0].replace(/\s+/g, ""));
  const percents = Array.from(vibe.matchAll(/\b\d{1,3}\s?%(?:\s*off)?/gi))
    .map((m) => m[0].replace(/\s+/g, " ").trim());
  const EVENT_PATTERNS: Array<[RegExp, string]> = [
    [/black\s*friday|\bbfcm\b/i, "Black Friday"],
    [/cyber\s*monday/i, "Cyber Monday"],
    [/prime\s*day|amazon\s*prime/i, "Prime Day"],
    [/diwali/i, "Diwali"],
    [/christmas/i, "Christmas"],
    [/new\s*year/i, "New Year"],
    [/valentine/i, "Valentine's Day"],
    [/memorial\s*day/i, "Memorial Day"],
    [/labor\s*day/i, "Labor Day"],
    [/(fourth\s*of\s*july|july\s*4|independence\s*day)/i, "Fourth of July"],
    [/summer\s*sale/i, "Summer Sale"],
    [/winter\s*sale/i, "Winter Sale"],
    [/spring\s*sale/i, "Spring Sale"],
    [/fall\s*sale|autumn\s*sale/i, "Fall Sale"],
    [/holiday\s*sale|holiday\s*season/i, "Holiday Sale"],
    [/boxing\s*day/i, "Boxing Day"],
    [/easter/i, "Easter"],
    [/mother'?s?\s*day/i, "Mother's Day"],
    [/father'?s?\s*day/i, "Father's Day"],
    [/back\s*to\s*school/i, "Back to School"],
    [/thanksgiving/i, "Thanksgiving"],
    [/halloween/i, "Halloween"],
    [/earth\s*day/i, "Earth Day"],
    [/launch\s*day|launch\s*sale/i, "Launch"],
    [/flash\s*sale/i, "Flash Sale"],
    [/limited\s*time/i, "Limited Time"],
  ];
  const events: string[] = [];
  for (const [re, label] of EVENT_PATTERNS) {
    if (re.test(vibe) && !events.includes(label)) events.push(label);
  }
  return {
    has: prices.length > 0 || percents.length > 0 || events.length > 0,
    prices,
    percents,
    events,
    raw: vibe,
  };
}

// For image generators — instructs the model to render the promo as in-frame
// typography (the headline) rather than as scene props.
export function renderPromoBlockForImage(p: PromoSignals): string {
  if (!p.has) return "";
  const lines: string[] = ["PROMO OVERLAY (render IN the image as typography — this is the headline)"];
  if (p.events.length) lines.push(`  - Event / season: ${p.events.join(", ")}`);
  if (p.prices.length) lines.push(`  - Price callout: ${p.prices.join(" / ")} (render this as the largest type on the frame)`);
  if (p.percents.length) lines.push(`  - Discount: ${p.percents.join(", ")}`);
  lines.push("  - Typography style: large uppercase sans-serif, gold or warm cream on dark backdrop, tight tracking, editorial — not clearance-bin.");
  lines.push("  - The product packshot must remain the visual hero; type wraps or sits beside it, never covers the label.");
  return lines.join("\n");
}

// For copy generators (scripts, captions, storyboards) — instructs the model
// to weave the promo into the hook + closer without burying it.
export function renderPromoBlockForCopy(p: PromoSignals): string {
  if (!p.has) return "";
  const lines: string[] = ["PROMO HOOK (operator-supplied — this MUST appear verbatim in the copy, ideally in the hook or first 3 seconds)"];
  if (p.events.length) lines.push(`  - Event / season: ${p.events.join(", ")}`);
  if (p.prices.length) lines.push(`  - Price callout: ${p.prices.join(" / ")} — keep the dollar amount and currency symbol exactly as written`);
  if (p.percents.length) lines.push(`  - Discount: ${p.percents.join(", ")}`);
  lines.push("  - The opener (hook) or the close (CTA) MUST name the price/event/discount literally. Do not paraphrase, do not omit. The operator typed these tokens; they are the headline.");
  return lines.join("\n");
}
