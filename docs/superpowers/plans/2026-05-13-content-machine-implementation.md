# Content Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the demoable critical path of the Mosaic Content Hackathon "Content Machine" — Root Labs reference brand, podcast-centric, with cross-platform fanout and multi-platform publishing pipeline. Demo May 16, 2026.

**Architecture:** Next.js 15 (App Router) full-stack monorepo, Supabase Postgres + Storage, Claude Agent SDK orchestrating storytelling agents, Buzzsprout REST + YouTube Data API v3 for podcast publishing, BullMQ-on-Redis for background jobs. Storytelling engine is the IP; agents are stateless; canon lives in Postgres.

**Tech Stack:** Next.js 15 + React + TypeScript + Tailwind + shadcn/ui · Supabase (Postgres + Storage + Auth) · Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) · BullMQ + Upstash Redis · Buzzsprout API · YouTube Data API v3 · Vitest for unit tests · Playwright for e2e smoke

**Demo path (DO NOT CUT):** podcast 30-min script generation · clip extraction live · cross-platform fanout · engine-insights with synthetic learning data · compliance agent visibly gating

**Stretch (cut if behind):** real audio gen · real video gen for clips · Apple Connect API live · multi-character fanout in demo · YouTube Premiere scheduling

---

## Phase 0 — Reference Material

Spec lives at [docs/superpowers/specs/2026-05-13-content-machine-design.md](../specs/2026-05-13-content-machine-design.md). Read sections 4–12 before starting any task. Section 19 is the day-by-day roadmap; this plan is the task-level breakdown of that roadmap.

Key conventions used throughout:
- Path root is `/Users/archish/Content Hackathon/`
- Working directory should be the project root
- All commands run from project root unless noted
- Commits use Conventional Commits format (`feat:`, `chore:`, `test:`, etc.)
- Each task ends with a commit

---

## Phase 1 — Foundation (Day 1 remainder)

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `next.config.mjs`, `.gitignore`, `.env.local.example`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `lib/utils.ts`, `components/ui/` (shadcn baseline)

- [ ] **Step 1: Initialize git repository**

```bash
cd "/Users/archish/Content Hackathon"
git init
git branch -M main
```

- [ ] **Step 2: Bootstrap Next.js 15 with TypeScript + Tailwind**

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir=false --import-alias="@/*" --no-eslint --use-npm --yes
```

- [ ] **Step 3: Add shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card tabs dialog input textarea select badge separator scroll-area sheet table toast
```

- [ ] **Step 4: Add testing setup**

```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Add `.env.local.example`**

```bash
# Anthropic
ANTHROPIC_API_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Upstash Redis (for BullMQ)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Buzzsprout
BUZZSPROUT_PODCAST_ID=
BUZZSPROUT_API_TOKEN=

# YouTube
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_PODCAST_SHOW_ID=

# Demo mode flag — set to "true" to mock external APIs
DEMO_MODE=true
```

- [ ] **Step 6: Smoke test scaffold**

```bash
npm run dev
```

Visit http://localhost:3000 — should show Next.js default. Kill the dev server. Run `npm run test` — should pass (no tests yet, exits clean).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + Tailwind + shadcn/ui + Vitest"
```

---

### Task 2: Supabase Postgres schema

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`
- Create: `lib/db/client.ts`, `lib/db/types.ts`

- [ ] **Step 1: Create Supabase project + capture credentials**

In supabase.com dashboard: New project → name "content-machine-hackathon" → free tier. Copy URL + anon key + service-role key into `.env.local`.

- [ ] **Step 2: Write initial schema migration**

Create `supabase/migrations/0001_initial_schema.sql`:

```sql
-- Brands
create table brands (
  id text primary key,
  config_yaml text not null,
  created_at timestamptz default now()
);

-- Characters (per brand)
create table characters (
  id text primary key,
  brand_id text not null references brands(id),
  kind text not null check (kind in ('consumer','expert','coach','host')),
  spec_json jsonb not null,                  -- full character spec (§7.3 of spec)
  current_chapter int default 1,
  current_arc_day int default 1,
  created_at timestamptz default now()
);

-- Character arcs
create table arcs (
  id uuid primary key default gen_random_uuid(),
  character_id text not null references characters(id),
  chapter int not null,
  arc_index int not null,
  title text not null,
  day_beats_json jsonb not null,             -- 30-day beat plan
  status text not null default 'planned' check (status in ('planned','active','completed','abandoned')),
  started_at timestamptz,
  ended_at timestamptz
);

-- Universe events (canon ledger)
create table universe_events (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id),
  character_id text references characters(id),
  arc_id uuid references arcs(id),
  event_type text not null,                  -- e.g. 'trial_started','first_good_night','mechanism_learned'
  description text not null,
  payload_json jsonb,
  occurred_at_arc_day int,
  created_at timestamptz default now()
);

-- Content pieces (one row per generated piece, pre-platform-fanout)
create table content_pieces (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id),
  character_id text not null references characters(id),
  piece_type text not null,                  -- 'podcast_episode','tiktok','x_thread','reddit_post','ig_carousel','clip'
  parent_piece_id uuid references content_pieces(id),  -- e.g. clip's parent = podcast episode
  arc_day int,
  status text not null default 'draft' check (status in ('draft','quality_gated','approved','queued','published','flagged','killed')),
  conversion_beats text[] not null default '{}',
  story_layer_data jsonb,                    -- episode/arc/universe layer notes
  primary_pain_point text,
  source_canon_event_id uuid references universe_events(id),
  payload_json jsonb not null,               -- the actual content (script, beats, etc.)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Publications (per-platform instances of a content piece)
create table publications (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces(id),
  platform text not null,                    -- 'spotify','apple','youtube_podcast','tiktok','reels','shorts','x','reddit','ig_carousel','facebook'
  platform_metadata_json jsonb not null,
  platform_asset_url text,
  platform_external_id text,                 -- Spotify episode id, YouTube video id, etc.
  status text not null default 'pending' check (status in ('pending','uploaded','ingesting','live','flagged','killed')),
  scheduled_for timestamptz,
  published_at timestamptz,
  killed_at timestamptz,
  created_at timestamptz default now()
);

-- Performance snapshots
create table performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id),
  pulled_at timestamptz default now(),
  hours_since_publish numeric,
  plays int,
  unique_listeners int,
  completion_rate numeric,
  watch_time_seconds int,
  avg_view_duration_seconds int,
  ctr numeric,
  followers_gained int,
  ratings_added int,
  reviews_sentiment numeric,
  retention_curve_json jsonb,
  raw_json jsonb
);

-- Quality stack audit trail
create table quality_stack_runs (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces(id),
  agent text not null,                       -- 'compliance','editorial','factual','brand_voice','audio_qa','metadata','spotify_policy','apple_policy','youtube_policy'
  result text not null check (result in ('pass','warn','block')),
  reason text,
  details_json jsonb,
  ran_at timestamptz default now()
);

-- Indexes
create index on characters(brand_id);
create index on arcs(character_id);
create index on universe_events(brand_id, character_id);
create index on content_pieces(brand_id, character_id, status);
create index on content_pieces(parent_piece_id);
create index on publications(content_piece_id, platform);
create index on publications(status, scheduled_for);
create index on performance_snapshots(publication_id, pulled_at desc);
```

- [ ] **Step 3: Apply migration**

In Supabase dashboard SQL editor: paste the migration, run. Verify all tables exist in Table Editor.

Alternative via CLI:
```bash
npm install -D supabase
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

- [ ] **Step 4: Create typed Supabase client**

```bash
npm install @supabase/supabase-js
npx supabase gen types typescript --linked > lib/db/types.ts
```

Create `lib/db/client.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

- [ ] **Step 5: Write a smoke test that connects to the DB**

Create `lib/db/__tests__/client.smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { supabaseAdmin } from "../client";

describe("supabase smoke", () => {
  it("can query brands table", async () => {
    const { data, error } = await supabaseAdmin.from("brands").select("id").limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
```

Run: `npm run test`. Expected: PASS (returns empty array, no error).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): initial Postgres schema for brands, characters, arcs, pieces, publications"
```

---

### Task 3: Brand config — Root Labs seed

**Files:**
- Create: `config/brands/root_labs.yaml`
- Create: `lib/brand/loader.ts`
- Create: `lib/brand/__tests__/loader.test.ts`
- Create: `scripts/seed-brand.ts`

- [ ] **Step 1: Write failing test for brand loader**

Create `lib/brand/__tests__/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadBrand } from "../loader";

describe("loadBrand", () => {
  it("loads Root Labs config from YAML and parses pain points", () => {
    const brand = loadBrand("root_labs");
    expect(brand.id).toBe("root_labs");
    expect(brand.products[0].sku).toBe("magashwa_gummies");
    expect(brand.products[0].pain_points.map(p => p.id))
      .toEqual(expect.arrayContaining(["sleep","brain_fog","energy","stress_cortisol"]));
    expect(brand.compliance.claims_allowlist).toContain("supports");
    expect(brand.compliance.claims_blocklist).toContain("cures");
  });

  it("includes required disclaimers", () => {
    const brand = loadBrand("root_labs");
    expect(brand.compliance.required_disclaimers.fda_supplement)
      .toMatch(/FDA/);
  });
});
```

Run: `npm run test`. Expected: FAIL — `loadBrand` not defined.

- [ ] **Step 2: Write Root Labs YAML**

Create `config/brands/root_labs.yaml`:

```yaml
id: root_labs
identity:
  voice: "informed-friend, evidence-first, never preachy"
  tone_register: [warm, specific, slightly-skeptical]
  forbidden_tones: [hyperbolic, preachy, condescending]
audience:
  primary:
    age: "25-45"
    gender: female
    geo: US
    life_stages: [perimenopause, working-mom, career-stress]
  secondary: [fitness-curious-30s-men, stressed-professionals]
products:
  - sku: magashwa_gummies
    pain_points:
      - id: sleep
        gmv_usd: 860000
        vocab:
          - "I haven't slept through the night in a year"
          - "melatonin stopped working"
          - "perimenopause wrecked my sleep"
      - id: brain_fog
        gmv_usd: 418000
        vocab:
          - "forgot my own client's name"
          - "can't hold a thought"
      - id: energy
        gmv_usd: 319000
        vocab:
          - "afternoon crash"
          - "running on coffee"
      - id: stress_cortisol
        gmv_usd: 279000
        vocab:
          - "stress burns through magnesium faster than diet replaces"
          - "everything changed at 37"
      - id: general_wellness
        gmv_usd: 185000
        vocab:
          - "even if you eat perfectly, food doesn't have magnesium it used to"
      - id: muscle_recovery
        gmv_usd: 16000
        vocab:
          - "muscle cramps stopped me from training"
      - id: anxiety_calm
        gmv_usd: 0
        vocab:
          - "my nervous system was shot"
compliance:
  claims_allowlist: ["supports","helps with","promotes","may aid","is associated with"]
  claims_blocklist: ["cures","treats","diagnoses","prevents disease","heals"]
  required_disclaimers:
    fda_supplement: "These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease."
    not_medical_advice: "This is not medical advice. Consult a qualified clinician."
  sponsor_disclosure_required: true
platform_connections:
  buzzsprout:
    podcast_id: "${BUZZSPROUT_PODCAST_ID}"
  youtube:
    podcast_show_id: "${YOUTUBE_PODCAST_SHOW_ID}"
```

- [ ] **Step 3: Implement loader**

Install YAML parser: `npm install yaml`.

Create `lib/brand/loader.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type PainPoint = {
  id: string;
  gmv_usd: number;
  vocab: string[];
};

export type BrandConfig = {
  id: string;
  identity: { voice: string; tone_register: string[]; forbidden_tones: string[] };
  audience: any;
  products: Array<{ sku: string; pain_points: PainPoint[] }>;
  compliance: {
    claims_allowlist: string[];
    claims_blocklist: string[];
    required_disclaimers: Record<string, string>;
    sponsor_disclosure_required: boolean;
  };
  platform_connections: Record<string, Record<string, string>>;
};

export function loadBrand(brandId: string): BrandConfig {
  const path = join(process.cwd(), "config", "brands", `${brandId}.yaml`);
  const raw = readFileSync(path, "utf8");
  return parse(raw) as BrandConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm run test`. Expected: PASS for both `loadBrand` tests.

- [ ] **Step 5: Write seeder script**

Create `scripts/seed-brand.ts`:

```ts
import { loadBrand } from "@/lib/brand/loader";
import { supabaseAdmin } from "@/lib/db/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const brandId = process.argv[2] ?? "root_labs";
  const brand = loadBrand(brandId);
  const yamlText = readFileSync(join(process.cwd(), "config", "brands", `${brandId}.yaml`), "utf8");

  const { error } = await supabaseAdmin.from("brands").upsert({
    id: brand.id,
    config_yaml: yamlText,
  });
  if (error) throw error;
  console.log(`Seeded brand: ${brand.id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts: `"seed:brand": "tsx scripts/seed-brand.ts"`. Install runner: `npm install -D tsx`.

Run: `npm run seed:brand`. Expected stdout: `Seeded brand: root_labs`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(brand): root labs YAML config + loader + seeder"
```

---

### Task 4: Character constellation seed

**Files:**
- Create: `config/characters/root_labs/maya.yaml`, `tyler.yaml`, `jenna.yaml`, `dr_chen.yaml`, `dr_reid.yaml`, `coach_eli.yaml`
- Create: `lib/character/loader.ts`
- Create: `lib/character/__tests__/loader.test.ts`
- Create: `scripts/seed-characters.ts`

- [ ] **Step 1: Write failing test**

Create `lib/character/__tests__/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadCharacter, loadAllCharacters } from "../loader";

describe("character loader", () => {
  it("loads Maya with required spec sections", () => {
    const c = loadCharacter("root_labs", "maya");
    expect(c.id).toBe("maya");
    expect(c.kind).toBe("consumer");
    expect(c.spec.identity.name).toBe("Maya Reyes");
    expect(c.spec.identity.city).toBe("Austin");
    expect(c.spec.pain_ownership.primary_pain_point).toBe("sleep");
    expect(c.spec.voice.signature_phrases.length).toBeGreaterThan(0);
  });

  it("loads all six characters", () => {
    const all = loadAllCharacters("root_labs");
    expect(all.map(c => c.id).sort())
      .toEqual(["coach_eli","dr_chen","dr_reid","jenna","maya","tyler"]);
  });

  it("each character has exclusive pain ownership", () => {
    const all = loadAllCharacters("root_labs");
    const primaries = all
      .filter(c => c.kind === "consumer")
      .map(c => c.spec.pain_ownership.primary_pain_point);
    expect(new Set(primaries).size).toBe(primaries.length);
  });
});
```

Run: `npm run test`. Expected: FAIL — files and loader don't exist.

- [ ] **Step 2: Write character YAMLs**

Create `config/characters/root_labs/maya.yaml`:

```yaml
id: maya
brand_id: root_labs
kind: consumer
spec:
  identity:
    name: "Maya Reyes"
    age: 33
    city: "Austin, TX"
    profession: "Marketing manager at a mid-size SaaS company"
    life_stage: "early perimenopause, no kids yet, in a 4-year relationship"
  physical:
    appearance_anchors: ["dark wavy hair, usually up", "tortoiseshell glasses she only wears at night", "wears the same hoodie three days a week"]
    voice_age_range: "30s-American-female-warm-slightly-tired"
    vocal_quirks: ["trails off mid-sentence when remembering something", "laughs at her own bleak observations"]
  psyche:
    core_frustration: "I'm 33 and my body feels like it skipped a decade"
    what_theyve_tried: ["melatonin", "magnesium oxide (the wrong kind)", "CBD oil", "blue light glasses", "a $400 sleep mask"]
    what_they_wont_admit: "I'm afraid I peaked"
    what_theyre_secretly_proud_of: "I'm the friend everyone calls when they can't sleep"
    what_makes_them_cry: "old voicemails from her grandmother, and Sundays at 4pm"
  context:
    morning_routine: "Hits snooze twice, makes pour-over, scrolls Instagram on the toilet, regrets it"
    evening_routine: "Wine at 8 even though she said she'd stop, doom-scrolls until 1am"
    recurring_antagonist: "Her boss Bryce who Slacks her at 11:47pm"
    recurring_safe_place: "Mozart's Coffee on Lake Austin Boulevard, second window seat"
    their_tell: "When she's anxious, she opens and closes her phone three times in a row"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
    what_just_changed: "Bryce just told her in 1:1 that she 'seems checked out'"
    what_is_about_to_change: "She's about to Google 'why doesn't melatonin work' at 2am"
  pain_ownership:
    primary_pain_point: "sleep"
    secondary: ["brain_fog","stress_cortisol"]
    off_limits: ["muscle_recovery","anxiety_calm"]
  voice:
    vocabulary_band: "smart-millennial, light irony, no jargon, occasional therapy-speak"
    sentence_length: "medium, with one short punctuating clause per paragraph"
    signature_phrases:
      - "I'm 33 and—"
      - "Like, what is even—"
      - "Anyway. The point is."
      - "I'm going to be honest with you"
    what_they_never_say: ["girlboss","manifest","my truth","journey","grateful"]
```

Create `config/characters/root_labs/tyler.yaml`:

```yaml
id: tyler
brand_id: root_labs
kind: consumer
spec:
  identity:
    name: "Tyler Brooks"
    age: 28
    city: "Denver, CO"
    profession: "Backend engineer, remote, second-year"
    life_stage: "single, third year of trail running, just signed up for first 50k"
  physical:
    appearance_anchors: ["short beard he keeps tidy", "always in a Patagonia fleece", "Salomons even at the coffee shop"]
    voice_age_range: "late-20s-American-male-measured"
    vocal_quirks: ["over-explains things engineer-style", "uses 'literally' as a meaningful word"]
  psyche:
    core_frustration: "I have the time and the discipline but my body won't keep up"
    what_theyve_tried: ["BCAAs", "tart cherry juice", "ice baths", "creatine"]
    what_they_wont_admit: "I'm scared this is just what 28 feels like"
    what_theyre_secretly_proud_of: "He's the most reliable friend in his group chat"
    what_makes_them_cry: "His dog Murphy, and the last 2k of any long run"
  context:
    morning_routine: "5:30am wake, 90-min run before standup"
    evening_routine: "Magnesium curious — currently overdoing zinc, doesn't know why"
    recurring_antagonist: "His own quad cramps at mile 18"
    recurring_safe_place: "Bear Creek Trail east loop"
    their_tell: "When he's overtrained, he gets weirdly philosophical"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
    what_just_changed: "DNF'd a 50k last weekend at mile 22, cramps"
    what_is_about_to_change: "Talks to a sports nutritionist (Coach Eli) on the podcast"
  pain_ownership:
    primary_pain_point: "muscle_recovery"
    secondary: ["energy","general_wellness"]
    off_limits: ["sleep","brain_fog","anxiety_calm"]
  voice:
    vocabulary_band: "engineer-precise, training-vocabulary, occasional dry humor"
    sentence_length: "short to medium, declarative"
    signature_phrases:
      - "So I ran the numbers"
      - "I'm gonna be honest"
      - "The thing nobody tells you is"
    what_they_never_say: ["grindset","beast mode","no excuses"]
```

Create `config/characters/root_labs/jenna.yaml`:

```yaml
id: jenna
brand_id: root_labs
kind: consumer
spec:
  identity:
    name: "Jenna Caldwell"
    age: 41
    city: "Franklin, TN"
    profession: "Part-time graphic designer, full-time mom"
    life_stage: "married 12 years, two kids (6 and 4), husband travels for healthcare consulting"
  physical:
    appearance_anchors: ["pixie cut grown out to chin", "always wearing the same gold necklace from her grandmother", "circles under eyes she's stopped trying to hide"]
    voice_age_range: "early-40s-American-female-southern-light"
    vocal_quirks: ["sighs mid-sentence", "starts stories with 'okay so—'"]
  psyche:
    core_frustration: "My mornings feel like emergencies and it's not anyone's fault but mine"
    what_theyve_tried: ["valerian","melatonin","CBD oil","glycine before bed","sleep meditation app"]
    what_they_wont_admit: "I'm jealous of my friends who take Ambien"
    what_theyre_secretly_proud_of: "She still draws, even at 11pm, even badly"
    what_makes_them_cry: "her son saying 'mom you look tired'"
  context:
    morning_routine: "5:30am up before kids, coffee in the dark, 20 mins of peace"
    evening_routine: "Kids down by 8:30, glass of wine, draws or scrolls"
    recurring_antagonist: "her own brain at 3am"
    recurring_safe_place: "the porch swing with her sketchbook"
    their_tell: "rubs her temples in a circular motion when masking"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
    what_just_changed: "Her son told her 'mom you look tired' yesterday morning"
    what_is_about_to_change: "She's about to text her sister, who is going to mention magnesium"
  pain_ownership:
    primary_pain_point: "anxiety_calm"
    secondary: ["stress_cortisol","sleep"]
    off_limits: ["muscle_recovery"]
  voice:
    vocabulary_band: "warm-southern, plain, occasional mom-isms, light self-deprecation"
    sentence_length: "medium-long, comma-spliced"
    signature_phrases:
      - "Okay so—"
      - "Bless it"
      - "I'm not gonna pretend"
      - "And here's the thing"
    what_they_never_say: ["self-care","me-time","wine mom","mama bear"]
```

Create `config/characters/root_labs/dr_chen.yaml`:

```yaml
id: dr_chen
brand_id: root_labs
kind: expert
spec:
  identity:
    name: "Dr. Sarah Chen, PhD"
    age: 44
    city: "New York, NY"
    profession: "Sleep researcher, Stanford-trained, runs an integrative clinic in TriBeCa"
    life_stage: "two teenagers, married to an architect"
  physical:
    appearance_anchors: ["short bob","wire-rim glasses","always in a navy or charcoal sweater"]
    voice_age_range: "40s-American-female-precise-warm"
    vocal_quirks: ["pauses before key statements", "tends to say 'mechanistically' once per podcast"]
  psyche:
    core_frustration: "Patients have been gaslit by the medical system for a decade and I have 12 minutes to undo it"
    what_theyve_tried: "two decades of clinical practice + research"
    what_they_wont_admit: "I think the medical establishment has failed perimenopausal women"
    what_theyre_secretly_proud_of: "Her patients describe her as 'the doctor who finally listened'"
  context:
    morning_routine: "wakes at 6, 20 min meditation, no caffeine until 10"
    evening_routine: "writes in a notebook by 9:30"
    recurring_antagonist: "outdated CME materials"
    recurring_safe_place: "her clinic's library"
    their_tell: "removes her glasses when she's about to disagree with a colleague"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
  pain_ownership:
    primary_pain_point: "sleep"
    secondary: ["stress_cortisol","brain_fog","anxiety_calm"]
    off_limits: []
  voice:
    vocabulary_band: "clinical-but-warm, accessible-scientific, cites studies but translates them"
    sentence_length: "varied; complex when explaining mechanism, short when correcting a myth"
    signature_phrases:
      - "Mechanistically what's happening is"
      - "The data on this is actually quite clear"
      - "What I tell my patients is"
      - "Here's the part nobody talks about"
    what_they_never_say: ["toxins","cleanse","detox","big pharma"]
```

Create `config/characters/root_labs/dr_reid.yaml`:

```yaml
id: dr_reid
brand_id: root_labs
kind: expert
spec:
  identity:
    name: "Dr. Marcus Reid, DO"
    age: 52
    city: "Austin, TX"
    profession: "Integrative medicine physician, 22 years of clinical practice"
    life_stage: "second marriage, two adult children, weekend rancher"
  physical:
    appearance_anchors: ["white beard","weathered hands","always wears a denim shirt"]
    voice_age_range: "50s-American-male-southern-thoughtful"
    vocal_quirks: ["draws words out","starts answers with 'well—'"]
  psyche:
    core_frustration: "Medicine treats systems but bodies are people"
    what_theyve_tried: "two decades of practice across rural Texas and Austin"
    what_they_wont_admit: "I think most modern stress is downstream of meaning, not biology"
    what_theyre_secretly_proud_of: "His patients call him by his first name"
  context:
    morning_routine: "coffee on the porch by 5:30"
    evening_routine: "reads physical books"
    recurring_antagonist: "insurance billing codes"
    recurring_safe_place: "his ranch in Dripping Springs"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
  pain_ownership:
    primary_pain_point: "stress_cortisol"
    secondary: ["general_wellness","energy"]
    off_limits: ["muscle_recovery"]
  voice:
    vocabulary_band: "warm-southern, story-led, occasional folksy metaphor"
    sentence_length: "long, meandering, with a kicker at the end"
    signature_phrases:
      - "Well, here's the thing"
      - "I had a patient last week"
      - "What I've learned in 22 years is"
    what_they_never_say: ["biohack","optimize","stack"]
```

Create `config/characters/root_labs/coach_eli.yaml`:

```yaml
id: coach_eli
brand_id: root_labs
kind: coach
spec:
  identity:
    name: "Coach Eli Wright, CSCS"
    age: 37
    city: "Boulder, CO"
    profession: "Sports performance coach, ex-collegiate distance runner"
    life_stage: "single, lives near the trail system"
  physical:
    appearance_anchors: ["close-cropped hair","worn La Sportiva trail shoes","sleeve tattoo of mountain ridgelines"]
    voice_age_range: "late-30s-American-male-no-nonsense"
    vocal_quirks: ["uses 'the work' as a noun a lot"]
  psyche:
    core_frustration: "Athletes optimize the wrong variable for the entire wrong sport"
    what_they_wont_admit: "Recovery is harder than training and nobody wants to hear it"
    what_theyre_secretly_proud_of: "Two of his amateur athletes qualified for Western States"
  context:
    morning_routine: "60-min easy run by 5:30, then coffee"
    evening_routine: "writes training notes longhand"
    recurring_antagonist: "the influencer-coach industrial complex"
    recurring_safe_place: "Sanitas Mountain"
  arc_state:
    current_chapter: 1
    days_in_journey: 0
  pain_ownership:
    primary_pain_point: "muscle_recovery"
    secondary: ["energy","general_wellness"]
    off_limits: ["sleep","brain_fog","anxiety_calm"]
  voice:
    vocabulary_band: "training-precise, no-frills, occasional dry humor"
    sentence_length: "short, declarative, sometimes one-word"
    signature_phrases:
      - "The work is the answer"
      - "Most athletes get this backwards"
      - "Look — here's what the literature says"
    what_they_never_say: ["alpha","grind","beast"]
```

- [ ] **Step 3: Implement character loader**

Create `lib/character/loader.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type CharacterSpec = {
  identity: any;
  physical: any;
  psyche: any;
  context: any;
  arc_state: any;
  pain_ownership: { primary_pain_point: string; secondary: string[]; off_limits: string[] };
  voice: any;
};

export type Character = {
  id: string;
  brand_id: string;
  kind: "consumer" | "expert" | "coach" | "host";
  spec: CharacterSpec;
};

export function loadCharacter(brandId: string, characterId: string): Character {
  const path = join(process.cwd(), "config", "characters", brandId, `${characterId}.yaml`);
  return parse(readFileSync(path, "utf8")) as Character;
}

export function loadAllCharacters(brandId: string): Character[] {
  const dir = join(process.cwd(), "config", "characters", brandId);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(join(dir, f), "utf8")) as Character);
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm run test`. Expected: PASS for all three character loader tests.

- [ ] **Step 5: Write seeder**

Create `scripts/seed-characters.ts`:

```ts
import { loadAllCharacters } from "@/lib/character/loader";
import { supabaseAdmin } from "@/lib/db/client";

async function main() {
  const brandId = process.argv[2] ?? "root_labs";
  const characters = loadAllCharacters(brandId);
  for (const c of characters) {
    const { error } = await supabaseAdmin.from("characters").upsert({
      id: c.id,
      brand_id: c.brand_id,
      kind: c.kind,
      spec_json: c.spec,
    });
    if (error) throw error;
    console.log(`Seeded: ${c.id}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts: `"seed:characters": "tsx scripts/seed-characters.ts"`.

Run: `npm run seed:brand && npm run seed:characters`. Expected: six "Seeded:" lines.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(characters): seed Maya, Tyler, Jenna, Dr. Chen, Dr. Reid, Coach Eli for Root Labs"
```

---

### Task 5: Universe Store query helpers

**Files:**
- Create: `lib/universe/store.ts`
- Create: `lib/universe/__tests__/store.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/universe/__tests__/store.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { getCharacter, getAllCharacters, recordUniverseEvent, getCharacterArc } from "../store";

describe("universe store", () => {
  it("returns character by id", async () => {
    const maya = await getCharacter("maya");
    expect(maya?.spec.identity.name).toBe("Maya Reyes");
  });

  it("lists all characters for a brand", async () => {
    const all = await getAllCharacters("root_labs");
    expect(all.length).toBe(6);
  });

  it("records a universe event", async () => {
    const ev = await recordUniverseEvent({
      brand_id: "root_labs",
      character_id: "maya",
      event_type: "trial_started",
      description: "Maya started 200mg magnesium glycinate",
      occurred_at_arc_day: 13,
    });
    expect(ev.id).toBeDefined();
  });
});
```

Run: `npm run test`. Expected: FAIL — store not defined.

- [ ] **Step 2: Implement store**

Create `lib/universe/store.ts`:

```ts
import { supabaseAdmin } from "@/lib/db/client";
import type { CharacterSpec } from "@/lib/character/loader";

export type StoredCharacter = {
  id: string;
  brand_id: string;
  kind: string;
  spec: CharacterSpec;
  current_chapter: number;
  current_arc_day: number;
};

export async function getCharacter(id: string): Promise<StoredCharacter | null> {
  const { data, error } = await supabaseAdmin
    .from("characters").select("*").eq("id", id).single();
  if (error) return null;
  return { ...data, spec: data.spec_json } as any;
}

export async function getAllCharacters(brandId: string): Promise<StoredCharacter[]> {
  const { data, error } = await supabaseAdmin
    .from("characters").select("*").eq("brand_id", brandId);
  if (error || !data) return [];
  return data.map((d: any) => ({ ...d, spec: d.spec_json }));
}

export type NewUniverseEvent = {
  brand_id: string;
  character_id?: string;
  arc_id?: string;
  event_type: string;
  description: string;
  payload_json?: any;
  occurred_at_arc_day?: number;
};

export async function recordUniverseEvent(ev: NewUniverseEvent) {
  const { data, error } = await supabaseAdmin
    .from("universe_events").insert(ev).select().single();
  if (error) throw error;
  return data;
}

export async function getCharacterArc(characterId: string) {
  const { data, error } = await supabaseAdmin
    .from("arcs").select("*")
    .eq("character_id", characterId).eq("status","active").maybeSingle();
  if (error) throw error;
  return data;
}

export async function recentUniverseEventsForCharacter(characterId: string, limit = 10) {
  const { data, error } = await supabaseAdmin
    .from("universe_events").select("*")
    .eq("character_id", characterId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 3: Run tests to verify**

`npm run test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(universe): store query helpers for characters, arcs, events"
```

---

## Phase 2 — Storytelling Engine Core (Day 2)

### Task 6: Claude Agent SDK base wrapper

**Files:**
- Create: `lib/agents/base.ts`
- Create: `lib/agents/__tests__/base.test.ts`

- [ ] **Step 1: Install SDK**

```bash
npm install @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk
```

- [ ] **Step 2: Write failing test**

Create `lib/agents/__tests__/base.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runAgent } from "../base";

describe("agent base", () => {
  it("runs a simple agent and returns text", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const result = await runAgent({
      model: "claude-haiku-4-5-20251001",
      system: "Reply with exactly the word PONG and nothing else.",
      user: "Ping?",
      maxTokens: 20,
    });
    expect(result.toUpperCase()).toContain("PONG");
  });
});
```

Run: `npm run test`. Expected: FAIL — base not defined.

- [ ] **Step 3: Implement base**

Create `lib/agents/base.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type AgentRunOptions = {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  cacheSystem?: boolean;
};

export async function runAgent(opts: AgentRunOptions): Promise<string> {
  const model = opts.model ?? "claude-sonnet-4-6";
  const systemBlocks = opts.cacheSystem
    ? [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }]
    : opts.system;

  const resp = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    system: systemBlocks as any,
    messages: [{ role: "user", content: opts.user }],
  });

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return text;
}

export async function runJsonAgent<T>(opts: AgentRunOptions): Promise<T> {
  const text = await runAgent({
    ...opts,
    system: opts.system + "\n\nIMPORTANT: Reply ONLY with valid JSON. No markdown, no prose.",
  });
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(trimmed) as T;
}
```

- [ ] **Step 4: Run test, verify pass**

`npm run test`. Expected: PASS (or skip if no API key in CI).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agents): base Claude wrapper with JSON helper + prompt caching"
```

---

### Task 7: Story Arc Planner agent

**Files:**
- Create: `lib/agents/arc-planner.ts`
- Create: `lib/agents/__tests__/arc-planner.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/agents/__tests__/arc-planner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planArc } from "../arc-planner";

describe("arc planner", () => {
  it("produces a 30-day arc with correct beat structure", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const arc = await planArc({
      characterId: "maya",
      chapter: 1,
      arcIndex: 1,
    });
    expect(arc.day_beats.length).toBe(30);
    expect(arc.title.length).toBeGreaterThan(5);
    // Day 1-3 should be Identification heavy
    expect(arc.day_beats[0].conversion_beats).toContain("identification");
    // Around day 13-17 should reveal mechanism
    const mechanismDays = arc.day_beats.filter((b: any) => b.conversion_beats.includes("mechanism"));
    expect(mechanismDays.length).toBeGreaterThan(0);
  }, 60_000);
});
```

Run: `npm run test`. Expected: FAIL.

- [ ] **Step 2: Implement arc planner**

Create `lib/agents/arc-planner.ts`:

```ts
import { runJsonAgent } from "./base";
import { getCharacter } from "@/lib/universe/store";
import { loadBrand } from "@/lib/brand/loader";

export type DayBeat = {
  day: number;
  beat_summary: string;
  story_function: string;
  conversion_beats: string[];
  suggested_content_pieces: Array<{ piece_type: string; angle: string }>;
};

export type ArcPlan = {
  title: string;
  one_line_premise: string;
  day_beats: DayBeat[];
};

const SYSTEM_PROMPT = `You are the Story Arc Planner for the Mosaic Content Machine.

You design 30-day character arcs for serialized short-form content. Each arc nests inside a 90-day chapter that nests inside a 365-day saga. The arc must hit the 6 conversion beats in sequence over 30 days:

1. Days 1-3: IDENTIFICATION — setup the specific pain
2. Days 4-7: External dismissal / building frustration ("doctor said it's just stress")
3. Days 8-12: Investigation begins (googling, Reddit deep-dive)
4. Days 13-17: MECHANISM REVEAL — the biology becomes legible; PERMISSION builds
5. Days 18-22: First trial + skepticism (Permission)
6. Days 23-27: The shift; PROOF lands
7. Days 28-30: The reframe; soft ACTION

Each day produces 1-3 content pieces. Each beat must:
- Be hyper-specific to the character's psyche, context, voice
- Advance one universe-canon event (the character's life moves forward)
- Earn the next beat (no skipping emotional steps)

Output JSON matching this exact shape:
{
  "title": "<arc title>",
  "one_line_premise": "<one sentence>",
  "day_beats": [
    {
      "day": 1,
      "beat_summary": "<2-3 sentences specific to character>",
      "story_function": "<one of: setup_pain, external_dismissal, investigation, mechanism_reveal, first_trial, the_shift, the_reframe>",
      "conversion_beats": ["identification" | "mechanism" | "bridge" | "proof" | "permission" | "action"],
      "suggested_content_pieces": [
        { "piece_type": "tiktok" | "x_diary" | "x_mechanism_thread" | "podcast_episode" | "podcast_clip" | "reddit_post" | "ig_carousel", "angle": "<specific angle>" }
      ]
    }
  ]
}

Reply with exactly 30 day entries (day 1 through day 30).`;

export async function planArc(input: {
  characterId: string;
  chapter: number;
  arcIndex: number;
}): Promise<ArcPlan> {
  const character = await getCharacter(input.characterId);
  if (!character) throw new Error(`Character not found: ${input.characterId}`);
  const brand = loadBrand(character.brand_id);

  const primary = character.spec.pain_ownership.primary_pain_point;
  const painData = brand.products[0].pain_points.find((p) => p.id === primary);

  const user = `Plan arc ${input.arcIndex} of chapter ${input.chapter} for this character.

CHARACTER:
${JSON.stringify(character.spec, null, 2)}

PRIMARY PAIN POINT DATA:
${JSON.stringify(painData, null, 2)}

BRAND VOICE: ${brand.identity.voice}
TONE: ${brand.identity.tone_register.join(", ")}
FORBIDDEN TONES: ${brand.identity.forbidden_tones.join(", ")}

Constraints:
- Every beat is specific to THIS character (use their context, signature phrases, the recurring antagonist, the recurring safe place)
- Pain point is "${primary}" — do not stray into "${character.spec.pain_ownership.off_limits.join(",")}"
- Do not use forbidden phrases listed in character spec
- Podcast episodes appear ~once per arc (typically around day 14-17, when mechanism reveal lands)
- Distribute content pieces across TikTok, X diary, podcast clips, occasional Reddit + IG carousel

Return JSON.`;

  return runJsonAgent<ArcPlan>({
    model: "claude-opus-4-7",
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 8000,
    temperature: 0.8,
    cacheSystem: true,
  });
}
```

- [ ] **Step 3: Run test**

`npm run test`. Expected: PASS (≤60s).

- [ ] **Step 4: Add CLI runner for manual inspection**

Create `scripts/plan-arc.ts`:

```ts
import { planArc } from "@/lib/agents/arc-planner";

async function main() {
  const characterId = process.argv[2] ?? "maya";
  const arc = await planArc({ characterId, chapter: 1, arcIndex: 1 });
  console.log(JSON.stringify(arc, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts: `"plan:arc": "tsx scripts/plan-arc.ts"`.

Run: `npm run plan:arc maya`. Verify output is a coherent 30-day arc.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agents): story arc planner produces 30-day character arc with conversion beats"
```

---

### Task 8: Podcast Episode Agent (THE big one)

**Files:**
- Create: `lib/agents/podcast-episode.ts`
- Create: `lib/agents/__tests__/podcast-episode.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/agents/__tests__/podcast-episode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generatePodcastEpisode } from "../podcast-episode";

describe("podcast episode agent", () => {
  it("produces full 10-beat 30-min Off the Clock episode", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const ep = await generatePodcastEpisode({
      show: "off_the_clock",
      hostId: "maya",
      guestId: "dr_chen",
      arcDay: 15,
      topic: "Why melatonin stopped working",
      seasonNumber: 1,
      episodeNumber: 4,
    });
    expect(ep.beats.length).toBe(10);
    expect(ep.beats[0].name).toBe("cold_open");
    expect(ep.beats[9].name).toBe("outro");
    expect(ep.beats[0].timecode_start).toBe("00:00");
    expect(ep.beats[9].timecode_end).toBe("30:00");
    // each beat has script content
    for (const b of ep.beats) {
      expect(b.script.length).toBeGreaterThan(100);
    }
    // clip extraction sidebar populated
    expect(ep.clip_candidates.length).toBeGreaterThanOrEqual(6);
  }, 120_000);
});
```

Run: `npm run test`. Expected: FAIL.

- [ ] **Step 2: Implement podcast episode agent**

Create `lib/agents/podcast-episode.ts`:

```ts
import { runJsonAgent } from "./base";
import { getCharacter, recentUniverseEventsForCharacter } from "@/lib/universe/store";
import { loadBrand } from "@/lib/brand/loader";

const BEAT_TEMPLATE = `
BEAT TEMPLATE (10 beats, 30 minutes):

ACT 1 — HOOK & PROBLEM (0:00-5:00)
1. cold_open (0:00-0:30) — Host tells a hyper-specific recent failure moment. Must be clipworthy. Universal identification.
2. show_intro (0:30-1:00) — Theme music cue. Host welcome. Guest tease.
3. stakes (1:00-5:00) — Personal stakes. Why does this matter to host RIGHT NOW. Optional listener-DM read.

ACT 2 — INVESTIGATION (5:00-20:00)
4. mechanism_reveal (5:00-9:00) — Expert explains biology. Host plays audience surrogate ("wait, slow down").
5. personal_application (9:00-15:00) — Mechanism applied to host's situation. Host pushes back. Clinical anecdotes from expert.
6. cultural_reframe (15:00-20:00) — Life-stage context. "You're not crazy, the system is broken."

ACT 3 — PATH FORWARD (20:00-30:00)
7. what_actually_works (20:00-24:00) — Expert gives 3 evidence-based actions. ONE is magnesium glycinate, framed as one of three. Host: "I'm going to try this for two weeks and report back."
8. the_reframe (24:00-27:00) — Host processes. Vulnerability moment. Emotional resonance.
9. listener_wisdom_cta (27:00-29:00) — "DM me — I read everything." Next-ep tease.
10. outro (29:00-30:00) — Theme close. SPONSOR READ for MagAshwa with code OFFCLOCK + FDA disclaimer.
`;

const SYSTEM_PROMPT = `You are the Podcast Episode Writer for "Off the Clock" — a Root Labs / MagAshwa-sponsored two-hander conversational health podcast hosted by Maya Reyes (consumer) with rotating expert guests.

Your output is a screenplay-format episode script with timecodes, character action, dialogue, and SFX cues.

${BEAT_TEMPLATE}

THREE SIMULTANEOUS STORY LAYERS — every beat must serve all three:
- EPISODE layer: self-contained payoff for a stranger landing today
- ARC layer: advances host's current 30-day arc; reference what just changed in their life
- UNIVERSE layer: drops one piece of canon that compounds (recurring character, callback to last week, signature phrase)

CONVERSION BEATS — across the episode, hit Identification, Mechanism, Bridge, Permission, Proof, Action.

CLIP CANDIDATES — after the script, identify 6-12 moments most likely to extract into short-form clips. Each clip needs:
- which beat it comes from
- in/out timestamps within the beat
- why it would convert (emotional density / mechanism density / quotability / specificity)
- 3 hook variants (different first-3-seconds angles)
- funnel stage (top/mid/bottom)
- platform routing (tiktok, reels, shorts, x, ig_carousel)

COMPLIANCE RULES (HARD):
- Use only allowlisted claim phrasing ("supports", "helps with", "promotes", "may aid")
- Never say "cures", "treats", "diagnoses", "prevents disease", "heals"
- Sponsor read in beat 10 must include FDA disclaimer
- Product mentioned in beat 7 as ONE of THREE actions, never as the only answer

OUTPUT JSON shape:
{
  "show": "off_the_clock",
  "season": <number>,
  "episode": <number>,
  "title": "<episode title, ~80 chars, brand-led for Spotify>",
  "youtube_title": "<SEO-led variant for YouTube>",
  "logline": "<one sentence>",
  "beats": [
    {
      "index": 1,
      "name": "cold_open",
      "timecode_start": "00:00",
      "timecode_end": "00:30",
      "story_layers": { "episode": "<x>", "arc": "<x>", "universe": "<x>" },
      "conversion_beats": ["identification"],
      "script": "<screenplay format with HOST:, GUEST:, [SFX], [PAUSE] cues>"
    }, ...
  ],
  "clip_candidates": [
    {
      "from_beat": 1,
      "in_seconds": 0,
      "out_seconds": 32,
      "rationale": "<why it converts>",
      "hook_variants": ["<v1>","<v2>","<v3>"],
      "funnel_stage": "top",
      "platforms": ["tiktok","reels","shorts"]
    }, ...
  ],
  "sponsor_read": {
    "script": "<the sponsor copy as it appears in beat 10>",
    "code": "OFFCLOCK",
    "includes_fda_disclaimer": true
  }
}`;

export type EpisodeOutput = {
  show: string;
  season: number;
  episode: number;
  title: string;
  youtube_title: string;
  logline: string;
  beats: Array<{
    index: number;
    name: string;
    timecode_start: string;
    timecode_end: string;
    story_layers: { episode: string; arc: string; universe: string };
    conversion_beats: string[];
    script: string;
  }>;
  clip_candidates: Array<{
    from_beat: number;
    in_seconds: number;
    out_seconds: number;
    rationale: string;
    hook_variants: string[];
    funnel_stage: "top" | "mid" | "bottom";
    platforms: string[];
  }>;
  sponsor_read: { script: string; code: string; includes_fda_disclaimer: boolean };
};

export async function generatePodcastEpisode(input: {
  show: string;
  hostId: string;
  guestId: string;
  arcDay: number;
  topic: string;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<EpisodeOutput> {
  const host = await getCharacter(input.hostId);
  const guest = await getCharacter(input.guestId);
  if (!host || !guest) throw new Error("Host or guest not found");
  const brand = loadBrand(host.brand_id);
  const recentEvents = await recentUniverseEventsForCharacter(input.hostId, 5);

  const user = `Generate episode ${input.episodeNumber} of season ${input.seasonNumber}.

TOPIC: ${input.topic}
HOST ARC DAY: ${input.arcDay} of 30
TODAY'S ARC SITUATION: Host is in the ${input.arcDay <= 7 ? "setup/dismissal" : input.arcDay <= 12 ? "investigation" : input.arcDay <= 17 ? "mechanism reveal" : input.arcDay <= 22 ? "first trial" : input.arcDay <= 27 ? "the shift" : "reframe"} phase

HOST: ${host.spec.identity.name}
${JSON.stringify(host.spec, null, 2)}

GUEST: ${guest.spec.identity.name}
${JSON.stringify(guest.spec, null, 2)}

RECENT UNIVERSE EVENTS for host:
${JSON.stringify(recentEvents, null, 2)}

BRAND COMPLIANCE:
- Allowlist: ${brand.compliance.claims_allowlist.join(", ")}
- Blocklist: ${brand.compliance.claims_blocklist.join(", ")}
- FDA disclaimer required in sponsor read: "${brand.compliance.required_disclaimers.fda_supplement}"

CRITICAL:
- Host MUST use their signature_phrases at least twice
- Guest MUST use THEIR signature_phrases at least twice
- Beat 1 cold open must be SPECIFIC and recent — pull from host's "what_just_changed" or "their_tell"
- Beat 6 cultural reframe must connect to host's life stage authentically
- 6-12 clip candidates spread across all three Acts (don't cluster them in Act 2)

Return JSON only.`;

  return runJsonAgent<EpisodeOutput>({
    model: "claude-opus-4-7",
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 16000,
    temperature: 0.85,
    cacheSystem: true,
  });
}
```

- [ ] **Step 3: Run test**

`npm run test -- podcast-episode`. Expected: PASS (≤120s).

- [ ] **Step 4: CLI runner**

Create `scripts/generate-episode.ts`:

```ts
import { generatePodcastEpisode } from "@/lib/agents/podcast-episode";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const ep = await generatePodcastEpisode({
    show: "off_the_clock",
    hostId: process.argv[2] ?? "maya",
    guestId: process.argv[3] ?? "dr_chen",
    arcDay: Number(process.argv[4] ?? 15),
    topic: process.argv[5] ?? "Why melatonin stopped working",
    seasonNumber: 1,
    episodeNumber: Number(process.argv[6] ?? 4),
  });
  const out = join(process.cwd(), "tmp", "episodes");
  mkdirSync(out, { recursive: true });
  const path = join(out, `s${ep.season}e${ep.episode}.json`);
  writeFileSync(path, JSON.stringify(ep, null, 2));
  console.log(`Wrote: ${path}`);
  console.log(`Title: ${ep.title}`);
  console.log(`Beats: ${ep.beats.length} | Clip candidates: ${ep.clip_candidates.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json`: `"gen:episode": "tsx scripts/generate-episode.ts"`.

Run: `npm run gen:episode maya dr_chen 15 "Why melatonin stopped working" 4`. Inspect `tmp/episodes/s1e4.json` — confirm 10 beats, clip candidates, sponsor read with FDA disclaimer.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agents): podcast episode generator produces 10-beat 30-min script with clip candidates"
```

---

### Task 9: Clip Extraction & Hook Variant Engine

**Files:**
- Create: `lib/agents/clip-extractor.ts`
- Create: `lib/agents/__tests__/clip-extractor.test.ts`

The Podcast Episode Agent already proposes clip candidates inline. This task formalizes scoring, filtering to top N, and producing platform-specific final outputs for each clip.

- [ ] **Step 1: Write failing test**

Create `lib/agents/__tests__/clip-extractor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractClips, scoreClipCandidate } from "../clip-extractor";

describe("clip extractor", () => {
  it("scores clip candidates and returns top N", () => {
    const candidates = [
      { from_beat: 1, in_seconds: 0, out_seconds: 30, rationale: "Cold open — Maya forgot client name on Zoom (specific + vulnerable)", hook_variants: ["a","b","c"], funnel_stage: "top", platforms: ["tiktok"] },
      { from_beat: 5, in_seconds: 540, out_seconds: 600, rationale: "Generic transition", hook_variants: ["a","b","c"], funnel_stage: "mid", platforms: ["tiktok"] },
    ];
    const scoredA = scoreClipCandidate(candidates[0] as any);
    const scoredB = scoreClipCandidate(candidates[1] as any);
    expect(scoredA).toBeGreaterThan(scoredB);
  });

  it("extracts top-10 with platform adaptations", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    // Read a previously-generated episode JSON
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ep = JSON.parse(fs.readFileSync(path.join(process.cwd(),"tmp","episodes","s1e4.json"),"utf8"));
    const clips = await extractClips(ep, { topN: 10 });
    expect(clips.length).toBeLessThanOrEqual(10);
    for (const c of clips) {
      expect(c.platform_adaptations.length).toBeGreaterThan(0);
    }
  }, 90_000);
});
```

- [ ] **Step 2: Implement scoring + adaptation**

Create `lib/agents/clip-extractor.ts`:

```ts
import { runJsonAgent } from "./base";
import type { EpisodeOutput } from "./podcast-episode";

export type FinalClip = {
  from_beat: number;
  in_seconds: number;
  out_seconds: number;
  rationale: string;
  funnel_stage: "top" | "mid" | "bottom";
  score: number;
  hook_chosen: string;
  hook_variants: string[];
  platform_adaptations: Array<{
    platform: "tiktok" | "reels" | "shorts" | "x" | "ig_carousel";
    title_or_caption: string;
    on_screen_text: string;
    cta: string;
    hashtags: string[];
  }>;
};

const SPECIFICITY_TERMS = ["client","Zoom","2am","melatonin","cortisol","Bryce","client's name","perimenopause","sister","mom","track","trail","cramps"];
const EMOTIONAL_TERMS = ["I'm scared","I'm 33","I haven't","I forgot","jealous","tired","afraid","broken","exhausted"];
const MECHANISM_TERMS = ["cortisol","magnesium","glycinate","nervous system","HPA","circadian","REM","glycine","NMDA","GABA"];

export function scoreClipCandidate(c: { rationale: string }): number {
  const text = c.rationale.toLowerCase();
  let score = 0;
  for (const t of SPECIFICITY_TERMS) if (text.includes(t.toLowerCase())) score += 2;
  for (const t of EMOTIONAL_TERMS) if (text.includes(t.toLowerCase())) score += 2;
  for (const t of MECHANISM_TERMS) if (text.includes(t.toLowerCase())) score += 1.5;
  if (text.includes("generic") || text.includes("transition") || text.includes("filler")) score -= 3;
  return score;
}

const ADAPTATION_SYSTEM = `You are the Cross-Platform Clip Adapter. Given a podcast clip moment, produce per-platform adaptations.

Per platform conventions:
- TikTok: max 100-char caption, 3-5 hashtags, hook in first 1-3s drives retention, CTA "follow Maya for more" (top funnel) or "comment your version" (mid) or "use code OFFCLOCK at rootlabs.com" (bottom)
- Reels: similar to TikTok but slightly longer caption tolerated, more hashtags (5-8)
- Shorts: SEO-led caption, can extend hook 2-3s, fewer hashtags (3-4)
- X: text-only — write a 5-tweet thread expanding the clip
- IG carousel: 6-panel structure — first panel hook, last panel CTA

OUTPUT JSON shape:
{
  "platform_adaptations": [
    { "platform": "tiktok", "title_or_caption": "...", "on_screen_text": "...", "cta": "...", "hashtags": ["#sleep", "..."] },
    ...
  ],
  "hook_chosen": "<best of the 3 variants>"
}`;

export async function extractClips(
  episode: EpisodeOutput,
  opts: { topN?: number } = {}
): Promise<FinalClip[]> {
  const topN = opts.topN ?? 10;
  const scored = episode.clip_candidates.map((c) => ({ c, score: scoreClipCandidate(c) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topN);

  const adapted: FinalClip[] = [];
  for (const { c, score } of top) {
    const beat = episode.beats.find((b) => b.index === c.from_beat);
    if (!beat) continue;
    const user = `EPISODE TITLE: ${episode.title}
CLIP from beat ${beat.index} (${beat.name}) [${beat.timecode_start}–${beat.timecode_end}]
RATIONALE: ${c.rationale}
HOOK VARIANTS: ${c.hook_variants.join(" | ")}
FUNNEL: ${c.funnel_stage}
PLATFORMS: ${c.platforms.join(",")}
CLIP SCRIPT EXCERPT (beat full text):
${beat.script.slice(0, 2000)}

Produce platform_adaptations only for the listed platforms. Return JSON.`;
    const result = await runJsonAgent<{
      platform_adaptations: FinalClip["platform_adaptations"];
      hook_chosen: string;
    }>({
      model: "claude-sonnet-4-6",
      system: ADAPTATION_SYSTEM,
      user,
      maxTokens: 2000,
      temperature: 0.7,
    });
    adapted.push({
      from_beat: c.from_beat,
      in_seconds: c.in_seconds,
      out_seconds: c.out_seconds,
      rationale: c.rationale,
      funnel_stage: c.funnel_stage as any,
      score,
      hook_chosen: result.hook_chosen,
      hook_variants: c.hook_variants,
      platform_adaptations: result.platform_adaptations,
    });
  }
  return adapted;
}
```

- [ ] **Step 3: Run tests**

`npm run test -- clip-extractor`. Expected: PASS.

- [ ] **Step 4: CLI runner**

Create `scripts/extract-clips.ts`:

```ts
import { extractClips } from "@/lib/agents/clip-extractor";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const ep = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const clips = await extractClips(ep, { topN: 10 });
  const out = process.argv[2].replace(/\.json$/, "-clips.json");
  writeFileSync(out, JSON.stringify(clips, null, 2));
  console.log(`Wrote ${clips.length} clips to ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Add: `"extract:clips": "tsx scripts/extract-clips.ts"`.

Run: `npm run extract:clips tmp/episodes/s1e4.json`. Inspect output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agents): clip extractor scores candidates, adapts to platform conventions"
```

---

### Task 10: Cross-Universe Fanout — X threads, Reddit, IG carousel

**Files:**
- Create: `lib/agents/fanout.ts`
- Create: `lib/agents/__tests__/fanout.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/agents/__tests__/fanout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fanOutEpisode } from "../fanout";

describe("episode fanout", () => {
  it("produces X thread (consumer), X thread (expert), Reddit post, IG carousel", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ep = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tmp","episodes","s1e4.json"),"utf8"));
    const out = await fanOutEpisode(ep, { hostId: "maya", guestId: "dr_chen" });
    expect(out.x_consumer_thread.tweets.length).toBeGreaterThanOrEqual(6);
    expect(out.x_expert_thread.tweets.length).toBeGreaterThanOrEqual(8);
    expect(out.reddit_post.body.length).toBeGreaterThan(500);
    expect(out.ig_carousel.panels.length).toBe(8);
  }, 120_000);
});
```

- [ ] **Step 2: Implement fanout**

Create `lib/agents/fanout.ts`:

```ts
import { runJsonAgent } from "./base";
import type { EpisodeOutput } from "./podcast-episode";
import { getCharacter } from "@/lib/universe/store";

export type FanoutResult = {
  x_consumer_thread: { handle: string; tweets: string[] };
  x_expert_thread: { handle: string; tweets: string[] };
  reddit_post: { subreddit: string; title: string; body: string };
  ig_carousel: { panels: Array<{ index: number; headline: string; body: string }> };
};

const SYSTEM = `You are the Episode-to-Universe Fanout Agent. Given a podcast episode (script + clips), produce four downstream universe artifacts:

1. **X consumer thread** — posted by the HOST in their own voice. 6-10 tweets. First-person diary recap of the episode's emotional arc. No mechanism explanations; that's the expert's job. End with a soft "DM me your version" CTA. Use the host's signature phrases.

2. **X expert thread** — posted by the GUEST in their own clinical voice. 8-15 tweets. Mechanism-heavy deep-dive that extends what the expert said in the episode. Cite mechanism details, reference clinical observations. Hard requirement: NO disease claims. Use only allowlist phrasing ("supports", "is associated with", "promotes"). End with a non-product CTA ("which mechanism do you wish more clinicians understood?").

3. **Reddit post** — 800-1500 words, first-person from the host in r/insomnia or r/perimenopause or r/Magnesium (pick the most relevant). Title that would top-rank in the sub. No product link, no affiliate. Reads as authentic narrative. Hook beats 1+3+8 of the episode into a personal essay. Universe-canon-faithful.

4. **IG carousel** — exactly 8 panels. Panel 1 = hook headline. Panels 2-7 = visual + 1-2 sentence beat from the episode (could be "the 3 things to try tonight" or a mechanism + reframe arc). Panel 8 = soft CTA + show plug. Each panel has a "headline" (large text) and "body" (small text).

OUTPUT JSON exactly:
{
  "x_consumer_thread": { "handle": "@<host_handle>", "tweets": ["<t1>", ...] },
  "x_expert_thread": { "handle": "@<guest_handle>", "tweets": ["<t1>", ...] },
  "reddit_post": { "subreddit": "r/<name>", "title": "<title>", "body": "<markdown body>" },
  "ig_carousel": { "panels": [{ "index": 1, "headline": "<h>", "body": "<b>" }, ...] }
}`;

export async function fanOutEpisode(
  episode: EpisodeOutput,
  input: { hostId: string; guestId: string }
): Promise<FanoutResult> {
  const host = await getCharacter(input.hostId);
  const guest = await getCharacter(input.guestId);
  if (!host || !guest) throw new Error("Missing character");

  const user = `EPISODE:
title: ${episode.title}
logline: ${episode.logline}

beats summary:
${episode.beats.map(b => `${b.index}. ${b.name} [${b.timecode_start}-${b.timecode_end}] — ${b.story_layers.episode}`).join("\n")}

key script excerpts (beats 1, 4, 7, 8):
${[1,4,7,8].map(i => {
  const b = episode.beats[i-1];
  return `\n## Beat ${i} (${b.name})\n${b.script.slice(0, 1500)}`;
}).join("\n")}

HOST: ${host.spec.identity.name}
host voice signature phrases: ${JSON.stringify(host.spec.voice.signature_phrases)}
host forbidden phrases: ${JSON.stringify(host.spec.voice.what_they_never_say)}

GUEST: ${guest.spec.identity.name}
guest voice signature phrases: ${JSON.stringify(guest.spec.voice.signature_phrases)}
guest forbidden phrases: ${JSON.stringify(guest.spec.voice.what_they_never_say)}

Return JSON only.`;

  return runJsonAgent<FanoutResult>({
    model: "claude-opus-4-7",
    system: SYSTEM,
    user,
    maxTokens: 8000,
    temperature: 0.85,
    cacheSystem: true,
  });
}
```

- [ ] **Step 3: Run test**

`npm run test -- fanout`. Expected: PASS.

- [ ] **Step 4: CLI runner + sanity inspection**

Create `scripts/fanout-episode.ts`:

```ts
import { fanOutEpisode } from "@/lib/agents/fanout";
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const ep = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const out = await fanOutEpisode(ep, { hostId: "maya", guestId: "dr_chen" });
  const target = process.argv[2].replace(/\.json$/, "-fanout.json");
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`Wrote ${target}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Add: `"fanout:episode": "tsx scripts/fanout-episode.ts"`. Run: `npm run fanout:episode tmp/episodes/s1e4.json`. Inspect output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agents): episode fanout produces X consumer + expert threads, Reddit, IG carousel"
```

---

### Task 11: Quality Stack — Compliance + Editorial + Brand Voice

**Files:**
- Create: `lib/quality/compliance.ts`, `editorial.ts`, `brand-voice.ts`, `metadata.ts`, `stack.ts`
- Create: `lib/quality/__tests__/stack.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/quality/__tests__/stack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runQualityStack } from "../stack";

describe("quality stack", () => {
  it("blocks content with forbidden disease claims", async () => {
    const result = await runQualityStack({
      brandId: "root_labs",
      contentType: "podcast_episode",
      contentText: "MagAshwa cures insomnia and treats anxiety. Try it today.",
      metadata: { title: "x", description: "y" } as any,
    });
    expect(result.overall).toBe("block");
    const compl = result.runs.find(r => r.agent === "compliance");
    expect(compl?.result).toBe("block");
  });

  it("passes compliant content", async () => {
    const result = await runQualityStack({
      brandId: "root_labs",
      contentType: "podcast_episode",
      contentText: "Magnesium glycinate supports relaxation and may aid sleep. These statements have not been evaluated by the FDA.",
      metadata: { title: "ok title", description: "ok desc" } as any,
    });
    expect(result.overall).not.toBe("block");
  });
});
```

- [ ] **Step 2: Implement compliance (deterministic — regex on allowlist/blocklist)**

Create `lib/quality/compliance.ts`:

```ts
import { loadBrand } from "@/lib/brand/loader";

export type AgentResult = { agent: string; result: "pass" | "warn" | "block"; reason?: string };

export function runCompliance(input: {
  brandId: string;
  contentText: string;
  hasSponsorDisclaimer?: boolean;
}): AgentResult {
  const brand = loadBrand(input.brandId);
  const text = input.contentText.toLowerCase();

  for (const banned of brand.compliance.claims_blocklist) {
    const re = new RegExp(`\\b${banned}\\b`, "i");
    if (re.test(text)) {
      return { agent: "compliance", result: "block", reason: `Forbidden claim found: "${banned}"` };
    }
  }

  if (brand.compliance.sponsor_disclosure_required && input.hasSponsorDisclaimer === false) {
    return { agent: "compliance", result: "block", reason: "Sponsor disclosure required but missing" };
  }

  // Soft warning if no allowlist words appear in a long enough piece
  if (input.contentText.length > 500) {
    const hasAllowed = brand.compliance.claims_allowlist.some((w) => text.includes(w));
    if (!hasAllowed) {
      return { agent: "compliance", result: "warn", reason: "No allowlisted claim verbs detected (this may be fine, but flagging)" };
    }
  }

  return { agent: "compliance", result: "pass" };
}
```

Create `lib/quality/editorial.ts`:

```ts
import type { AgentResult } from "./compliance";

export function runEditorial(input: {
  contentType: "podcast_episode" | string;
  payload: any;
}): AgentResult {
  if (input.contentType === "podcast_episode") {
    const ep = input.payload;
    if (!ep.beats || ep.beats.length !== 10) {
      return { agent: "editorial", result: "block", reason: `Expected 10 beats, found ${ep.beats?.length ?? 0}` };
    }
    const expectedNames = ["cold_open","show_intro","stakes","mechanism_reveal","personal_application","cultural_reframe","what_actually_works","the_reframe","listener_wisdom_cta","outro"];
    for (let i = 0; i < 10; i++) {
      if (ep.beats[i].name !== expectedNames[i]) {
        return { agent: "editorial", result: "block", reason: `Beat ${i+1} name mismatch: expected ${expectedNames[i]}, found ${ep.beats[i].name}` };
      }
    }
    if (!ep.beats[0].timecode_start.startsWith("00:00") || !ep.beats[9].timecode_end.startsWith("30:")) {
      return { agent: "editorial", result: "warn", reason: "Timecode boundaries off" };
    }
  }
  return { agent: "editorial", result: "pass" };
}
```

Create `lib/quality/brand-voice.ts`:

```ts
import { getCharacter } from "@/lib/universe/store";
import type { AgentResult } from "./compliance";

export async function runBrandVoice(input: {
  hostId?: string;
  contentText: string;
}): Promise<AgentResult> {
  if (!input.hostId) return { agent: "brand_voice", result: "pass" };
  const host = await getCharacter(input.hostId);
  if (!host) return { agent: "brand_voice", result: "pass" };

  const forbidden: string[] = host.spec.voice.what_they_never_say ?? [];
  const text = input.contentText.toLowerCase();
  for (const phrase of forbidden) {
    if (text.includes(phrase.toLowerCase())) {
      return { agent: "brand_voice", result: "warn", reason: `Host's forbidden phrase detected: "${phrase}"` };
    }
  }

  const signature: string[] = host.spec.voice.signature_phrases ?? [];
  const hits = signature.filter((s) => text.includes(s.toLowerCase())).length;
  if (input.contentText.length > 4000 && hits === 0) {
    return { agent: "brand_voice", result: "warn", reason: "No host signature phrases detected in long content" };
  }

  return { agent: "brand_voice", result: "pass" };
}
```

Create `lib/quality/metadata.ts`:

```ts
import type { AgentResult } from "./compliance";

export function runMetadata(input: { metadata: { title?: string; description?: string } }): AgentResult {
  if (!input.metadata.title || input.metadata.title.length < 5) {
    return { agent: "metadata", result: "block", reason: "Title missing or too short" };
  }
  if (input.metadata.title.length > 100) {
    return { agent: "metadata", result: "warn", reason: "Title exceeds 100 chars (Spotify card limit)" };
  }
  if (!input.metadata.description || input.metadata.description.length < 50) {
    return { agent: "metadata", result: "block", reason: "Description missing or too short" };
  }
  return { agent: "metadata", result: "pass" };
}
```

Create `lib/quality/stack.ts`:

```ts
import { runCompliance, type AgentResult } from "./compliance";
import { runEditorial } from "./editorial";
import { runBrandVoice } from "./brand-voice";
import { runMetadata } from "./metadata";

export type StackInput = {
  brandId: string;
  hostId?: string;
  contentType: string;
  contentText: string;
  payload?: any;
  metadata?: { title?: string; description?: string };
  hasSponsorDisclaimer?: boolean;
};

export type StackResult = {
  overall: "pass" | "warn" | "block";
  runs: AgentResult[];
};

export async function runQualityStack(input: StackInput): Promise<StackResult> {
  const runs: AgentResult[] = [];

  runs.push(runCompliance({ brandId: input.brandId, contentText: input.contentText, hasSponsorDisclaimer: input.hasSponsorDisclaimer }));
  if (input.payload) runs.push(runEditorial({ contentType: input.contentType, payload: input.payload }));
  runs.push(await runBrandVoice({ hostId: input.hostId, contentText: input.contentText }));
  if (input.metadata) runs.push(runMetadata({ metadata: input.metadata }));

  let overall: "pass" | "warn" | "block" = "pass";
  for (const r of runs) {
    if (r.result === "block") { overall = "block"; break; }
    if (r.result === "warn") overall = "warn";
  }
  return { overall, runs };
}
```

- [ ] **Step 3: Run tests**

`npm run test -- quality`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(quality): compliance + editorial + brand-voice + metadata agents in series stack"
```

---

## Phase 3 — Publishing (Day 3 morning)

### Task 12: Buzzsprout Adapter (Spotify + Apple via RSS)

**Files:**
- Create: `lib/publishers/buzzsprout.ts`
- Create: `lib/publishers/__tests__/buzzsprout.test.ts`

- [ ] **Step 1: Sign up for Buzzsprout, create test podcast, get API token**

Sign up at buzzsprout.com → create podcast titled "Off the Clock Demo" → in Buzzsprout dashboard → API tab → copy the podcast ID and API token into `.env.local`. Free tier works — 2hrs/mo upload.

- [ ] **Step 2: Write failing test**

Create `lib/publishers/__tests__/buzzsprout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { publishToBuzzsprout, buildBuzzsproutPayload } from "../buzzsprout";

describe("buzzsprout adapter", () => {
  it("builds correct payload from asset bundle", () => {
    const payload = buildBuzzsproutPayload({
      title: "Why melatonin stops working",
      description: "<p>Description here</p>",
      summary: "Plain summary",
      season: 1,
      episode: 4,
      explicit: false,
      episode_type: "full",
      audio_url: "https://example.com/audio.mp3",
      cover_url: "https://example.com/cover.png",
      tags: "sleep, magnesium",
    });
    expect(payload.title).toBe("Why melatonin stops working");
    expect(payload.season_number).toBe(1);
    expect(payload.episode_number).toBe(4);
    expect(payload.private).toBe(false);
  });

  it("DEMO_MODE returns simulated success without network", async () => {
    process.env.DEMO_MODE = "true";
    const result = await publishToBuzzsprout({
      title: "Test", description: "<p>x</p>", summary: "x",
      season: 1, episode: 1, explicit: false, episode_type: "full",
      audio_url: "x", cover_url: "x", tags: "x",
    });
    expect(result.status).toBe("uploaded");
    expect(result.simulated).toBe(true);
  });
});
```

- [ ] **Step 3: Implement adapter**

Create `lib/publishers/buzzsprout.ts`:

```ts
export type BuzzsproutEpisodeInput = {
  title: string;
  description: string;            // HTML allowed
  summary: string;                // plain
  season: number;
  episode: number;
  explicit: boolean;
  episode_type: "full" | "trailer" | "bonus";
  audio_url: string;              // either a URL Buzzsprout can fetch OR pass as multipart
  cover_url?: string;
  tags?: string;
  artist?: string;
  artwork_url?: string;
  private?: boolean;
};

export type BuzzsproutPublishResult = {
  status: "uploaded" | "failed";
  buzzsprout_episode_id?: string;
  guid?: string;
  audio_url?: string;
  simulated?: boolean;
  error?: string;
};

export function buildBuzzsproutPayload(input: BuzzsproutEpisodeInput) {
  return {
    title: input.title,
    description: input.description,
    summary: input.summary,
    season_number: input.season,
    episode_number: input.episode,
    explicit: input.explicit,
    episode_type: input.episode_type,
    artist: input.artist ?? "Off the Clock",
    audio_url: input.audio_url,
    artwork_url: input.cover_url ?? input.artwork_url,
    tags: input.tags ?? "",
    private: input.private ?? false,
  };
}

export async function publishToBuzzsprout(input: BuzzsproutEpisodeInput): Promise<BuzzsproutPublishResult> {
  if (process.env.DEMO_MODE === "true") {
    return {
      status: "uploaded",
      buzzsprout_episode_id: "demo-" + Math.random().toString(36).slice(2),
      guid: "demo-guid-" + Date.now(),
      audio_url: input.audio_url,
      simulated: true,
    };
  }

  const podcastId = process.env.BUZZSPROUT_PODCAST_ID;
  const token = process.env.BUZZSPROUT_API_TOKEN;
  if (!podcastId || !token) {
    return { status: "failed", error: "Missing Buzzsprout credentials" };
  }

  const payload = buildBuzzsproutPayload(input);
  const res = await fetch(`https://www.buzzsprout.com/api/${podcastId}/episodes.json`, {
    method: "POST",
    headers: {
      "Authorization": `Token token=${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    return { status: "failed", error: `Buzzsprout ${res.status}: ${await res.text()}` };
  }
  const data = await res.json();
  return {
    status: "uploaded",
    buzzsprout_episode_id: String(data.id),
    guid: data.guid,
    audio_url: data.audio_url,
  };
}
```

- [ ] **Step 4: Run tests**

`npm run test -- buzzsprout`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(publishers): Buzzsprout adapter for RSS distribution (Spotify + Apple)"
```

---

### Task 13: YouTube Podcasts Adapter

**Files:**
- Create: `lib/publishers/youtube.ts`
- Create: `lib/publishers/__tests__/youtube.test.ts`

- [ ] **Step 1: Set up YouTube Data API credentials**

1. Google Cloud Console → New project → enable YouTube Data API v3
2. Create OAuth 2.0 Client ID (Desktop app type)
3. Use https://developers.google.com/oauthplayground to mint a refresh token with scope `https://www.googleapis.com/auth/youtube.upload`
4. Save client_id, client_secret, refresh_token to `.env.local`

For the hackathon demo, we can also keep `DEMO_MODE=true` and skip real uploads — the orchestrator will report simulated success.

- [ ] **Step 2: Write failing test**

Create `lib/publishers/__tests__/youtube.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildYoutubeMetadata, publishToYoutube } from "../youtube";

describe("youtube adapter", () => {
  it("builds metadata with timestamped chapters from beats", () => {
    const meta = buildYoutubeMetadata({
      title: "Why melatonin stops working at 33 | Off the Clock Ep 4",
      description_intro: "Maya talks to Dr. Chen.",
      chapters_youtube_format: "00:00 Cold open\n00:30 Welcome to Off the Clock\n01:00 Stakes",
      sponsor_disclosure: "FDA disclaimer.",
      tags: ["sleep","magnesium","melatonin"],
      category_id: "27",
    });
    expect(meta.snippet.title.length).toBeLessThanOrEqual(100);
    expect(meta.snippet.description).toContain("00:00 Cold open");
    expect(meta.snippet.tags).toContain("sleep");
  });

  it("DEMO_MODE returns simulated success", async () => {
    process.env.DEMO_MODE = "true";
    const r = await publishToYoutube({
      videoFilePath: "/dev/null",
      thumbnailPath: "/dev/null",
      metadata: buildYoutubeMetadata({
        title: "T",
        description_intro: "x",
        chapters_youtube_format: "00:00 a",
        sponsor_disclosure: "",
        tags: ["x"],
        category_id: "27",
      }),
    });
    expect(r.status).toBe("uploaded");
    expect(r.simulated).toBe(true);
  });
});
```

- [ ] **Step 3: Implement adapter**

Install: `npm install googleapis`.

Create `lib/publishers/youtube.ts`:

```ts
import { google } from "googleapis";
import { createReadStream } from "node:fs";

export type YoutubeBuildInput = {
  title: string;
  description_intro: string;
  chapters_youtube_format: string;     // newline-separated "MM:SS Title"
  sponsor_disclosure: string;
  tags: string[];
  category_id: string;                  // "27" = Education
  privacy_status?: "public" | "private" | "unlisted";
  language?: string;
};

export function buildYoutubeMetadata(input: YoutubeBuildInput) {
  const description = [
    input.description_intro,
    "",
    input.chapters_youtube_format,
    "",
    input.sponsor_disclosure,
  ].filter(Boolean).join("\n");

  return {
    snippet: {
      title: input.title.slice(0, 100),
      description,
      tags: input.tags,
      categoryId: input.category_id,
      defaultLanguage: input.language ?? "en-US",
      defaultAudioLanguage: input.language ?? "en-US",
    },
    status: {
      privacyStatus: input.privacy_status ?? "unlisted",
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  };
}

export type YoutubePublishInput = {
  videoFilePath: string;
  thumbnailPath?: string;
  metadata: ReturnType<typeof buildYoutubeMetadata>;
  podcastShowId?: string;
};

export type YoutubePublishResult = {
  status: "uploaded" | "failed";
  video_id?: string;
  simulated?: boolean;
  error?: string;
};

export async function publishToYoutube(input: YoutubePublishInput): Promise<YoutubePublishResult> {
  if (process.env.DEMO_MODE === "true") {
    return { status: "uploaded", video_id: "demo-vid-" + Math.random().toString(36).slice(2), simulated: true };
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  try {
    const res = await youtube.videos.insert({
      part: ["snippet","status"],
      requestBody: input.metadata as any,
      media: { body: createReadStream(input.videoFilePath) },
    });
    const videoId = res.data.id ?? undefined;
    if (videoId && input.thumbnailPath) {
      await youtube.thumbnails.set({ videoId, media: { body: createReadStream(input.thumbnailPath) } });
    }
    return { status: "uploaded", video_id: videoId };
  } catch (e: any) {
    return { status: "failed", error: e?.message ?? String(e) };
  }
}
```

- [ ] **Step 4: Run tests**

`npm run test -- youtube`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(publishers): YouTube Data API adapter with metadata builder + thumbnail set"
```

---

### Task 14: Publish Orchestrator

**Files:**
- Create: `lib/publishers/orchestrator.ts`
- Create: `lib/publishers/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/publishers/__tests__/orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { publishEpisode } from "../orchestrator";

describe("orchestrator", () => {
  beforeAll(() => { process.env.DEMO_MODE = "true"; });

  it("runs quality stack, uploads in parallel, returns combined result", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ep = JSON.parse(fs.readFileSync(path.join(process.cwd(),"tmp","episodes","s1e4.json"),"utf8"));
    const result = await publishEpisode({
      brandId: "root_labs",
      hostId: "maya",
      episode: ep,
      audioUrl: "https://example.com/a.mp3",
      coverUrl: "https://example.com/c.png",
      videoFilePath: "/dev/null",
      thumbnailPath: "/dev/null",
    });
    expect(result.quality_stack.overall).not.toBe("block");
    expect(result.buzzsprout.status).toBe("uploaded");
    expect(result.youtube.status).toBe("uploaded");
  }, 30_000);
});
```

- [ ] **Step 2: Implement orchestrator**

Create `lib/publishers/orchestrator.ts`:

```ts
import { runQualityStack, type StackResult } from "@/lib/quality/stack";
import { publishToBuzzsprout, type BuzzsproutPublishResult } from "./buzzsprout";
import { publishToYoutube, buildYoutubeMetadata, type YoutubePublishResult } from "./youtube";
import type { EpisodeOutput } from "@/lib/agents/podcast-episode";
import { supabaseAdmin } from "@/lib/db/client";

export type OrchestratorInput = {
  brandId: string;
  hostId: string;
  episode: EpisodeOutput;
  audioUrl: string;
  coverUrl: string;
  videoFilePath: string;
  thumbnailPath?: string;
};

export type OrchestratorResult = {
  quality_stack: StackResult;
  buzzsprout: BuzzsproutPublishResult;
  youtube: YoutubePublishResult;
};

export async function publishEpisode(input: OrchestratorInput): Promise<OrchestratorResult> {
  const fullText = input.episode.beats.map(b => b.script).join("\n\n");
  const stack = await runQualityStack({
    brandId: input.brandId,
    hostId: input.hostId,
    contentType: "podcast_episode",
    contentText: fullText,
    payload: input.episode,
    metadata: { title: input.episode.title, description: input.episode.logline },
    hasSponsorDisclaimer: input.episode.sponsor_read.includes_fda_disclaimer,
  });

  if (stack.overall === "block") {
    return {
      quality_stack: stack,
      buzzsprout: { status: "failed", error: "Quality stack blocked" },
      youtube: { status: "failed", error: "Quality stack blocked" },
    };
  }

  const description = `${input.episode.logline}\n\n${input.episode.beats.map(b => `${b.timecode_start} ${b.name.replace(/_/g," ")}`).join("\n")}\n\n${input.episode.sponsor_read.script}`;

  const ytMetadata = buildYoutubeMetadata({
    title: input.episode.youtube_title ?? input.episode.title,
    description_intro: input.episode.logline,
    chapters_youtube_format: input.episode.beats.map(b => `${b.timecode_start} ${b.name.replace(/_/g," ")}`).join("\n"),
    sponsor_disclosure: input.episode.sponsor_read.script,
    tags: ["off the clock","sleep","magnesium","podcast","perimenopause"],
    category_id: "27",
    privacy_status: "unlisted",
  });

  const [buzzsprout, youtube] = await Promise.all([
    publishToBuzzsprout({
      title: input.episode.title,
      description,
      summary: input.episode.logline,
      season: input.episode.season,
      episode: input.episode.episode,
      explicit: false,
      episode_type: "full",
      audio_url: input.audioUrl,
      cover_url: input.coverUrl,
      tags: "sleep, magnesium, perimenopause, podcast",
      artist: "Off the Clock",
    }),
    publishToYoutube({
      videoFilePath: input.videoFilePath,
      thumbnailPath: input.thumbnailPath,
      metadata: ytMetadata,
    }),
  ]);

  // Audit trail (best-effort — don't fail orchestrator if DB write fails in demo)
  try {
    for (const run of stack.runs) {
      await supabaseAdmin.from("quality_stack_runs").insert({
        content_piece_id: null as any,
        agent: run.agent,
        result: run.result,
        reason: run.reason ?? null,
      });
    }
  } catch {}

  return { quality_stack: stack, buzzsprout, youtube };
}
```

- [ ] **Step 3: Run tests**

`npm run test -- orchestrator`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(publishers): orchestrator runs quality stack + parallel Buzzsprout + YouTube publish"
```

---

## Phase 4 — Dashboard UX (Day 3 afternoon)

### Task 15: Dashboard shell + Brand Universe Home (View A)

**Files:**
- Modify: `app/layout.tsx`, `app/page.tsx`
- Create: `app/(dashboard)/layout.tsx`
- Create: `app/(dashboard)/page.tsx`
- Create: `app/(dashboard)/_components/sidebar.tsx`, `character-card.tsx`
- Create: `app/(dashboard)/_lib/data.ts`

- [ ] **Step 1: Wire up the dashboard layout**

Modify `app/layout.tsx`:

```tsx
import "./globals.css";
export const metadata = { title: "Content Machine — Root Labs" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
```

Replace `app/page.tsx` with a redirect:

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/dashboard"); }
```

Create `app/(dashboard)/layout.tsx`:

```tsx
import Sidebar from "./_components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

Create `app/(dashboard)/_components/sidebar.tsx`:

```tsx
import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-60 border-r bg-white p-4 space-y-1 text-sm">
      <div className="font-semibold text-lg mb-4">Content Machine</div>
      <div className="text-xs text-zinc-500 mb-2">Brand</div>
      <div className="rounded bg-zinc-100 px-2 py-1 mb-4">Root Labs</div>
      <nav className="space-y-1">
        <Link href="/dashboard" className="block rounded px-2 py-1 hover:bg-zinc-100">Universe Home</Link>
        <Link href="/dashboard/calendar" className="block rounded px-2 py-1 hover:bg-zinc-100">Content Calendar</Link>
        <Link href="/dashboard/insights" className="block rounded px-2 py-1 hover:bg-zinc-100">Engine Insights</Link>
        <Link href="/dashboard/config" className="block rounded px-2 py-1 hover:bg-zinc-100">Configuration</Link>
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Data fetcher**

Create `app/(dashboard)/_lib/data.ts`:

```ts
import { getAllCharacters } from "@/lib/universe/store";
export async function getDashboardData() {
  const characters = await getAllCharacters("root_labs");
  return { characters };
}
```

- [ ] **Step 3: Universe Home page**

Create `app/(dashboard)/page.tsx`:

```tsx
import CharacterCard from "./_components/character-card";
import { getDashboardData } from "./_lib/data";

export default async function UniverseHome() {
  const { characters } = await getDashboardData();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Root Labs · Universe</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {characters.map((c) => <CharacterCard key={c.id} character={c} />)}
      </div>
    </div>
  );
}
```

Create `app/(dashboard)/_components/character-card.tsx`:

```tsx
import Link from "next/link";

export default function CharacterCard({ character }: { character: any }) {
  const s = character.spec;
  const kindBadge = { consumer: "bg-emerald-100 text-emerald-700", expert: "bg-blue-100 text-blue-700", coach: "bg-amber-100 text-amber-700", host: "bg-purple-100 text-purple-700" }[character.kind] ?? "bg-zinc-100";
  return (
    <Link href={`/dashboard/characters/${character.id}`} className="block rounded-lg border bg-white p-4 hover:shadow transition">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{s.identity.name}</div>
        <span className={`text-xs rounded px-2 py-0.5 ${kindBadge}`}>{character.kind}</span>
      </div>
      <div className="text-sm text-zinc-600 mb-2">{s.identity.age}, {s.identity.city}</div>
      <div className="text-xs text-zinc-500 mb-3">{s.identity.profession}</div>
      <div className="text-xs text-zinc-700 italic mb-3">"{s.psyche.core_frustration}"</div>
      <div className="flex items-center justify-between text-xs">
        <span className="rounded bg-zinc-100 px-2 py-0.5">Ch. {character.current_chapter} · Day {character.current_arc_day}</span>
        <span className="text-zinc-500">owns: {s.pain_ownership.primary_pain_point}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run dev server and verify**

```bash
npm run dev
```

Visit http://localhost:3000 → redirects to /dashboard → six character cards rendered. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): View A — Brand Universe Home with character cards"
```

---

### Task 16: Content Calendar (View B) + Piece Detail (View C)

**Files:**
- Create: `app/(dashboard)/calendar/page.tsx`
- Create: `app/(dashboard)/calendar/_components/week-grid.tsx`
- Create: `app/(dashboard)/pieces/[id]/page.tsx`
- Create: `app/(dashboard)/pieces/[id]/_components/episode-view.tsx`, `clips-panel.tsx`, `fanout-tabs.tsx`
- Create: `app/api/generate-episode/route.ts`

- [ ] **Step 1: API route to generate episode end-to-end**

Create `app/api/generate-episode/route.ts`:

```ts
import { NextResponse } from "next/server";
import { generatePodcastEpisode } from "@/lib/agents/podcast-episode";
import { extractClips } from "@/lib/agents/clip-extractor";
import { fanOutEpisode } from "@/lib/agents/fanout";
import { supabaseAdmin } from "@/lib/db/client";

export async function POST(req: Request) {
  const body = await req.json();
  const ep = await generatePodcastEpisode({
    show: "off_the_clock",
    hostId: body.hostId ?? "maya",
    guestId: body.guestId ?? "dr_chen",
    arcDay: body.arcDay ?? 15,
    topic: body.topic ?? "Why melatonin stopped working",
    seasonNumber: body.season ?? 1,
    episodeNumber: body.episode ?? 4,
  });

  const [clips, fanout] = await Promise.all([
    extractClips(ep, { topN: 10 }),
    fanOutEpisode(ep, { hostId: body.hostId ?? "maya", guestId: body.guestId ?? "dr_chen" }),
  ]);

  const { data: piece, error } = await supabaseAdmin.from("content_pieces").insert({
    brand_id: "root_labs",
    character_id: body.hostId ?? "maya",
    piece_type: "podcast_episode",
    status: "draft",
    payload_json: { episode: ep, clips, fanout },
    conversion_beats: ["identification","mechanism","bridge","permission","proof","action"],
    primary_pain_point: "sleep",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ piece_id: piece.id, episode: ep, clips, fanout });
}
```

- [ ] **Step 2: Calendar view**

Create `app/(dashboard)/calendar/page.tsx`:

```tsx
import WeekGrid from "./_components/week-grid";
import { supabaseAdmin } from "@/lib/db/client";

export default async function CalendarPage() {
  const { data: pieces } = await supabaseAdmin.from("content_pieces")
    .select("*").eq("brand_id","root_labs").order("created_at", { ascending: false }).limit(50);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Content Calendar</h1>
      <p className="text-sm text-zinc-600 mb-6">Click "Generate Episode" to produce the next Off the Clock from Maya's arc.</p>
      <GenerateButton />
      <div className="mt-8">
        <WeekGrid pieces={pieces ?? []} />
      </div>
    </div>
  );
}

function GenerateButton() {
  return (
    <form action="/api/generate-episode" method="post">
      <button className="rounded bg-zinc-900 text-white px-4 py-2 text-sm hover:bg-zinc-700" formAction={async () => {
        "use server";
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/generate-episode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId: "maya", guestId: "dr_chen", arcDay: 15, episode: 4 }),
        });
        const data = await res.json();
        console.log("Generated", data.piece_id);
      }}>Generate next episode</button>
    </form>
  );
}
```

Create `app/(dashboard)/calendar/_components/week-grid.tsx`:

```tsx
import Link from "next/link";

export default function WeekGrid({ pieces }: { pieces: any[] }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="rounded border bg-white p-2 min-h-32">
          <div className="text-xs text-zinc-500 mb-2">Day {i+1}</div>
          {pieces.filter((_p, idx) => idx % 7 === i).map((p) => (
            <Link key={p.id} href={`/dashboard/pieces/${p.id}`} className="block text-xs rounded bg-zinc-100 px-2 py-1 mb-1 hover:bg-zinc-200 truncate">
              {p.payload_json?.episode?.title ?? p.piece_type}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Piece Detail view (View C)**

Create `app/(dashboard)/pieces/[id]/page.tsx`:

```tsx
import { supabaseAdmin } from "@/lib/db/client";
import EpisodeView from "./_components/episode-view";
import ClipsPanel from "./_components/clips-panel";
import FanoutTabs from "./_components/fanout-tabs";

export default async function PieceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: piece } = await supabaseAdmin.from("content_pieces").select("*").eq("id", id).single();
  if (!piece) return <div>Not found</div>;
  const payload = piece.payload_json as any;

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{payload.episode.title}</h1>
        <p className="text-sm text-zinc-600 mt-1">{payload.episode.logline}</p>
      </header>
      <EpisodeView episode={payload.episode} />
      <ClipsPanel clips={payload.clips} />
      <FanoutTabs fanout={payload.fanout} />
    </div>
  );
}
```

Create `app/(dashboard)/pieces/[id]/_components/episode-view.tsx`:

```tsx
export default function EpisodeView({ episode }: { episode: any }) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="font-semibold mb-4">Episode Script · 10 beats · 30:00</h2>
      <ol className="space-y-4">
        {episode.beats.map((b: any) => (
          <li key={b.index} className="border-l-2 border-zinc-200 pl-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-zinc-500">{b.timecode_start}–{b.timecode_end}</span>
              <span className="text-xs rounded bg-zinc-100 px-2 py-0.5">{b.name}</span>
              {b.conversion_beats.map((cb: string) => (
                <span key={cb} className="text-xs rounded bg-emerald-100 text-emerald-700 px-2 py-0.5">{cb}</span>
              ))}
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans text-zinc-800">{b.script}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Create `app/(dashboard)/pieces/[id]/_components/clips-panel.tsx`:

```tsx
export default function ClipsPanel({ clips }: { clips: any[] }) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="font-semibold mb-4">Clip Extractions · {clips.length} clips</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clips.map((c: any, i: number) => (
          <div key={i} className="rounded border p-3">
            <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
              <span>Beat {c.from_beat} · {c.in_seconds}s–{c.out_seconds}s</span>
              <span className="rounded bg-zinc-100 px-2 py-0.5">{c.funnel_stage} funnel</span>
            </div>
            <div className="text-sm font-medium mb-2">"{c.hook_chosen}"</div>
            <div className="text-xs text-zinc-600 mb-3 italic">{c.rationale}</div>
            <div className="space-y-1">
              {c.platform_adaptations.map((p: any) => (
                <div key={p.platform} className="text-xs">
                  <span className="font-mono text-zinc-500 mr-2">{p.platform}</span>
                  <span>{p.title_or_caption}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Create `app/(dashboard)/pieces/[id]/_components/fanout-tabs.tsx`:

```tsx
"use client";
import { useState } from "react";

export default function FanoutTabs({ fanout }: { fanout: any }) {
  const tabs = ["x_consumer", "x_expert", "reddit", "ig_carousel"] as const;
  const [active, setActive] = useState<typeof tabs[number]>("x_consumer");
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="font-semibold mb-4">Universe Fanout</h2>
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((t) => (
          <button key={t} onClick={() => setActive(t)}
            className={`px-3 py-2 text-sm ${active===t ? "border-b-2 border-zinc-900 font-medium" : "text-zinc-500"}`}>
            {t.replace("_"," ")}
          </button>
        ))}
      </div>
      <div className="text-sm">
        {active === "x_consumer" && <ThreadView t={fanout.x_consumer_thread} />}
        {active === "x_expert" && <ThreadView t={fanout.x_expert_thread} />}
        {active === "reddit" && <RedditView r={fanout.reddit_post} />}
        {active === "ig_carousel" && <CarouselView c={fanout.ig_carousel} />}
      </div>
    </section>
  );
}

function ThreadView({ t }: { t: any }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-3">{t.handle}</div>
      <ol className="space-y-2">
        {t.tweets.map((tw: string, i: number) => (
          <li key={i} className="rounded border p-3"><span className="text-xs text-zinc-400 mr-2">{i+1}/{t.tweets.length}</span>{tw}</li>
        ))}
      </ol>
    </div>
  );
}

function RedditView({ r }: { r: any }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-2">{r.subreddit}</div>
      <div className="font-medium mb-3">{r.title}</div>
      <pre className="whitespace-pre-wrap text-sm">{r.body}</pre>
    </div>
  );
}

function CarouselView({ c }: { c: any }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {c.panels.map((p: any) => (
        <div key={p.index} className="rounded border p-3 bg-zinc-50">
          <div className="text-xs text-zinc-500 mb-1">Panel {p.index}</div>
          <div className="font-semibold text-sm mb-2">{p.headline}</div>
          <div className="text-xs text-zinc-700">{p.body}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Visit /dashboard/calendar → click "Generate next episode" → wait ~60-120s for episode + clips + fanout → navigate to /dashboard/pieces/[id] → verify all three sections render. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): View B calendar + View C piece detail (script, clips, fanout)"
```

---

### Task 17: Publish action button + sandbox simulation

**Files:**
- Create: `app/(dashboard)/pieces/[id]/_components/publish-panel.tsx`
- Create: `app/api/publish/route.ts`
- Modify: `app/(dashboard)/pieces/[id]/page.tsx`

- [ ] **Step 1: API route for publish**

Create `app/api/publish/route.ts`:

```ts
import { NextResponse } from "next/server";
import { publishEpisode } from "@/lib/publishers/orchestrator";
import { supabaseAdmin } from "@/lib/db/client";

export async function POST(req: Request) {
  const { piece_id } = await req.json();
  const { data: piece, error } = await supabaseAdmin.from("content_pieces").select("*").eq("id", piece_id).single();
  if (error || !piece) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });

  const payload = piece.payload_json as any;
  const result = await publishEpisode({
    brandId: piece.brand_id,
    hostId: piece.character_id,
    episode: payload.episode,
    audioUrl: "https://placeholder.cdn/audio.mp3",
    coverUrl: "https://placeholder.cdn/cover.png",
    videoFilePath: "/dev/null",
    thumbnailPath: "/dev/null",
  });

  // Record publications
  if (result.buzzsprout.status === "uploaded") {
    await supabaseAdmin.from("publications").insert([
      { content_piece_id: piece_id, platform: "spotify", platform_metadata_json: result.buzzsprout, status: "ingesting" },
      { content_piece_id: piece_id, platform: "apple", platform_metadata_json: result.buzzsprout, status: "ingesting" },
    ]);
  }
  if (result.youtube.status === "uploaded") {
    await supabaseAdmin.from("publications").insert({
      content_piece_id: piece_id, platform: "youtube_podcast",
      platform_metadata_json: result.youtube,
      platform_external_id: result.youtube.video_id ?? null,
      status: "live",
    });
  }

  await supabaseAdmin.from("content_pieces").update({ status: "published" }).eq("id", piece_id);

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Publish panel UI**

Create `app/(dashboard)/pieces/[id]/_components/publish-panel.tsx`:

```tsx
"use client";
import { useState } from "react";

export default function PublishPanel({ pieceId }: { pieceId: string }) {
  const [state, setState] = useState<"idle"|"running"|"done"|"failed">("idle");
  const [result, setResult] = useState<any>(null);

  async function onPublish() {
    setState("running"); setResult(null);
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piece_id: pieceId }),
    });
    const data = await res.json();
    setResult(data);
    setState(data.quality_stack?.overall === "block" ? "failed" : "done");
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="font-semibold mb-4">Publish</h2>
      <button onClick={onPublish} disabled={state === "running"}
        className="rounded bg-zinc-900 text-white px-4 py-2 text-sm hover:bg-zinc-700 disabled:bg-zinc-400">
        {state === "running" ? "Publishing..." : "Approve & Auto-Publish"}
      </button>

      {result && (
        <div className="mt-6 space-y-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Quality Stack</div>
            <ol className="space-y-1">
              {result.quality_stack.runs.map((r: any, i: number) => (
                <li key={i} className="text-xs flex items-center gap-2">
                  <span className={r.result === "pass" ? "text-emerald-600" : r.result === "warn" ? "text-amber-600" : "text-red-600"}>●</span>
                  <span className="font-mono">{r.agent}</span>
                  <span>{r.result}</span>
                  {r.reason && <span className="text-zinc-500">— {r.reason}</span>}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Platforms</div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2"><span className="text-emerald-600">●</span> Spotify (via Buzzsprout RSS) — {result.buzzsprout.status} {result.buzzsprout.simulated && "(sim)"}</div>
              <div className="flex items-center gap-2"><span className="text-emerald-600">●</span> Apple Podcasts (via RSS) — {result.buzzsprout.status} {result.buzzsprout.simulated && "(sim)"}</div>
              <div className="flex items-center gap-2"><span className="text-emerald-600">●</span> YouTube Podcast — {result.youtube.status} {result.youtube.simulated && "(sim)"}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
```

Modify `app/(dashboard)/pieces/[id]/page.tsx` — append before closing div:

```tsx
import PublishPanel from "./_components/publish-panel";
// ...
      <PublishPanel pieceId={id} />
```

- [ ] **Step 3: Manual smoke test**

`npm run dev` → navigate to an existing piece → click "Approve & Auto-Publish" → watch the quality stack tick + three platforms light green. Kill dev.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(dashboard): publish panel showing quality stack + multi-platform results"
```

---

### Task 18: Engine Insights view (View D) — synthetic learning data

**Files:**
- Create: `app/(dashboard)/insights/page.tsx`
- Create: `lib/insights/synthetic.ts`

- [ ] **Step 1: Synthetic data generator**

Create `lib/insights/synthetic.ts`:

```ts
export type InsightSnapshot = {
  generated_at: string;
  highlights: string[];
  hook_performance: Array<{ character: string; hook_category: string; retention_3s: number; delta_vs_baseline: number }>;
  beat_retention: Array<{ beat_name: string; avg_retention_pct: number }>;
  arc_pacing_signal: { observation: string; recommendation: string };
  cross_platform: Array<{ platform: string; unique_listeners: number; completion_rate: number; conversion_signal: number }>;
};

export function makeSyntheticInsights(): InsightSnapshot {
  return {
    generated_at: new Date().toISOString(),
    highlights: [
      "Maya's mechanism-led hooks convert 2.3× her identification-led hooks last week",
      "Beat 6 (cultural reframe) is the strongest cross-platform clip extractor — 4 of top 6 clips",
      "YouTube viewers drop off 11% harder when the cold open exceeds 35 seconds → next week's calendar auto-trimmed",
      "Dr. Chen's mechanism threads on X have 4.2× the reply rate of generic supplement-Twitter",
      "Reddit r/perimenopause is the highest-converting traffic source per visit — feed more long-form there",
    ],
    hook_performance: [
      { character: "maya", hook_category: "doctor_defy", retention_3s: 0.78, delta_vs_baseline: 0.31 },
      { character: "maya", hook_category: "mechanism_tease", retention_3s: 0.71, delta_vs_baseline: 0.18 },
      { character: "maya", hook_category: "cost_confession", retention_3s: 0.58, delta_vs_baseline: -0.04 },
      { character: "tyler", hook_category: "pov", retention_3s: 0.66, delta_vs_baseline: 0.09 },
      { character: "jenna", hook_category: "pattern_interrupt_confession", retention_3s: 0.74, delta_vs_baseline: 0.22 },
    ],
    beat_retention: [
      { beat_name: "cold_open", avg_retention_pct: 0.91 },
      { beat_name: "show_intro", avg_retention_pct: 0.74 },
      { beat_name: "stakes", avg_retention_pct: 0.68 },
      { beat_name: "mechanism_reveal", avg_retention_pct: 0.72 },
      { beat_name: "personal_application", avg_retention_pct: 0.66 },
      { beat_name: "cultural_reframe", avg_retention_pct: 0.78 },
      { beat_name: "what_actually_works", avg_retention_pct: 0.61 },
      { beat_name: "the_reframe", avg_retention_pct: 0.58 },
      { beat_name: "listener_wisdom_cta", avg_retention_pct: 0.43 },
      { beat_name: "outro", avg_retention_pct: 0.31 },
    ],
    arc_pacing_signal: {
      observation: "Maya's followers spike between arc day 14 and arc day 22 — the mechanism + first-trial window",
      recommendation: "Extend the first-trial subarc by 2 days; compress dismissal subarc by 2 days",
    },
    cross_platform: [
      { platform: "spotify", unique_listeners: 9810, completion_rate: 0.67, conversion_signal: 0.31 },
      { platform: "apple", unique_listeners: 6712, completion_rate: 0.71, conversion_signal: 0.42 },
      { platform: "youtube_podcast", unique_listeners: 22100, completion_rate: 0.42, conversion_signal: 0.28 },
      { platform: "tiktok", unique_listeners: 134000, completion_rate: 0.62, conversion_signal: 0.51 },
      { platform: "reels", unique_listeners: 41200, completion_rate: 0.58, conversion_signal: 0.35 },
    ],
  };
}
```

- [ ] **Step 2: Insights page**

Create `app/(dashboard)/insights/page.tsx`:

```tsx
import { makeSyntheticInsights } from "@/lib/insights/synthetic";

export default function InsightsPage() {
  const data = makeSyntheticInsights();
  return (
    <div className="max-w-5xl space-y-8">
      <h1 className="text-2xl font-semibold">Engine Insights</h1>
      <p className="text-sm text-zinc-600">What the system has learned this week. Synthetic data for demo.</p>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-4">This week the engine noticed</h2>
        <ul className="space-y-3">
          {data.highlights.map((h, i) => (
            <li key={i} className="flex gap-3"><span className="text-emerald-600">●</span><span className="text-sm">{h}</span></li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-4">Hook category performance · 3s retention</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase">
              <th className="pb-2">Character</th><th>Hook category</th><th>3s retention</th><th>Δ vs baseline</th>
            </tr>
          </thead>
          <tbody>
            {data.hook_performance.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-2">{r.character}</td>
                <td>{r.hook_category}</td>
                <td>{(r.retention_3s * 100).toFixed(0)}%</td>
                <td className={r.delta_vs_baseline >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {r.delta_vs_baseline >= 0 ? "+" : ""}{(r.delta_vs_baseline * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-4">Episode beat retention (avg across published episodes)</h2>
        <div className="space-y-2">
          {data.beat_retention.map((b, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-44 text-sm">{b.beat_name}</div>
              <div className="flex-1 h-3 rounded bg-zinc-100 overflow-hidden">
                <div className="h-3 bg-emerald-500" style={{ width: `${b.avg_retention_pct * 100}%` }} />
              </div>
              <div className="w-12 text-right text-xs">{(b.avg_retention_pct * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-2">Arc pacing signal</h2>
        <p className="text-sm mb-2"><strong>Observation:</strong> {data.arc_pacing_signal.observation}</p>
        <p className="text-sm"><strong>Recommendation:</strong> {data.arc_pacing_signal.recommendation}</p>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-4">Cross-platform performance · last 30 days</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase">
              <th className="pb-2">Platform</th><th>Unique listeners</th><th>Completion</th><th>Conversion signal</th>
            </tr>
          </thead>
          <tbody>
            {data.cross_platform.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-2">{r.platform}</td>
                <td>{r.unique_listeners.toLocaleString()}</td>
                <td>{(r.completion_rate * 100).toFixed(0)}%</td>
                <td>{(r.conversion_signal * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

`npm run dev` → /dashboard/insights → all five sections render. Kill dev.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(dashboard): View D — Engine Insights with synthetic learning data"
```

---

### Task 19: Configuration view (View E)

**Files:**
- Create: `app/(dashboard)/config/page.tsx`

- [ ] **Step 1: Read-only config view**

Create `app/(dashboard)/config/page.tsx`:

```tsx
import { loadBrand } from "@/lib/brand/loader";
import { getAllCharacters } from "@/lib/universe/store";

export default async function ConfigPage() {
  const brand = loadBrand("root_labs");
  const characters = await getAllCharacters("root_labs");
  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Configuration · Root Labs</h1>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-3">Brand voice</h2>
        <p className="text-sm mb-1"><span className="text-zinc-500">Voice:</span> {brand.identity.voice}</p>
        <p className="text-sm mb-1"><span className="text-zinc-500">Tone register:</span> {brand.identity.tone_register.join(", ")}</p>
        <p className="text-sm"><span className="text-zinc-500">Forbidden tones:</span> {brand.identity.forbidden_tones.join(", ")}</p>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-3">Pain points (by GMV)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-zinc-500 uppercase"><th className="pb-2">Pain</th><th>GMV (USD)</th><th>Owner</th></tr></thead>
          <tbody>
            {brand.products[0].pain_points.map((p) => {
              const owner = characters.find((c) => c.spec.pain_ownership.primary_pain_point === p.id);
              return (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{p.id}</td>
                  <td>${(p.gmv_usd ?? 0).toLocaleString()}</td>
                  <td>{owner?.spec.identity.name ?? <span className="text-zinc-400">unassigned</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-3">Compliance</h2>
        <div className="text-sm">
          <p className="mb-1"><span className="text-zinc-500">Allowlist:</span> {brand.compliance.claims_allowlist.join(", ")}</p>
          <p className="mb-1"><span className="text-zinc-500">Blocklist:</span> {brand.compliance.claims_blocklist.join(", ")}</p>
          <p className="mb-1"><span className="text-zinc-500">FDA disclaimer:</span> {brand.compliance.required_disclaimers.fda_supplement}</p>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-3">Autonomy mode</h2>
        <p className="text-sm text-zinc-600 mb-3">Currently: Human-in-loop at publish gate (Tier C default).</p>
        <button className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50" disabled>Toggle Autonomous Mode (demo)</button>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test + commit**

`npm run dev` → /dashboard/config → renders. Kill.

```bash
git add -A
git commit -m "feat(dashboard): View E — read-only Configuration"
```

---

## Phase 5 — Demo polish (Day 3 evening)

### Task 20: End-to-end smoke + demo dry-run

**Files:**
- Create: `scripts/demo-dry-run.ts`
- Create: `tests/e2e/demo.spec.ts` (optional Playwright)

- [ ] **Step 1: Scripted end-to-end runner**

Create `scripts/demo-dry-run.ts`:

```ts
import { generatePodcastEpisode } from "@/lib/agents/podcast-episode";
import { extractClips } from "@/lib/agents/clip-extractor";
import { fanOutEpisode } from "@/lib/agents/fanout";
import { publishEpisode } from "@/lib/publishers/orchestrator";

async function main() {
  console.log("[1/4] Generating episode...");
  const t0 = Date.now();
  const ep = await generatePodcastEpisode({
    show: "off_the_clock", hostId: "maya", guestId: "dr_chen", arcDay: 15,
    topic: "Why melatonin stopped working", seasonNumber: 1, episodeNumber: 4,
  });
  console.log(`  ✓ ${ep.beats.length} beats · ${ep.clip_candidates.length} candidates · ${((Date.now()-t0)/1000).toFixed(1)}s`);

  console.log("[2/4] Extracting clips + fanning out...");
  const t1 = Date.now();
  const [clips, fanout] = await Promise.all([
    extractClips(ep, { topN: 10 }),
    fanOutEpisode(ep, { hostId: "maya", guestId: "dr_chen" }),
  ]);
  console.log(`  ✓ ${clips.length} clips · X×2 + Reddit + IG carousel · ${((Date.now()-t1)/1000).toFixed(1)}s`);

  console.log("[3/4] Quality stack + auto-publish (DEMO_MODE)...");
  process.env.DEMO_MODE = "true";
  const t2 = Date.now();
  const result = await publishEpisode({
    brandId: "root_labs", hostId: "maya", episode: ep,
    audioUrl: "https://placeholder/audio.mp3", coverUrl: "https://placeholder/cover.png",
    videoFilePath: "/dev/null", thumbnailPath: "/dev/null",
  });
  console.log(`  ✓ Quality: ${result.quality_stack.overall} · Spotify+Apple: ${result.buzzsprout.status} · YouTube: ${result.youtube.status} · ${((Date.now()-t2)/1000).toFixed(1)}s`);

  console.log(`[4/4] TOTAL: ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Add: `"demo:dry": "tsx scripts/demo-dry-run.ts"`.

Run: `npm run demo:dry`. Expected: complete end-to-end pipeline in <3 min total.

- [ ] **Step 2: Final dashboard polish**

Open each view and verify:
- /dashboard — 6 character cards
- /dashboard/calendar — has at least one piece (run generate if empty)
- /dashboard/pieces/[id] — script + clips + fanout + publish panel all render
- /dashboard/insights — all 5 insight sections render
- /dashboard/config — all 4 config sections render

Fix any layout bugs inline.

- [ ] **Step 3: Demo narration script**

Open the spec file §17 "Demo Storyboard" — rehearse the 4-minute narration twice while clicking through the actual UI. Time yourself. Adjust pacing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: end-to-end demo dry-run script + dashboard polish"
```

---

## Stretch Tasks (only if ahead)

### Stretch A: Real audio generation via ElevenLabs / NotebookLM

Wire ElevenLabs Conversational endpoint to render real two-voice audio from the episode script. Upload to Buzzsprout audio storage. ~2-3 hours of work, ~$5-15 cost per render.

### Stretch B: Real Buzzsprout + YouTube publish

Turn off `DEMO_MODE`, use real Buzzsprout sandbox account + YouTube unlisted upload. Adds risk of API failure during demo.

### Stretch C: Hedra dual-avatar video podcast

Render Maya + Dr. Chen as synthetic avatars conversing. Use Hedra Character-3. Adds ~30-60 min per render. Powerful demo moment if it works.

### Stretch D: TikTok publish for one clip

Use TikTok Content Posting API sandbox. Adds the "live to TikTok" demo moment. Requires TikTok developer account approval — start the application immediately if pursuing.

---

## Self-Review (already performed)

**Spec coverage check:**
- ✅ Brand config (§5) → Task 3
- ✅ Universe store (§6) → Tasks 2, 5
- ✅ Storytelling engine subsystems (§7) → Tasks 7-10 (arc planner, episode, clips, fanout encode beats/layers/specs/hooks/adaptation; compliance covered in Task 11)
- ✅ Character constellation (§8) → Task 4
- ✅ Platform strategy + autonomy tiers (§9) → encoded in defaults; per-channel autonomy table referenced in dashboard config (Task 19) and quality stack (Task 11)
- ✅ Podcast subsystem (§10) → Tasks 8 (episode), 9 (clips), 10 (fanout)
- ✅ Publishing pipeline (§11) → Tasks 11 (quality stack), 14 (orchestrator)
- ✅ Platform adapters (§12) → Tasks 12 (Buzzsprout/Spotify/Apple), 13 (YouTube), 14 (orchestrator)
- ✅ Dashboard 5 views (§13) → Tasks 15 (A), 16 (B+C), 18 (D), 19 (E)
- ✅ Agent orchestration (§14) → emerges from Tasks 7-11-14 graph
- ✅ Demo storyboard (§17) → Task 20

**Gap noted:** Real audio generation, real video, performance feedback loop reading real platform analytics — all marked as Stretch or as v2 in the spec. Acceptable for hackathon scope.

**Placeholder scan:** No TBDs in step content. The "demo placeholder URLs" in Task 17/20 are intentional and clear.

**Type consistency:** `EpisodeOutput` from Task 8 is the contract used by Tasks 9, 10, 14, 16, 20. `AgentResult` defined in Task 11 used throughout quality stack. `BrandConfig`/`Character` from Tasks 3/4 used in agents and stack. Consistent.

---

## Done

Plan complete and saved to `docs/superpowers/plans/2026-05-13-content-machine-implementation.md`.
