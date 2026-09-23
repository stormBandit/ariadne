export interface YouTubeVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  videoType: 'video' | 'short';
  status: 'live' | 'draft';
  thumbnailUrl?: string;
}

export class YouTubeApiError extends Error {}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
      thumbnails?: {
        maxres?: { url?: string };
        high?: { url?: string };
      };
    };
  }>;
}

interface VideosListResponse {
  items?: Array<{
    id?: string;
    status?: { privacyStatus?: string };
    snippet?: {
      title?: string;
      thumbnails?: {
        maxres?: { url?: string };
        high?: { url?: string };
      };
    };
  }>;
}

interface VideoDetails {
  status: 'live' | 'draft';
  title?: string;
  thumbnailUrl?: string;
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

// Fetches status, title, and thumbnail for a batch of video IDs (max 50 per
// call). Requesting `part=snippet,status` in one call (rather than two
// separate calls) is what lets reclassifyExisting check every stored video
// for title/thumbnail changes at no extra request cost beyond the status
// check it already did. Maps privacyStatus: 'public' -> 'live', else 'draft'.
async function fetchVideoDetails(apiKey: string, videoIds: string[]): Promise<Map<string, VideoDetails>> {
  const details = new Map<string, VideoDetails>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new YouTubeApiError(`YouTube API request failed: ${res.status} ${errorBody}`.trim());
    }

    const body = (await res.json()) as VideosListResponse;
    for (const item of body.items ?? []) {
      if (!item.id) continue;
      details.set(item.id, {
        status: item.status?.privacyStatus === 'public' ? 'live' : 'draft',
        title: item.snippet?.title,
        thumbnailUrl: item.snippet?.thumbnails?.maxres?.url ?? item.snippet?.thumbnails?.high?.url,
      });
    }
  }
  return details;
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

  const rawVideos: Array<{ videoId: string; title: string; publishedAt: string; thumbnailUrl?: string }> = [];
  for (const item of body.items) {
    const videoId = item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title;
    const publishedAt = item.snippet?.publishedAt;
    if (!videoId || !title || !publishedAt) continue;
    const thumbnailUrl = item.snippet?.thumbnails?.maxres?.url ?? item.snippet?.thumbnails?.high?.url;
    rawVideos.push({ videoId, title, publishedAt, thumbnailUrl });
  }

  const [resolvedUrls, videoDetails] = await Promise.all([
    Promise.all(rawVideos.map(async (v) => ({ videoId: v.videoId, ...(await resolveVideoUrl(v.videoId)) }))),
    fetchVideoDetails(apiKey, rawVideos.map((v) => v.videoId)),
  ]);

  const urlMap = new Map(resolvedUrls.map((r) => [r.videoId, r]));

  return rawVideos.map((v) => ({
    ...v,
    sourceUrl: urlMap.get(v.videoId)?.sourceUrl ?? `https://www.youtube.com/watch?v=${v.videoId}`,
    videoType: urlMap.get(v.videoId)?.videoType ?? 'video',
    status: videoDetails.get(v.videoId)?.status ?? 'live',
  }));
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  skipped: number;
  reclassified: number;
  changelogged: number;
  insertedTitles: string[];
}

type ContentChange = { type: 'title' | 'thumbnail'; oldValue: string | null; newValue: string };

// Applies a video's detected title/thumbnail changes and writes their
// content_changelog rows in a single D1 batch, so the stored value and its
// log entry can never drift out of sync.
async function applyContentChanges(db: D1Database, videoId: string, changes: ContentChange[]): Promise<void> {
  if (changes.length === 0) return;
  const changedAt = new Date().toISOString();
  const statements = changes.flatMap((change) => [
    db
      .prepare(
        `UPDATE youtube_videos SET ${change.type === 'title' ? 'title' : 'thumbnail_url'} = ? WHERE video_id = ?`
      )
      .bind(change.newValue, videoId),
    db
      .prepare(
        `INSERT INTO content_changelog (video_id, changed_at, change_type, old_value, new_value)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(videoId, changedAt, change.type, change.oldValue, change.newValue),
  ]);
  await db.batch(statements);
}

// Reclassifies every stored video (not just the ones fetchRecentUploads just
// returned) by re-running the redirect check and re-fetching status, title,
// and thumbnail from the API, updating any fields that have changed. This is
// what catches a title/thumbnail edit on an old video that's long since
// fallen out of the "recent uploads" window fetchRecentUploads looks at.
async function reclassifyExisting(
  db: D1Database,
  apiKey: string
): Promise<{ reclassified: number; changelogged: number }> {
  const { results } = await db
    .prepare('SELECT video_id, title, thumbnail_url FROM youtube_videos')
    .all<{ video_id: string; title: string; thumbnail_url: string | null }>();

  const videoIds = results.map((r) => r.video_id);

  const [resolvedUrls, videoDetails] = await Promise.all([
    Promise.all(videoIds.map(async (id) => ({ videoId: id, ...(await resolveVideoUrl(id)) }))),
    fetchVideoDetails(apiKey, videoIds),
  ]);

  const urlMap = new Map(resolvedUrls.map((r) => [r.videoId, r]));

  let reclassified = 0;
  let changelogged = 0;
  for (const row of results) {
    const resolved = urlMap.get(row.video_id);
    const details = videoDetails.get(row.video_id);
    const status = details?.status ?? 'live';

    if (resolved) {
      const { meta } = await db
        .prepare(
          'UPDATE youtube_videos SET source_url = ?, video_type = ?, status = ? WHERE video_id = ? AND (source_url != ? OR video_type != ? OR status != ?)'
        )
        .bind(resolved.sourceUrl, resolved.videoType, status, row.video_id, resolved.sourceUrl, resolved.videoType, status)
        .run();
      if (meta.changes > 0) reclassified++;
    }

    const changes: ContentChange[] = [];
    if (details?.title && details.title !== row.title) {
      changes.push({ type: 'title', oldValue: row.title, newValue: details.title });
    }
    if (details?.thumbnailUrl && details.thumbnailUrl !== row.thumbnail_url) {
      changes.push({ type: 'thumbnail', oldValue: row.thumbnail_url, newValue: details.thumbnailUrl });
    }
    if (changes.length > 0) {
      await applyContentChanges(db, row.video_id, changes);
      changelogged += changes.length;
    }
  }

  return { reclassified, changelogged };
}

export async function syncYouTubeUploads(
  db: D1Database,
  apiKey: string,
  uploadsPlaylistId: string
): Promise<SyncResult> {
  const videos = await fetchRecentUploads(apiKey, uploadsPlaylistId);

  const result: SyncResult = {
    fetched: videos.length,
    inserted: 0,
    skipped: 0,
    reclassified: 0,
    changelogged: 0,
    insertedTitles: [],
  };

  for (const video of videos) {
    const existing = await db
      .prepare('SELECT title, thumbnail_url FROM youtube_videos WHERE video_id = ?')
      .bind(video.videoId)
      .first<{ title: string; thumbnail_url: string | null }>();

    if (existing) {
      result.skipped++;

      const changes: ContentChange[] = [];
      if (video.title !== existing.title) {
        changes.push({ type: 'title', oldValue: existing.title, newValue: video.title });
      }
      if (video.thumbnailUrl && video.thumbnailUrl !== existing.thumbnail_url) {
        changes.push({ type: 'thumbnail', oldValue: existing.thumbnail_url, newValue: video.thumbnailUrl });
      }
      if (changes.length > 0) {
        await applyContentChanges(db, video.videoId, changes);
        result.changelogged += changes.length;
      }
      continue;
    }

    await db
      .prepare(
        `INSERT INTO youtube_videos (video_id, title, source_url, publish_date, status, video_type, thumbnail_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        video.videoId,
        video.title,
        video.sourceUrl,
        video.publishedAt,
        video.status,
        video.videoType,
        video.thumbnailUrl ?? null
      )
      .run();

    result.inserted++;
    result.insertedTitles.push(video.title);
  }

  const reclassifyResult = await reclassifyExisting(db, apiKey);
  result.reclassified = reclassifyResult.reclassified;
  result.changelogged += reclassifyResult.changelogged;

  return result;
}
