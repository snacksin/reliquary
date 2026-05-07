-- M1 Step 1: per-work last-read pointer for the library's
-- "Continue Reading" carousel.
-- Populated by POST /api/works/[id]/progress on debounced scroll
-- (Step 5). Cleared by DELETE /api/works/[id]/progress when the
-- user removes a fic from the carousel.
-- ON DELETE CASCADE: if a work is deleted, its progress row goes too.
CREATE TABLE reading_progress (
	work_id        TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	last_chapter   INTEGER NOT NULL,
	last_scroll_y  INTEGER NOT NULL DEFAULT 0,
	updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
