-- M2.1 Step 1: structured tag storage extracted from AO3 preface metadata.
--
-- One row per distinct (category, name) pair across the whole library.
-- `category` is one of:
--   rating | warning | category | fandom | relationship | character | freeform | personal
-- The first seven categories are populated automatically by Step 2's
-- preface parser. `personal` is reserved for user-toggled tags and is
-- NEVER populated at ingest — a future milestone wires up the UI for it.
CREATE TABLE tags (
	id          INTEGER PRIMARY KEY,
	category    TEXT NOT NULL,
	name        TEXT NOT NULL,
	created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(category, name)
);

-- Join table connecting works to their tags. Both FKs cascade so
-- deleting a work or a tag tidies up the join rows automatically.
CREATE TABLE work_tags (
	work_id  TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
	tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	PRIMARY KEY(work_id, tag_id)
);

-- Reverse-lookup index: given a tag, find every work using it.
-- Primary use case is the tag-filter sidebar's "works matching this tag" query.
CREATE INDEX idx_work_tags_tag ON work_tags(tag_id);

-- Category lookup index: powers the /api/tags grouped-by-category response.
CREATE INDEX idx_tags_category ON tags(category);
