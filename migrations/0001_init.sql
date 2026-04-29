CREATE TABLE works (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  author          TEXT NOT NULL,
  summary         TEXT,
  chapter_count   INTEGER NOT NULL,
  word_count      INTEGER,
  ingested_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chapters (
  id              TEXT PRIMARY KEY,
  work_id         TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL,
  title           TEXT,
  content_path    TEXT NOT NULL,
  UNIQUE(work_id, number)
);
