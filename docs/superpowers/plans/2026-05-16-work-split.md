# Content Machine — Two-Person Work Split

**Demo:** May 16 evening
**Team:** 2 people
**Working hours assumed:** ~10 each
**Mode:** parallel lanes with a shared JSON contract

---

## The Split

| Lane | Owner | Owns | Deliverable |
|---|---|---|---|
| **A — Content Pipeline** | Person A | All Claude agents, prompts, content quality | A `content/` directory of JSON files matching the schema below |
| **B — Frontend + Deploy** | Person B | Next.js dashboard, UI, simulated publish, Railway deploy | A live URL that reads the JSON files |

**Why this split works:** they communicate only through the JSON schema in §3. Person B builds against stub JSON in hour 1, swaps in real outputs from Person A by hour 5. Each person can ship independently.

---

## 1. The Three Sync Points

| When | What | Duration |
|---|---|---|
| **Hour 0** | Both read this doc together. Agree on JSON schema (§3). Person A commits stub JSON files (any content, just shape-correct) to `content/`. Person B starts the scaffold against the stubs. | 30 min |
| **Hour 5** | Person A has real outputs for at least the episode + clips. Person B pulls them in, hot-reloads, screenshots a check. Either adjust schema, or proceed. | 15 min |
| **Hour 8** | Integration. Person A's mid-funnel + fanout outputs are in. Person B integrates. First end-to-end click-through. | 30 min |
| **Hour 9–10** | Together — demo dry-run × 2, polish, deploy. | 60 min |

Everything between these sync points is independent work.

---

## 2. Lane A — Content Pipeline (Person A)

**Goal:** Generate every JSON file the dashboard needs by hour 8. Quality over quantity. The IP visible to judges lives in these files.

### Hour 0–1 — Setup + Stub JSON

- [ ] Pull repo. Read `docs/superpowers/specs/2026-05-13-content-machine-design.md` §10 (podcast subsystem) carefully.
- [ ] Read the JSON schema in §3 below.
- [ ] Create `content/episodes/s1e4-stub.json` with a dummy 10-beat episode just so Person B has something to render against (3 lines of dummy script per beat is fine).
- [ ] Commit stub. Tell Person B.

### Hour 1–2.5 — Episode Generator (the hero asset)

- [ ] Implement the agent from Task 8 of the existing plan (`lib/agents/podcast-episode.ts`).
- [ ] Use `claude-opus-4-7` model, 16k max tokens, cache the system prompt.
- [ ] Run it: Maya + Dr. Chen, arc day 15, topic "Why melatonin stopped working," S1E4.
- [ ] **Quality bar:** every beat must include the host's signature phrases at least once. Cold open must be specific (not generic). Sponsor read must include the FDA disclaimer verbatim.
- [ ] Save to `content/episodes/s1e4.json`. If quality is weak, re-run with prompt tweaks. Budget two retries max.
- [ ] Notify Person B → they swap stub for real.

### Hour 2.5–3.5 — Clip Extractor

- [ ] Implement Task 9 (`lib/agents/clip-extractor.ts`) — scoring + per-platform adaptation.
- [ ] Run it on `s1e4.json` with `topN: 10`.
- [ ] **Quality bar:** at least 4 of 10 clips should have a hook that quotes a SPECIFIC detail from the script (not paraphrased). The cold-open clip should be in the top 3.
- [ ] Save to `content/episodes/s1e4-clips.json`.

### Hour 3.5–5 — Mid-Funnel Video Agent (NEW)

- [ ] Create `lib/agents/mid-funnel-video.ts`.
- [ ] System prompt skeleton:

  ```
  You are the Mid-Funnel Video Writer for Off the Clock.
  
  A mid-funnel video is a 60-90s vertical video that goes DEEPER than a 
  clip — not a pull from the episode but an EXPANSION of one idea, 
  designed for an audience that already saw a top-funnel clip.
  
  Five types:
  - mechanism_explainer (host: expert): one mechanism in depth with 
    on-screen text overlays
  - personal_expansion (host: consumer): expands a viral hook from a 
    previous TikTok
  - comparison_myth_bust (host: expert or coach): anti-recommendation 
    framing
  - day_in_life_growth (host: consumer): same character at two arc-day 
    timestamps
  - qa_response (host: any): aggregated DM/comment response
  
  Every video:
  - 60-90 seconds
  - Hook in first 3 seconds  
  - Soft CTA (comment/DM/follow), NOT product push
  - 4-7 on-screen text overlays with timestamps
  - 1 specific universe-canon reference
  
  Output JSON array of 4 videos following the MidFunnelVideo schema.
  ```

- [ ] Pass the episode + arc + character spec as user input.
- [ ] **Quality bar:** must produce 1 Mechanism Explainer (Dr. Chen), 1 Personal Expansion (Maya), 1 Comparison (Dr. Chen or Coach Eli — pick Eli for variety), 1 Day-in-Life-Growth (Maya, day 21 vs day 1).
- [ ] Save to `content/episodes/s1e4-mid-funnel.json`.
- [ ] Notify Person B.

### Hour 5–6.5 — Cross-Universe Fanout

- [ ] Implement Task 10 (`lib/agents/fanout.ts`).
- [ ] Produce X consumer thread (Maya), X expert thread (Dr. Chen), Reddit post, IG carousel.
- [ ] **Quality bar:** the X expert thread must NOT contain anything from the blocklist (cures, treats, diagnoses). The Reddit post must read like a real first-person post — no marketing voice.
- [ ] Save to `content/episodes/s1e4-fanout.json`.

### Hour 6.5–7.5 — Constellation Teasers (Tyler + Jenna)

- [ ] One TikTok script each for Tyler and Jenna, ~30s each.
- [ ] Quick — these are just to make the universe-home page feel alive. Reuse the script agent from Task 8 but for a single TikTok piece, not a full episode.
- [ ] Save to `content/pieces/tyler-tiktok-1.json` and `content/pieces/jenna-tiktok-1.json`.

### Hour 7.5–8 — Engine Insights data

- [ ] Write `content/insights.json` by hand — use the synthetic structure from Task 18 of the existing plan. Five sections: highlights, hook performance, beat retention, arc pacing, cross-platform.
- [ ] Five specific learning highlights that reference our actual characters/episode (e.g., "Maya's mechanism-led hooks convert 2.3× her identification-led hooks last week" — call out Maya by name).
- [ ] Save to `content/insights.json`.

### Hour 8+ — Buffer

If you finish early:
- Generate Episode S1E5 stub (Maya + Coach Eli, recovery topic) — extra calendar fill
- Improve any weak outputs by re-running with sharper prompts
- Build a 30-day calendar preview JSON (just metadata of upcoming pieces, no full generation) for the calendar view

### Lane A's One Critical Constraint

**Do not change the JSON schema in §3 without telling Person B.** If you need to add a field, post in chat and we adjust the contract together. Silent schema drift = broken integration at hour 8.

---

## 3. The JSON Schema Contract (the shared truth)

This is the only contract between Lane A and Lane B. Person A's outputs must match. Person B reads only from these files.

### `content/episodes/<id>.json` — Episode

```typescript
{
  "id": "s1e4",
  "show": "off_the_clock",
  "season": 1,
  "episode": 4,
  "title": "Why melatonin stopped working: Dr. Sarah Chen on the cortisol-magnesium loop",
  "youtube_title": "Why melatonin stops working at 33 | Off the Clock Ep 4",
  "logline": "Maya hasn't slept through the night in 14 months. Dr. Sarah Chen explains why melatonin stops working.",
  "host_id": "maya",
  "guest_id": "dr_chen",
  "arc_day": 15,
  "beats": [
    {
      "index": 1,
      "name": "cold_open" | "show_intro" | "stakes" | "mechanism_reveal" | "personal_application" | "cultural_reframe" | "what_actually_works" | "the_reframe" | "listener_wisdom_cta" | "outro",
      "timecode_start": "00:00",
      "timecode_end": "00:30",
      "conversion_beats": ["identification" | "mechanism" | "bridge" | "proof" | "permission" | "action"],
      "story_layers": { "episode": "...", "arc": "...", "universe": "..." },
      "script": "HOST: ..."
    }
    // ... 10 beats total
  ],
  "sponsor_read": {
    "script": "...",
    "code": "OFFCLOCK",
    "includes_fda_disclaimer": true
  }
}
```

### `content/episodes/<id>-clips.json` — Top-funnel clips

```typescript
[
  {
    "id": "s1e4-clip-1",
    "from_beat": 1,
    "in_seconds": 0,
    "out_seconds": 32,
    "rationale": "Cold open — Maya forgot client name on Zoom (specific + vulnerable)",
    "funnel_stage": "top",
    "score": 14,
    "hook_chosen": "I forgot my own client's name on a Zoom yesterday. I'm 33.",
    "hook_variants": ["...", "...", "..."],
    "platform_adaptations": [
      {
        "platform": "tiktok",
        "title_or_caption": "I forgot my client's name. I'm 33.",
        "on_screen_text": "I'M 33 AND I FORGOT MY OWN CLIENT'S NAME",
        "cta": "follow Maya for the next 30 days",
        "hashtags": ["#sleep", "#brainfog", "#perimenopause"]
      }
      // ... reels, shorts
    ]
  }
  // ... 10 clips
]
```

### `content/episodes/<id>-mid-funnel.json` — Mid-funnel videos (NEW)

```typescript
[
  {
    "id": "s1e4-mid-1",
    "type": "mechanism_explainer" | "personal_expansion" | "comparison_myth_bust" | "day_in_life_growth" | "qa_response",
    "host_id": "dr_chen",
    "title": "Why magnesium glycinate is different from oxide",
    "duration_target_seconds": 75,
    "source_episode_id": "s1e4",
    "hook": "If you tried magnesium and it didn't work — you took the wrong kind. Here's why.",
    "beats": [
      "0-3s: Look-to-camera. Hook. (\"You took the wrong kind.\")",
      "3-15s: The reframe — 'magnesium' on a label tells you almost nothing",
      "15-45s: The mechanism — glycinate binds with glycine, crosses BBB; oxide stays in gut",
      "45-70s: The takeaway — 'check the label, look for glycinate or bisglycinate'",
      "70-85s: Soft CTA — 'comment your supplement label, I'll tell you which kind you have'"
    ],
    "on_screen_text_overlays": [
      { "at_seconds": 4, "text": "MAGNESIUM ≠ MAGNESIUM" },
      { "at_seconds": 22, "text": "GLYCINATE crosses blood-brain barrier" },
      { "at_seconds": 30, "text": "OXIDE → stays in gut → laxative" },
      { "at_seconds": 50, "text": "Check the label: GLYCINATE or BISGLYCINATE" },
      { "at_seconds": 75, "text": "Comment your label ↓" }
    ],
    "caption": "If you tried magnesium and it didn't work, you took the wrong kind. Here's the chemistry.",
    "hashtags": ["#magnesium", "#sleep", "#womenshealth", "#perimenopause"],
    "cta": "Comment your supplement label below 👇",
    "funnel_stage": "mid",
    "platforms": ["tiktok", "reels", "shorts"]
  }
  // ... 4 videos total
]
```

### `content/episodes/<id>-fanout.json` — Cross-universe artifacts

```typescript
{
  "x_consumer_thread": {
    "handle": "@maya.reyes",
    "tweets": [
      "I forgot my own client's name on a Zoom yesterday. I'm 33.",
      "Then I drove home and got into bed at 9pm and stared at the ceiling until 2am like a stranger to my own body.",
      // ...
    ]
  },
  "x_expert_thread": {
    "handle": "@drsarahchensleep",
    "tweets": [
      "Most patients I see in their 30s are taking melatonin and wondering why it stopped working.",
      // ...
    ]
  },
  "reddit_post": {
    "subreddit": "r/perimenopause",
    "title": "I'm 33 and my body just turned on me. Here's what I've learned (and what I'm trying).",
    "body": "..."
  },
  "ig_carousel": {
    "panels": [
      { "index": 1, "headline": "Melatonin stopped working?", "body": "You're not crazy. Here's what's happening." },
      // ... 8 panels
    ]
  }
}
```

### `content/insights.json` — Engine learning data (hand-written)

```typescript
{
  "highlights": ["...", "...", "...", "...", "..."],
  "hook_performance": [
    { "character": "maya", "hook_category": "doctor_defy", "retention_3s": 0.78, "delta_vs_baseline": 0.31 }
    // ...
  ],
  "beat_retention": [
    { "beat_name": "cold_open", "avg_retention_pct": 0.91 }
    // ...
  ],
  "arc_pacing_signal": { "observation": "...", "recommendation": "..." },
  "cross_platform": [
    { "platform": "spotify", "unique_listeners": 9810, "completion_rate": 0.67, "conversion_signal": 0.31 }
    // ...
  ]
}
```

### `content/pieces/<id>.json` — Single content pieces (Tyler/Jenna teasers)

```typescript
{
  "id": "tyler-tiktok-1",
  "piece_type": "tiktok",
  "character_id": "tyler",
  "arc_day": 4,
  "duration_seconds": 30,
  "hook": "I DNF'd my first 50k at mile 22. Here's what the cramps told me.",
  "script": "...",
  "caption": "...",
  "hashtags": ["#trailrunning", "#recovery", "#magnesium"]
}
```

---

## 4. Lane B — Frontend + Deploy (Person B)

**Goal:** A live, deployed dashboard at a Vercel URL that reads from `content/` JSON files, with the publish animation, by hour 8.

### Hour 0–1 — Scaffold against stub

- [ ] Pull repo. Read this doc.
- [ ] `npx create-next-app@latest . --typescript --tailwind --app --no-eslint --yes`
- [ ] `npx shadcn@latest init -d && npx shadcn@latest add card button tabs badge separator scroll-area dialog`
- [ ] Create `lib/content.ts` — reads JSON files from `content/` via `fs.readFileSync` at build time:

  ```typescript
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  
  export function readContent<T>(relativePath: string): T {
    return JSON.parse(readFileSync(join(process.cwd(), "content", relativePath), "utf8")) as T;
  }
  
  export function readCharacters() {
    // read all YAMLs in config/characters/root_labs/, parse, return array
  }
  ```

- [ ] Stub the episode read against Person A's stub file. Verify hot-reload works.
- [ ] Commit baseline.

### Hour 1–2 — Universe Home (View A)

- [ ] `app/page.tsx` → six character cards from `config/characters/root_labs/*.yaml` (or copy them into `content/characters/`)
- [ ] Card layout per the spec §13: name, age/city, profession, core frustration in italics, kind badge (consumer/expert/coach), current arc state, primary pain owned
- [ ] Each card links to `/pieces/<sample-piece-id>` — Maya links to S1E4, Tyler/Jenna link to their teaser TikToks
- [ ] Test all 6 cards render. Push.

### Hour 2–4 — Piece Detail page (the centerpiece)

- [ ] `app/pieces/[id]/page.tsx` — for now, hardcode to render S1E4
- [ ] Section 1: Episode header (title, logline, host+guest, season/episode badge)
- [ ] Section 2: **Episode Script** — 10 beats in a vertical timeline. Each beat = card with timecode, name badge, conversion-beats chips (green), story-layers (3 small sub-cards), then the script as monospaced-ish text
- [ ] Section 3: **Clips Panel** — 10 clip cards in 2-column grid. Each card: hook in quotes (large text), funnel badge, platform adaptations as small chips, expand button for hook variants

### Hour 4–5 — Mid-Funnel Panel (NEW)

- [ ] Section 4: **Mid-Funnel Videos** — 4 cards in 2-column grid
- [ ] Each card has a distinct visual treatment from clips — taller, with a "VIDEO" badge in a different color
- [ ] Layout per card:
  - Type badge (Mechanism Explainer / Personal Expansion / Comparison / Day-in-Life Growth) — color-coded
  - Host name + avatar circle
  - Hook in quotes (large)
  - Duration badge ("75s")
  - **Beats** as a vertical mini-timeline (5 rows, each "0-3s: ...")
  - **On-screen text overlays** as a horizontal scroll strip showing each overlay at its timestamp
  - Caption + hashtags at bottom
  - Soft CTA in a callout box

### Hour 5–6 — Fanout Tabs + Insights

- [ ] Section 5: **Universe Fanout** — 4 tabs (X consumer / X expert / Reddit / IG carousel)
  - X tabs: list of tweet cards with the handle, numbered (1/8, 2/8…)
  - Reddit: subreddit + title + body in markdown rendering
  - IG carousel: 8-panel grid (2×4), each panel = headline + body in a faux phone-screen frame
- [ ] `app/insights/page.tsx` — read `content/insights.json`, render the five sections per Task 18 of the existing plan (highlights, hook performance table, beat retention bars, arc pacing, cross-platform table)

### Hour 6–7 — Simulated Publish Animation (the demo wow moment)

- [ ] Section 6 on the piece detail page: **Publish Panel**
- [ ] Big button: "Approve & Auto-Publish to 7 Platforms"
- [ ] On click, animate sequence (use `useEffect` + `setTimeout` chains, or framer-motion):
  - 0.0s: "Running quality stack..." appears
  - 0.5s: ✓ Compliance (FDA-safe phrasing verified)
  - 1.0s: ✓ Editorial Coherence (10 beats present)
  - 1.5s: ✓ Factual Sanity (claims cross-checked)
  - 2.0s: ✓ Brand Voice (Maya's signature phrases detected)
  - 2.5s: ✓ Metadata QA (title 73 chars, description complete)
  - 3.0s: "Sandbox window starting (60min)..." → fast-forward bar
  - 3.5s: ✓ Sandbox clean
  - 4.0s: "Uploading..." appears for 3 platforms
  - 5.0s: ✓ Spotify · live · 23min ingestion
  - 5.5s: ✓ Apple Podcasts · ingesting · 14h ETA
  - 6.0s: ✓ YouTube Podcast · live · video id YT_demo_abc
  - 6.5s: "Triggering clip distribution..."
  - 7.0s: ✓ 10 TikTok clips queued
  - 7.5s: ✓ 4 Mid-funnel videos queued
  - 8.0s: ✓ X consumer + X expert posted
  - 8.5s: ✓ Reddit post live in r/perimenopause
  - 9.0s: ✓ IG carousel scheduled
  - 9.5s: Final state — "Live on 7 platforms · 19 pieces in distribution"
- [ ] Each tick is a small row with green ✓, agent/platform name, and an optional detail. Use shadcn `Badge` for status, `Progress` for sandbox bar.

### Hour 7–8 — Deploy + polish

- [ ] Push to GitHub (`git push origin main`)
- [ ] Deploy via Railway:
  - `railway login` (one-time, opens browser OAuth)
  - `railway init` from project root → pick or create the `Content-Hackathon` project
  - `railway up` → Railway detects Next.js, builds and deploys
  - In Railway dashboard: add env var `ANTHROPIC_API_KEY` (even if unused at runtime, prevents build errors)
  - Generate a domain in Railway: Settings → Networking → Generate Domain → copy the `*.up.railway.app` URL
- [ ] Verify live URL renders. Test on mobile and desktop.
- [ ] Polish: font sizes, spacing, hover states, color of badges, the publish-button affordance

### Hour 8+ — Buffer / Polish

If finished:
- Add a Calendar placeholder view showing the week of pieces
- Add Config view (read-only from `config/brands/root_labs.yaml`)
- Add an autonomy-mode toggle to Config (visual only — sets a flag in localStorage)
- Add a header bar with brand picker dropdown (only Root Labs is functional, others greyed out — shows extensibility)
- Improve the publish animation timing

---

## 5. Joint Tasks (do together at sync points)

### Hour 0 sync (30 min)

- [ ] Both read this entire doc
- [ ] Both confirm: agree on the schema in §3
- [ ] Person A commits the stub JSON files for episode, clips, mid-funnel, fanout
- [ ] Person B confirms they can render the stub data

### Hour 5 sync (15 min)

- [ ] Person A: episode + clips are real
- [ ] Person B: pulls latest, verifies render
- [ ] Anyone catches schema drift now (cheap to fix) vs. hour 8 (expensive)

### Hour 8 sync (30 min)

- [ ] Person A: mid-funnel + fanout + insights are real
- [ ] Person B: integrates, does first end-to-end click-through
- [ ] Bug list: prioritize blockers, defer polish
- [ ] Either person fixes blockers; both fix in parallel

### Hour 9 — Demo Dry-Run × 2 (60 min)

- [ ] Person B drives the click-through (UI is theirs)
- [ ] Person A narrates the storytelling depth (content is theirs)
- [ ] Together they time it, target 5 min
- [ ] After dry-run 1: list 3 things to improve
- [ ] After dry-run 2: lock the demo, no more changes

### Hour 10 — Deploy + Submit

- [ ] Final Vercel deploy
- [ ] Submit to hackathon

---

## 6. Failure Modes & Recovery

| If… | Then… |
|---|---|
| Person A's episode generation fails 3x | Use the stub + manually write a high-quality 10-beat script in a text editor (1 hour). The demo doesn't require it to be model-generated — it requires it to be impressive. |
| Person A's mid-funnel agent produces weak output | Hand-write the 4 mid-funnel video specs in JSON. The schema is rigid; filling it manually is 30 min. |
| Person B's Railway deploy fails | Demo from `localhost:3000` directly on the laptop. Have a backup screen-recording as fallback. |
| Either person hits an unrecoverable block | Slack/Discord ping. The other pauses and helps for 15 min. Get unblocked, then split again. |
| Both behind at hour 8 | Cut: Tyler/Jenna teasers, Calendar view, Config view, autonomy toggle. Keep: episode, clips, mid-funnel, fanout, insights, publish animation. Those are the demo. |

---

## 7. The Single Source of Truth

This doc is the contract. If something here is wrong or unclear, fix it in this doc immediately and tell the other person. Don't fork into private assumptions.

The spec (`docs/superpowers/specs/2026-05-13-content-machine-design.md`) is the pitch. The plan (`docs/superpowers/plans/2026-05-13-content-machine-implementation.md`) is the original full version. This file is the *today* plan.

Good luck. Ship it.
