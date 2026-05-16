# Content Machine — Design Spec

**Project:** Mosaic Content Hackathon entry
**Author:** Archish
**Last updated:** 2026-05-13
**Demo date:** 2026-05-16
**Status:** Design — pending user review before implementation plan

---

## 0. TL;DR

A brand-agnostic, end-to-end **Content Machine** that lets one brand manager run 5–10 channels (TikTok, Reels, Shorts, X character network, podcasts, YouTube, Reddit, IG carousels) by encoding the **storytelling logic** rather than just the production pipeline. Root Labs / MagAshwa is the v1 reference brand; the other four Mosaic brands plug in via a config swap.

**Key bets:**

1. **Storytelling is the IP.** Agents are commodity. The system's moat is how it architects narrative — character specificity, three-layer story design, conversion-beat-aware scripts.
2. **One canonical narrative beat → many platform-specific outputs.** Same story, different shapes for TikTok / Reels / Shorts / X / Reddit / podcast / carousel.
3. **Podcast is the canon hub.** A 30-min episode is the source of truth; ~25 derivative pieces fan out from it. This is what makes the "content machine" mechanic actually compound.
4. **Per-channel autonomy.** Different platforms carry different risk profiles. Some channels run fully autonomous; some are human-gated. Granular trust graduates over time.
5. **Shippable, not demoable.** The architecture is designed for production deployment, not just May 16. Judging weights commercial viability and budget adherence — we lean into that.

---

## 1. Hackathon Context

The Mosaic brief defines an **overarching Job** ("build a Content Machine") and **five Tasks**:

1. Theme / Character Creation
2. Universe building
3. Scripts
4. Screenplay
5. Content Generation

Plus five candidate output formats: 60s microdrama, kids' animated, comic strip, Labs format, AI Influencer UGC.

**This entry takes the entire Job, end-to-end, plus publishing.** Solo entry. Built for Root Labs / MagAshwa as the reference; brand-agnostic at the architecture layer.

Prizes weight commercial viability and budget adherence. Top entry presents to a 5000-person crowd at Mumbai Tech Week AI Showcase, May 29–30.

---

## 2. Product Vision

A **single brand manager** can run 5–10 distinct channel properties per brand, end-to-end, by:

- Defining the brand once
- Approving (or trusting) characters and arcs
- Reviewing the engine's output where risk warrants
- Watching content publish, perform, and feed back into the engine's own learning

**The brand manager's day** in this system: scroll a queue of decisions, approve or edit a handful, observe analytics roll in, occasionally re-tune autonomy tiers. They don't write copy. They don't direct shoots. They steer.

The economic claim: replace a 4–6 person content team per brand with one brand manager + the system. For Mosaic with five brands, that's ~$2M+/year in labor compounded.

---

## 3. Scope & Success Criteria

### What's in scope for May 16 demo

- Full Content Machine architecture, end-to-end, working
- Root Labs as the reference brand, fully configured
- Three consumer characters (Maya, Tyler, Jenna) + three expert personas (Dr. Chen, Dr. Reid, Coach Eli) populated in the universe store
- One full podcast episode of *Off the Clock* generated end-to-end (script → metadata → quality stack → publish-pipeline)
- Auto-publishing pipeline live to Spotify (via Buzzsprout sandbox) + Apple (via same RSS) + YouTube Podcasts (via Data API sandbox)
- Clip extraction system producing ~10 platform-routed clips from the podcast episode
- Cross-universe fanout: from the same episode, an X thread by Maya, an X thread by Dr. Chen, an IG carousel, a Reddit narrative post
- Master dashboard with five views (Brand Universe Home, Content Calendar, Piece Detail, Engine Insights, Configuration)
- Performance feedback loop visualized with synthetic data
- Compliance/quality-stack pipeline operational
- Autonomous-mode toggle visible (config diff, not full activation in demo)

### What's architected for but not in v1

- Real audio generation (placeholder MP3 in v1; ElevenLabs/NotebookLM swap in v2)
- Real video generation for TikTok clips (script + screenplay in v1; Hedra/Veo swap in v2)
- Live publishing to TikTok / IG / X / Reddit production accounts (sandbox + simulated in v1)
- Megaphone integration (Buzzsprout in v1)
- Real Apple Podcasts Connect API access (mocked in v1)
- The Theme/Character agent running continuous market research (one-shot generation in v1; characters pre-seeded)
- Full autonomous mode activated end-to-end (toggle exists, gates remain on by default)
- Dynamic Audio Insertion for platform-specific CTAs
- Full graduation/demotion automation (config-driven in v1)

### Success criteria

- Judges see end-to-end pipeline run live during 4-minute demo
- "Wow moment" is the cross-platform fanout from one episode + the engine-insights view showing the system self-tuning
- Architecture diagram is clean enough that a real engineer would say "I could ship this Monday"
- Cost-per-content-piece numbers hold up under scrutiny
- Compliance/regulatory story is credible to a real brand-safety-aware operator

---

## 4. System Architecture (5 Layers)

```
┌──────────────────────────────────────────────────────────────┐
│ LAYER 5 — Publishing & Feedback                              │
│   Platform adapters (TikTok, Meta, YouTube, RSS, X, Reddit)  │
│   Performance ingestion + learning loop                       │
├──────────────────────────────────────────────────────────────┤
│ LAYER 4 — Content Generation (execution)                     │
│   Video gen (Hedra/Veo) · Image gen (Flux) · Audio (11Labs)  │
│   Text gen (Claude) · Captioning · Thumbnailing               │
├──────────────────────────────────────────────────────────────┤
│ LAYER 3 — Storytelling Engine (the IP)                       │
│   Theme/Character · Universe · Arc Planner ·                 │
│   Script · Screenplay · Hook Variants                        │
├──────────────────────────────────────────────────────────────┤
│ LAYER 2 — Universe State (canon store)                       │
│   Character bibles · Relationships · Universe events ·       │
│   Active arcs · Performance history                          │
├──────────────────────────────────────────────────────────────┤
│ LAYER 1 — Brand Configuration                                │
│   Brand identity · Audience · Products · Pain points ·       │
│   Compliance rules · Platform connections                    │
└──────────────────────────────────────────────────────────────┘
```

Each layer reads from layers below and writes to layers above. Strict separation enables brand-agnostic configuration at Layer 1 to flow through to brand-tuned output at Layer 5.

---

## 5. Layer 1 — Brand Configuration

Per-brand YAML config loaded at runtime. Everything downstream reads from it.

```yaml
brand: root_labs
identity:
  voice: "informed-friend, evidence-first, never preachy"
  tone_register: [warm, specific, slightly-skeptical]
  forbidden_tones: [hyperbolic, preachy, condescending]
audience:
  primary: { age: 25-45, gender: female, geo: US, life_stages: [perimenopause, working-mom, career-stress] }
  secondary: [fitness-curious-30s-men, stress-driven-professionals]
products:
  - sku: magashwa_gummies
    pain_points:
      - { id: sleep, gmv: 860k, vocab: ["I haven't slept through the night", "melatonin stopped working"] }
      - { id: brain_fog, gmv: 418k, vocab: ["forgot my own client's name", "can't hold a thought"] }
      - { id: energy, gmv: 319k, vocab: ["afternoon crash", "running on coffee"] }
      - { id: stress_cortisol, gmv: 279k, vocab: ["stress burns through magnesium faster than diet replaces"] }
      - { id: general_wellness, gmv: 185k, vocab: ["even if you eat perfectly, food doesn't have magnesium it used to"] }
      - { id: muscle_recovery, gmv: 16k, vocab: [...] }
      - { id: anxiety_calm, gmv: nascent, vocab: ["my nervous system was shot"] }
compliance:
  claims_allowlist: ["supports", "helps with", "promotes", "may aid"]
  claims_blocklist: ["cures", "treats", "diagnoses", "prevents disease"]
  required_disclaimers:
    fda_supplement: "These statements have not been evaluated by the FDA."
    not_medical_advice: "This is not medical advice."
  sponsor_disclosure_required: true
platform_connections:
  tiktok: { account_id, shop_id, posting_api_token }
  instagram: { account_id, token }
  youtube: { channel_id, podcast_show_id, api_token }
  x: { handles: { maya, tyler, jenna, dr_chen, dr_reid, coach_eli } }
  reddit: { handles: { maya_personal: ..., dr_chen_expert: ... } }
  buzzsprout: { podcast_id, api_token }
```

Root Labs config draws raw data from existing `magcontentinator` product brief (already populated). The other four Mosaic brands get equivalent configs as the system extends.

---

## 6. Layer 2 — Universe State (Canon Store)

A persistent Postgres database holding the canon — the memory of the content machine.

### Core entities

- **characters** — character bibles per character per brand (~30 fields, see §8)
- **character_relationships** — edges between characters (Maya listens to Dr. Chen's podcast)
- **arcs** — active 30-day arcs per character, with day-by-day beat plans
- **chapters** — 90-day chapter spanning 3 arcs
- **sagas** — 365-day saga, the character's overall growth
- **universe_events** — every canon-impacting moment (Maya tried magnesium on day 17; she had her first good night on day 24); prevents contradictions
- **content_pieces** — every generated piece, linked to character + beat + universe events
- **publications** — each platform-instance of a content piece
- **performance_snapshots** — analytics polled per publication on a schedule

This is what makes the engine *coherent over time*. New scripts read from prior universe events. Future episodes can reference past episodes.

---

## 7. Layer 3 — The Storytelling Engine (the IP)

The intellectual core. Eight subsystems.

### 7.1 Conversion Anatomy

Every piece of supplement content that converts moves the viewer through six psychological beats. The engine names these as states; every script targets one or more:

| Beat | Internal monologue | Content move |
|---|---|---|
| **Identification** | "She's me." | Hyper-specific character detail in first 3s |
| **Mechanism** | "Oh, *that's* what's happening." | Reveal a biological cause the viewer didn't know |
| **Bridge** | "And this is what changed it." | Product enters as discovery, not solution-pitch |
| **Proof** | "It actually worked." | Specific transformation detail, not vague claim |
| **Permission** | "It's okay to try." | "I was skeptical too" — lower friction |
| **Action** | "Where do I get it?" | Clear CTA, orange cart |

A single TikTok hits 2–3 of these. A 30-day character arc hits all six in sequence. The script-writer agent has a `target_beats` parameter on every generation.

### 7.2 Three Story Layers (always simultaneous)

Every piece must do three things at once:

- **Episode layer** — self-contained payoff for the stranger landing today
- **Arc layer** — advances the character's current 30-day journey, rewarding followers
- **Universe layer** — drops one piece of canon that compounds — recurring side character, callback to last week, aesthetic element

Every script generation has all three layered into its prompt. This is non-negotiable.

### 7.3 Character Specification Framework

The brief's core principle: more specific character = more identification. Generic "stressed mom" is invisible. Hyper-specific "Jenna, 41, Franklin TN, two kids, husband travels for healthcare work, hasn't slept through the night in 4 years, tried valerian/melatonin/CBD, won't take Ambien because her mom got dependent" — every detail becomes a hook for a real viewer to say "she's me."

Character spec schema:

```yaml
identity: { name, age, city, profession, life_stage }
physical: { appearance_anchors, voice_age_range, vocal_quirks }
psyche:
  core_frustration
  what_theyve_tried
  what_they_wont_admit
  what_theyre_secretly_proud_of
  what_makes_them_cry
context:
  morning_routine
  evening_routine
  recurring_antagonist
  recurring_safe_place
  their_tell
arc_state:
  current_chapter
  days_in_journey
  what_just_changed
  what_is_about_to_change
pain_ownership:
  primary_pain_point
  secondary
  off_limits  # what this character DOES NOT cover
voice:
  vocabulary_band
  sentence_length
  signature_phrases
  what_they_never_say
```

**Critical constraint: pain ownership is exclusive.** Maya owns *sleep + perimenopause*. Tyler owns *recovery + training*. Jenna owns *anxiety + motherhood*. Dr. Chen owns *mechanism authority*. Don't have one character cover everything — it kills parasocial attachment.

### 7.4 Story Arc Planner (the 30 / 90 / 365 spine)

Each character runs **30-day micro-arc** nested inside **90-day chapter** nested inside **365-day saga**.

**30-day micro-arc** (Maya's "I stopped relying on melatonin" arc example):

| Day | Beat | Story function | Conversion role |
|---|---|---|---|
| 1–3 | Setup the pain | Relatability | Identification |
| 4–7 | External dismissal | "Doctor said it's just stress" | Build frustration |
| 8–12 | Investigation begins | Googling / Reddit deep-dive | Mechanism teaser |
| 13–17 | Mechanism reveal | Learns about magnesium glycinate | Mechanism, Permission |
| 18–22 | First trial + skepticism | "Day 3, nothing yet" | Permission |
| 23–27 | The shift | First good night, then second | Proof |
| 28–30 | The reframe | Tells someone casually | Action (soft CTA) |

Each day yields 1–3 content pieces (TikTok primary, X post, occasional podcast cameo).

**90-day chapter** = three arcs strung together. Maya Ch.1: *the discovery*. Maya Ch.2: *the new normal challenged* (goes on vacation, falls off, comes back). Maya Ch.3: *she becomes the source* (friend asks; audience hears pitch from a character they trust).

**365-day saga** = how the character fundamentally changes. Month-12 Maya isn't month-1 Maya. This is the long compounding moat.

### 7.5 Hook Library + Variant Engine

The first 1–3s determine whether anything else happens. The hook library has named, parametrized templates:

- **Pattern-interrupt confession** — "I'm 33 and I just realized..."
- **Doctor-defy** — "My doctor told me this was normal. He was wrong."
- **Mechanism tease** — "Your body literally cannot sleep if [X]."
- **POV** — "POV: you're 41 and your nervous system runs on cortisol and coffee."
- **Anti-recommendation** — "Don't take magnesium if [unexpected]."
- **Origin moment** — "I haven't taken melatonin in 8 months. Here's why."
- **Cost confession** — "I spent $4k on supplements last year. Only one worked."
- **Cliffhanger callback** — "Remember when I said I'd try X for 30 days? Update."

**Variant engine**: every script generates 3 hook variants by default. Either posted as TikTok photo-mode or staggered, with performance measured at 3-second retention. Variant performance feeds back into hook category weights per character.

### 7.6 Cross-Platform Adaptation Logic (the content economics killer)

Every story idea is **one canonical narrative beat** that fans out via platform adapters.

**Example beat**: "Maya, day 17, first good night of sleep, doesn't realize until 11am at work, calls her sister."

| Platform | Output | Shape |
|---|---|---|
| TikTok 60s | Maya at desk, voiceover confession, cut to product beat 35s, CTA 50s |
| Reels | Same video, different caption (Reels rewards hashtag work), no shop tag |
| YouTube Short | Same video, +5s extra setup, SEO-optimized title |
| X thread (Maya) | First-person diary, 8 tweets, soft mention |
| X thread (Dr. Chen) | Mechanism: why day 17 is when the nervous system resets, cites Maya's case |
| Podcast snippet | Maya + Dr. Chen, 4-min Maya tells story + 6-min Dr. Chen mechanism |
| Reddit post | 1500-word first-person account in r/Magnesium, no product link |
| IG Carousel | 6 comic-strip panels of the moment |

One beat → 8 outputs across 5 platforms in one generation pass.

### 7.7 Performance Feedback Loop

Every published piece has a return ticket:

```
Publication → Platform analytics
            → Tag with character, pain_point, hook, beat, story_layer, day_of_arc
            → Feed back into:
                 • Hook category weights (per character)
                 • Beat sequencing (Mechanism-first vs. Identification-first for this audience?)
                 • Arc pacing (30 vs. 21 days)
                 • Cross-platform routing rules
```

For v1 demo: architected for, populated with synthetic data showing the loop closing. "The engine learned this week..." callouts in the dashboard.

### 7.8 Compliance Guardrails

Supplements can't make disease claims. The compliance pass runs at script generation:

- Brand-specific claims allowlist/blocklist
- Forbidden constructions flagged ("treats," "cures," "diagnoses")
- Auto-disclaimer injection where needed
- Hard publish-block if not addressed

This is also a **strong judging signal** — separates the toy from the shippable product.

---

## 8. The Root Labs Character Constellation

All characters are **American**. Indian-coded characters (the brief's Rhea/Mumbai, Karan/Bengaluru examples) belong to BeBodywise and Man Matters — different Mosaic brands. Root Labs sells via TikTok Shop, US-primary, MagAshwa target is US women 25–45.

### Consumer Characters (transformation arcs)

- **Maya Reyes, 33, Austin** — marketing manager, perimenopause hitting early, sleep is shot. Arc: *I stopped relying on melatonin*.
- **Tyler Brooks, 28, Denver** — software engineer turned trail runner, recovery bottleneck. Arc: *muscle cramps stopped, training plateau broke*.
- **Jenna Caldwell, 41, Franklin TN** — two kids, anxiety she can't name, runs on coffee. Arc: *my mornings stopped feeling like emergencies*.

### Expert / Authority Personas

- **Dr. Sarah Chen, PhD** — Stanford-trained sleep researcher, NYC clinic. Mechanism-heavy, citations, debunks melatonin myths.
- **Dr. Marcus Reid, DO** — integrative medicine, Austin. Practical, story-led, clinical practice anecdotes.
- **Coach Eli Wright, CSCS** — sports performance, Boulder. Training science, recovery protocols.

### Podcast Hosts (universe recurring voices)

- ***"Off the Clock" with Maya Reyes*** — consumer-meets-expert conversational; v1 primary
- ***"Inside the Cell" with Dr. Chen + Dr. Reid*** — two-expert mechanism dialogue; v2
- ***"The 4am Club" — Maya's audio diary*** — solo intimate monologue; v3

---

## 9. Platform Strategy

### 9.1 Platform Tiers

```
TIER 1 — Conversion (where GMV lives)
  TikTok (primary, TikTok Shop / orange cart)
  Instagram Reels
  YouTube Shorts

TIER 2 — Authority + universe building
  X (multi-character constellation: experts + consumers + coaches)
  Podcast (Spotify / Apple / YouTube / 25+ via RSS)
  YouTube long-form (Labs / documentary)

TIER 3 — Static + narrative
  Instagram Feed (carousels, comic strip)
  Reddit (long-form story source + organic publishing)
```

### 9.2 Autonomy Tiers Per Channel

Not all platforms carry the same risk. Forcing one autonomy model on everything over-gates the cheap stuff or under-gates the dangerous stuff.

| Tier | Definition | Channels |
|---|---|---|
| **A — Full Auto** | Always autonomous, no human | YouTube Shorts (re-cuts), Facebook Reels (cross-post), Reddit-as-source, compliance pre-checks, analytics, caption/hashtag gen |
| **B — Auto + Compliance Gate** | Autonomous if compliance agent approves | Consumer-character X diary posts, A/B hook variants, podcasts (with multi-agent quality stack), YouTube Podcasts |
| **C — Auto-generate, Human Publish** | Engine produces, human approves before publish | TikTok (brand acct), Instagram Reels, Instagram Carousels, cross-platform fanout, TikTok Shop product tags |
| **D — Human in Content + Publish** | Engine drafts, human shapes and approves | Expert persona X threads (medical claims), YouTube long-form Labs documentaries, Reddit character publishing, crisis/reactive content |
| **E — Human Only** | Engine suggests; never executes | Spark Ads / paid boost, influencer outreach, customer service replies, legal communications, account-level decisions |

### 9.3 Per-Channel Autonomy Table

```
Channel                  | Stage 1-3        | Generation    | Publish
                         | (theme/uni/arc)  |               |
─────────────────────────┼──────────────────┼───────────────┼──────────
TikTok (brand acct)      | Auto             | Auto          | HUMAN
Instagram Reels (brand)  | Auto             | Auto          | HUMAN
Instagram Carousel       | Auto             | Auto          | HUMAN
YouTube Shorts           | Auto             | Auto          | Auto
Facebook Reels           | Auto             | Auto          | Auto
X — consumer characters  | Auto             | Auto          | Auto*
X — expert personas      | Auto             | HUMAN draft   | HUMAN
X — reactive posts       | n/a              | HUMAN         | HUMAN
Reddit — ingestion       | Auto             | n/a           | n/a
Reddit — character posts | Auto             | HUMAN draft   | HUMAN
Podcast (audio)          | Auto             | Auto          | Auto**
YouTube Podcast          | Auto             | Auto          | Auto**
YouTube long-form        | Auto             | HUMAN draft   | HUMAN
Analytics + learning     | Auto             | Auto          | n/a
Spark Ads                | Auto (suggest)   | n/a           | HUMAN
Customer service         | n/a              | n/a           | HUMAN

*  compliance-agent gated
** multi-agent quality stack + sandbox + kill switch
```

### 9.4 The Graduation Concept

Autonomy isn't fixed. A piece-type can move Tier C → B → A as confidence accumulates. After 10 pieces with 0 rejections, the system proposes graduation. Two failures → auto-demotion. Encoded in config per piece-type per character:

```yaml
autonomy_grants:
  - { character: maya, piece_type: tiktok_morning_routine, tier: A, granted_after: 10_clean, demote_on: 2_failures }
  - { character: dr_chen, piece_type: x_mechanism_thread, tier: D, never_graduate: true }
  - { character: tyler, piece_type: x_diary, tier: B, granted_after: setup }
```

Granular per-piece-type trust is what makes autonomous mode actually trustable at scale.

---

## 10. Podcast Storytelling Subsystem

The podcast is the **canon hub** of the universe. Everything else cites it.

### 10.1 The Three Shows

| Show | Format | Hosts | Strength | v1? |
|---|---|---|---|---|
| **Off the Clock** | Two-hander conversational | Maya + rotating expert | Identification + Authority. Highest conversion engine. | ✅ |
| **Inside the Cell** | Two-expert dialogue | Dr. Chen + Dr. Reid | Evergreen authority, SEO. | architected, not v1 |
| **The 4am Club** | Solo monologue, audio diary | Maya alone | Highest intimacy, parasocial. | architected, not v1 |

### 10.2 The 30-Minute Episode Structure (10 beats)

**ACT 1 — Hook & Problem (0:00–5:00)**

| Beat | Time | Function |
|---|---|---|
| 1 — Cold Open | 0:00–0:30 | Hyper-specific recent failure moment (clipworthy) |
| 2 — Show Intro | 0:30–1:00 | Theme, host, today's guest tease |
| 3 — Stakes | 1:00–5:00 | Personal stakes; optional listener DM read |

**ACT 2 — Investigation (5:00–20:00)**

| Beat | Time | Function |
|---|---|---|
| 4 — Mechanism Reveal | 5:00–9:00 | Expert explains biology; host plays surrogate |
| 5 — Personal Application | 9:00–15:00 | Mechanism applied; clinical anecdotes |
| 6 — Cultural Reframe | 15:00–20:00 | Life-stage context; "you're not crazy" moment |

**ACT 3 — Path Forward (20:00–30:00)**

| Beat | Time | Function |
|---|---|---|
| 7 — What Actually Works | 20:00–24:00 | Three evidence-based actions; product as one of three |
| 8 — The Reframe | 24:00–27:00 | Emotional resonance, vulnerability |
| 9 — Listener Wisdom + CTA | 27:00–29:00 | DM CTA, next-ep tease |
| 10 — Outro | 29:00–30:00 | Sponsor read (MagAshwa explicit) |

### 10.3 Clip Extraction System

From one 30-min episode, the system extracts 10–14 clips. Moment classifier scores beats on:

- **Emotional density** — vulnerability, surprise, conviction
- **Mechanism density** — information value, "aha" facts
- **Quotability** — does it stand alone?
- **Specificity** — concrete detail vs. abstract

Top moments become clips. Each clip gets:

- Clip cut (in/out timestamps)
- Audio hook (potentially hoisted from later)
- On-screen text overlay
- 3 caption variants per platform
- Cover frame / thumbnail
- Platform routing
- CTA tier (top/mid/bottom funnel)
- Universe-link metadata

### 10.4 Funnel-Stage Routing

| Stage | Purpose | CTA | Platforms |
|---|---|---|---|
| Top | Cold viewer identification | "Follow for more" / "Listen to full ep" | TikTok, Reels, Shorts |
| Mid | Returning audience ready for depth | "Comment your version" / "DM me" | Same + X |
| Bottom | Primed listener, soft product nod | Soft product reference + link in bio | TikTok+shop, IG+link |

### 10.5 Pre-Episode Prep Pipeline

When brand manager clicks "Plan next episode":

1. **Topic + frame** — pulled from character's current arc day
2. **Guest expert selection** — based on topic
3. **Audience question bank** — pulled from r/insomnia, r/perimenopause, r/Magnesium top questions + DMs
4. **Mechanism brief** — 1-page expert-prep doc
5. **Narrative beats** — 10-beat outline with conversion role per beat
6. **Clip moments to plant** — phrases pre-engineered for clip extractability
7. **3 cold-open hook variants** — A/B fodder
8. **Clip targets** — anticipated extraction points

### 10.6 Episode Script Output (v1)

Fully-realized screenplay-format 30-min script with timecodes, character action, dialogue, SFX cues. Plus a clip-extraction sidebar at each beat — likely clip in/out, hook variant suggestions, funnel placement, platform routing, CTA per platform.

### 10.7 Cross-Universe Linkage (the content multiplier)

Every podcast episode emits secondary content:

| Output | Platform | Generated from |
|---|---|---|
| 10–14 short-form clips | TikTok / Reels / Shorts | Moment classifier |
| 1 X thread from Maya | X (consumer) | POV recap, 8–12 tweets |
| 1 X mechanism thread from Dr. Chen | X (expert) | Mechanism beat deepened |
| 1 Reddit confessional | r/insomnia or r/perimenopause | Beats 1+3+8, 1500 words |
| 1 IG Carousel | Instagram feed | 8 panels: 3-things + reframe |
| 1 newsletter essay | Email | Long-form prose |
| 1 universe canon update | Universe Store | Arc day advances; future content can reference |

**~25 distinct content pieces from one episode** across 6+ platforms in one generation pass.

### 10.8 Season Arc Structure

12-episode season maps to Maya's 90-day chapter:

| Episodes | Phase | Conversion role |
|---|---|---|
| 1–3 | Discovery | Identification-heavy |
| 4–7 | Practice | Mechanism + Bridge |
| 8–10 | Integration | Proof + Permission |
| 11–12 | Cultural | Action + new-viewer Identification |

Each episode references prior episodes — serialization compounds subscribers.

---

## 11. Publishing Pipeline

### 11.1 The Automated Quality Stack (6+ agents)

Auto-publish only safe with automated gates. Each agent has BLOCK power; any fail → human review queue.

| # | Agent | Checks | Blocks on |
|---|---|---|---|
| 1 | **Compliance** | FDA structure/function rules, FTC sponsor disclosure, blocklist | Forbidden claim, missing disclaimer |
| 2 | **Editorial Coherence** | All beats present, arc completes, universe consistency | Arc broken, contradiction |
| 3 | **Factual Sanity** | Claims cross-checked against knowledge base, citations valid | Unsupported factual claim |
| 4 | **Brand Voice** | Character voice match, show-vibe match | Voice drift above threshold |
| 5 | **Audio QA** | Length, silence, SNR, glitches, sponsor placement | Technical defect |
| 6 | **Metadata QA** | Title length, description complete, cover art valid, chapters | Incomplete metadata |
| 7+ | **Platform Policy** (per platform) | Spotify, Apple, YouTube specific rules | Platform-specific violation |

Full chain runs ~2–4 minutes per episode.

### 11.2 Sandbox Window (the safety net)

Even after quality stack passes, every episode goes through a **1-hour soft-launch**:

1. Publishes to direct-URL only (no subscriber broadcast)
2. Soft-launch monitor watches: early listener completion, comment sentiment, "this is wrong" flags
3. Clean after 60 min → broadcast goes wide
4. Flagged → auto-unpublish + human review

### 11.3 Performance Kill Switch

Post-broadcast monitoring:

- First-24h listener retention < 50% of show baseline → pause clip distribution, flag
- YouTube like/dislike < 0.7 → pull from suggested, flag
- 3+ misinformation comments → episode hidden, human review
- DMCA / brand complaint → instant takedown

### 11.4 Spot-Check Sampler

Random sampling overrides full autonomy:

- 1 in 10 episodes → human review pre-publish (regardless of agent passes)
- 1 in 5 sponsor reads → human review (highest legal exposure)
- First 3 episodes of any new show → human review (warm-start)
- First episode after character arc transition → human review

Spot-check prevents long-term drift.

---

## 12. Platform Adapters

### 12.1 Shared Asset Bundle

Before any adapter runs, a platform-agnostic bundle is generated:

```yaml
episode_asset_bundle:
  audio_file_mp3
  audio_file_wav
  cover_art_3000          # 3000×3000 sRGB
  cover_art_1400          # fallback
  thumbnail_1280          # 16:9 for YouTube
  transcript_srt
  transcript_vtt
  transcript_plain
  chapters_psc_xml        # Podcasting 2.0
  chapters_youtube_desc   # YouTube timestamp format
  beat_timestamps
  show_notes_html
  show_notes_plain
  episode_meta            # season, episode, title, explicit, etc.
  conversion_meta         # pain_point, arc_position, beats hit, sponsor block
```

### 12.2 Spotify Adapter (via Buzzsprout / RSS)

**Mechanism:** Spotify has no public episode-upload API for non-enterprise customers. Path: upload to Buzzsprout → RSS regenerates → Spotify polls within ~1h → ingests.

**Buzzsprout chosen over alternatives** for v1: $12/mo, REST API, RSS to ~25 platforms as free side-effect. Future state: Megaphone for direct Spotify pipeline + programmatic ad insertion (no architecture change, just adapter swap).

**Spotify-specific assets:**

- Podcasting 2.0 chapter XML (`<psc:chapters>`)
- Transcript via `podcast:transcript` tag
- Episode description with timestamped chapters in HTML
- Sponsor disclosure in description + audio

**Ingestion confirmation:** Poll Spotify Web API after upload, look for episode by RSS GUID match. Log Spotify episode ID for analytics.

**Spotify analytics:** Spotify for Podcasters API (partner program) — plays, completion rate, follower delta, demographics. Fallback: Open Stats dashboard scrape.

**Native features used in v1:** Chapters, Transcript, Q&A ingestion, Spotify Clips upload. Music+Talk, subscriber-only, video-podcast — architected for, not v1.

**One-time show setup:** Buzzsprout creates RSS → claim feed in Spotify for Podcasters dashboard → set categories (Mental Health primary, Nutrition + Alternative Health secondary) → submit.

### 12.3 Apple Podcasts Adapter (same RSS, different optimization)

**Mechanism:** Apple ingests from the same Buzzsprout RSS feed as Spotify. No second upload. Apple polls every ~12–24h (slower than Spotify).

**Apple-specific metadata:**

- `<itunes:author>` — must be host name (Maya Reyes)
- `<itunes:summary>` — 2000-char plain-text fallback for HTML-stripping clients
- `<itunes:category>` — Apple's finer taxonomy: Mental Health primary
- Cover art **must be sRGB** (Apple rejects P3/CMYK)

**Apple discovery signals:**

- Listener completion %
- Ratings & reviews count (high weight)
- New & Noteworthy chart (first 8 weeks of new show)
- Chart position in primary category

**Strategy:** Launch hard during first 8 weeks. Cross-platform clip distribution drives Apple followers during the critical window. CTAs encourage Apple ratings ("Leave a rating on Apple Podcasts — it's the kindest thing for a small show").

**Apple analytics:** Apple Podcasts Connect API (beta partner program); engaged listeners (>40% completion) is Apple's preferred metric.

**One-time setup:** Submit RSS URL in Apple Podcasts Connect → verify email ownership → set categories → submit for Apple review (24–48h).

### 12.4 YouTube Podcasts Adapter (separate upload pipeline)

**Mechanism:** YouTube is NOT RSS-based. Separate upload via YouTube Data API v3 (resumable upload). Each episode = video file (MP4) associated with the podcast show.

**Audio-only → MP4 render:** ffmpeg combines audio + static cover image into MP4. For Hedra dual-avatar video podcast: render real video, same upload pipeline.

**YouTube-specific metadata:**

- Title (100 chars, SEO-led — different from Spotify's brand-led)
- Description with timestamped chapters (auto-becomes YouTube chapter markers if ≥3 timestamps)
- Tags (free-text keywords)
- Category: Education (closest fit; YouTube identifies podcasts via show association)
- Thumbnail (1280×720 min, 3 variants for built-in A/B test)
- Language tags
- Synthetic media disclosure (YouTube policy 2024+ requires when AI-generated)
- Podcast show association via `snippet.podcastMetadata.show_id`

**YouTube Premiere (optional):** Schedule episode as live event watch-party. 24–48h scheduling window. YouTube auto-promotes to subscribers; live chat during premiere; algorithmic boost from initial-burst signal. Cadence: weekly Tuesday 2pm ET.

**YouTube Community Tab:** Auto-post when episode goes live, with episode thumbnail.

**YouTube analytics:** YouTube Analytics API v2 — the best podcast analytics available. Per-second retention curve, demographics, traffic sources, search queries, thumbnail CTR by variant.

**Quota reality:** Default 10,000 units/day, ~1,600 per upload = ~6 uploads/day default. Adequate for v1; request quota increase for production scale.

**Content policy:** YouTube Community Guidelines stricter than Spotify/Apple on medical content. The compliance agent has YouTube as the strictest pass.

**One-time setup:** Create YouTube channel for *Off the Clock* (new channel recommended over Root Labs main — clean algorithmic slate). In YouTube Studio: New Playlist → mark as Podcast → set show metadata. Apply for YouTube Music distribution.

### 12.5 Unified Publish Orchestrator

```python
async def publish_episode(episode_id, autonomy_config):
    bundle = build_asset_bundle(episode_id)
    
    if not await run_quality_stack(bundle, gates=[
        compliance_agent, editorial_agent, factual_agent,
        brand_voice_agent, audio_qa_agent, metadata_agent,
        spotify_policy_agent, apple_policy_agent, youtube_policy_agent,
    ]):
        return await route_to_human_review(episode_id)
    
    if spot_checker.sample(episode_id):
        return await route_to_human_review(episode_id, blocking=False)
    
    results = await asyncio.gather(
        publish_to_buzzsprout(bundle),   # Spotify + Apple + 23 others via RSS
        publish_to_youtube(bundle),       # YouTube Podcasts + YouTube Music
        return_exceptions=True,
    )
    
    await soft_launch_monitor(episode_id, duration_minutes=60)
    
    spotify_ep_id = await confirm_spotify_ingestion(results[0].guid, timeout_min=90)
    apple_ep_id   = await confirm_apple_ingestion(results[0].guid, timeout_min=24*60)
    youtube_id    = results[1].video_id
    
    await broadcast(spotify_ep_id, apple_ep_id, youtube_id)
    await trigger_clip_extraction(episode_id)
    await schedule_analytics_polling(episode_id)
```

### 12.6 Cross-Platform Analytics Aggregation

```yaml
episode: s1e4
spotify: { plays, unique_listeners, completion_rate, followers, saves, shares }
apple:   { plays, engaged_listeners, ratings_new, reviews_sentiment, followers }
youtube: { views, watch_time, avg_view_duration, retention_curve, ctr_by_thumbnail,
           top_search_terms, top_traffic_source, subscribers_gained }
aggregate:
  total_unique_listeners
  best_platform_by_reach
  best_platform_by_intent
  sponsor_code_redemptions
  estimated_attributable_GMV
```

YouTube retention curve is the **single highest-value signal** — second-by-second drop-off tunes the storytelling engine at the beat level.

### 12.7 Per-Platform Optimization Differences

| Lever | Spotify | Apple | YouTube |
|---|---|---|---|
| Top signal | Completion rate | Completion + Ratings | Watch time + CTR |
| Discovery | Recs, Daily Drive, Wrapped | Charts, N&N, Editorial | Search, Suggested, Subs |
| Title | Brand-led | Brand + topic | SEO-led |
| Description | Medium HTML | Long HTML | Long + timestamps + links |
| Cover/thumb | Show cover dominates | Show cover dominates | Episode thumbnail dominates |
| Engagement | Q&A, Polls | Ratings & reviews | Comments, Community |

The system maintains three slightly different metadata sets per episode (same audio, different surface metadata), generated automatically.

---

## 13. Master Dashboard UX

The brand manager's only surface. Five views:

### View A — Brand Universe Home

Top-level. All characters as cards: avatar, current chapter ("Maya · Ch.2 day 17 · Arc: New Normal Challenged"), this-week content count, last-7-day performance pulse.

### View B — Content Calendar

The command center. Week view, color-coded by character. Each cell = one content piece, stage-tagged. Click → drill into the piece.

### View C — Piece Detail

Single piece, vertical stack:

- **Story context** — character, arc day, episode beat, conversion beats
- **Hook variants tray** — 3 generated, pick or regen
- **Script** — editable inline
- **Screenplay / visual direction** — shot list, on-screen text, generated b-roll preview
- **Cross-platform fanout** — tabs for TikTok / Reels / Shorts / X / Reddit / Podcast / Carousel, each with platform-adapted version
- **Approval controls** — approve → queue, publish now, revise

### View D — Engine Insights

The autonomy unlock view. Shows what the system has learned:

- Hook conversion by character
- Beat-level retention from YouTube curves
- Platform amplification per character
- Recommended arc adjustments

This is the demo "wow" view — judges see the loop closing.

### View E — Configuration

Brand config, character constellation editor, compliance rules, API connections, autonomy grants per piece-type.

### Three Brand-Manager View Modes

Per autonomy tier:

1. **"Went out without you"** — Tier A + B daily digest. Scroll, scan.
2. **"Needs you"** — Tier C + D review queue. Sorted by deadline. **Most of brand manager's time here.**
3. **"You're driving"** — Tier E manual workspace.

---

## 14. Agent Orchestration

```
ThemeAgent → UniverseAgent → ArcPlannerAgent
                                  │
                                  ▼
                            EpisodeAgent (one per content piece)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        HookAgent (×3)     ScriptAgent         ScreenplayAgent
                                  │
                                  ▼
                          ComplianceAgent (gate)
                                  │
                                  ▼
                          PlatformAdapterAgent (×N platforms)
                                  │
                                  ▼
                          GeneratorAgent (video / image / audio / text)
                                  │
                                  ▼
                          PublisherAgent (per platform)
                                  │
                                  ▼
                          AnalyticsAgent (return ticket)
                                  │
                                  ▼
                          LearnerAgent → updates weights → back to top
```

Built on Claude Agent SDK. Each agent ~50–150 lines of prompt + tool definitions. Agents stateless; canon lives in Universe Store. Fault-tolerant, retryable, observable.

---

## 15. Tech Stack

| Layer | Choice |
|---|---|
| **Frontend** | Next.js 15 + React + Tailwind + shadcn/ui; Vercel deploy |
| **Backend** | Next.js API routes (CRUD) + separate Node service for long-running gen jobs |
| **Agent runtime** | Claude Agent SDK: Opus 4.7 for planner/storytelling, Sonnet 4.6 for adapter/compliance, Haiku 4.5 for cheap analytics tagging |
| **Job queue** | BullMQ on Redis (Upstash for hackathon, AWS managed for prod) |
| **Database** | Postgres (Supabase free tier for hackathon — auth + storage included) |
| **Object storage** | Supabase Storage for generated assets, CDN-backed |
| **External APIs** | HeyGen, Hedra, ElevenLabs, Flux (Together/Replicate), TikTok Content Posting + Shop, Meta Graph, YouTube Data v3, X API v2, Reddit API, Buzzsprout |
| **Auth** | Supabase Auth, role-gated to brand managers |
| **Observability** | PostHog (product), Sentry (errors), OpenTelemetry (agent traces) |
| **CI/CD** | GitHub Actions → Vercel (frontend), Fly.io/Railway (gen service) |

A real engineer could ship this Monday after the hackathon. That's the "deployable" answer.

---

## 16. Cost Model

Per-piece generation cost (USD):

| Asset | Service | Cost / piece |
|---|---|---|
| TikTok 60s talking-head | Hedra + ElevenLabs | $0.50–1.50 |
| TikTok 60s b-roll | Veo 3 / Kling | $1.50–4.00 |
| Comic carousel (8 panels) | Flux schnell | $0.05–0.20 |
| Podcast 30min, 2 voices | ElevenLabs / NotebookLM-style | $2–6 |
| X thread / Reddit / caption | Claude API | $0.02–0.10 |
| Performance ingestion | Free (platform APIs) | $0 |
| Claude agent graph | Opus + Sonnet mix | ~$0.30 avg |

**One character's full week (~40 pieces) costs ~$30–80** to generate.

Compare:
- Freelance scriptwriter: $50/script × 40 = $2,000/week
- Content team for 10 channels: $500k/year salary
- Our system: ~$1,500/week of API costs across 10 channels, vs. $500k/year team

The math is the pitch.

---

## 17. Demo Storyboard (May 16, ~4 minutes)

1. **(0:00–0:30)** Open dashboard. Root Labs universe loaded. Show character constellation — Maya, Tyler, Jenna, Dr. Chen, Dr. Reid, Coach Eli. *"One brand. Drop in any of the four other Mosaic brands with one config swap."*

2. **(0:30–1:15)** Click "Generate next week's calendar." Engine produces 7-day plan across 5 platforms, ~40 content pieces from 7 canonical story beats. Cross-platform fanout visible in real-time. *"One narrative beat fans out to every platform that matters."*

3. **(1:15–2:30)** Drill into Maya's Wednesday TikTok. Show story context, 3 hook variants, script, screenplay, generated video preview. Pick a hook variant → engine regenerates screenplay + visuals. *"Every piece serves three layers: the scroller today, the follower this month, the universe forever."*

4. **(2:30–3:15)** Switch to Engine Insights. Show learning loop running on synthetic data — *"The engine noticed Maya's mechanism-led hooks convert 2.3× her identification-led hooks last week. Next week's calendar weights toward mechanism."*

5. **(3:15–3:45)** Hit publish on the TikTok. API call visible (sandbox). Then click "Publish episode" on the podcast — quality stack ticks green, RSS + YouTube upload, Spotify + Apple + YouTube ingestion confirmation. *"From script to live on Spotify + Apple + YouTube + 23 directories in 4 minutes."*

6. **(3:45–4:00)** Toggle Autonomous mode. Calendar populates itself for next 30 days. *"This is the future. One brand manager, ten properties, no team."*

---

## 18. Autonomous Mode (the future-state toggle)

Human-in-the-loop is v1 default. Autonomous mode is configured per brand, per piece-type:

```yaml
brand: root_labs
autonomy:
  theme_approval: required
  character_approval: required
  arc_approval: weekly_summary
  script_approval: spot_check_20%
  screenplay_approval: skip
  generated_asset_approval: skip
  publish_approval: skip
  compliance_blocks: hard_stop
```

Different brands tune their trust differently. Scrappy brand = full auto. Regulated brand = every gate on. Architecture identical; only config changes.

---

## 19. Restructuring Roadmap — How to Build This in 3 Days

Translating this spec to a 3-day build (May 13–16, with demo morning of May 16):

### Day 1 — May 13 (today, remaining)

- ✅ Architecture + design locked (this doc)
- Spin up Next.js scaffold, Supabase project, Postgres schema for Layer 2
- Buzzsprout sandbox account + YouTube sandbox channel set up
- Layer 1 brand config for Root Labs hard-coded
- Universe Store seeded with the 6 characters (Maya, Tyler, Jenna, Dr. Chen, Dr. Reid, Coach Eli) at full character-spec depth
- Dashboard shell (Next.js + shadcn/ui), navigation working, View A loading

### Day 2 — May 14

- Layer 3 storytelling engine core: Script agent, Hook variant agent (3 variants), Screenplay agent, Compliance agent
- Story Arc Planner generating 30-day arcs
- Podcast Episode Agent producing full 10-beat 30-min script for *Off the Clock* Ep 1
- Clip Extraction (moment classifier scoring beats, top-10 extraction)
- Cross-Universe Fanout: from one episode, produce X threads, Reddit post, IG carousel, TikTok clips (scripts only, no assets)
- Master Dashboard Views B + C wired to real data

### Day 3 — May 15

- Publishing pipeline: 6-agent quality stack + spot-checker + sandbox simulator
- Spotify adapter (Buzzsprout REST upload, RSS confirmation poll)
- Apple adapter (RSS metadata tuning, sRGB cover validator)
- YouTube adapter (Data API resumable upload, podcast show association, thumbnail upload)
- Cross-platform analytics aggregator (mocked data; real-architecture)
- Master Dashboard Views D + E
- Engine Insights view with synthetic learning loop data
- Demo dry-run, polish, prepare narration

### May 16 morning

- Final smoke test
- Real Buzzsprout sandbox publish + YouTube sandbox publish during demo
- Live demo

### What to cut if behind

- (cuttable) Real publishing — fall back to fully simulated
- (cuttable) Image gen for IG carousel — show static template
- (cuttable) Apple ingestion poll — show via mocked data
- (cuttable) Multiple character cross-platform fanout — demo one (Maya) end-to-end only
- (DO NOT CUT) Podcast 30-min script generation working live
- (DO NOT CUT) Clip extraction working live
- (DO NOT CUT) Engine Insights view with synthetic data
- (DO NOT CUT) Compliance agent visibly running

---

## 20. Open Decisions / To Confirm Before Plan

| # | Decision | Recommendation | Status |
|---|---|---|---|
| 1 | Host (Buzzsprout vs. Transistor) | Buzzsprout for v1 | pending |
| 2 | Show name | "Off the Clock" placeholder | pending |
| 3 | YouTube channel strategy | New channel for *Off the Clock*, separate from Root Labs main | pending |
| 4 | YouTube Premiere in demo | Architected for, instant-publish in demo | pending |
| 5 | Spotify Partner Program API access | Mock for demo if not granted | pending |
| 6 | Real TikTok dev account / sandbox | Sandbox burner | pending |
| 7 | Sponsor disclosure language | Drafted, pending lock | pending |
| 8 | What data user can provide tomorrow | Top 10 TikTok URLs, customer reviews/DMs, compliance guardrails, creator MCP access | committed for May 14 |
| 9 | Final demo length | 4 min stated, may stretch to 5 with Premiere | pending |
| 10 | Whether to demo X / Reddit / IG carousel fanout, or focus on podcast end-to-end | Both — fanout is the differentiator | pending |

---

## 21. What Comes After This Spec

1. User reviews this doc → green-light or revise
2. Invoke `superpowers:writing-plans` skill to produce step-by-step implementation plan
3. Execute plan over Day 1–3
4. Demo May 16
5. Post-hackathon: if entry advances, fold real Root Labs data, swap audio/video gen to production, extend to other Mosaic brands

---

*End of design spec. Next step: user review, then implementation plan.*
