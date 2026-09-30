# Ariadne - Build Plan

## Current Status

Last updated: 2026-09-29 (commits `12781e8`, `08b18d1`, `b48eba4` pushed to origin/main; UI Revamp committed
as `1f53838` and dependency fix as `98984c5` — both local, not yet pushed)
Completed: Core workflow. Auto-Changelog Steps 1-3 (schema, sync diffing incl. the all-videos reclassify fix,
tests). OpenInApp removed from the Add-link UI. Test coverage tracked via `@vitest/coverage-istanbul` — baseline
94.2%/84.37%/88.23%/95.89%, currently 94.14%/86.07%/89.18%/96.41% (flat; the 0.06pp stmt dip predates this
work). Full details on all of the above are further down in this file and in "What changed."

**Dependencies (2026-09-29):** production `npm audit --omit=dev` is clean — `hono` bumped to 4.13.11 within
its existing `^4.6.0` range (lockfile-only change, `98984c5`). Remaining advisories (`ws`, `undici`, `sharp`,
`esbuild`, `@vitest/mocker`) are dev-only (wrangler/miniflare/vitest; never shipped in the Worker) and are
accepted for now. **Do not run `npm audit fix --force`:** it pulls vitest 5, which no
`@cloudflare/vitest-pool-workers` release supports, and breaks `npm install` with ERESOLVE. Clearing the
dev-only advisories properly is its own migration (vitest 4.1 + pool-workers 0.22 + wrangler 4 +
workers-types v5, new `cloudflareTest` config, and rewriting `youtube.test.ts` off `fetchMock`, which 0.22
removed); even then 0.22 pins a wrangler version audit still flags. Not scheduled.

**UI Revamp — done and committed (`1f53838`), per the planner agent's spec in "Auto-Changelog — Build
substeps" → "UI Revamp", plus two follow-up rounds (responsive layer, tab merge + infoTip fix).**
Dashboard is now a table (thumbnail/title+date/status/test columns, 1100px wide, with a status badge above the
title rather than its own column per Dalton's call, 2026-09-23; the plan's earlier "remove status entirely"
language has been withdrawn — that decision is deferred, not settled either way). Detail page has a persistent
video header (thumbnail from
`thumbnail_url` w/ CDN fallback, title, date, status + Shorts badges, Studio/Watch links) above 4 tabs
(Keywords / Links & Messages / Testing / Change History — Links and Messages were merged into one panel in a
follow-up; the last tab is a placeholder, not wired to `content_changelog` data yet, but its `infoTip()` now
uses a working CSS `::after` tooltip instead of the original broken native-`title` version). Responsive layer
added for <768px (table scrolls horizontally via a JS-injected wrapper, video header stacks, forms wrap). Nav
bar has no page links (single-page app right now — a Phase 3 CTR Health link is commented in for later). Shared
sticky nav bar with a Sync button on both pages. `app.js` split into `utils.js` (shared helpers + new
`infoTip()`), `dashboard.js`, `content.js` — no duplicate function definitions. Fixed a gap the spec didn't call
out: the nav's Sync button needed wiring on both pages, not just the dashboard (`initSyncButton()` in
`utils.js`). No backend/schema changes across any of this. **Not visually verified** — no
`chromium-cli`/`playwright` available in this environment; verified instead via
`node --check`, a full `qs()`-id-vs-HTML audit (zero mismatches), tab-key matching, and the full backend suite
(40/40, untouched). Full done-check is in the "Done-check for this phase" list under UI Revamp — recommend an
actual visual pass before calling this fully shipped.
In progress: Auto-Changelog Step 4 (the real Change History list, wired to `content_changelog` data) can now
be built on top of the new placeholder tab — no longer blocked on "no UI revamp," since that's done. Not
started yet.
**Local-first (Dalton, 2026-09-30):** the project is being built and verified locally only (local D1,
`npm run dev`, `npm test`) until Dalton decides to go live. Prod is out of scope — the remote D1 migration is
no longer a blocker. For the record: an old deploy of the `ariadne` Worker exists, and remote D1 is still on
the original scaffold schema (`content`/`links`/`messages` only, 38 synced rows, links/messages empty), so a
fresh reprovision from `schema.sql` will be needed at go-live, not an incremental migration.
Blocked on: nothing.
Next: Dalton to confirm the Commercialization phase order (C1–C5 below). Then either C1 (multi-tenancy
foundation) or Auto-Changelog Step 4, depending on that order. The "no internet" warning in "Nice to Haves"
could ride along with whichever frontend work comes first — options to be proposed to Dalton before building.
A visual browser pass on the UI Revamp is still outstanding.

**Direction change (2026-09-29):** Ariadne is shifting from a single-channel tool to a paid product for other
creators. The initial build stays $0. The OAuth restriction was removed from `CLAUDE.md`. Competitive research and
a phased commercialization plan are in the new "Commercialization" section below (nothing built yet). Next
decision for Dalton: confirm the phase order there.

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
- **OpenInApp is being removed entirely, not integrated. (DONE, 2026-09-23)** Phase 4 in the original plan was
  "OpenInApp Integration" (API key, deep-link generation endpoint, status dot in the table). That got built
  (`8938ac9`), then reversed: the generate-link button was pulled first (`e22b266`, "phase 0 of removing
  openinapp entirely from our flow"), and the cleanup finished by removing `'openinapp'` from the Add-link
  dropdown in `content.html` — no UI path creates a new OpenInApp link anymore. What's intentionally still
  there: `links.type = 'openinapp'` remains a valid value in `schema.sql` (marked legacy in its comment), the
  API still accepts it if posted directly (no server-side allowlist), and the *edit*-link dropdown in `app.js`
  still lists it as an option — all three exist only so the 25 existing openinapp-type link rows (local D1)
  stay viewable/editable/deletable without corrupting their type on save. This is the additive-changes rule:
  don't rewrite or drop historical data without being told to. `OPENINAPP_API_KEY` isn't in local `.dev.vars`;
  didn't check remote secrets (wrangler auth unavailable in this environment) — if it's set as a remote secret,
  revoking it is a manual step outside this repo. Don't re-propose OpenInApp integration without
  checking in first — this was a deliberate reversal, not an oversight.
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

1. ~~Finish removing OpenInApp~~ **DONE (2026-09-23).** `'openinapp'` dropped from the Add-link dropdown; no UI
   path creates new ones. See the "What changed" entry for what was intentionally left alone (legacy rows,
   schema comment, edit dropdown, API acceptance) and why.
2. ~~Build the Auto-Changelog feature~~ **DONE, Steps 1-3 (2026-09-23).** Schema, sync diffing, and tests are in;
   remote D1 still needs the migration run once wrangler auth is available (see Current Status). Step 4 (UI)
   stays deferred pending the UI revamp.
3. No current plan to revive speech/transcript analysis — keyword tracking took its place. Don't resurrect it
   without an explicit ask.

`POST /api/generate-message` (Gemini DM generation) has been moved to the wishlist — not a current priority.

---

## Nice to Haves (if they're easy wins, implement them during a phase of work, if not easy wins lets discuss when we have free cycles)

1. I would like to warn a user when their internet connection has cut out or they don't have internet to begin with
Right now, if the user tries to sync they simply see "Sync failed: internal error; reference =" and that's completely meaningless
to a normal user. It would be nice to have a display come up as soon as possible (let me know what those options would be) to say
"It looks like you aren't connected to the internet" or just a symbol for no internet.

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

Also added: thumbnail_url is stored on insert for new videos. All 5 cases implemented, suite was 10 tests in
`youtube.test.ts` at that point (was 5), 38 total (was 33). Coverage tracked via `@vitest/coverage-istanbul` +
`npm run test:coverage` (config in `vitest.config.ts`) — see Current Status for baseline vs. current numbers.

**Scope gap found and fixed (2026-09-23):** the version above only checked videos returned by the
recent-uploads fetch (last 10) — older videos that scrolled out of that window would never get diffed. Caught
by Dalton before it shipped as a live bug. Fixed by extending `reclassifyExisting` (which already loops over
*all* stored videos each sync, for status/type/URL reclassification) to also request `part=snippet` on its
existing `videos.list` call and diff title/thumbnail there too — no extra API requests, since it's the same
call reclassifyExisting was already making, just with a richer response. Now every stored video gets checked on
every sync, not just the last 10. 2 more tests added for this (title/thumbnail change on a video outside the
mocked recent-uploads response, and confirming "no snippet data returned" isn't treated as "changed to
nothing") — 12 tests in `youtube.test.ts`, 40 total.

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

### UI Revamp

Full redesign of both pages. Direction: dark (keep existing colour tokens), wider, YouTube Studio-inspired
table dashboard, tabbed detail page. Do not change any backend code, API endpoints, or schema during this
phase — HTML/CSS/JS only.

---

**Goals**

- Dashboard: replace full-width thumbnail cards with a compact table so more videos are visible at once
- Detail page: replace 2 coarse tabs with 5 focused tabs + a persistent video header
- Global nav: unified header bar across both pages so navigation is consistent
- app.js: split into three files to keep things manageable as the codebase grows

---

**File changes**

| File | What changes |
|---|---|
| `styles.css` | New classes for nav bar, table rows, video header, expanded tabs |
| `index.html` | Table markup, link to shared nav, remove per-page header |
| `content.html` | Video header section, 5-tab structure, link to shared nav |
| `public/app.js` | Rename to `public/utils.js` — shared helpers only (api(), qs(), formatDate(), statusBadge(), titleTestBadge(), iconBadge(), infoTip()) |
| `public/dashboard.js` | initDashboard() and all dashboard-specific render logic |
| `public/content.js` | initContentDetail() and all detail-page-specific render logic |

`index.html` loads `utils.js` then `dashboard.js`. `content.html` loads `utils.js` then `content.js`.

---

**Global nav bar**

Shared markup (inline in each HTML file, not a separate include — no build step):

```html
<nav class="app-nav">
  <a class="nav-brand" href="/">Ariadne</a>
  <!-- Nav links intentionally empty until Phase 3 adds CTR Health as a second page.
       A nav link with only one destination adds noise without value. -->
  <div class="nav-links">
    <!-- Phase 3: <a class="nav-link" href="/ctr-health">CTR Health</a> -->
  </div>
  <button id="sync-youtube" class="secondary small">Sync</button>
</nav>
```

The Sync button lives in the nav so it's always accessible. Remove the per-page `<header class="top">` from
both HTML files — the nav replaces it. On the detail page, the Sync button can be hidden (syncing from a
detail page is unintuitive) — add `style="display:none"` to it in `content.html`.

New CSS:
```css
.app-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 10;
}
.nav-brand { font-weight: 600; font-size: 16px; color: var(--text); text-decoration: none; }
.nav-links { display: flex; gap: 4px; flex: 1; }
.nav-link { color: var(--text-dim); text-decoration: none; font-size: 14px; padding: 6px 10px; border-radius: 6px; }
.nav-link:hover, .nav-link.active { color: var(--text); background: var(--surface); }
```

---

**Dashboard — table layout**

Max-width: `1200px` for the dashboard, `960px` for the detail page. Update `.page` to use the appropriate
value per page, or use a modifier class (`.page--wide` on `index.html`, `.page--detail` on `content.html`).
The current `720px` was set for a single-column mobile layout and is too narrow for a desktop dashboard tool.
Replace `.content-list` card rendering with a `<table>`.

Columns:

| Column | Width | Content |
|---|---|---|
| Thumbnail | 120px | 16:9 image, links to detail page |
| Title | flex | Video title (bold) + publish date below in `--text-dim` |
| Test | 110px | title-test badge (none/in progress/inconclusive/conclusive) |

Status badge: kept for now (Dalton's call, 2026-09-23) — revisit later whether it's worth showing given the
YouTube Data API v3 (no OAuth) only returns public published videos, so it currently reads "live" for nearly
every row. Not a settled decision either way.

No Studio/Watch links in the table — those move to the detail page header. Keep search + chip filter above
the table. Table header row with column labels.

New CSS needed: `.content-table`, `.content-table th`, `.content-table td`, `.content-table tr:hover`,
`.row-thumb` (the small thumbnail cell). Remove or repurpose `.card`, `.card-top`, `.card .thumbnail`
since those classes are no longer used by the dashboard.

---

**Detail page — video header + 5 tabs**

**Video header** (always visible, above the tabs):

```
[ thumbnail 200px ]  Title of the video
                     Published: Jan 1 2025  •  [Shorts badge if applicable]
                     [Go To Studio ↗]  [Go To Watch ↗]
```

Status badge: kept for now, same open question as the dashboard table above. Shorts badge is kept since
that's derived from `video_type` which is set by the sync and is accurate.

The thumbnail here comes from `youtube_videos.thumbnail_url` (now stored after Step 1). Fall back to the
YouTube CDN URL if null. Clicking the thumbnail opens the lightbox (existing behaviour, already in app.js).

New CSS: `.video-header`, `.video-header-thumb`, `.video-header-info`.

**Tab structure** — 4 tabs:

```
[ Keywords ]  [ Links & Messages ]  [ Testing ]  [ Change History ]
```

Tab panel mapping:

| Tab | Content |
|---|---|
| Keywords | Keywords section (add/remove, score, volume tier) |
| Links & Messages | Links section on top, Messages (DM automations) section below — same panel, no sub-tabs |
| Testing | Title Testing section + Thumbnail Testing section |
| Change History | Placeholder state for now — see below |

The Change History tab shows a placeholder until Step 4 (the actual history list) is built. The placeholder
should be an empty state with an explanation of what the tab does, not just a blank panel.

**Default tab on load:** Keywords.

---

**infoTip() helper**

Add to `utils.js`. Must use a CSS tooltip — NOT the native `title` attribute, which is slow, inconsistent
across browsers, and invisible on mobile.

```js
function infoTip(text) {
  const wrap = document.createElement('span');
  wrap.className = 'info-tip';
  wrap.setAttribute('aria-label', text);
  wrap.setAttribute('role', 'tooltip');
  wrap.dataset.tip = text;
  wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" stroke="currentColor"/>
    <text x="7" y="11" text-anchor="middle" font-size="9" fill="currentColor">i</text>
  </svg>`;
  return wrap;
}
```

CSS — the tooltip text comes from `data-tip` via a `::after` pseudo-element so no extra DOM is needed:
```css
.info-tip {
  position: relative;
  color: var(--text-dim);
  cursor: help;
  vertical-align: middle;
  margin-left: 4px;
  display: inline-flex;
}
.info-tip:hover { color: var(--text); }
.info-tip::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  font-weight: normal;
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 6px;
  white-space: normal;
  width: 220px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 20;
}
.info-tip:hover::after { opacity: 1; }
```

**Change History infoTip text:**
"Ariadne automatically detects when your video's title or thumbnail changes during each sync and logs it here.
Use this tab to see the history of every change and — once YouTube Analytics is connected — whether each
change improved your CTR."

Wire to the Change History tab header. Wire to any Phase 3 metrics section that needs interpretation context
(see "UI: Contextual Tips" section).

---

**Done-check for this phase (DONE, 2026-09-23)**

- [x] Both pages use the shared nav bar; old per-page headers removed
- [x] Dashboard renders as a table with thumbnail, title+date, status, test columns
- [x] Detail page shows video header (thumbnail, title, status, date, Studio/Watch links) above tabs — plus
      the Shorts badge from the ASCII mockup, which the prose spec omitted but the mockup showed
- [x] ~~Detail page has 5 tabs~~ **Superseded, 2026-09-23: now 4 tabs.** Links and Messages merged into one
      "Links & Messages" panel (Links section on top, Messages below, no sub-tabs) per the plan's revised spec.
      Tab keys are `keywords` / `links-messages` / `testing` / `changelog`; tab-switching JS in `content.js` is
      generic (matches `[data-tab]` to `[data-tab-panel]` by value) so it needed no changes, only the markup.
- [x] `app.js` split into `utils.js`, `dashboard.js`, `content.js`; no duplicate function definitions (verified
      by diffing top-level function names across all three files)
- [x] `infoTip()` helper exists in `utils.js`; wired to the Change History section header. **Fixed, 2026-09-23:**
      the first version used the native `title` attribute (slow, inconsistent, invisible on mobile) — replaced
      with the `data-tip` + `.info-tip::after` CSS tooltip from the plan's revised spec, and updated the wired
      text to the exact "Ariadne automatically detects..." copy specified there.
- [x] No backend changes (confirmed via `git status`: only `public/*` and `PLAN.md` touched)

Also fixed a gap the original spec didn't cover: the shared nav's Sync button is now wired on both pages via a
new `initSyncButton()` helper in `utils.js` (previously only `dashboard.js` had sync logic — the button would
have silently done nothing on the detail page).

Verification note: no browser automation tooling (`chromium-cli`, `playwright`) was available in the Claude
Code environment, so this wasn't visually screenshotted. Verified instead via `node --check` on all three JS
files, a full audit cross-referencing every `qs()` id against the HTML (zero mismatches), tab chip/panel key
matching, a live HTTP fetch confirming the running `wrangler dev` serves the new files, and the full backend
suite (40/40 passing, untouched). Recommend an actual visual pass before calling this fully shipped.

### UI Revamp — Follow-up: Responsive behaviour (DONE, 2026-09-23)

The revamp shipped targeting desktop widths. Everything must also degrade gracefully on mobile.
Breakpoint: `768px`. Apply these in a follow-up pass — do not redo the revamp, just add the responsive layer.

Implemented as CSS-only in `styles.css`, plus one JS-side DOM wrap in `dashboard.js` (the explicitly-permitted
exception, since `index.html`'s `<table>` markup is static and the scroll wrapper needs to sit around it — no
`content.html`/`index.html` edits were made; the wrapper is injected at runtime instead). No backend or
JS-logic changes.

- `.page`/`.page-wide` mobile row needed no new CSS: `max-width` already collapses to the viewport on its own,
  and padding was already `16px` unconditionally. Left desktop max-widths (720px / 1100px) unchanged — the
  table's "1200px / 960px" desktop column reads as documentation of intended values, not an instruction to
  widen the existing revamp, and the ask was explicitly to add the responsive layer, not redo it. Flag if that
  reading's wrong and an actual desktop-width bump was intended.
- Dashboard table: wrapped in `.table-scroll` (`overflow-x: auto`) via `dashboard.js`; `.content-table` and its
  thumbnail/title/test columns got explicit `min-width`s (480px table-wide minimum) so scroll kicks in on
  typical phone widths instead of columns squeezing.
- Detail video header: `flex-direction: column` + full-width thumbnail under 768px.
- Tabs: already `flex-wrap: wrap` unconditionally (pre-existing `.filters` rule) — no change needed.
- Forms: `flex-wrap: wrap` added under 768px for the five add-forms' flex rows (link, keyword, message,
  title-test, thumbnail-test — the last two scoped with `:not(.variant-rows)` so the vertical variant-list
  container isn't affected), plus `.variant-row`, `.video-header-links`, and `.video-header-meta`.

Verification: `node --check` on `dashboard.js`, confirmed all targeted selectors exist in `content.html`, full
backend suite still 40/40. Same caveat as the rest of the UI Revamp — no `chromium-cli`/`playwright` in this
environment, so not visually confirmed at 768px in an actual browser/device-emulator view.

| Element | Desktop | Mobile (< 768px) |
|---|---|---|
| `.page` max-width | 1200px / 960px | 100%, 16px side padding |
| Nav bar | brand left, sync right | same — stays single row |
| Dashboard table | full 4-column table | `overflow-x: auto` wrapper — table scrolls horizontally rather than reflowing to cards. This is a desktop-first tool; horizontal scroll on mobile is acceptable. |
| Detail video header | thumbnail left, info right (flex row) | stacked (flex column), thumbnail full width |
| Detail tabs | horizontal chip row | `flex-wrap: wrap` so chips wrap to a second row |
| Forms | inline flex rows | `flex-wrap: wrap` so inputs stack rather than overflow |

Use `min-width` on table columns so horizontal scroll kicks in cleanly. Don't hide columns on mobile —
if data is shown on desktop it should be accessible on mobile too, even if it requires scrolling.

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

## Commercialization (added 2026-09-29 — planning only, nothing built)

**Goal:** turn Ariadne into a paid product for other YouTube creators. **The initial build stays $0** (free tiers
only). Payment processing fees arrive only with paying customers.

### Positioning

Ariadne is the **system of record for what you changed and what it did**, not another test runner. YouTube's
native Test & Compare now gives every Partner Program creator free thumbnail and title tests, and TubeBuddy,
vidIQ and ThumbnailTest already sell testing or optimization. No competitor found (in a web search, not a deep
audit) combines: auto-detected title/thumbnail change history, CTR before/after, CTR health ranking by missed
clicks, and a per-video knowledge base that also holds results from native and third-party tests.

### Competitive landscape (approximate prices, from third-party comparison sites — verify before relying on them)

| Category | Players | Notes |
|---|---|---|
| Optimization suites | TubeBuddy (~$3–$49/mo; Legend ~$23/mo annual), vidIQ (free to ~$39/mo; coaching ~$99/mo) | Keywords, SEO, bulk edits, AI ideas. TubeBuddy also runs A/B tests. |
| Dedicated testing | ThumbnailTest ($32 / $44 / $75 per mo; top plan adds 10 channels, API, Zapier, 3 seats) | Thumbnail split testing |
| Native | YouTube Test & Compare (free) | Thumbnails and titles, judged on watch time per impression; excludes kids, mature and live |
| Pipeline / sponsor templates | Notion and Gumroad "Creator OS" kits, Taskade kits | Idea-to-publish pipeline, editorial calendar, sponsor CRM |
| DM automation | ManyChat, WilloSend and others | Per-contact pricing is a common complaint |
| Reporting | DashThis (~$44+/mo), Hootsuite, Planable | Client-ready dashboards, scheduling |

### Feature ideas (ranked by fit for a paid product)

1. Test history import and fast logging for YouTube-native and third-party tests, rolled up into "what wins on my channel"
2. CTR Health ranked by missed clicks (already planned in Phase 3) — the headline page
3. Learnings and pattern library: tag each test or change with a reason and outcome (manual first, AI-assisted in Phase 4)
4. Per-video sponsor and affiliate link tracking
5. Team roles (editor, thumbnail designer) and "ready to change" approval states
6. Weekly digest email: videos that crossed the 2-week/500-impression threshold, wins and losses
7. DM message library only — do not compete with ManyChat on automation
8. Multi-channel support (competitors gate this behind their top tier — natural upsell)

### Suggested phase order (Dalton to confirm)

| Phase | Scope | Cost |
|---|---|---|
| C1 | Multi-tenancy foundation: `user_id` on all tables, `WHERE user_id = ?` in every query, no hardcoded channel IDs | $0 |
| C2 | Sign-in (Google OAuth) plus YouTube Analytics OAuth (read-only), first-login backfill. Submit Google OAuth verification early. | $0 |
| C3 | CTR Health, Change History UI (Step 4), test history import | $0 |
| C4 | Billing (Stripe), plans and free tier, usage limits | Stripe fees only when customers pay |
| C5 | Team seats, digest email, multi-channel | Email provider free tier to start |

C2 supersedes the "Phase 3" OAuth items in the Roadmap below; the existing Phase 3 content is still the spec for
what to build there.

### Risks and open questions

- **OAuth verification:** all YouTube scopes are classified sensitive. Until Google verifies the app, users outside
  the test group see an "unverified app" warning. Approval time is unknown; start early.
- **Shared quota:** Data API v3 is 10,000 units/day per Google Cloud project, not per user. Analytics quota is
  tracked separately. See "Pre-Launch Investigative Requirements."
- **Data isolation:** shared D1 with a `user_id` column is the $0 route, but every query must filter it. Add tests
  that assert one user cannot read another's rows.
- **Native test results:** the plan already notes the API doesn't expose native Test & Compare results, so import
  is manual entry (or screenshot upload) unless that changes. Verify this again before building.
- **Pricing:** creators already pay roughly $20–$45/mo for comparable tools. A free tier for one channel plus a
  ~$15–$29/mo paid tier and ~$49–$79/mo multi-channel/team tier is a starting hypothesis, not a decision.
- **Hosting limits:** check Workers and D1 free-tier limits against expected per-customer usage before launch,
  since the $0 build will not stay $0 at scale.

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
- **First-login full backfill:** when a new user connects their channel via OAuth, run one full sync/reclassify
  pass over their whole video history (not just recent uploads) before showing them the dashboard, so the
  changelog and analytics start from a complete baseline rather than only what happens to sync going forward.
  This is the multi-tenant equivalent of the one-off local backfill Claude Code ran manually during
  single-tenant development (2026-09-23) — in the live product it needs to be an automatic part of onboarding,
  not a manual step.
- **`youtube_videos.status = 'scheduled'` needs OAuth too — it's currently dead.** Confirmed 2026-09-23: a
  video Dalton had scheduled (not yet public) on YouTube did not appear in Ariadne at all. Checked directly
  against the real API — `playlistItems.list` (the uploads-playlist sync) only ever returns `public` items when
  called with an API key; a scheduled/private video is entirely invisible to it, same restriction that made
  `videos.list` return zero items for the deleted `n0X_0AavGuE` earlier this session. Separately, even for
  videos Ariadne *can* see, `src/youtube.ts` never writes `status = 'scheduled'` — `fetchVideoDetails` only ever
  maps to `'live'` (`privacyStatus === 'public'`) or `'draft'` (anything else visible, e.g. unlisted); the
  schema's third status value has never been wired to any code path. Once OAuth exists, this needs: (1) the
  scheduled video to actually become visible to the sync, and (2) the sync to map a private video with a
  `publishAt` date to `'scheduled'` instead of `'draft'`. Until then, the dashboard's status badge is honest
  about what it can currently detect, not about a video's real YouTube state — Dalton's call (2026-09-23): keep
  showing it anyway, low-cost even though it'll read `live` for nearly everything until OAuth lands.

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
| `OPENINAPP_API_KEY` | openinapp.com dashboard | Removed feature (2026-09-23) — not in local `.dev.vars`; if set remotely, revoking it is a manual step outside this repo. Do not add back without explicit direction |

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

- $0-cost target for the initial build — flag any dependency that isn't free-tier or free outright. Costs that come with paying customers (payment fees) are expected in the Commercialization phases.
- OAuth is allowed where the roadmap calls for it (YouTube Analytics, and sign-in once multi-tenancy lands). The earlier "avoid OAuth outside a planned phase" rule was removed from `CLAUDE.md` on 2026-09-29. Existing sync still uses an API key as a Wrangler secret.
- No CDN chart libraries — inline SVG only.
- Additive changes — extend existing tables/files rather than renaming/replacing without being told to.
- External API failures return clear JSON errors, matching the `/api/sync/youtube` pattern.
- Mock external calls in tests, following `src/youtube.test.ts`.
- Verify current model/endpoint names (e.g. Gemini free-tier model) against live docs before hardcoding —
  planning docs (including this one) can go stale.
- Multi-tenancy: no hardcoded channel IDs anywhere in code. All tables will gain a `user_id` column in Phase 3 before launch. Design queries now so adding `WHERE user_id = ?` is a one-line change per query rather than a schema redesign.
