CREATE TABLE content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  platform    TEXT NOT NULL,        -- 'youtube'
  source_url  TEXT,                 -- original URL (e.g. the YouTube video URL)
  publish_date TEXT,
  status      TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'live'
  video_type  TEXT NOT NULL DEFAULT 'video', -- 'video', 'short'
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  INTEGER REFERENCES content(id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- 'openinapp', 'creatorurls', 'affiliate', 'other'
  label       TEXT,
  url         TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    INTEGER REFERENCES content(id) ON DELETE CASCADE,
  platform      TEXT,         -- 'instagram', 'facebook', 'tiktok', etc.
  trigger_word  TEXT,         -- word someone DMs to trigger automation
  message_body  TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
