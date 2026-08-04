CREATE TABLE youtube_videos (
  video_id    TEXT PRIMARY KEY,     -- YouTube's own video ID, e.g. 'Xnk2Budn0zA'
  title       TEXT NOT NULL,
  source_url  TEXT,                 -- original URL (e.g. the YouTube video URL)
  publish_date TEXT,
  status      TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'live'
  video_type  TEXT NOT NULL DEFAULT 'video', -- 'video', 'short'
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
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
