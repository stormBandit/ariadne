# ariadne — working notes for Claude Code

A content workflow dashboard for The Nomadic Sweethearts. Cloudflare Workers + Hono + D1, vanilla HTML/CSS/JS frontend, $0-cost target. See `README.md` for the current data model and endpoints.

## Before making any change

Read the relevant existing file(s) first, `src/index.ts` for routes, `src/youtube.ts` for the sync pattern, `public/app.js` for frontend behaviour, before writing anything. Don't guess at conventions already established in the code.

## Constraints

- **$0-cost.** Every dependency should be free-tier or free outright. Flag anything that would introduce a real cost before adding it.
- **Avoid OAuth.** Everything so far uses API keys as Wrangler secrets, no OAuth flow anywhere in this repo. Don't introduce one without it being explicitly called for in `PLAN.md` for the phase you're on.
- **No CDN chart libraries.** Any chart (existing or new) is inline SVG, hand-built, no Chart.js or similar. Keeps pages self-contained.
- **Additive changes.** Extend existing tables and files rather than replacing them. Don't rename existing fields, routes, or table names without being told to.
- **Handle external API failures gracefully.** Return a clear JSON error, don't let the Worker throw uncaught. Match the pattern already in the `/api/sync/youtube` handler in `src/index.ts`.
- **Mock external calls in tests.** Gemini, YouTube, OpenInApp, whatever the phase adds, follow the mocking pattern already in `src/youtube.test.ts`. Never call the real API from a test.
- **Verify current model/endpoint names before hardcoding.** Things like the current Gemini free-tier model name can be stale in planning docs written months earlier. Check Google's current docs rather than trusting an older reference.

## Roadmap

The phased build plan lives in `PLAN.md` in this repo. Work one phase at a time:

1. Read the phase's goal and prompt in `PLAN.md`.
2. Some phases are marked fully autonomous, implement the whole thing. Others (currently Phase F) are marked scaffolded/paired, meaning specific steps are meant to be written by Dalton himself for practice, not generated. Check which kind of phase you're on before starting.
3. Run that phase's done-check yourself before considering it finished.
4. Stop and wait to be told to start the next phase. Don't chain phases automatically.

## After a phase ships

Commit with a message that names the phase (e.g. `Phase A: OpenInApp deep link generation`). Dalton reports back to Cowork (Mission Control project) after each phase so the status tracking there stays accurate, that's a manual step outside this repo, not something to do from here.
