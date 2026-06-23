import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from './index';

const SCHEMA = `
CREATE TABLE content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  platform    TEXT NOT NULL,
  source_url  TEXT,
  publish_date TEXT,
  status      TEXT DEFAULT 'draft',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  INTEGER REFERENCES content(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  label       TEXT,
  url         TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    INTEGER REFERENCES content(id) ON DELETE CASCADE,
  platform      TEXT,
  trigger_word  TEXT,
  message_body  TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

beforeAll(async () => {
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM messages');
  await env.DB.exec('DELETE FROM links');
  await env.DB.exec('DELETE FROM content');
});

async function createContent(overrides: Partial<Record<string, unknown>> = {}) {
  const res = await app.request(
    '/api/content',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Video',
        platform: 'youtube',
        ...overrides,
      }),
    },
    env
  );
  return res.json() as Promise<{ id: number }>;
}

describe('content endpoints', () => {
  it('creates content and lists it', async () => {
    await createContent({ title: 'First' });
    const res = await app.request('/api/content', {}, env);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('First');
    expect(rows[0].status).toBe('draft');
  });

  it('rejects content creation without title/platform', async () => {
    const res = await app.request(
      '/api/content',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('fetches one content piece with its links and messages', async () => {
    const content = await createContent();
    await app.request(
      `/api/content/${content.id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'openinapp', url: 'https://oia.example/x' }),
      },
      env
    );
    await app.request(
      `/api/content/${content.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_body: 'hey there!' }),
      },
      env
    );

    const res = await app.request(`/api/content/${content.id}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.links).toHaveLength(1);
    expect(body.messages).toHaveLength(1);
  });

  it('404s on missing content', async () => {
    const res = await app.request('/api/content/999999', {}, env);
    expect(res.status).toBe(404);
  });

  it('updates a content piece', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'live' }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('live');
    expect(body.title).toBe('Test Video');
  });

  it('deletes content and cascades to links/messages', async () => {
    const content = await createContent();
    await app.request(
      `/api/content/${content.id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', url: 'https://example.com' }),
      },
      env
    );

    const del = await app.request(`/api/content/${content.id}`, { method: 'DELETE' }, env);
    expect(del.status).toBe(204);

    const { results } = await env.DB.prepare('SELECT * FROM links WHERE content_id = ?')
      .bind(content.id)
      .all();
    expect(results).toHaveLength(0);
  });
});

describe('links endpoints', () => {
  it('rejects link creation without type/url', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.id}/links`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('deletes a link', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', url: 'https://example.com' }),
      },
      env
    );
    const link = (await created.json()) as { id: number };

    const res = await app.request(`/api/links/${link.id}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);

    const missing = await app.request(`/api/links/${link.id}`, { method: 'DELETE' }, env);
    expect(missing.status).toBe(404);
  });
});

describe('messages endpoints', () => {
  it('rejects message creation without message_body', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('deletes a message', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_body: 'hi' }),
      },
      env
    );
    const message = (await created.json()) as { id: number };

    const res = await app.request(`/api/messages/${message.id}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);

    const missing = await app.request(`/api/messages/${message.id}`, { method: 'DELETE' }, env);
    expect(missing.status).toBe(404);
  });
});
