-- M2.3 Step 1: schema foundation for soft trash + dedup. The three
-- columns are INERT until Steps 2-4 wire them up — this migration must
-- change zero app behavior and apply cleanly over a live library (no
-- data wipe; all existing rows get NULLs).
--
-- source_url: canonical work URL, the PRIMARY dedup identity key
--   (Step 2 extracts it from the preface's "Posted originally on the
--   Archive of Our Own at <a href=…>" link, normalized to
--   https://archiveofourown.org/works/<id>). Identity is the URL, not
--   title/author — titles and authors change; the URL is stable unless
--   the fic is deleted/re-posted (Allie, 2026-06-11).
--
-- content_hash: sha256 FALLBACK identity for URL-less fics (FicHub
--   etc.). Computed over normalized parsed content (title + author +
--   ordered chapter HTML), NOT raw EPUB bytes — recomputable from data
--   already on disk, so Step 2's startup pass can backfill the
--   existing library without the original EPUBs.
--
-- trashed_at: non-NULL means "in trash" (DESIGN.md §6.7e). Step 4 adds
--   the endpoints + exclusion from every surface; Step 6 purges rows
--   older than 30 days at server start.
--
-- NO UNIQUE constraints on source_url or content_hash, deliberately:
-- the library may already contain duplicates from the POC's
-- accept-silently era, and a UNIQUE index would make this migration
-- fail on real data. Uniqueness is enforced at the app layer by
-- Step 3's dedup logic in ingestEpub(). Don't "tighten" this later
-- without first deduplicating existing rows.
ALTER TABLE works ADD COLUMN source_url TEXT;
ALTER TABLE works ADD COLUMN content_hash TEXT;
ALTER TABLE works ADD COLUMN trashed_at DATETIME;

-- Partial indexes, same pattern as 0004's idx_works_favorited_at:
-- most rows have NULL in these columns (all of them, until Steps 2-4
-- populate), so indexing only the non-NULL rows keeps the indexes tiny
-- while making the dedup lookups (Step 3) and trash-exclusion WHERE
-- clauses (Step 4) index-supported.
CREATE INDEX idx_works_source_url ON works(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX idx_works_content_hash ON works(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_works_trashed_at ON works(trashed_at) WHERE trashed_at IS NOT NULL;
