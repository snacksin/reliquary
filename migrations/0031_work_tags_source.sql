-- Manual tags (2026-11-09): who put a tag on a work.
--
--   extracted — parsed from the EPUB's AO3 preface at ingest. The
--               update-in-place path deletes and rewrites these on every
--               re-upload, so they always track the newest download.
--   manual    — added by hand on the detail page (non-AO3 fics: FicHub
--               exports of FanFiction.net stories carry no tags at all),
--               plus every personal ("My tags") link. Re-ingest never
--               touches these: the rewrite in ingest.ts is scoped to
--               source = 'extracted'.
--
-- A link that is both (picked by hand, later also parsed) keeps the first
-- writer's value: ingest links with INSERT OR IGNORE, so a manual link
-- stays manual and therefore survives the next re-upload.
ALTER TABLE work_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'extracted'
	CHECK (source IN ('extracted', 'manual'));

-- Personal tags were always user-authored; record that. (The ingest delete
-- also keeps its old category guard, so this is belt and braces.)
UPDATE work_tags SET source = 'manual'
 WHERE tag_id IN (SELECT id FROM tags WHERE category = 'personal');
