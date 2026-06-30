-- Personal layer (you-layer) Step 2: per-work markdown notes, searchable.
-- A separate table (DESIGN §6.5/§6.8) — its own dimension, decoupled from
-- ratings / read / Continue Reading / favorites. Applies over the live
-- library, no wipe.
--
-- body is the raw markdown the user typed (rendered + sanitized client-side).
-- An empty note is represented by NO ROW (the save endpoint DELETEs to clear),
-- so "nothing shown" is the default. ON DELETE CASCADE drops the note (and via
-- the notes_fts trigger, its search row) when a work is purged.
CREATE TABLE notes (
	work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	body TEXT NOT NULL DEFAULT '',
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Global search over note text. DELIBERATELY a SEPARATE FTS table rather than
-- rebuilding the live works_fts: notes are single-source (one body per work),
-- so the triggers are trivial, there is NO re-index/backfill (this table starts
-- empty and fills as notes are written), and the existing title/author/summary
-- index is left completely untouched — zero regression risk to search. The
-- search query (src/routes/api/works/+server.ts) matches works_fts OR notes_fts
-- by work_id. Same tokenizer as works_fts so behavior is consistent.
CREATE VIRTUAL TABLE notes_fts USING fts5(
	work_id UNINDEXED,
	body,
	tokenize = "porter unicode61 remove_diacritics 2"
);

-- Sync triggers keep notes_fts in lockstep with notes (single table → simple;
-- delete-then-insert on update). On a work purge the FK cascade deletes the
-- notes row, firing notes_fts_delete, so the search row goes with it.
CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
	INSERT INTO notes_fts(work_id, body) VALUES (new.work_id, new.body);
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
	DELETE FROM notes_fts WHERE work_id = old.work_id;
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
	DELETE FROM notes_fts WHERE work_id = old.work_id;
	INSERT INTO notes_fts(work_id, body) VALUES (new.work_id, new.body);
END;
