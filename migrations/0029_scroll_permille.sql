-- Cross-device scroll handoff (ROADMAP item 5). The reader's position as a
-- fraction of the chapter text, 0–1000 (permille), so it means the same
-- place on a phone and a laptop. `last_scroll_y` stays as raw pixels; it
-- can't be reused because legacy pixel values under 1000 are
-- indistinguishable from permille. Purely additive: existing rows are NULL
-- = "no device-independent position known" = no handoff (today's
-- behavior). NULL is also what a stale pre-handoff client tab writes.
ALTER TABLE reading_progress ADD COLUMN last_scroll_permille INTEGER;
