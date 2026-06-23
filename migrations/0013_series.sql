-- Series Pages Part 1: foundation for series support (DESIGN §6.6).
-- Records which works belong to which AO3 series. The source data is the
-- "Series:" line already present in each work's stored preface.html, so the
-- existing library is backfilled from disk (no re-download). Additive —
-- applies over the live library on first boot, no wipe.

-- One row per distinct series. Identity is the normalized AO3 series URL;
-- URL-less EPUBs fall back to name (ao3_series_url NULL), mirroring work dedup.
CREATE TABLE series (
	id             INTEGER PRIMARY KEY,
	ao3_series_url TEXT,
	name           TEXT NOT NULL,
	created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One series row per URL. Partial so multiple URL-less (name-keyed) rows are
-- allowed; their de-duplication is handled app-layer in syncWorkSeries.
CREATE UNIQUE INDEX idx_series_url ON series(ao3_series_url) WHERE ao3_series_url IS NOT NULL;

-- Many-to-many: a work can be in several series. position = "Part N" (NULL if
-- the preface entry has no part number). Both FKs cascade on delete so a
-- permanently-purged work or series leaves nothing dangling.
CREATE TABLE series_works (
	series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
	work_id   TEXT    NOT NULL REFERENCES works(id)  ON DELETE CASCADE,
	position  INTEGER,
	PRIMARY KEY (series_id, work_id)
);

-- Reverse lookup: a work's series (for the preface section).
CREATE INDEX idx_series_works_work ON series_works(work_id);

-- Backfill skip-marker. The series backfill re-reads preface.html for works
-- with series_scanned_at IS NULL and stamps it once scanned (with or without a
-- series found), so a second boot scans 0 — same idiom as identity's
-- content_hash skip-marker. A no-series work has zero series_works rows, so
-- without this flag it couldn't be told apart from an unscanned one.
ALTER TABLE works ADD COLUMN series_scanned_at DATETIME;
