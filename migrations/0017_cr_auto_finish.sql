-- Continue Reading: auto-finish removal + resurface on new chapters.
-- Three additive columns, applied over the live library (no wipe). All
-- nullable so existing rows keep exactly today's behavior until re-read.

-- High-water mark: the furthest REAL chapter number the reader has scrolled
-- to ~95% of (the auto-mark). Drives "finished" dynamically — a work is
-- finished when max_read_chapter >= chapter_count — so when chapter_count
-- grows (re-upload / MS dedup update-in-place) the new final chapter is
-- unread and the work un-finishes for free. NULL on pre-existing rows is
-- read as 0 ("nothing confirmed read to the end") by the CR logic.
ALTER TABLE reading_progress ADD COLUMN max_read_chapter INTEGER;

-- Sticky dismiss. The Continue Reading × sets this instead of deleting the
-- row, so a dismissed work stays out of the carousel even when new chapters
-- arrive. Cleared (back to NULL) by any subsequent progress write — reading
-- the work again brings it back. NULL = not dismissed.
ALTER TABLE reading_progress ADD COLUMN dismissed_at DATETIME;

-- When an update-in-place last GREW a work's chapter_count (vs the initial
-- ingest). Lets the Continue Reading carousel bump a freshly-grown,
-- resurfaced work up to its new-chapter time rather than burying it at its
-- old reading-recency position. NULL = never grown since ingest.
ALTER TABLE works ADD COLUMN chapters_updated_at DATETIME;
