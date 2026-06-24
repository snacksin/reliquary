-- Series Pages Part 2: per-series favorite + index hide.
-- Mirrors the favorite-author flag (manual-only) and the per-tag sidebar hide.
-- Additive — applies over the live library on first boot, no wipe.

-- Manual favorite (non-null = favorite). Never auto-set, same policy as
-- works.favorited_at and authors.favorited_at.
ALTER TABLE series ADD COLUMN favorited_at DATETIME;

-- Hide a series from the /series index only (1 = hidden). The series' member
-- works still appear normally in the library — this is index declutter for
-- one-shot "collections", not a separate type.
ALTER TABLE series ADD COLUMN hidden_from_index INTEGER NOT NULL DEFAULT 0;
