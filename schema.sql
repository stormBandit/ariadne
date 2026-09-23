CREATE TABLE youtube_videos (
  video_id      TEXT PRIMARY KEY,     -- YouTube's own video ID, e.g. 'Xnk2Budn0zA'
  title         TEXT NOT NULL,
  source_url    TEXT,                 -- original URL (e.g. the YouTube video URL)
  publish_date  TEXT,
  status        TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'live'
  video_type    TEXT NOT NULL DEFAULT 'video', -- 'video', 'short'
  thumbnail_url TEXT,                 -- current live thumbnail, synced from YouTube Data API
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- 'openinapp', 'creatorurls', 'affiliate', 'other'
  label       TEXT,
  url         TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  platform      TEXT,         -- 'instagram', 'facebook', 'tiktok', etc.
  trigger_word  TEXT,         -- word someone DMs to trigger automation
  message_body  TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE keywords (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id     TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,
  weighted_score INTEGER, -- TubeBuddy "weighted overall score", out of 100
  search_volume  TEXT CHECK (search_volume IS NULL OR search_volume IN ('Poor', 'Fair', 'Good', 'Great', 'Excellent')),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  test_type   TEXT NOT NULL,                       -- 'title', 'thumbnail'
  status      TEXT NOT NULL DEFAULT 'inconclusive', -- 'conclusive', 'inconclusive'
  start_date  TEXT,
  end_date    TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE test_variants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id           INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  value             TEXT NOT NULL, -- title text, or thumbnail description/URL
  watch_time_share  REAL,          -- percentage, e.g. 62.0; null if inconclusive
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Auto-detected title/thumbnail changes, written by the YouTube sync when it
-- notices the live title or thumbnail_url differs from what's stored. Separate
-- from `tests`, which tracks intentional, manually-logged A/B experiments.
CREATE TABLE content_changelog (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id                  TEXT REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL DEFAULT 'dalton',
  changed_at                TEXT NOT NULL,
  change_type               TEXT NOT NULL CHECK (change_type IN ('title', 'thumbnail')),
  old_value                 TEXT,
  new_value                 TEXT,
  -- CTR/watch-duration fields: all NULL until Phase 3 OAuth is connected.
  -- ctr_before/avg_view_duration_before = the 28 days leading up to the detected change.
  -- ctr_after/avg_view_duration_after = the 28 days starting ~2 weeks post-change; stays
  -- NULL until the threshold is met (2 weeks elapsed + 500 impressions after).
  ctr_before                REAL,
  impressions_before        INTEGER,
  avg_view_duration_before  INTEGER,  -- seconds
  ctr_after                 REAL,
  impressions_after         INTEGER,
  avg_view_duration_after   INTEGER,  -- seconds
  created_at                TEXT DEFAULT CURRENT_TIMESTAMP
);
