# Higgsfield Video Dashboard

A hosted Next.js dashboard that calls the Higgsfield video API server-side.
No Claude/MCP dependency at runtime — your dashboard keeps working even when
your local agent isn't.

## Architecture

```
Browser  ──▶  Next.js API routes  ──▶  Higgsfield REST API
                  │
                  └─ in-memory job store + 5s background poller
```

- `lib/higgsfield.ts` — server-only client. Holds the API key, exposes
  `submitVideoJob` and `fetchJob`.
- `lib/jobs.ts` — in-memory job table + a `setInterval` poller that updates
  in-flight jobs every 5s.
- `app/api/higgsfield/generate` — submit a new job.
- `app/api/higgsfield/jobs` — list jobs.
- `app/api/higgsfield/jobs/[id]` — single job status.
- `app/api/auth` — sets a shared-password cookie.
- `app/page.tsx` — UI: prompt form + history grid with auto-refresh.

> **In-memory storage** is intentional — fast to demo, zero infra. Jobs
> vanish on server restart. Swap `lib/jobs.ts` for Supabase/Postgres when
> you need persistence (the shape stays the same).

## Setup

```bash
cd higgsfield-dashboard
npm install
cp .env.example .env.local
# edit .env.local and add your real HIGGSFIELD_API_KEY + DASHBOARD_PASSWORD
npm run dev
```

Open http://localhost:3000, log in with the password, generate a video.

## Configure the Higgsfield call

The exact endpoint path and JSON keys depend on your Higgsfield plan. Edit
`lib/higgsfield.ts`:

- `submitVideoJob` posts to `${BASE}/v1/video/generations` with
  `{ model, prompt, duration, aspect_ratio, reference_image_url }`.
- `fetchJob` GETs `${BASE}/v1/video/generations/:id`.
- `normalize` maps the response to `{ id, status, asset_url, error }` — adjust
  the field names if Higgsfield returns different ones.

Update `HIGGSFIELD_VIDEO_MODEL` in `.env.local` to the exact model id (e.g.
`dop`, `speak`, or whatever your plan exposes).

## Deploy

### Vercel (fastest)

```bash
npx vercel
# add env vars in the Vercel dashboard:
#   HIGGSFIELD_API_KEY, HIGGSFIELD_API_BASE, HIGGSFIELD_VIDEO_MODEL, DASHBOARD_PASSWORD
```

> **Vercel caveat:** serverless functions don't keep a long-running
> `setInterval` alive. For production on Vercel, do one of:
> 1. Move job storage to a DB (Supabase/Upstash) and add a Vercel Cron
>    (`vercel.json`) that hits a `/api/cron/poll` route every minute.
> 2. Switch to webhooks if Higgsfield supports them on your plan.
> 3. Deploy on Render/Fly/Railway instead — long-running Node process,
>    the in-memory poller works as-is.

### Render / Fly / Railway

Standard Node service. Build = `npm run build`, start = `npm start`. Set the
same env vars. The in-memory poller works because the process stays alive.

## Triggering generations from elsewhere (e.g. Claude/MCP)

Your dashboard endpoint is now a stable contract — anything with the
cookie or future API token can call it:

```bash
curl -X POST https://your-domain.com/api/higgsfield/generate \
  -H "Cookie: hf_dash_auth=YOUR_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a calm morning routine, 9:16","duration_seconds":6}'
```

When you wire MCP back in later, point the MCP tool at this endpoint
instead of Higgsfield directly. The dashboard stays the source of truth.

## What's intentionally NOT here

- No DB. Add Supabase if you need persistence.
- No asset mirroring. Higgsfield URLs may expire — if you need durable
  playback, download finished assets into S3/R2 in `lib/jobs.ts` after
  status flips to `succeeded`.
- No per-user accounts. Single shared password only.
