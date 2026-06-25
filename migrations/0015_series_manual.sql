-- Series Pages Part 4: manual "set series" assignment.
-- Marks a series_works link as user-assigned (manual) vs auto-extracted from
-- the preface. The auto-paths (startup backfill, re-scan, re-upload) only
-- refresh manual = 0 links, so a manual assignment is never clobbered — the
-- FicHub net. Additive — applies over the live library on first boot, no wipe.
ALTER TABLE series_works ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
