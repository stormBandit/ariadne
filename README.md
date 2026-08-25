# ariadne

A content workflow dashboard for The Nomadic Sweethearts: it syncs videos in from YouTube, then tracks the things
Studio doesn't give you an API for — title and thumbnail A/B test results, targeted keywords and their search
volume, tracking/deep links, and saved DM automation messages.
Win: a searchable place to track every video, what titles/thumbnails were tested on it and how those tests went,
what keywords it's targeting, its tracking links, and its DM automation messages.

Built on Cloudflare Workers + D1 + Pages. Cost: $0 on the free tier.

## Stack

| Layer | Tool |
|---|---|
| Backend | Cloudflare Workers (TypeScript + Hono) |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Vanilla HTML/CSS/JS |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |

## Data model

```
youtube_videos           links                     messages
┌───────────────┐        ┌───────────────┐         ┌───────────────┐
│ video_id      │───┐    │ id            │         │ id            │
│ title         │   │    │ content_id  ──┼───┐     │ content_id  ──┼───┐
│ source_url    │   ├───▶│ type          │   │     │ platform      │   │
│ publish_date  │   │    │ label         │   │     │ trigger_word  │   │
│ status        │   │    │ url           │   │     │ message_body  │   │
│ video_type    │   │    │ created_at    │   │     │ created_at    │   │
│ created_at    │   │    └───────────────┘   │     └───────────────┘   │
│               │   │                        │                        │
│               │   │    keywords            │      tests             │      test_variants
│               │   │    ┌───────────────┐   │      ┌───────────────┐ │      ┌───────────────┐
│               │   │    │ id            │   │      │ id            │ │      │ id            │
│               │   ├───▶│ content_id  ──┼───┤      │ content_id  ──┼─┤      │ test_id     ──┼──┐
│               │   │    │ keyword       │   │      │ test_type     │ │      │ value         │  │
│               │   │    │ weighted_score│   │      │ status        │ │      │ watch_time_...│  │
│               │   │    │ search_volume │   │      │ start_date    │ │      │ created_at    │  │
│               │   │    │ created_at    │   │      │ end_date      │ │      └───────────────┘  │
│               │   │    └───────────────┘   │      │ notes         │◀┼──────────────────────────┘
│               │   │                        │      │ created_at    │
└───────────────┘   └────────────────────────┴──────└───────────────┘
                          (ON DELETE CASCADE: deleting a video row removes its links, messages,
                           keywords, and tests; deleting a test removes its variants too)
```

`video_id` is YouTube's own video ID (e.g. `Xnk2Budn0zA`) and is the table's primary key — there's no separate auto-incrementing surrogate ID. It's what the frontend uses directly in URLs (`/content?id=Xnk2Budn0zA`) and what `links.content_id`/`messages.content_id`/`keywords.content_id`/`tests.content_id` reference.

`tests.test_type` is `'title'` or `'thumbnail'` — both currently share the `tests`/`test_variants` tables, with `test_variants.value` holding either the title text or a base64 thumbnail image depending on type. `tests.status` is `'conclusive'` or `'inconclusive'`; a test with no `end_date` yet is treated as still running by the UI.

## API endpoints

| Method | Path | What it's for |
|---|---|---|
| `GET` | `/api/content` | List every video, newest-to-oldest by publish date — powers the dashboard view |
| `GET` | `/api/content/:id` | Fetch one video (looked up by `video_id`) along with its links, messages, keywords, and title/thumbnail tests (with variants) — powers the detail view |
| `PUT` | `/api/content/:id` | Update a video's fields (e.g. mark it `live` once published) |
| `DELETE` | `/api/content/:id` | Delete a video — cascades to delete its links, messages, keywords, and tests |
| `POST` | `/api/content/:id/links` | Attach a link to a content piece (CreatorURLs tracking link, affiliate link, etc.) |
| `PUT` | `/api/links/:id` | Edit an existing link |
| `DELETE` | `/api/links/:id` | Remove a single link |
| `POST` | `/api/content/:id/messages` | Save a DM automation message for a content piece (per platform/trigger word) |
| `DELETE` | `/api/messages/:id` | Remove a single message |
| `POST` | `/api/content/:id/keywords` | Track a targeted keyword, with its TubeBuddy weighted score and search volume |
| `DELETE` | `/api/keywords/:id` | Remove a single keyword |
| `POST` | `/api/content/:id/tests` | Log a title or thumbnail A/B test with its variants (title tests need ≥2 variants, thumbnail tests need ≥1) |
| `PUT` | `/api/tests/:id` | Update a test's status/dates/notes and replace its variants wholesale |
| `DELETE` | `/api/tests/:id` | Remove a test — cascades to delete its variants |
| `POST` | `/api/sync/youtube` | Pulls recent uploads from the channel's uploads playlist into `youtube_videos` (also runs on a weekly cron) |

Planned, not yet implemented:

| Method | Path | What it's for |
|---|---|---|
| `POST` | `/api/generate-message` | Calls Gemini with content + link details, returns 3 DM message options to choose from |

### Request flow

```
                         ┌──────────────────┐
   Browser (Pages) ─────▶│  Worker (Hono)   │─────▶  D1 (youtube_videos/links/messages/keywords/tests)
                         └──────────────────┘
                                  │
                                  ├──▶ YouTube Data API (channel sync)
                                  └──▶ Gemini API        (DM message generation)
```

## Development

```bash
npm install
npm run dev      # local dev server (wrangler dev)
npm test         # run the test suite (vitest, local D1 via Miniflare)
npm run deploy   # deploy to Cloudflare
```

Apply the schema to a fresh D1 database with:

```bash
npx wrangler d1 execute ariadne --file=schema.sql          # local
npx wrangler d1 execute ariadne --remote --file=schema.sql # production
```
