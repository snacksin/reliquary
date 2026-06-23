-- Author Pages Part 2: per-author notes + a reusable author-tag vocabulary.
-- Extends the authors table (0011) with a single free-text note, and adds a
-- SEPARATE flat tag vocabulary (deliberately NOT the work-tag tables — author
-- tags are their own namespace per Allie's Part 2 decision) plus per-author
-- links. Additive — applies over the live library on first boot, no wipe.

-- One free-text note per author. NULL = no note (nothing shown on the page).
ALTER TABLE authors ADD COLUMN notes TEXT;

-- Reusable vocabulary: one row per distinct author tag, shared across authors.
-- UNIQUE COLLATE NOCASE so "Reread" and "reread" are the same tag (the add
-- combobox autocompletes against this list and find-or-creates by name).
CREATE TABLE author_tags (
	id   INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

-- Many-to-many: which vocabulary tags are attached to which author. Removing a
-- link detaches the tag from that author but leaves it in the vocabulary.
-- FK to authors(name): any author getting a tag is upserted into authors first
-- (the same row that may also hold a favorite and/or a note).
CREATE TABLE author_tag_links (
	author_name   TEXT NOT NULL REFERENCES authors(name) ON DELETE CASCADE,
	author_tag_id INTEGER NOT NULL REFERENCES author_tags(id) ON DELETE CASCADE,
	PRIMARY KEY (author_name, author_tag_id)
);

-- Speeds the index filter's reverse lookup (authors carrying a given tag id).
CREATE INDEX idx_author_tag_links_tag ON author_tag_links(author_tag_id);
