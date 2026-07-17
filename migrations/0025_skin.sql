-- WS Part 2: the work's creator stylesheet (AO3 work skin), extracted at
-- ingest, sanitized + #workskin-scoped (src/lib/server/skin.ts), stored as
-- data/works/<id>/skin.css. CWD-RELATIVE like content_path/cover_path —
-- the one path rule. Ingest-owned (no manual variant): re-drop refreshes,
-- a skin-less re-drop clears, purge deletes with the work dir, trash
-- preserves. NEVER a computeContentHash input. Forward-looking: EPUBs
-- aren't retained, so existing fics get skins via fresh upload/re-drop.
ALTER TABLE works ADD COLUMN skin_path TEXT;
