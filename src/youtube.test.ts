import { env, fetchMock } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from './index';
import { fetchRecentUploads, syncYouTubeUploads } from './youtube';

const SCHEMA = `
CREATE TABLE content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  platform    TEXT NOT NULL,
  source_url  TEXT,
  publish_date TEXT,
  status      TEXT DEFAULT 'draft',
  video_type  TEXT NOT NULL DEFAULT 'video',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

beforeAll(async () => {
  await env.DB.prepare(SCHEMA.trim()).run();
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
  await env.DB.exec('DELETE FROM content');
});

function mockPlaylistItems(
  videos: Array<{ videoId: string; title: string; publishedAt: string }>
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

    const { results } = await env.DB.prepare('SELECT * FROM content').all();
    expect(results).toHaveLength(3);
    expect(results.every((r: any) => r.platform === 'youtube' && r.status === 'draft')).toBe(true);
  });

  it('does not duplicate videos already stored by source_url', async () => {
    await env.DB.prepare(
      `INSERT INTO content (title, platform, source_url, status) VALUES (?, 'youtube', ?, 'draft')`
    )
      .bind('Existing', 'https://www.youtube.com/watch?v=v1')
      .run();

    mockPlaylistItems([
      { videoId: 'v1', title: 'First', publishedAt: '2026-01-01T00:00:00Z' },
      { videoId: 'v2', title: 'Second', publishedAt: '2026-01-02T00:00:00Z' },
      { videoId: 'v3', title: 'Third', publishedAt: '2026-01-03T00:00:00Z' },
    ]);

    const result = await syncYouTubeUploads(env.DB, 'fake-key', 'UUxxxx');
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(1);

    const { results } = await env.DB.prepare('SELECT * FROM content').all();
    expect(results).toHaveLength(3);
  });

  it('POST /api/sync/youtube returns 502 on API failure', async () => {
    mockPlaylistItemsError(500);
    const res = await app.request('/api/sync/youtube', { method: 'POST' }, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
