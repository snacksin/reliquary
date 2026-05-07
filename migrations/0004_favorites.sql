-- M1 Step 1: per-work favorite flag. NULL = not favorited.
-- Non-NULL = favorited at that timestamp.
--
-- STRICT NO-AUTO-FAVORITING POLICY (per M1.md §"Build order" Step 6):
-- this column is set only by the user clicking the heart button on
-- the detail page — i.e. only by POST /api/works/[id]/favorite. Never
-- auto-populated by ratings, read counts, time-spent, or any other
-- heuristic. Future contributors: do not add "helpful" auto-favoriting.
ALTER TABLE works ADD COLUMN favorited_at DATETIME NULL;

-- Partial index — covers only favorited rows. Makes the
-- "Favorites" carousel query (ORDER BY favorited_at DESC) fast
-- without paying the index-maintenance cost on every non-favorite.
CREATE INDEX idx_works_favorited_at ON works(favorited_at) WHERE favorited_at IS NOT NULL;
