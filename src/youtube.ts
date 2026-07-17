export interface YouTubeVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  videoType: 'video' | 'short';
  status: 'live' | 'draft';
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

interface VideosListResponse {
  items?: Array<{
    id?: string;
    status?: { privacyStatus?: string };
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

// Fetches privacy status for a batch of video IDs (max 50 per call).
// Maps privacyStatus: 'public' -> 'live', everything else -> 'draft'.
async function fetchVideoStatuses(apiKey: string, videoIds: string[]): Promise<Map<string, 'live' | 'draft'>> {
  const statuses = new Map<string, 'live' | 'draft'>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'status');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new YouTubeApiError(`YouTube API request failed: ${res.status} ${errorBody}`.trim());
    }

    const body = (await res.json()) as VideosListResponse;
    for (const item of body.items ?? []) {
      if (item.id) {
        statuses.set(item.id, item.status?.privacyStatus === 'public' ? 'live' : 'draft');
      }
    }
  }
  return statuses;
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

  const [resolvedUrls, statuses] = await Promise.all([
    Promise.all(rawVideos.map(async (v) => ({ videoId: v.videoId, ...(await resolveVideoUrl(v.videoId)) }))),
    fetchVideoStatuses(apiKey, rawVideos.map((v) => v.videoId)),
  ]);

  const urlMap = new Map(resolvedUrls.map((r) => [r.videoId, r]));

  return rawVideos.map((v) => ({
    ...v,
    sourceUrl: urlMap.get(v.videoId)?.sourceUrl ?? `https://www.youtube.com/watch?v=${v.videoId}`,
    videoType: urlMap.get(v.videoId)?.videoType ?? 'video',
    status: statuses.get(v.videoId) ?? 'live',
  }));
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
// re-fetching status from the API, updating any fields that have changed.
async function reclassifyExisting(db: D1Database, apiKey: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, source_url FROM content WHERE platform = 'youtube'")
    .all<{ id: number; source_url: string }>();

  const rows = results.filter((r) => r.source_url);
  const videoIds = rows.map((r) => videoIdFromUrl(r.source_url)).filter(Boolean) as string[];
  const idToRow = new Map(rows.map((r) => [videoIdFromUrl(r.source_url), r.id]));

  const [resolvedUrls, statuses] = await Promise.all([
    Promise.all(videoIds.map(async (id) => ({ videoId: id, ...(await resolveVideoUrl(id)) }))),
    fetchVideoStatuses(apiKey, videoIds),
  ]);

  let reclassified = 0;
  for (const resolved of resolvedUrls) {
    const rowId = idToRow.get(resolved.videoId);
    if (rowId === undefined) continue;
    const status = statuses.get(resolved.videoId) ?? 'live';
    const { meta } = await db
      .prepare(
        'UPDATE content SET source_url = ?, video_type = ?, status = ? WHERE id = ? AND (source_url != ? OR video_type != ? OR status != ?)'
      )
      .bind(resolved.sourceUrl, resolved.videoType, status, rowId, resolved.sourceUrl, resolved.videoType, status)
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
      .prepare('SELECT id FROM content WHERE source_url LIKE ?')
      .bind(`%${video.videoId}%`)
      .first();

    if (existing) {
      result.skipped++;
      continue;
    }

    await db
      .prepare(
        `INSERT INTO content (title, platform, source_url, publish_date, status, video_type)
         VALUES (?, 'youtube', ?, ?, ?, ?)`
      )
      .bind(video.title, video.sourceUrl, video.publishedAt, video.status, video.videoType)
      .run();

    result.inserted++;
    result.insertedTitles.push(video.title);
  }

  result.reclassified = await reclassifyExisting(db, apiKey);

  return result;
}
