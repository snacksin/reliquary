-- M1 Step 1: classify chapters by their role in the EPUB spine.
-- Valid values: 'preface', 'summary', 'chapter', 'afterword'.
-- Existing POC rows default to 'chapter' here; Step 2's wrapper-aware
-- parser reclassifies them on re-ingestion (or a one-shot script —
-- see Step 1 notes in M1.md). Step 1 also wipes the DB so this default
-- only ever applies transiently to leftover dev data.
ALTER TABLE chapters ADD COLUMN kind TEXT NOT NULL DEFAULT 'chapter';

CREATE INDEX idx_chapters_work_kind ON chapters(work_id, kind, number);
