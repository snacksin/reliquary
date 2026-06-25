-- Multi-Source (MS) Step 1: record where each fic came from.
-- AO3-native vs FicHub (and the FicHub fic's origin site), detected from the
-- stored preface.html. Precursor to Step 2's source-URL identity/dedup fix.
-- Additive — applies over the live library on first boot, no wipe.
--
-- No DEFAULT: existing rows stay NULL so backfillSource (db.ts boot hook) can
-- find them via `source IS NULL`, then stamp a concrete value — same skip-marker
-- idiom as works.content_hash / works.series_scanned_at. NULL is transient.
-- Values: ao3 | fichub-ao3 | fichub-ffn | fichub-other | unknown
ALTER TABLE works ADD COLUMN source TEXT;
