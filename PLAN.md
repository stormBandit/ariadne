# Ariadne - Build Plan

## Current Status

Last updated: 2026-09-23 (uncommitted — Auto-Changelog Steps 1-3 on top of commit `8409584`)
Completed: Core workflow (YouTube sync, dashboard/detail, links, DM messages, keywords, A/B tests). Auto-Changelog
Steps 1-3: `content_changelog` table + `youtube_videos.thumbnail_url` column (local D1 migrated, remote D1 still
needs the same migration run), sync logic now diffs title/thumbnail on every sync and logs changes atomically,
test coverage added (10 tests in `youtube.test.ts`, up from 5). Added `@vitest/coverage-istanbul` +
`npm run test:coverage` to track coverage going forward — baseline 94.2%/84.37%/88.23%/95.89%
(stmts/branch/funcs/lines); currently 94.14%/85.41%/88.88%/96.15%, effectively flat (the 0.06pp stmt dip is
pre-existing untested error branches, not new code).
In progress: Auto-Changelog Step 4 (Change History UI) is intentionally deferred pending the UI revamp — do not
build it yet. Removing remaining OpenInApp references (`links.type = 'openinapp'` legacy value) still pending.
Blocked on: nothing currently.
Next: Run the schema migration (`thumbnail_url` column + `content_changelog` table) against remote/production D1
— see "Development" below for the commands; local D1 is already migrated. Then finish the OpenInApp cleanup.

_This file is the shared plan between Claude Code (this repo) and the Cowork planning agent. See "Sync
convention" below for who owns which section. "What changed since the original plan" is the decision log._

A content workflow dashboard for The Nomadic Sweethearts. It syncs videos in from YouTube automatically, then
tracks the things YouTube Studio doesn't give you an API for: title/thumbnail A/B test results, targeted
keywords and their search volume, tracking/deep links, and saved DM automation messages.

Built on Cloudflare Workers + D1, served as Worker-hosted static assets. Cost: $0 on the free tier.

Scope: YouTube only. Other platforms may be added later but are out of scope now.

---

## What changed since the original plan

This plan was written before real implementation started. Several decisions changed along the way — this
section is the authoritative record of what actually happened and why, so future planning starts from truth
rather than the original assumptions.

- **No manual "Add Video" flow.** The original plan had a form where you paste a YouTube URL and the Worker
  calls oEmbed to fetch title/thumbnail on demand. This was built, then removed (`4d8f3f0 Removing all the
  manual adding of content`). Videos now enter the system exclusively through the YouTube sync (see below) —
  one source of truth, no drift between manually-entered and synced data.
- **OpenInApp is being removed entirely, not integrated.** Phase 4 in the original plan was "OpenInApp
  Integration" (API key, deep-link generation endpoint, status dot in the table). That got built
  (`8938ac9`), then reversed: the generate-link button was pulled first (`e22b266`, "phase 0 of removing
  openinapp entirely from our flow") and the rest is expected to follow. `links.type` still has `'openinapp'`
  as a legacy value in the schema comment but no active code path creates one anymore. Don't re-propose
  OpenInApp integration without checking in first — this was a deliberate reversal, not an oversight.
- **Keyword tracking replaced speech analysis as the "Part 2" intelligence feature.** The original Phase 7 was
  filler-word/transcript analysis. That was dropped before being built. In its place: a `keywords` table
  tracking targeted keywords with a TubeBuddy weighted score (0–100) and a search-volume tier (`Poor` / `Fair`
  / `Good` / `Great` / `Excellent`), shipped in `7456b9b`. No transcript upload or Gemini transcript-audit
  feature exists.
- **Title and thumbnail testing share one schema, not two.** `tests`/`test_variants` covers both
  `test_type = 'title'` and `test_type = 'thumbnail'` in the same tables (`test_variants.value` holds title
  text or a base64-encoded thumbnail image depending on type), rather than the separate Part 2 tables the
  original plan sketched. Title tests require ≥2 variants; thumbnail tests require ≥1.
- **No Chart.js.** CLAUDE.md now bans CDN chart libraries outright — any chart is hand-built inline SVG. The
  original plan's "bar chart (Chart.js from CDN)" language for speech analysis and title testing is moot since
  that feature didn't ship as planned, but the constraint applies to anything built going forward (e.g. a
  future CTR comparison view).
- **Primary key is the YouTube video ID, not an autoincrement int.** `youtube_videos.video_id` (e.g.
  `Xnk2Budn0zA`) is the table's primary key (`1d009e9`). Every other table's foreign key
  (`links.content_id`, `messages.content_id`, `keywords.content_id`, `tests.content_id`) points at that string,
  and the frontend uses it directly in URLs (`/content?id=Xnk2Budn0zA`).
- **Hosting is Worker static assets, not Cloudflare Pages.** `wrangler.toml` uses `[assets]` with an `ASSETS`
  binding (`run_worker_first = true`) rather than a separate Pages deployment — one Worker serves both the API
  and the frontend.
- **Gemini DM-generation is on the wishlist, not scheduled.** `POST /api/generate-message` (3 DM message
  variations) is still planned but was bumped behind the Auto-Changelog feature — see "Immediate priorities."
  No `GEMINI_API_KEY` secret is in use yet.

---

## Tech Stack (current)

| Layer | Tool | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | No build step, deploys anywhere |
| Backend | Cloudflare Workers (TypeScript + Hono) | Free tier, edge performance |
| Database | Cloudflare D1 (SQLite) | Free, built into Workers |
| Static hosting | Worker `[assets]` binding | One Worker serves API + frontend, no separate Pages deploy |
| View/upload sync | YouTube Data API v3 | Existing API key, pulls uploads playlist on cron + manual trigger |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` | Mocks external calls (see `src/youtube.test.ts` pattern) |
| CI/CD | GitHub Actions | Free for public repos |
| AI (planned, not yet built) | Google Gemini API (free tier) | DM message generation |

No OpenInApp dependency (being actively removed). No Chart.js or any CDN chart library (project-wide rule now,
not just a Part 2 detail) — see `CLAUDE.md`.

---

## Database Schema (current — `schema.sql`)

```sql
CREATE TABLE youtube_videos (
  video_id    TEXT PRIMARY KEY,     -- YouTube's own video ID, e.g. 'Xnk2Budn0zA'
  title       TEXT NOT NULL,
  source_url  TEXT,
  publish_date TEXT,
  status      TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'live'
  video_type  TEXT NOT NULL DEFAULT 'video', -- 'video', 'short'
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- 'openinapp' (legacy), 'creatorurls', 'affiliate', 'other'
  label       TEXT,
  url         TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  platform      TEXT,         -- 'instagram', 'facebook', 'tiktok', etc.
  trigger_word  TEXT,         -- word someone DMs to trigger automation
  message_body  TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE keywords (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id     TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,
  weighted_score INTEGER, -- TubeBuddy "weighted overall score", out of 100
  search_volume  TEXT CHECK (search_volume IS NULL OR search_volume IN ('Poor', 'Fair', 'Good', 'Great', 'Excellent')),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  test_type   TEXT NOT NULL,                       -- 'title', 'thumbnail'
  status      TEXT NOT NULL DEFAULT 'inconclusive', -- 'conclusive', 'inconclusive'
  start_date  TEXT,
  end_date    TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE test_variants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id           INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  value             TEXT NOT NULL, -- title text, or base64 thumbnail image
  watch_time_share  REAL,          -- percentage, e.g. 62.0; null if inconclusive
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
```

`ON DELETE CASCADE`: deleting a video row removes its links, messages, keywords, and tests; deleting a test
removes its variants.

---

## Repo Structure (current)

```
ariadne/
├── public/
│   ├── index.html        -- Dashboard (search + type filter + content list)
│   ├── content.html       -- Video detail page (links, messages, keywords, tests)
│   ├── styles.css
│   └── app.js             -- ~1040 lines: dashboard render, detail render, all interactions
├── src/
│   ├── index.ts           -- Hono routes (all endpoints below live here, not split into src/routes/)
│   ├── youtube.ts          -- YouTube sync logic (cron + manual "Sync now")
│   ├── index.test.ts
│   ├── youtube.test.ts     -- mocking pattern for external API calls
│   └── env.d.ts
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

Note: routes are not split into `src/routes/*.ts` as the original plan sketched — everything lives in
`src/index.ts` (currently ~320 lines). Revisit splitting only if that file gets hard to navigate; no evidence
yet that it needs it.

---

## API Endpoints (current)

| Method | Path | What it's for |
|---|---|---|
| `GET` | `/api/content` | List every video, newest-to-oldest by publish date — powers the dashboard |
| `GET` | `/api/content/:id` | Fetch one video (by `video_id`) with links, messages, keywords, tests+variants |
| `PUT` | `/api/content/:id` | Update a video's fields (e.g. mark it `live`) |
| `DELETE` | `/api/content/:id` | Delete a video — cascades |
| `POST` | `/api/content/:id/links` | Attach a link (CreatorURLs, affiliate, etc.) |
| `PUT` | `/api/links/:id` | Edit a link |
| `DELETE` | `/api/links/:id` | Remove a link |
| `POST` | `/api/content/:id/messages` | Save a DM automation message (per platform/trigger word) |
| `DELETE` | `/api/messages/:id` | Remove a message |
| `POST` | `/api/content/:id/keywords` | Track a targeted keyword with weighted score + search volume |
| `DELETE` | `/api/keywords/:id` | Remove a keyword |
| `POST` | `/api/content/:id/tests` | Log a title or thumbnail A/B test with variants |
| `PUT` | `/api/tests/:id` | Update a test's status/dates/notes, replace variants wholesale |
| `DELETE` | `/api/tests/:id` | Remove a test — cascades to variants |
| `POST` | `/api/sync/youtube` | Pull recent uploads from the channel's uploads playlist into `youtube_videos` (also runs weekly on cron, Friday 20:00 UTC) |

**Planned, not yet built:**

| Method | Path | What it's for |
|---|---|---|
| `POST` | `/api/generate-message` | Calls Gemini with content + link details, returns 3 DM message options |

---

## Frontend (current)

**Dashboard (`index.html` / `initDashboard()` in `app.js`)**
- Search by title or video ID
- Chip filter: Videos / Shorts
- "Sync now" button triggers `/api/sync/youtube` manually, shows sync status
- Each row shows a status badge (draft/scheduled/live) and a title-test badge (derived from the most recent
  title test's status: in progress / none / inconclusive / conclusive), with a hand-drawn SVG icon so badges
  are distinguishable by shape as well as color

**Detail page (`content.html` / `initContentDetail()` in `app.js`)**
- Links section (add/edit/remove, with URL validation per link type)
- Messages section (DM automations, add/remove)
- Keywords section (add/remove, weighted score + search volume tier)
- Tests section, separately for title and thumbnail: add/edit variants, mark conclusive/inconclusive, image
  compression + data-URL preview for thumbnail variants, date range display

No Chart.js, no external chart library — badges and status indicators are plain DOM/CSS plus small inline SVGs
(see `iconBadge`/`titleTestBadge` in `app.js`).

---

## Immediate priorities (next up, not yet scheduled into phases)

1. Finish removing OpenInApp: drop the `'openinapp'` link type from active use once confirmed nothing still
   writes it (currently only the button was removed, per `e22b266`).
2. Build the Auto-Changelog feature — see full substeps below.
3. No current plan to revive speech/transcript analysis — keyword tracking took its place. Don't resurrect it
   without an explicit ask.

`POST /api/generate-message` (Gemini DM generation) has been moved to the wishlist — not a current priority.

---

## Auto-Changelog — Build substeps

Auto-detect when the live title or thumbnail changes on each sync and log it automatically. This is separate
from A/B testing (which tracks intentional multi-variant experiments). Both coexist on the detail page:
- **A/B tests section** = you manually logged a test with variants and results (already built)
- **Change History section** = system detected the live version changed from X to Y on this date (what we're building)

### Step 1 — Schema migration (DONE, local D1 only — remote still pending)

```sql
-- Add to youtube_videos
ALTER TABLE youtube_videos ADD COLUMN thumbnail_url TEXT;

-- New table
CREATE TABLE content_changelog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL DEFAULT 'dalton',
  changed_at    TEXT NOT NULL,
  change_type   TEXT NOT NULL CHECK (change_type IN ('title', 'thumbnail')),
  old_value     TEXT,
  new_value     TEXT,
  -- CTR fields: all NULL until Phase 3 OAuth is connected.
  -- ctr_before = CTR for the 28 days leading up to the detected change.
  -- ctr_after  = CTR for the 28 days starting ~2 weeks post-change; stays NULL until
  --              the threshold is met (suggested: 2 weeks elapsed + 500 impressions after).
  -- Impressions stored alongside so confidence in the rate is visible to the user.
  ctr_before                REAL,
  impressions_before        INTEGER,
  ctr_after                 REAL,
  impressions_after         INTEGER,
  avg_view_duration_before  INTEGER,  -- seconds; NULL until Phase 3 OAuth
  avg_view_duration_after   INTEGER   -- seconds; NULL until threshold met (2 weeks + 500 impressions)
);
```

Do NOT use a single `ctr_at_change` field. CTR is a rate over a time window, not a point-in-time number.
The before/after split is what makes the data actionable. `avg_view_duration` is stored alongside CTR
because the two together tell the full story: CTR up + duration down means the thumbnail is attracting
the wrong audience. CTR alone doesn't catch that.

Run on both local and remote D1.

### Step 2 — Update `youtube.ts` sync logic (DONE)

Current behaviour: sync fetches the uploads playlist, inserts new videos, skips existing ones.

New behaviour:
- On INSERT of a new video: store `thumbnail_url` (use `snippet.thumbnails.high.url` or `maxresdefault`)
- On each sync for existing videos: compare incoming `title` + `thumbnail_url` against stored values
- If title changed: update `youtube_videos.title`, write a `content_changelog` row (`change_type = 'title'`,
  `old_value = old title`, `new_value = new title`, all CTR/impressions fields = NULL for now)
- If thumbnail URL changed: update `youtube_videos.thumbnail_url`, write a changelog row the same way
- If neither changed: skip — no write, no log

This is the core behaviour change. Keep it atomic: update the stored value and write the log row in the same
D1 batch so they can't get out of sync.

### Step 3 — Update tests (DONE)

In `youtube.test.ts`, add cases for:
- Title changed on existing video → stored title updated + changelog row written
- Thumbnail URL changed → stored URL updated + changelog row written
- No changes → no writes
- Both changed in same sync → two changelog rows

Also added: thumbnail_url is stored on insert for new videos. All 5 cases implemented; suite is now 10 tests
in `youtube.test.ts` (was 5), 38 total across the project (was 33). Coverage tracked via
`@vitest/coverage-istanbul` + `npm run test:coverage` (config in `vitest.config.ts`) — see Current Status for
baseline vs. current numbers. Scope note: the diff only checks videos returned by the recent-uploads fetch
(default last 10), not every row in the DB — older videos that scroll out of that window won't get diffed
until they're re-fetched. Matches the existing `reclassifyExisting` split (that function handles
status/type/URL reclassification for *all* stored videos separately, via a lighter API call); extending
title/thumbnail diffing to all stored videos would cost an extra quota-consuming API call per video and wasn't
asked for — flag if that scope is actually wanted.

### Step 4 — Change History UI (DEFERRED — pending UI revamp)

Do not build Step 4 yet. The detail page and dashboard are getting cluttered as features accumulate, and
adding a changelog section on top of the current layout will make it worse. A UI revamp is planned before
this phase ships to users — the changelog UI will be designed as part of that, not bolted on after.

What to build when the time comes (for reference, not for now):
- New "Change History" section on the detail page, positioned below A/B tests
- For title changes: old title → new title, strikethrough on old
- For thumbnail changes: old thumbnail → arrow → new thumbnail, side by side (YouTube CDN URL, not base64)
- CTR before/after only shown when both are non-null; hidden entirely otherwise
- Empty state: "No changes detected yet — changes to your live title or thumbnail will appear here
  automatically after the next sync."

### UI Revamp (planning item — scope TBD)

The dashboard and detail page are accumulating features and becoming cluttered. Before the changelog UI
(Step 4) and any further Phase 3 features are added, the overall layout needs a rethink. This will be
planned separately with design input. Do not add new UI sections to the existing pages until the revamp
direction is set.

---

### Step 5 — Phase 3 graph (do not build now, comes with OAuth)

When CTR data is available (Phase 3 YouTube Analytics OAuth):
- CTR trend line per video (inline SVG only — no Chart.js per project rule)
- Change event icons on the timeline: T icon for title changes, thumbnail icon for thumbnail changes
  (similar to the publish icons YouTube Studio shows on its views graph)
- Hovering an icon reveals a tooltip: old thumbnail → arrow → new thumbnail (same layout as the inline
  diff view in Step 4, but as a hover overlay on the chart)
- `ctr_before`/`ctr_after` backfilled from the Analytics API for changelog entries that predate OAuth, using the 28-day window around `changed_at`

The A/B test section remains separate from this graph — tests are intentional experiments, the graph shows
organic change history.

---

## Roadmap

### Phase 3 — Analytics & Intelligence

Phase 3 requires OAuth (YouTube Analytics API, read-only). The existing YouTube Data API v3 key still handles video sync. All Phase 3 work builds on top of the existing dashboard and schema — no rebuilding.

**Multi-tenancy prep (do before any Phase 3 schema work):** Add `user_id TEXT NOT NULL DEFAULT 'dalton'` to all existing tables and to every new Phase 3 table. No auth layer yet, but queries should be structured so `WHERE user_id = ?` is a one-line addition per query, not a schema redesign.

---

**YouTube Analytics OAuth**

- Per-user OAuth flow (YouTube Analytics API, read-only scope `https://www.googleapis.com/auth/yt-analytics.readonly`)
- Pull per-video: impressions, CTR, views, watch time (hours), average view duration, subscriber change
- Pull channel-level: channel average CTR (baseline for flagging underperformers)
- Store weekly snapshots in D1 so metrics are tracked over time, not just point-in-time
- "Last synced" timestamp visible per video; manual sync button + optional scheduled sync

---

**CTR Health Dashboard**

- Single view ranking all videos by `missed_clicks = impressions × (channel_avg_ctr - video_ctr)` — highest missed clicks at top
- Colour coding: red (significantly below channel average), yellow (slightly below), green (at or above)
- Filter by date range, content type, impression threshold (e.g. only show 1,000+ impressions)
- One-click drill-down to video detail page with full analytics + changelog
- "Dismissed" status per video — mark ones you've consciously decided not to change

---

**Title & Thumbnail Auto-Changelog**

- On each analytics sync: pull current thumbnail URL and title from YouTube Data API and compare against the previous sync values stored in D1
- If changed: automatically log a changelog entry with old/new value, date, and CTR at time of change — no manual effort required
- Each video accumulates a full history over time: title v1 → v2, thumbnail v1 → v2, CTR snapshot at each transition
- Visual diff view: old vs. new thumbnail side by side, CTR before/after
- "This change improved CTR by X%" label after sufficient post-change data accumulates (suggested threshold: 2 weeks + 500 impressions)

Note: YouTube Studio's API does not expose which A/B title variant is currently winning — the changelog detects when the final title changes post-test but cannot track the test itself in real time. The existing A/B test logging in Ariadne remains the mechanism for that.

---

**AI Diagnosis (Gemini)**

- "Diagnose this video" button on the detail page for flagged underperformers
- Feed title, thumbnail URL, CTR, impressions, and top-performing videos (as comparison) into Gemini free tier
- Output: thumbnail problem, title problem, or mismatch between the two — plus a specific rewrite suggestion
- Suggestion history: log every recommendation alongside what was actually changed and what CTR did afterward
- Use Gemini free tier (no cost); verify current model name against live docs before hardcoding

---

**New tables needed (Phase 3 schema additions)**

```sql
-- Weekly analytics snapshots per video
CREATE TABLE analytics_snapshots (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id                  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL DEFAULT 'dalton',
  snapshotted_at            TEXT NOT NULL,
  impressions               INTEGER,
  ctr                       REAL,         -- e.g. 0.052 = 5.2%
  views                     INTEGER,
  watch_time_hours          REAL,
  avg_view_duration_seconds INTEGER,
  subscriber_change         INTEGER
);

-- Channel-level snapshots (for avg CTR baseline)
CREATE TABLE channel_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL DEFAULT 'dalton',
  snapshotted_at TEXT NOT NULL,
  avg_ctr        REAL
);

-- Auto-detected title/thumbnail changelog entries — SHIPPED, see schema.sql
CREATE TABLE content_changelog (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id                  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL DEFAULT 'dalton',
  changed_at                TEXT NOT NULL,
  change_type               TEXT NOT NULL CHECK (change_type IN ('title', 'thumbnail')),
  old_value                 TEXT,
  new_value                 TEXT,
  ctr_before                REAL,        -- CTR for 28 days before change; NULL until OAuth
  impressions_before        INTEGER,
  avg_view_duration_before  INTEGER,     -- seconds; NULL until OAuth
  ctr_after                 REAL,        -- CTR for 28 days ~2 weeks post-change; NULL until threshold met
  impressions_after         INTEGER,
  avg_view_duration_after   INTEGER      -- seconds; NULL until threshold met
);

-- AI diagnosis log
CREATE TABLE ai_diagnoses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL DEFAULT 'dalton',
  diagnosed_at  TEXT NOT NULL,
  diagnosis     TEXT,    -- JSON: {problem: 'thumbnail'|'title'|'both', suggestion: '...'}
  actual_change TEXT,    -- filled in later: what was actually changed
  ctr_before    REAL,
  ctr_after     REAL     -- filled in once enough post-change data exists
);
```

---

### Pre-Launch Investigative Requirements

Before Ariadne goes public, these questions must be answered — not built around, but actually verified. They affect architecture decisions that are expensive to undo post-launch.

**YouTube API quota under multi-tenancy**

The current setup uses a single Google Cloud project. Both the YouTube Data API v3 (video sync, API key) and YouTube Analytics API (OAuth, Phase 3) draw from that project's daily quota pool. With multiple live users, every user's sync burns from the same shared limits.

What needs to be investigated before launch:
- What is the actual daily quota for the YouTube Analytics API under OAuth? (The number is not well-documented and may differ from the Data API v3's 10,000 units/day.)
- Do OAuth-authenticated Analytics calls count against the project quota or against a per-user quota allocation? Google's behaviour here is not obvious and has changed in the past — check the Cloud Console quota page once OAuth is built, not before.
- How many units does a typical analytics snapshot query cost? (One report call per video, per time window — estimate total weekly quota consumption at 10, 100, and 500 users.)
- What is the quota increase request process, and how long does approval take? Apply before hitting the ceiling, not after.

The Data API v3 sync (existing API key, video list) is likely the tighter constraint at scale — syncing upload playlists for hundreds of channels against a 10,000 unit/day limit adds up faster than bounded analytics snapshot queries. Both need modelling.

Mitigations to design for (don't defer these to post-launch):
- Staggered sync scheduling — spread user syncs across the day/week, not all at the same time
- Snapshot-only querying — already the plan; query once per changelog event, never on page load
- Quota monitoring — surface remaining daily quota in an admin view so you can see problems before users do

---

### Phase 4 — Pattern Recognition (Wishlist, Post-Launch)

Out of scope for the $0 initial launch. Revisit once Ariadne is live and generating real analytics history. Some features here will have API costs — scope and pricing to be confirmed at planning time.

- **Thumbnail style tagging:** manual tagging by style (faces only, landscape, reaction face, text-heavy, etc.) with average CTR surfaced per style
- **AI-assisted tagging:** feed thumbnail URLs into a vision model to auto-classify style, subject, colour temperature, whether faces are present
- **Title pattern analysis:** surface which title structures (question, "how to", number list, location + activity) perform best on this specific channel's history
- **Content type benchmarking:** group videos by type (road trip, city guide, cruise, whale watching) and show CTR benchmarks within each group — so a road trip compares to other road trips, not to a whale watching video
- **Cross-signal correlation:** once speech/transcript analysis is revisited, correlate filler-word count with watch time, hook strength (first 30 seconds) with drop-off rate, video length with watch time percentage

---

## UI: Contextual Tips ('i' icon pattern)

Wherever metrics are displayed that require interpretation, show a small ℹ icon next to the section
header. Tapping or hovering reveals a tooltip explaining what the data means and what to do about it —
not just what it is. The goal is to surface the hypothesis, not just the number.

Build this as a single shared component (a reusable `infoTip(text)` helper in `app.js` that renders
the icon and wires up the tooltip), not reimplemented per section.

**Interpretations to surface on the changelog CTR + avg view duration block:**

- CTR up, avg view duration down → "More people clicked but fewer stayed. This suggests the thumbnail
  may be attracting the wrong audience, or creating expectations the video doesn't meet. Consider
  whether the thumbnail accurately represents the content."
- CTR up, avg view duration flat or up → "Positive signal — more clicks and engagement held steady.
  The change likely improved relevance for your audience."
- CTR down after change → "CTR dropped after this change. Consider reverting or testing a different
  direction."
- Data not yet available → "Not enough data yet. Check back after 2 weeks and 500 impressions
  post-change."

Apply this pattern to every metrics section added in Phase 3 and beyond — CTR Health Dashboard,
analytics snapshot view, AI Diagnosis. The icon and tooltip are deferred until the UI revamp
(Step 4 of Auto-Changelog), but the design intent should inform how new sections are structured.

---

## Sync convention (planning partner ↔ Claude Code)

This file is the shared communication channel. To keep both sides oriented:

- **Claude Code writes:** "Current Status" block at the top, "What changed since the original plan" section — reflects actual repo state, updated as work lands.
- **Planning partner (Cowork) writes:** "Roadmap" section above — upstream planning decisions, upcoming phases, scope calls made with Dalton. Claude Code reads this before starting a new feature to check for direction changes.
- Neither side deletes the other's sections. If a Roadmap item conflicts with what's actually been built, Claude Code adds a note in "What changed" explaining the divergence.

Claude Code should maintain a `STATUS.md` at the repo root — a short file (< 20 lines) with: current commit, what's done, what's in progress, what's blocked, and what's next. This gives the planning partner a fast read without parsing the full plan.

---

## Secrets in use

| Secret | Where | Status |
|---|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console | In use (sync) |
| `GEMINI_API_KEY` | aistudio.google.com, free, no card | Not yet added — needed once DM generation is built |
| `OPENINAPP_API_KEY` | openinapp.com dashboard | Being phased out — do not add back without explicit direction |

---

## Development

```bash
npm install
npm run dev            # local dev server (wrangler dev)
npm test                # run the test suite (vitest, local D1 via Miniflare)
npm run test:coverage   # same, with an istanbul coverage report — check before/after any change
npm run deploy          # deploy to Cloudflare
```

`schema.sql` is written as fresh-install CREATE statements, not a migration log — it errors with "table already
exists" against a DB that's already provisioned. To bring an existing DB (local or remote) up to date with a
schema change, run the specific `ALTER TABLE` / `CREATE TABLE` statements for what changed, not the whole file:

```bash
npx wrangler d1 execute ariadne --file=schema.sql          # fresh DB only (local or remote)
npx wrangler d1 execute ariadne --remote --file=schema.sql # fresh DB only (local or remote)

# Auto-Changelog migration (Step 1) — run against an already-provisioned DB:
npx wrangler d1 execute ariadne --local --command "ALTER TABLE youtube_videos ADD COLUMN thumbnail_url TEXT;"
npx wrangler d1 execute ariadne --remote --command "ALTER TABLE youtube_videos ADD COLUMN thumbnail_url TEXT;"
# then CREATE TABLE content_changelog (see schema.sql for the full statement) against both local and remote
```

---

## Working conventions (from `CLAUDE.md`, kept here for reference)

- $0-cost target — flag any dependency that isn't free-tier or free outright.
- Avoid OAuth until Phase 3 — everything before that uses API keys as Wrangler secrets. OAuth returns in Phase 3 for YouTube Analytics.
- No CDN chart libraries — inline SVG only.
- Additive changes — extend existing tables/files rather than renaming/replacing without being told to.
- External API failures return clear JSON errors, matching the `/api/sync/youtube` pattern.
- Mock external calls in tests, following `src/youtube.test.ts`.
- Verify current model/endpoint names (e.g. Gemini free-tier model) against live docs before hardcoding —
  planning docs (including this one) can go stale.
- Multi-tenancy: no hardcoded channel IDs anywhere in code. All tables will gain a `user_id` column in Phase 3 before launch. Design queries now so adding `WHERE user_id = ?` is a one-line change per query rather than a schema redesign.
