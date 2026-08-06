import { Hono } from 'hono';
import { syncYouTubeUploads } from './youtube';
import { createDeepLink } from './openinapp';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  YOUTUBE_API_KEY: string;
  YOUTUBE_UPLOADS_PLAYLIST_ID: string;
  OPENINAPP_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/content', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM youtube_videos ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

app.get('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const content = await c.env.DB.prepare('SELECT * FROM youtube_videos WHERE video_id = ?')
    .bind(id)
    .first();
  if (!content) {
    return c.json({ error: 'not found' }, 404);
  }
  const { results: links } = await c.env.DB.prepare(
    'SELECT * FROM links WHERE content_id = ? ORDER BY created_at'
  )
    .bind(id)
    .all();
  const { results: messages } = await c.env.DB.prepare(
    'SELECT * FROM messages WHERE content_id = ? ORDER BY created_at'
  )
    .bind(id)
    .all();
  const { results: keywords } = await c.env.DB.prepare(
    'SELECT * FROM keywords WHERE content_id = ? ORDER BY created_at'
  )
    .bind(id)
    .all();
  const { results: tests } = await c.env.DB.prepare(
    'SELECT * FROM tests WHERE content_id = ? ORDER BY created_at'
  )
    .bind(id)
    .all<{ id: number }>();
  const { results: variants } = await c.env.DB.prepare(
    `SELECT test_variants.* FROM test_variants
     JOIN tests ON tests.id = test_variants.test_id
     WHERE tests.content_id = ? ORDER BY test_variants.created_at`
  )
    .bind(id)
    .all<{ test_id: number }>();
  const testsWithVariants = tests.map((test) => ({
    ...test,
    variants: variants.filter((v) => v.test_id === test.id),
  }));
  return c.json({ ...content, links, messages, keywords, tests: testsWithVariants });
});

app.put('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const { title, source_url, publish_date, status, video_type } = await c.req.json();
  const { meta } = await c.env.DB.prepare(
    `UPDATE youtube_videos
     SET title = COALESCE(?, title),
         source_url = COALESCE(?, source_url),
         publish_date = COALESCE(?, publish_date),
         status = COALESCE(?, status),
         video_type = COALESCE(?, video_type)
     WHERE video_id = ?`
  )
    .bind(title ?? null, source_url ?? null, publish_date ?? null, status ?? null, video_type ?? null, id)
    .run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  const row = await c.env.DB.prepare('SELECT * FROM youtube_videos WHERE video_id = ?').bind(id).first();
  return c.json(row);
});

app.delete('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM youtube_videos WHERE video_id = ?').bind(id).run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.body(null, 204);
});

app.post('/api/content/:id/links', async (c) => {
  const contentId = c.req.param('id');
  const { type, label, url } = await c.req.json();
  if (!type || !url) {
    return c.json({ error: 'type and url are required' }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO links (content_id, type, label, url) VALUES (?, ?, ?, ?)'
  )
    .bind(contentId, type, label ?? null, url)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?')
    .bind(meta.last_row_id)
    .first();
  return c.json(row, 201);
});

app.put('/api/links/:id', async (c) => {
  const id = c.req.param('id');
  const { type, label, url } = await c.req.json();
  const { meta } = await c.env.DB.prepare(
    `UPDATE links
     SET type = COALESCE(?, type),
         label = COALESCE(?, label),
         url = COALESCE(?, url)
     WHERE id = ?`
  )
    .bind(type ?? null, label ?? null, url ?? null, id)
    .run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  const row = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
  return c.json(row);
});

app.delete('/api/links/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.body(null, 204);
});

app.post('/api/content/:id/messages', async (c) => {
  const contentId = c.req.param('id');
  const { platform, trigger_word, message_body } = await c.req.json();
  if (!message_body) {
    return c.json({ error: 'message_body is required' }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO messages (content_id, platform, trigger_word, message_body) VALUES (?, ?, ?, ?)'
  )
    .bind(contentId, platform ?? null, trigger_word ?? null, message_body)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?')
    .bind(meta.last_row_id)
    .first();
  return c.json(row, 201);
});

app.delete('/api/messages/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.body(null, 204);
});

const SEARCH_VOLUMES = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];

app.post('/api/content/:id/keywords', async (c) => {
  const contentId = c.req.param('id');
  const { keyword, weighted_score, search_volume } = await c.req.json();
  if (!keyword) {
    return c.json({ error: 'keyword is required' }, 400);
  }
  if (search_volume && !SEARCH_VOLUMES.includes(search_volume)) {
    return c.json({ error: `search_volume must be one of: ${SEARCH_VOLUMES.join(', ')}` }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO keywords (content_id, keyword, weighted_score, search_volume) VALUES (?, ?, ?, ?)'
  )
    .bind(contentId, keyword, weighted_score ?? null, search_volume ?? null)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM keywords WHERE id = ?')
    .bind(meta.last_row_id)
    .first();
  return c.json(row, 201);
});

app.delete('/api/keywords/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM keywords WHERE id = ?').bind(id).run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.body(null, 204);
});

app.post('/api/content/:id/tests', async (c) => {
  const contentId = c.req.param('id');
  const { test_type, status, start_date, end_date, notes, variants } = await c.req.json();
  if (!test_type || !Array.isArray(variants) || variants.length < 2) {
    return c.json({ error: 'test_type and at least 2 variants are required' }, 400);
  }
  if (variants.some((v) => !v.value)) {
    return c.json({ error: 'every variant requires a value' }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO tests (content_id, test_type, status, start_date, end_date, notes)
     VALUES (?, ?, COALESCE(?, 'inconclusive'), ?, ?, ?)`
  )
    .bind(contentId, test_type, status ?? null, start_date ?? null, end_date ?? null, notes ?? null)
    .run();
  const testId = meta.last_row_id;

  for (const variant of variants) {
    await c.env.DB.prepare(
      'INSERT INTO test_variants (test_id, value, watch_time_share) VALUES (?, ?, ?)'
    )
      .bind(testId, variant.value, variant.watch_time_share ?? null)
      .run();
  }

  const test = await c.env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(testId).first();
  const { results: savedVariants } = await c.env.DB.prepare(
    'SELECT * FROM test_variants WHERE test_id = ? ORDER BY created_at'
  )
    .bind(testId)
    .all();
  return c.json({ ...test, variants: savedVariants }, 201);
});

app.put('/api/tests/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM tests WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ error: 'not found' }, 404);
  }
  const { status, start_date, end_date, notes, variants } = await c.req.json();
  if (!Array.isArray(variants) || variants.length < 2 || variants.some((v) => !v.value)) {
    return c.json({ error: 'at least 2 variants with a value are required' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE tests
     SET status = COALESCE(?, status),
         start_date = COALESCE(?, start_date),
         end_date = COALESCE(?, end_date),
         notes = COALESCE(?, notes)
     WHERE id = ?`
  )
    .bind(status ?? null, start_date ?? null, end_date ?? null, notes ?? null, id)
    .run();

  // Variants are always replaced wholesale rather than diffed, since edits
  // come from the UI as a full variant list (add/remove/edit all collapse
  // into one submit).
  await c.env.DB.prepare('DELETE FROM test_variants WHERE test_id = ?').bind(id).run();
  for (const variant of variants) {
    await c.env.DB.prepare(
      'INSERT INTO test_variants (test_id, value, watch_time_share) VALUES (?, ?, ?)'
    )
      .bind(id, variant.value, variant.watch_time_share ?? null)
      .run();
  }

  const test = await c.env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(id).first();
  const { results: savedVariants } = await c.env.DB.prepare(
    'SELECT * FROM test_variants WHERE test_id = ? ORDER BY created_at'
  )
    .bind(id)
    .all();
  return c.json({ ...test, variants: savedVariants });
});

app.delete('/api/tests/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM tests WHERE id = ?').bind(id).run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.body(null, 204);
});

app.post('/api/sync/youtube', async (c) => {
  try {
    const result = await syncYouTubeUploads(
      c.env.DB,
      c.env.YOUTUBE_API_KEY,
      c.env.YOUTUBE_UPLOADS_PLAYLIST_ID
    );
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'sync failed' }, 502);
  }
});

app.post('/api/openinapp', async (c) => {
  const { url } = await c.req.json();
  if (!url) {
    return c.json({ error: 'url is required' }, 400);
  }
  try {
    const deepLink = await createDeepLink(c.env.OPENINAPP_API_KEY, url);
    return c.json({ url: deepLink });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'OpenInApp request failed' }, 502);
  }
});

app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    await syncYouTubeUploads(env.DB, env.YOUTUBE_API_KEY, env.YOUTUBE_UPLOADS_PLAYLIST_ID);
  },
};
