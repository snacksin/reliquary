-- Cover Art Part A: the DESIGN §6.19 reserved column arrives (the UI has
-- held 2:3 cover space since M1 Step 9), plus the manual-vs-extracted
-- precedence flag.
--
-- cover_path is CWD-RELATIVE, exactly like chapters.content_path
-- ('data/works/<id>/…') — one path rule; absolute paths in the DB would
-- break when the Pi move relocates data/. It points either at an
-- ingest-extracted image ('data/works/<id>/images/<file>') or a manually
-- uploaded file ('data/works/<id>/cover-<ts>.<ext>').
--
-- cover_source is the explicit precedence flag: 'manual' | 'epub', NULL
-- when cover_path is NULL. Ingest may set/replace a cover only when the
-- source is NOT 'manual' — a re-upload never overwrites a manually-set
-- cover. Manual upload always may. (Deliberately a column, not derived
-- from the path shape — self-documenting and robust to future moves.)
ALTER TABLE works ADD COLUMN cover_path TEXT;
ALTER TABLE works ADD COLUMN cover_source TEXT;
