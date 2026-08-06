import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from './index';

const SCHEMA = `
CREATE TABLE youtube_videos (
  video_id    TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source_url  TEXT,
  publish_date TEXT,
  status      TEXT DEFAULT 'draft',
  video_type  TEXT NOT NULL DEFAULT 'video',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  label       TEXT,
  url         TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  platform      TEXT,
  trigger_word  TEXT,
  message_body  TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE keywords (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id     TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,
  weighted_score INTEGER,
  search_volume  TEXT CHECK (search_volume IS NULL OR search_volume IN ('Poor', 'Fair', 'Good', 'Great', 'Excellent')),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  test_type   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'inconclusive',
  start_date  TEXT,
  end_date    TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE test_variants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id           INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  value             TEXT NOT NULL,
  watch_time_share  REAL,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

beforeAll(async () => {
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM test_variants');
  await env.DB.exec('DELETE FROM tests');
  await env.DB.exec('DELETE FROM keywords');
  await env.DB.exec('DELETE FROM messages');
  await env.DB.exec('DELETE FROM links');
  await env.DB.exec('DELETE FROM youtube_videos');
});

async function createContent(overrides: Partial<Record<string, unknown>> = {}) {
  const data = {
    video_id: 'abc123',
    title: 'Test Video',
    source_url: 'https://www.youtube.com/watch?v=abc123',
    publish_date: null,
    status: 'draft',
    video_type: 'video',
    ...overrides,
  } as Record<string, unknown>;
  await env.DB.prepare(
    `INSERT INTO youtube_videos (video_id, title, source_url, publish_date, status, video_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(data.video_id, data.title, data.source_url, data.publish_date, data.status, data.video_type)
    .run();
  return { video_id: data.video_id as string };
}

describe('content endpoints', () => {
  it('lists content', async () => {
    await createContent({ title: 'First' });
    const res = await app.request('/api/content', {}, env);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('First');
    expect(rows[0].status).toBe('draft');
  });

  it('reports title_test_status/title_test_end_date from the most recent title test', async () => {
    const noTest = await createContent({ video_id: 'no-test' });
    const inProgress = await createContent({ video_id: 'in-progress', title: 'In Progress Video' });
    const concluded = await createContent({ video_id: 'concluded', title: 'Concluded Video' });

    await app.request(
      `/api/content/${inProgress.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'title',
          start_date: '2026-07-15',
          variants: [{ value: 'A' }, { value: 'B' }],
        }),
      },
      env
    );
    await app.request(
      `/api/content/${concluded.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'title',
          status: 'conclusive',
          start_date: '2026-07-01',
          end_date: '2026-07-10',
          variants: [{ value: 'A', watch_time_share: 60 }, { value: 'B', watch_time_share: 40 }],
        }),
      },
      env
    );

    const res = await app.request('/api/content', {}, env);
    const rows = (await res.json()) as any[];
    const byId = Object.fromEntries(rows.map((r) => [r.video_id, r]));

    expect(byId[noTest.video_id].title_test_status).toBeNull();
    expect(byId[noTest.video_id].title_test_end_date).toBeNull();

    expect(byId[inProgress.video_id].title_test_status).toBe('inconclusive');
    expect(byId[inProgress.video_id].title_test_end_date).toBeNull();

    expect(byId[concluded.video_id].title_test_status).toBe('conclusive');
    expect(byId[concluded.video_id].title_test_end_date).toBe('2026-07-10');
  });

  it('fetches one content piece with its links and messages', async () => {
    const content = await createContent();
    await app.request(
      `/api/content/${content.video_id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'openinapp', url: 'https://oia.example/x' }),
      },
      env
    );
    await app.request(
      `/api/content/${content.video_id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_body: 'hey there!' }),
      },
      env
    );

    const res = await app.request(`/api/content/${content.video_id}`, {}, env);
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
      `/api/content/${content.video_id}`,
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
      `/api/content/${content.video_id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', url: 'https://example.com' }),
      },
      env
    );

    const del = await app.request(`/api/content/${content.video_id}`, { method: 'DELETE' }, env);
    expect(del.status).toBe(204);

    const { results } = await env.DB.prepare('SELECT * FROM links WHERE content_id = ?')
      .bind(content.video_id)
      .all();
    expect(results).toHaveLength(0);
  });
});

describe('links endpoints', () => {
  it('rejects link creation without type/url', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.video_id}/links`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('updates a link', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', url: 'https://example.com' }),
      },
      env
    );
    const link = (await created.json()) as { id: number };

    const res = await app.request(
      `/api/links/${link.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'updated description', url: 'https://example.com/updated' }),
      },
      env
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { label: string; url: string; type: string };
    expect(updated.label).toBe('updated description');
    expect(updated.url).toBe('https://example.com/updated');
    expect(updated.type).toBe('other');
  });

  it('returns 404 updating a missing link', async () => {
    const res = await app.request(
      '/api/links/999999',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://x.com' }) },
      env
    );
    expect(res.status).toBe(404);
  });

  it('deletes a link', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/links`,
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
      `/api/content/${content.video_id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('deletes a message', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/messages`,
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

describe('keywords endpoints', () => {
  it('rejects keyword creation without a keyword', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.video_id}/keywords`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });

  it('creates a keyword with a weighted score and search volume, and includes it on the content detail', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/keywords`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'prince rupert', weighted_score: 92, search_volume: 'Great' }),
      },
      env
    );
    expect(created.status).toBe(201);
    const keyword = (await created.json()) as {
      id: number;
      keyword: string;
      weighted_score: number;
      search_volume: string;
    };
    expect(keyword.keyword).toBe('prince rupert');
    expect(keyword.weighted_score).toBe(92);
    expect(keyword.search_volume).toBe('Great');

    const res = await app.request(`/api/content/${content.video_id}`, {}, env);
    const body = (await res.json()) as any;
    expect(body.keywords).toHaveLength(1);
  });

  it('rejects a keyword with an invalid search volume', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.video_id}/keywords`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'prince rupert', search_volume: 'Amazing' }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('deletes a keyword', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/keywords`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: 'hidden gem' }) },
      env
    );
    const keyword = (await created.json()) as { id: number };

    const res = await app.request(`/api/keywords/${keyword.id}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);

    const missing = await app.request(`/api/keywords/${keyword.id}`, { method: 'DELETE' }, env);
    expect(missing.status).toBe(404);
  });
});

describe('tests endpoints', () => {
  it('rejects test creation without test_type or with fewer than 2 variants', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_type: 'title', variants: [{ value: 'only one' }] }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('rejects a variant missing a value', async () => {
    const content = await createContent();
    const res = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_type: 'title', variants: [{ value: 'A' }, { value: '' }] }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('creates a title test with variants and includes it on the content detail', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'title',
          status: 'conclusive',
          start_date: '2026-07-15',
          end_date: '2026-07-20',
          notes: 'curiosity gap won',
          variants: [
            { value: "You Won't Believe What We Saw", watch_time_share: 62 },
            { value: 'The Hidden Gem We Found', watch_time_share: 38 },
          ],
        }),
      },
      env
    );
    expect(created.status).toBe(201);
    const test = (await created.json()) as { id: number; variants: any[] };
    expect(test.variants).toHaveLength(2);

    const res = await app.request(`/api/content/${content.video_id}`, {}, env);
    const body = (await res.json()) as any;
    expect(body.tests).toHaveLength(1);
    expect(body.tests[0].test_type).toBe('title');
    expect(body.tests[0].variants).toHaveLength(2);
  });

  it('defaults status to inconclusive', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'thumbnail',
          variants: [{ value: 'thumb-a.jpg' }, { value: 'thumb-b.jpg' }],
        }),
      },
      env
    );
    const test = (await created.json()) as { status: string };
    expect(test.status).toBe('inconclusive');
  });

  it('updates a test, replacing its variants wholesale', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'title',
          status: 'inconclusive',
          notes: 'not enough data yet',
          variants: [{ value: 'A' }, { value: 'B' }],
        }),
      },
      env
    );
    const test = (await created.json()) as { id: number };

    const res = await app.request(
      `/api/tests/${test.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'conclusive',
          start_date: '2026-07-15',
          end_date: '2026-07-20',
          notes: 'A won',
          variants: [
            { value: 'A', watch_time_share: 62 },
            { value: 'B', watch_time_share: 38 },
            { value: 'C', watch_time_share: 0 },
          ],
        }),
      },
      env
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { status: string; notes: string; variants: any[] };
    expect(updated.status).toBe('conclusive');
    expect(updated.notes).toBe('A won');
    expect(updated.variants).toHaveLength(3);
    expect(updated.variants.map((v: any) => v.value)).toEqual(['A', 'B', 'C']);
  });

  it('rejects a test update with fewer than 2 variants', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_type: 'title', variants: [{ value: 'A' }, { value: 'B' }] }),
      },
      env
    );
    const test = (await created.json()) as { id: number };

    const res = await app.request(
      `/api/tests/${test.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants: [{ value: 'A' }] }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 updating a missing test', async () => {
    const res = await app.request(
      '/api/tests/999999',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants: [{ value: 'A' }, { value: 'B' }] }),
      },
      env
    );
    expect(res.status).toBe(404);
  });

  it('deletes a test and cascades to its variants', async () => {
    const content = await createContent();
    const created = await app.request(
      `/api/content/${content.video_id}/tests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_type: 'title',
          variants: [{ value: 'A' }, { value: 'B' }],
        }),
      },
      env
    );
    const test = (await created.json()) as { id: number };

    const res = await app.request(`/api/tests/${test.id}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);

    const { results } = await env.DB.prepare('SELECT * FROM test_variants WHERE test_id = ?')
      .bind(test.id)
      .all();
    expect(results).toHaveLength(0);
  });
});
