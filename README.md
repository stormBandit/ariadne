# ariadne

A link and auto-DM message management dashboard for content creators, streamlining the threads of automation.
Win: a searchable place to track content pieces, their tracking/deep links, and saved DM automation messages.

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
└───────────────┘   └───────────────────────┴────────────────────────┘
                          (ON DELETE CASCADE: deleting a video row
                           removes its links and messages too)
```

`video_id` is YouTube's own video ID (e.g. `Xnk2Budn0zA`) and is the table's primary key — there's no separate auto-incrementing surrogate ID. It's what the frontend uses directly in URLs (`/content?id=Xnk2Budn0zA`) and what `links.content_id`/`messages.content_id`/`keywords.content_id`/`tests.content_id` reference.

## API endpoints

| Method | Path | What it's for |
|---|---|---|
| `GET` | `/api/content` | List every video, newest first — powers the dashboard view |
| `POST` | `/api/content` | Create a video (title + source URL; `video_id` is derived from the URL if not passed explicitly) |
| `GET` | `/api/content/:id` | Fetch one video (looked up by `video_id`) along with all its links and messages — powers the detail view |
| `PUT` | `/api/content/:id` | Update a video's fields (e.g. mark it `live` once published) |
| `DELETE` | `/api/content/:id` | Delete a video — cascades to delete its links and messages |
| `POST` | `/api/content/:id/links` | Attach a link to a content piece (OpenInApp deep link, CreatorURLs tracking link, etc.) |
| `DELETE` | `/api/links/:id` | Remove a single link |
| `POST` | `/api/content/:id/messages` | Save a DM automation message for a content piece (per platform/trigger word) |
| `DELETE` | `/api/messages/:id` | Remove a single message |
| `POST` | `/api/openinapp` | Proxies a source URL to the OpenInApp API and returns a deep link |

Planned, not yet implemented:

| Method | Path | What it's for |
|---|---|---|
| `POST` | `/api/generate-message` | Calls Gemini with content + link details, returns 3 DM message options to choose from |

### Request flow

```
                         ┌──────────────────┐
   Browser (Pages) ─────▶│  Worker (Hono)   │─────▶  D1 (youtube_videos/links/messages)
                         └──────────────────┘
                                  │
                                  ├──▶ OpenInApp API   (deep link generation)
                                  └──▶ Gemini API      (DM message generation)
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
