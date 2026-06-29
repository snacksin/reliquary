-- Personal layer (you-layer) Step 1: per-work star rating. A separate table
-- (DESIGN §6.8), not a column on works, so ratings are their own dimension —
-- decoupled from reading progress, Continue Reading, the read flag, and
-- favorites. Applies over the live library, no wipe.
--
-- Unrated = NO ROW (the set/clear endpoint DELETEs to clear), so `stars` is
-- always a real 1-5. This mirrors the favorited_at / read_at presence-idiom
-- and is cleaner than a 0 sentinel; DESIGN's CHECK(0..5) / "0 = unrated" was a
-- sync-shape sketch — no-row is equivalent (a future sync clear maps to a
-- tombstone). Column name `stars` matches DESIGN's sync WAL shape.
--
-- ON DELETE CASCADE: a hard purge of a work drops its rating too (same as
-- reading_progress). No index this round — the table is tiny (one row per
-- rated work) and the PK covers the work_id join; a `stars` index can land
-- with the sort/filter fast-follow if it ever needs one.
CREATE TABLE ratings (
	work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
