-- Author Identity Part A: per-work author records parsed from the AO3
-- preface/summary byline LINKS (never the display string — pseuds may
-- legally contain parens and commas). Each byline author arrives as one
-- <a rel="author"> whose URL is /users/{account}/pseuds/{pseud} (or just
-- /users/{account} when unpseuded), so account + pseud come straight from
-- the URL path segments (%-decoded).
--
-- Ordered many-to-many NOW even though Part A's feature scope is
-- single-author display: co-authored fics arrive as multiple links, all
-- stored here at ingest/backfill, so Part B (multi-author display/pages)
-- rides this table without another schema change or backfill.
--
-- This table is INGEST-OWNED (rows only ever come from parsing — no user
-- editing), so re-ingest does a full delete+rewrite per work. That is the
-- opposite of work_tags, whose rewrite must stay category-scoped because
-- it mixes parsed AO3 tags with user-authored personal tags.
--
-- AO3-source works only (works.source = 'ao3'); FicHub/other works never
-- get rows and every author surface falls back to works.author for them.
-- works.author itself is untouched — it stays the raw decoded dc:creator
-- byline (display fallback + the #64 hash-from-raw input).
CREATE TABLE work_authors (
	work_id  TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
	position INTEGER NOT NULL,   -- byline order; 0 = primary author
	account  TEXT NOT NULL,      -- %-decoded /users/ URL segment
	pseud    TEXT,               -- %-decoded /pseuds/ segment; NULL when the URL had no pseud part
	PRIMARY KEY (work_id, position)
);

-- Reverse lookup: the account's author page gathers its works (and the
-- "pseuds seen so far" list) by account.
CREATE INDEX idx_work_authors_account ON work_authors(account);
