-- WS Part 3 amendment: manual-vs-extracted precedence for skins, mirroring
-- cover_source (0024) exactly. 'manual' = pasted via the detail-page
-- "Creator's style" box; 'epub' = extracted at ingest; NULL when skin_path
-- is NULL. Ingest may set/replace a skin only when skin_source IS NOT
-- 'manual' — a re-drop never overwrites a pasted skin (its file rides the
-- dir swap like a manual cover). Clearing via the box nulls BOTH columns,
-- returning the work to extractable: a later re-drop may set an 'epub'
-- skin again.
ALTER TABLE works ADD COLUMN skin_source TEXT;
-- Every skin that exists before this migration was ingest-extracted (the
-- paste box ships in the same PR as this column).
UPDATE works SET skin_source = 'epub' WHERE skin_path IS NOT NULL;
