-- Manual "read" mark (you-layer foundation). NULL = unread; non-NULL =
-- marked read at that timestamp. Applies over the live library, no wipe.
-- Mirrors the favorited_at / trashed_at / dismissed_at idiom.
--
-- STRICT MANUAL-ONLY POLICY (mirrors the no-auto-favoriting rule in
-- migrations/0004_favorites.sql):
-- this column is set ONLY by the user toggling "Mark as read" on the detail
-- page — i.e. only by POST/DELETE /api/works/[id]/read. It is DELIBERATELY
-- decoupled from reading progress: finishing a fic, reaching ~95%, the
-- "Read again" reset, and ingest must NEVER touch read_at. The whole point is
-- that it reflects an explicit, intentional user signal, independent of where
-- you physically are in the text. Future contributors: do not add automatic
-- "helpfully mark read" based on max_read_chapter, completion, or any heuristic.
ALTER TABLE works ADD COLUMN read_at DATETIME NULL;

-- No index this round: there is no read_at query yet (the library "hide read"
-- filter / row badge are deferred to the broader you-layer). The partial index
-- (WHERE read_at IS NOT NULL) lands with the filter that needs it, mirroring
-- how idx_works_favorited_at shipped alongside the Favorites carousel.
