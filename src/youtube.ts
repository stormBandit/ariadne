export interface YouTubeVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  videoType: 'video' | 'short';
}

export class YouTubeApiError extends Error {}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
    };
  }>;
}

// Resolves whether a video ID is a Short by following the /shorts/ redirect.
// YouTube redirects /shorts/ID to /watch?v=ID for regular videos, and keeps
// it on /shorts/ID for Shorts.
async function resolveVideoUrl(videoId: string): Promise<{ sourceUrl: string; videoType: 'video' | 'short' }> {
  const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, { redirect: 'follow' });
  const isShort = res.url.includes('/shorts/');
  return {
    sourceUrl: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
    videoType: isShort ? 'short' : 'video',
  };
}

export async function fetchRecentUploads(
  apiKey: string,
  uploadsPlaylistId: string,
  maxResults = 10
): Promise<YouTubeVideo[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('playlistId', uploadsPlaylistId);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.error('YouTube API error response:', res.status, errorBody);
    throw new YouTubeApiError(`YouTube API request failed: ${res.status} ${errorBody}`.trim());
  }

  const body = (await res.json()) as PlaylistItemsResponse;
  if (!Array.isArray(body.items)) {
    throw new YouTubeApiError('YouTube API response missing items array');
  }

  const rawVideos: Array<{ videoId: string; title: string; publishedAt: string }> = [];
  for (const item of body.items) {
    const videoId = item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title;
    const publishedAt = item.snippet?.publishedAt;
    if (!videoId || !title || !publishedAt) continue;
    rawVideos.push({ videoId, title, publishedAt });
  }

  const resolved = await Promise.all(
    rawVideos.map(async (v) => ({ ...v, ...(await resolveVideoUrl(v.videoId)) }))
  );

  return resolved;
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  skipped: number;
  reclassified: number;
  insertedTitles: string[];
}

function videoIdFromUrl(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.replace('/shorts/', '');
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

// Reclassifies existing DB entries by re-running the redirect check and
// updating source_url + video_type if they've changed.
async function reclassifyExisting(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, source_url FROM content WHERE platform = 'youtube'")
    .all<{ id: number; source_url: string }>();

  const rows = results.filter((r) => r.source_url);

  const updates = await Promise.all(
    rows.map(async (row) => {
      const videoId = videoIdFromUrl(row.source_url);
      if (!videoId) return null;
      const resolved = await resolveVideoUrl(videoId);
      return { id: row.id, ...resolved };
    })
  );

  let reclassified = 0;
  for (const update of updates) {
    if (!update) continue;
    const { meta } = await db
      .prepare(
        'UPDATE content SET source_url = ?, video_type = ? WHERE id = ? AND (source_url != ? OR video_type != ?)'
      )
      .bind(update.sourceUrl, update.videoType, update.id, update.sourceUrl, update.videoType)
      .run();
    if (meta.changes > 0) reclassified++;
  }

  return reclassified;
}

export async function syncYouTubeUploads(
  db: D1Database,
  apiKey: string,
  uploadsPlaylistId: string
): Promise<SyncResult> {
  const videos = await fetchRecentUploads(apiKey, uploadsPlaylistId);

  const result: SyncResult = { fetched: videos.length, inserted: 0, skipped: 0, reclassified: 0, insertedTitles: [] };

  for (const video of videos) {
    // Match on video ID embedded in either watch or shorts URL to avoid
    // re-inserting videos whose source_url we're about to reclassify.
    const existing = await db
      .prepare("SELECT id FROM content WHERE source_url LIKE ? OR source_url = ?")
      .bind(`%${video.videoId}%`, video.sourceUrl)
      .first();

    if (existing) {
      result.skipped++;
      continue;
    }

    await db
      .prepare(
        `INSERT INTO content (title, platform, source_url, publish_date, status, video_type)
         VALUES (?, 'youtube', ?, ?, 'draft', ?)`
      )
      .bind(video.title, video.sourceUrl, video.publishedAt, video.videoType)
      .run();
    result.inserted++;
    result.insertedTitles.push(video.title);
  }

  result.reclassified = await reclassifyExisting(db);

  return result;
}
