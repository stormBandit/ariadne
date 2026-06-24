export interface YouTubeVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
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
    throw new YouTubeApiError(`YouTube API request failed: ${res.status}`);
  }

  const body = (await res.json()) as PlaylistItemsResponse;
  if (!Array.isArray(body.items)) {
    throw new YouTubeApiError('YouTube API response missing items array');
  }

  const videos: YouTubeVideo[] = [];
  for (const item of body.items) {
    const videoId = item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title;
    const publishedAt = item.snippet?.publishedAt;
    if (!videoId || !title || !publishedAt) continue;
    videos.push({
      videoId,
      title,
      publishedAt,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return videos;
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  skipped: number;
  insertedTitles: string[];
}

export async function syncYouTubeUploads(
  db: D1Database,
  apiKey: string,
  uploadsPlaylistId: string
): Promise<SyncResult> {
  const videos = await fetchRecentUploads(apiKey, uploadsPlaylistId);

  const result: SyncResult = { fetched: videos.length, inserted: 0, skipped: 0, insertedTitles: [] };

  for (const video of videos) {
    const existing = await db
      .prepare('SELECT id FROM content WHERE source_url = ?')
      .bind(video.sourceUrl)
      .first();

    if (existing) {
      result.skipped++;
      continue;
    }

    await db
      .prepare(
        `INSERT INTO content (title, platform, source_url, publish_date, status)
         VALUES (?, 'youtube', ?, ?, 'draft')`
      )
      .bind(video.title, video.sourceUrl, video.publishedAt)
      .run();
    result.inserted++;
    result.insertedTitles.push(video.title);
  }

  return result;
}
