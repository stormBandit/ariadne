import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/content', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM content ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

app.post('/api/content', async (c) => {
  const { title, platform, source_url, publish_date, status } = await c.req.json();
  if (!title || !platform) {
    return c.json({ error: 'title and platform are required' }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO content (title, platform, source_url, publish_date, status)
     VALUES (?, ?, ?, ?, COALESCE(?, 'draft'))`
  )
    .bind(title, platform, source_url ?? null, publish_date ?? null, status ?? null)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id = ?')
    .bind(meta.last_row_id)
    .first();
  return c.json(row, 201);
});

app.get('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const content = await c.env.DB.prepare('SELECT * FROM content WHERE id = ?')
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
  return c.json({ ...content, links, messages });
});

app.put('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const { title, platform, source_url, publish_date, status } = await c.req.json();
  const { meta } = await c.env.DB.prepare(
    `UPDATE content
     SET title = COALESCE(?, title),
         platform = COALESCE(?, platform),
         source_url = COALESCE(?, source_url),
         publish_date = COALESCE(?, publish_date),
         status = COALESCE(?, status)
     WHERE id = ?`
  )
    .bind(title ?? null, platform ?? null, source_url ?? null, publish_date ?? null, status ?? null, id)
    .run();
  if (meta.changes === 0) {
    return c.json({ error: 'not found' }, 404);
  }
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id = ?').bind(id).first();
  return c.json(row);
});

app.delete('/api/content/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare('DELETE FROM content WHERE id = ?').bind(id).run();
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

export default app;
