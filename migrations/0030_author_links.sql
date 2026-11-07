-- Author links (2026-11-07): one person, two bylines. A FicHub export from
-- FanFiction.net (or another non-AO3 site) carries only a plain-text name,
-- so it lands under its own author key even when the same writer's AO3
-- account is already in the library ("Tsume Yuki" vs AO3 "Tsume_Yuki").
--
-- A link maps that raw name (works.author of the non-AO3 works) onto an
-- author key — normally an AO3 account. Linked works get work_authors rows
-- {account, pseud: <raw name>} (refreshAuthorLinks in authors.ts), so every
-- existing author surface groups them under the account with no query
-- change. The rows are derived; this table is the user-owned truth that
-- survives re-ingest.
--
--   auto    — name matched exactly one AO3 account (case-insensitive,
--             spaces = underscores); made and dropped by the boot/ingest pass
--   manual  — Allie linked it on the author page ("Same author as…")
--   blocked — Allie unlinked it; the auto pass must never redo it
--
-- AO3-native and FicHub-AO3 works never use this table: their byline
-- identity is parsed (links / "pseud (account)").
CREATE TABLE author_links (
	alias      TEXT PRIMARY KEY,   -- exact works.author string of the non-AO3 works
	account    TEXT NOT NULL,      -- author key they join (blocked: the one unlinked from)
	kind       TEXT NOT NULL CHECK (kind IN ('auto', 'manual', 'blocked')),
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_author_links_account ON author_links(account);
