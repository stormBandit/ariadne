# ariadne

A link and auto-DM message management dashboard for content creators, streamlining the threads of automation.
Win: a searchable place to track content pieces, their tracking/deep links, and saved DM automation messages.

Built on Cloudflare Workers + D1 + Pages. Cost: $0 on the free tier.

## Stack

| Layer | Tool |
|---|---|
| Backend | Cloudflare Workers (TypeScript + Hono) |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Vanilla HTML/CSS/JS (planned) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |

## Data model

```
content                  links                     messages
┌───────────────┐        ┌───────────────┐         ┌───────────────┐
│ id            │───┐    │ id            │         │ id            │
│ title         │   │    │ content_id  ──┼───┐     │ content_id  ──┼───┐
│ platform      │   ├───▶│ type          │   │     │ platform      │   │
│ source_url    │   │    │ label         │   │     │ trigger_word  │   │
│ publish_date  │   │    │ url           │   │     │ message_body  │   │
│ status        │   │    │ created_at    │   │     │ created_at    │   │
│ created_at    │   │    └───────────────┘   │     └───────────────┘   │
└───────────────┘   └───────────────────────┴────────────────────────┘
                          (ON DELETE CASCADE: deleting a content row
                           removes its links and messages too)
```

## API endpoints

| Method | Path | What it's for |
|---|---|---|
| `GET` | `/api/content` | List every content piece, newest first — powers the dashboard view |
| `POST` | `/api/content` | Create a new content piece (title, platform, source URL, etc.) |
| `GET` | `/api/content/:id` | Fetch one content piece along with all its links and messages — powers the detail view |
| `PUT` | `/api/content/:id` | Update a content piece's fields (e.g. mark it `live` once published) |
| `DELETE` | `/api/content/:id` | Delete a content piece — cascades to delete its links and messages |
| `POST` | `/api/content/:id/links` | Attach a link to a content piece (OpenInApp deep link, CreatorURLs tracking link, etc.) |
| `DELETE` | `/api/links/:id` | Remove a single link |
| `POST` | `/api/content/:id/messages` | Save a DM automation message for a content piece (per platform/trigger word) |
| `DELETE` | `/api/messages/:id` | Remove a single message |

Planned, not yet implemented:

| Method | Path | What it's for |
|---|---|---|
| `POST` | `/api/openinapp` | Proxies a source URL to the OpenInApp API and returns a deep link |
| `POST` | `/api/generate-message` | Calls Gemini with content + link details, returns 3 DM message options to choose from |

### Request flow

```
                         ┌──────────────────┐
   Browser (Pages) ─────▶│  Worker (Hono)   │─────▶  D1 (content/links/messages)
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
