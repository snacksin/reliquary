-- Chapter History Part 1 (DESIGN.md §6.7b): preserve prior versions of
-- edited chapters instead of overwriting them. Populated by the
-- update-in-place path in ingest.ts when a re-uploaded fic carries an
-- edit to an existing chapter. This migration is additive — applies
-- cleanly over the live library, no wipe.

-- One row per archived prior version of a chapter. `chapter_id` points
-- at the live chapter row, whose id is now STABLE across updates (the
-- update path reconciles rows by (work_id, number) rather than
-- delete+reinsert) so these references stay valid as a chapter is
-- edited repeatedly. ON DELETE CASCADE matches the preservation model:
-- history is never deleted by the update path, only when the whole work
-- is purged from Trash (Step 6 deletes the work → cascades chapters →
-- cascades history).
CREATE TABLE chapter_history (
	id            INTEGER PRIMARY KEY,
	chapter_id    TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
	archived_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	previous_hash TEXT NOT NULL,          -- sha256 of the archived (old) chapter HTML
	previous_path TEXT NOT NULL,          -- data/works/<work_id>/_history/ch-<n>-<ts>.html
	word_count    INTEGER                 -- word count of the archived version
);

-- All-versions-of-a-chapter lookup (drives Part 2's history view).
CREATE INDEX idx_chapter_history_chapter ON chapter_history(chapter_id);

-- Per-chapter content hash for edit detection, and the timestamp of the
-- most recent detected edit. Both nullable: NULL content_hash on the
-- existing library is fine — the update path reads the on-disk file to
-- detect changes and stamps content_hash going forward (no retroactive
-- history is fabricated). last_edited_at stays NULL until a chapter is
-- actually edited.
ALTER TABLE chapters ADD COLUMN content_hash   TEXT;
ALTER TABLE chapters ADD COLUMN last_edited_at DATETIME;
