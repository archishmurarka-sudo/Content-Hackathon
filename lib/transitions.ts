// Adapted from 0xsline/StoryGen-Atelier `backend/src/services/llmService.js`
// — specifically the `analyzeShotTransition` function (Apache-2.0).
//
// Given two adjacent shots (image URL + narrative line), ask Gemini to
// describe the camera movement / cinematographic bridge between them
// and recommend a duration. Surfaces shot-to-shot continuity, which is
// the single biggest quality risk in multi-shot AI video.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = process.env.GEMINI_TRANSITION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export type TransitionInput = {
  imageUrl: string;
  story: string; // 1-sentence shot description
};

export type Transition = {
  transition_prompt: string;
  duration_s: 4 | 6 | 8;
};

async function fetchAsBase64(url: string): Promise<{ data: string; mime: string }> {
  if (url.startsWith("data:")) {
    return { data: url.split(",")[1], mime: url.split(";")[0].slice(5) };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mime: res.headers.get("content-type") ?? "image/jpeg",
  };
}

export async function analyzeShotTransition(
  shotA: TransitionInput,
  shotB: TransitionInput
): Promise<Transition> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const [a, b] = await Promise.all([fetchAsBase64(shotA.imageUrl), fetchAsBase64(shotB.imageUrl)]);

  // Gemini multimodal parts: labeled frames + each shot's narrative so the
  // model can align visual grounding with the story intent. This mirrors
  // StoryGen-Atelier's labeled-frames technique verbatim.
  const parts: any[] = [
    { text: "Role: Expert film director and cinematographer. You are writing the bridge between two adjacent shots in a short-form vertical video." },
    { text: "Frame A (previous shot):" },
    { inlineData: { data: a.data, mimeType: a.mime } },
    { text: `Frame A narrative: ${shotA.story || "(none)"}` },
    { text: "Frame B (next shot):" },
    { inlineData: { data: b.data, mimeType: b.mime } },
    { text: `Frame B narrative: ${shotB.story || "(none)"}` },
    {
      text: `Task: Describe the specific camera movement and visual transition required to bridge Frame A → Frame B so the cut feels seamless. Then pick a duration that lets the transition land naturally (must be 4, 6, or 8 seconds).

Output ONLY a raw JSON object, no markdown:
{
  "transition_prompt": "Detailed cinematic description (e.g., 'Slow dolly-in while panning right, motion blur on the product label, audio whoosh on the cut').",
  "duration": 4
}`,
    },
  ];

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini transition error ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  let dur = Number(parsed.duration);
  if (![4, 6, 8].includes(dur)) dur = 6;
  return {
    transition_prompt: String(parsed.transition_prompt ?? "Smooth cinematic transition"),
    duration_s: dur as 4 | 6 | 8,
  };
}
