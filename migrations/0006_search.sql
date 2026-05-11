-- M2.1 Step 1: full-text search over works' searchable text fields.
--
-- FTS5 virtual table. `work_id` is UNINDEXED — stored alongside each row
-- so we can join back to `works` after a match, but excluded from the
-- inverted index since we never search by it. `title`, `author`, and
-- `summary` are tokenized with the Porter stemmer (so "running" matches
-- "run") and Unicode-aware folding (so diacritics don't prevent matches).
--
-- Tag-text searchability is achieved by joining FTS results to
-- `work_tags` at query time rather than embedding tag text into the
-- index, which keeps the index lean and avoids re-indexing on tag edits.
CREATE VIRTUAL TABLE works_fts USING fts5(
	work_id UNINDEXED,
	title,
	author,
	summary,
	tokenize = "porter unicode61 remove_diacritics 2"
);

-- Sync triggers keep `works_fts` in lockstep with `works`. The runner
-- creates the table empty; Step 2's re-ingest fires INSERT triggers as
-- works arrive, so the index is rebuilt naturally without a manual
-- backfill. If a future migration ALTERs the `works` schema, regenerate
-- the FTS table in that migration to avoid trigger drift.
CREATE TRIGGER works_fts_insert AFTER INSERT ON works BEGIN
	INSERT INTO works_fts(work_id, title, author, summary)
	VALUES (new.id, new.title, new.author, COALESCE(new.summary, ''));
END;

CREATE TRIGGER works_fts_delete AFTER DELETE ON works BEGIN
	DELETE FROM works_fts WHERE work_id = old.id;
END;

CREATE TRIGGER works_fts_update AFTER UPDATE ON works BEGIN
	DELETE FROM works_fts WHERE work_id = old.id;
	INSERT INTO works_fts(work_id, title, author, summary)
	VALUES (new.id, new.title, new.author, COALESCE(new.summary, ''));
END;
