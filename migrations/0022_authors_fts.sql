-- Author Identity Part B: co-author searchability via the notes_fts idiom —
-- a small SEPARATE FTS table OR'd into the search query. works_fts stays
-- completely untouched (the locked Part A decision): it still indexes the
-- raw works.author byline, which only ever recorded the FIRST author for
-- most co-authored fics. This table indexes ALL parsed byline authors
-- (every account + pseud from work_authors), so a search for any co-author
-- finds the work.
--
-- One row per work; `names` is the space-joined account + pseud tokens in
-- byline order. Maintained at the APPLICATION level by syncWorkAuthors
-- (the single writer of work_authors — ingest + backfill both route through
-- it), not by triggers: work_authors is multi-row per work, so the
-- delete-then-reinsert-aggregate shape is clearer in code than in per-row
-- trigger programs. purgeWork deletes the row explicitly on hard delete.
-- Same tokenizer as works_fts/notes_fts so search behavior is consistent.
CREATE VIRTUAL TABLE authors_fts USING fts5(
	work_id UNINDEXED,
	names,
	tokenize = "porter unicode61 remove_diacritics 2"
);

-- One-shot population from the work_authors rows Part A already backfilled
-- over the live library — so the existing co-authored works are searchable
-- immediately, no boot-pass needed. New/re-ingested works are maintained by
-- syncWorkAuthors from here on.
INSERT INTO authors_fts (work_id, names)
SELECT work_id, group_concat(name_pair, ' ')
  FROM (
    SELECT work_id,
           account || CASE WHEN pseud IS NOT NULL AND pseud != account
                           THEN ' ' || pseud ELSE '' END AS name_pair
      FROM work_authors
     ORDER BY work_id, position
  )
 GROUP BY work_id;
