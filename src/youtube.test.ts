import { env, fetchMock } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from './index';
import { fetchRecentUploads, syncYouTubeUploads } from './youtube';

const SCHEMA = `
CREATE TABLE youtube_videos (
  video_id      TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source_url    TEXT,
  publish_date  TEXT,
  status        TEXT DEFAULT 'draft',
  video_type    TEXT NOT NULL DEFAULT 'video',
  thumbnail_url TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE content_changelog (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id                  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL DEFAULT 'dalton',
  changed_at                TEXT NOT NULL,
  change_type               TEXT NOT NULL CHECK (change_type IN ('title', 'thumbnail')),
  old_value                 TEXT,
  new_value                 TEXT,
  ctr_before                REAL,
  impressions_before        INTEGER,
  avg_view_duration_before  INTEGER,
  ctr_after                 REAL,
  impressions_after         INTEGER,
  avg_view_duration_after   INTEGER,
  created_at                TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

beforeAll(async () => {
  for (const statement of SCHEMA.trim().split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
  // Persistent mocks for the /shorts/ redirect check and the videos.list status
  // lookup that fetchRecentUploads/reclassifyExisting always make alongside
  // playlistItems. They're generic (any video id, any batch), so registering
  // them once here covers every test below.
  mockShortsRedirect();
  mockVideoStatuses('private');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM content_changelog');
  await env.DB.exec('DELETE FROM youtube_videos');
});

function mockPlaylistItems(
  videos: Array<{ videoId: string; title: string; publishedAt: string; thumbnailUrl?: string }>
) {
  fetchMock
    .get('https://www.googleapis.com')
    .intercept({ path: /\/youtube\/v3\/playlistItems/ })
    .reply(200, {
      items: videos.map((v) => ({
        snippet: {
          title: v.title,
          publishedAt: v.publishedAt,
          resourceId: { videoId: v.videoId },
          ...(v.thumbnailUrl ? { thumbnails: { high: { url: v.thumbnailUrl } } } : {}),
        },
      })),
    });
}

function mockPlaylistItemsError(status: number) {
  fetchMock
    .get('https://www.googleapis.com')
    .intercept({ path: /\/youtube\/v3\/playlistItems/ })
    .reply(status, { error: 'mocked failure' });
}

// undici's mock reply never performs a real HTTP redirect, so res.url stays
// on the requested /shorts/<id> URL — every test video therefore resolves
// as video_type 'short'. None of the assertions below check video_type, so
// this is just satisfying resolveVideoUrl's fetch, not modeling real
// YouTube redirect behavior.
function mockShortsRedirect() {
  fetchMock
    .get('https://www.youtube.com')
    .intercept({ path: /\/shorts\// })
    .reply(200, '')
    .persist();
}

function mockVideoStatuses(privacyStatus: string) {
  fetchMock
    .get('https://www.googleapis.com')
    .intercept({ path: /\/youtube\/v3\/videos/ })
    .reply(200, (opts) => {
      const query = opts.path.split('?')[1] || '';
      const ids = (new URLSearchParams(query).get('id') || '').split(',').filter(Boolean);
      return { items: ids.map((id) => ({ id, status: { privacyStatus } })) };
    })
    .persist();
}

describe('fetchRecentUploads', () => {
  it('parses videos from the API response', async () => {
    mockPlaylistItems([
      { videoId: 'abc123', title: 'Video One', publishedAt: '2026-01-01T00:00:00Z' },
    ]);
    const videos = await fetchRecentUploads('fake-key', 'UUxxxx');
    expect(videos).toEqual([
      {
        videoId: 'abc123',
        title: 'Video One',
        publishedAt: '2026-01-01T00:00:00Z',
        // mockShortsRedirect() never performs a real redirect, so every test
        // video resolves as a short — see its comment above.
        sourceUrl: 'https://www.youtube.com/shorts/abc123',
        videoType: 'short',
        status: 'draft',
      },
    ]);
  });

  it('throws on a non-200 response', async () => {
    mockPlaylistItemsError(403);
    await expect(fetchRecentUploads('fake-key', 'UUxxxx')).rejects.toThrow();
  });
});

describe('syncYouTubeUploads', () => {
  it('inserts new videos as draft content', async () => {
    mockPlaylistItems([
      { videoId: 'v1', title: 'First', publishedAt: '2026-01-01T00:00:00Z' },
      { videoId: 'v2', title: 'Second', publishedAt: '2026-01-02T00:00:00Z' },
      { videoId: 'v3', title: 'Third', publishedAt: '2026-01-03T00:00:00Z' },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);

    const { results } = await env.DB.prepare('SELECT * FROM youtube_videos').all();
    expect(results).toHaveLength(3);
    expect(results.every((r: any) => r.status === 'draft')).toBe(true);
    expect(results.map((r: any) => r.video_id).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('does not duplicate videos already stored by video_id', async () => {
    await env.DB.prepare(
      `INSERT INTO youtube_videos (video_id, title, source_url, status) VALUES (?, ?, ?, 'draft')`
    )
      .bind('v1', 'Existing', 'https://www.youtube.com/watch?v=v1')
      .run();

    mockPlaylistItems([
      { videoId: 'v1', title: 'First', publishedAt: '2026-01-01T00:00:00Z' },
      { videoId: 'v2', title: 'Second', publishedAt: '2026-01-02T00:00:00Z' },
      { videoId: 'v3', title: 'Third', publishedAt: '2026-01-03T00:00:00Z' },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(1);

    const { results } = await env.DB.prepare('SELECT * FROM youtube_videos').all();
    expect(results).toHaveLength(3);
  });

  it('logs a changelog entry and updates the stored title when it changes', async () => {
    await env.DB.prepare(
      `INSERT INTO youtube_videos (video_id, title, source_url, status, thumbnail_url) VALUES (?, ?, ?, 'draft', ?)`
    )
      .bind('v1', 'Old Title', 'https://www.youtube.com/watch?v=v1', 'https://img.example/old.jpg')
      .run();

    mockPlaylistItems([
      {
        videoId: 'v1',
        title: 'New Title',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnailUrl: 'https://img.example/old.jpg',
      },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.skipped).toBe(1);
    expect(result.changelogged).toBe(1);

    const row = await env.DB.prepare('SELECT title FROM youtube_videos WHERE video_id = ?').bind('v1').first();
    expect(row).toEqual({ title: 'New Title' });

    const { results } = await env.DB.prepare('SELECT * FROM content_changelog').all();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      video_id: 'v1',
      change_type: 'title',
      old_value: 'Old Title',
      new_value: 'New Title',
    });
  });

  it('logs a changelog entry and updates the stored thumbnail_url when it changes', async () => {
    await env.DB.prepare(
      `INSERT INTO youtube_videos (video_id, title, source_url, status, thumbnail_url) VALUES (?, ?, ?, 'draft', ?)`
    )
      .bind('v1', 'Same Title', 'https://www.youtube.com/watch?v=v1', 'https://img.example/old.jpg')
      .run();

    mockPlaylistItems([
      {
        videoId: 'v1',
        title: 'Same Title',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnailUrl: 'https://img.example/new.jpg',
      },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.changelogged).toBe(1);

    const row = await env.DB.prepare('SELECT thumbnail_url FROM youtube_videos WHERE video_id = ?')
      .bind('v1')
      .first();
    expect(row).toEqual({ thumbnail_url: 'https://img.example/new.jpg' });

    const { results } = await env.DB.prepare('SELECT * FROM content_changelog').all();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      video_id: 'v1',
      change_type: 'thumbnail',
      old_value: 'https://img.example/old.jpg',
      new_value: 'https://img.example/new.jpg',
    });
  });

  it('writes no changelog rows when title and thumbnail are unchanged', async () => {
    await env.DB.prepare(
      `INSERT INTO youtube_videos (video_id, title, source_url, status, thumbnail_url) VALUES (?, ?, ?, 'draft', ?)`
    )
      .bind('v1', 'Same Title', 'https://www.youtube.com/watch?v=v1', 'https://img.example/same.jpg')
      .run();

    mockPlaylistItems([
      {
        videoId: 'v1',
        title: 'Same Title',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnailUrl: 'https://img.example/same.jpg',
      },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.changelogged).toBe(0);

    const { results } = await env.DB.prepare('SELECT * FROM content_changelog').all();
    expect(results).toHaveLength(0);
  });

  it('writes two changelog rows when both title and thumbnail change in the same sync', async () => {
    await env.DB.prepare(
      `INSERT INTO youtube_videos (video_id, title, source_url, status, thumbnail_url) VALUES (?, ?, ?, 'draft', ?)`
    )
      .bind('v1', 'Old Title', 'https://www.youtube.com/watch?v=v1', 'https://img.example/old.jpg')
      .run();

    mockPlaylistItems([
      {
        videoId: 'v1',
        title: 'New Title',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnailUrl: 'https://img.example/new.jpg',
      },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.changelogged).toBe(2);

    const { results } = await env.DB.prepare('SELECT change_type FROM content_changelog ORDER BY change_type').all();
    expect(results).toEqual([{ change_type: 'thumbnail' }, { change_type: 'title' }]);
  });

  it('stores thumbnail_url on insert for new videos', async () => {
    mockPlaylistItems([
      {
        videoId: 'v1',
        title: 'First',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnailUrl: 'https://img.example/first.jpg',
      },
    ]);

    await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');

    const row = await env.DB.prepare('SELECT thumbnail_url FROM youtube_videos WHERE video_id = ?')
      .bind('v1')
      .first();
    expect(row).toEqual({ thumbnail_url: 'https://img.example/first.jpg' });
  });

  it('POST /api/sync/youtube returns 502 on API failure', async () => {
    mockPlaylistItemsError(500);
    const res = await app.request('/api/sync/youtube', { method: 'POST' }, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
