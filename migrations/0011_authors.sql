-- Author Pages Part 1: per-author state, keyed by the exact works.author
-- string (no pseud/alias merging — that's M6). For now the only column
-- besides the name is the manual favorite flag; Part 2 grows this table
-- with notes/tags. Additive — applies over the live library, no wipe.
--
-- No foreign key to works: works.author is free text and an author has
-- no row of its own there. A favorite persists even if every work by
-- that author is later trashed or deleted (the row just stops appearing
-- in the /authors index, which requires ≥1 non-trashed work).
CREATE TABLE authors (
	name         TEXT PRIMARY KEY,   -- exact works.author string
	favorited_at DATETIME            -- non-null = favorite author
);
