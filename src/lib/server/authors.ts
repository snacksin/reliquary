import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { decodeEntities } from './epub';

/**
 * Author Identity Part A — AO3 pseud parsing + account grouping (the offline
 * v1 slice of DESIGN §6.11; no profile fetching).
 *
 * On AO3, a pseud byline DISPLAYS as "pseud (account)" — e.g.
 * "azure (noirmagiks)" — but in the EPUB each byline author is a separate
 * `<a rel="author">` link whose URL carries the identity:
 *
 *   https://archiveofourown.org/users/{account}/pseuds/{pseud}
 *   https://archiveofourown.org/users/{account}            (unpseuded)
 *
 * We parse the LINKS, never the display text: pseuds may legally contain
 * parens and commas, so the display string is unparseable in general. The
 * byline anchor lives in the SUMMARY wrapper in the library's (Calibre-
 * processed) AO3 EPUBs — not the preface — so callers feed both wrappers'
 * HTML.
 *
 * Edge cases (all verified against the real library):
 *  - Anonymous / deleted-author bylines have NO `rel="author"` anchor →
 *    `[]` → the work gets zero work_authors rows and every author surface
 *    falls back to `works.author`, exactly as today.
 *  - `orphan_account` is a real AO3 account; it parses + groups normally
 *    (all orphaned works under one page — accurate to AO3 itself).
 *  - pseud identical to the account (AO3's default pseud) is stored
 *    verbatim; display logic treats it as unpseuded.
 *  - Co-authored fics arrive as multiple anchors — ALL are stored, in
 *    byline order (Part B rides this; Part A surfaces only position 0).
 */

export type WorkAuthor = {
	account: string;
	/** NULL when the byline URL had no /pseuds/ segment. */
	pseud: string | null;
};

/** Percent-decode a URL path segment, tolerating malformed escapes. */
function decodeSegment(seg: string): string {
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

/**
 * Extract the byline authors from wrapper HTML, in byline order.
 *
 * Scoped to the `<div class="byline">` region(s): AO3 EPUB wrappers carry
 * `rel="author"` anchors with perfectly valid `/users/{x}/pseuds/{x}` hrefs
 * OUTSIDE the byline too — the "Inspired by <work> by <author>" credits and
 * gift-recipient links — and a whole-document scan mistakes those for
 * co-authors (the Part B amendment bug: giftees/inspirations became phantom
 * co-authors with their own author pages). Real co-authored fics list every
 * author INSIDE the one byline div ("by <a>A</a>, <a>B</a>" — verified
 * against the library's genuinely co-authored works), so the div is both
 * necessary and sufficient. Wrappers with no byline div at all (unknown
 * EPUB shapes) fall back to the whole-document scan.
 *
 * Two extra guards, defense-in-depth:
 *  - anchors after a `</a> for ` token are dropped (AO3 gift syntax is
 *    "by A, B for C" — recipients always follow the authors);
 *  - the href path must be EXACTLY /users/{account} or
 *    /users/{account}/pseuds/{pseud} — any trailing segment (/gifts,
 *    /works, …) disqualifies the anchor.
 *
 * Anchors are matched attribute-order-agnostically; duplicate
 * (account, pseud) pairs collapse to the first occurrence so a byline
 * repeated across the summary + preface wrappers yields one row per author.
 */
export function extractWorkAuthors(html: string): WorkAuthor[] {
	const bylines = [...html.matchAll(/<div[^>]*class="[^"]*byline[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];
	let scope = bylines.length ? bylines.map((m) => m[1]).join('\n') : html;
	const giftCut = scope.indexOf('</a> for ');
	if (giftCut !== -1) scope = scope.slice(0, giftCut + '</a>'.length);

	const out: WorkAuthor[] = [];
	const seen = new Set<string>();
	for (const tag of scope.matchAll(/<a\b[^>]*>/gi)) {
		const attrs = tag[0];
		if (!/\brel\s*=\s*["']author["']/i.test(attrs)) continue;
		const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
		if (!href) continue;
		// Anchored: nothing may follow the account/pseud segment but an
		// optional trailing slash and the end of the path.
		const m = /\/users\/([^/?"#]+)(?:\/pseuds\/([^/?"#]+))?\/?(?=[?#]|$)/.exec(href);
		if (!m) continue;
		const account = decodeSegment(m[1]).trim();
		if (!account) continue;
		const pseud = m[2] ? decodeSegment(m[2]).trim() || null : null;
		const key = `${account}\0${pseud ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ account, pseud });
	}
	return out;
}

/**
 * Rewrite one work's author rows + its authors_fts search row (Part B).
 * work_authors is INGEST-OWNED (rows only ever come from parsing), so unlike
 * work_tags this is a full, unscoped delete+rewrite. Statements are plain
 * (not a transaction) so the ingest write transactions can call this inline
 * — same contract as syncWorkSeries.
 *
 * authors_fts is maintained HERE (the single writer of work_authors) rather
 * than by triggers: the table is one aggregated row per work over multi-row
 * source data, so delete-then-reinsert in code is clearer than per-row
 * trigger programs. purgeWork deletes the search row on hard delete.
 */
export function syncWorkAuthors(db: Database, workId: string, authors: WorkAuthor[]): void {
	db.prepare(`DELETE FROM work_authors WHERE work_id = ?`).run(workId);
	const insert = db.prepare(
		`INSERT INTO work_authors (work_id, position, account, pseud) VALUES (?, ?, ?, ?)`
	);
	authors.forEach((a, i) => insert.run(workId, i, a.account, a.pseud));

	// Search row: every account + pseud token, byline-ordered (matches the
	// 0022 migration's one-shot population shape).
	db.prepare(`DELETE FROM authors_fts WHERE work_id = ?`).run(workId);
	if (authors.length > 0) {
		const names = authors
			.map((a) => (a.pseud && a.pseud !== a.account ? `${a.account} ${a.pseud}` : a.account))
			.join(' ');
		db.prepare(`INSERT INTO authors_fts (work_id, names) VALUES (?, ?)`).run(workId, names);
	}
}

// ─── Author links (2026-11-07): one writer, two bylines ──────────────────
//
// FicHub EPUBs carry the author only as plain text in the preface
// (`<b>By: …</b>`), never as a /users/ link, so the parser above finds
// nothing and the work falls back to the raw works.author string. Two cases:
//
//  - FicHub export OF AN AO3 FIC (source 'fichub-ao3'): the text is AO3's
//    own display form, "pseud (account)" or a bare account. AO3 account
//    names are letters/digits/underscores only, so the trailing "(…)" is
//    unambiguous → parseFichubByline gives real {account, pseud} rows, the
//    same identity an AO3 download would have.
//  - Any other site (FanFiction.net …): the name lives on another site, so
//    joining it to an AO3 account is a judgment call. The author_links
//    table (0030) holds it — auto when the name matches exactly one AO3
//    account (case-insensitive, spaces = underscores), or manual from the
//    author page — and linked works get derived rows
//    {account, pseud: <raw name>} so every surface groups them under the
//    account without a query change.

/** The source values whose byline identity is PARSED, never linked. */
const PARSED_SOURCES = `('ao3', 'fichub-ao3')`;

/** AO3 account names: letters, digits, underscores. */
const AO3_ACCOUNT = /^[A-Za-z0-9_]+$/;

/**
 * Byline of a FicHub export of an AO3 work, from its preface
 * (`<b>By: Rhino (RhinoMouse)</b>`). Returns [] whenever the text isn't
 * clearly ONE author — anonymous, several authors, or a shape we can't read
 * with confidence — so those keep today's raw-name fallback.
 */
export function parseFichubByline(prefaceHtml: string): WorkAuthor[] {
	const m = /<b>\s*By:\s*([\s\S]*?)<\/b>/i.exec(prefaceHtml);
	if (!m) return [];
	const text = decodeEntities(m[1].replace(/<[^>]*>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
	if (!text || /^anonymous$/i.test(text)) return [];

	const withPseud = /^(.+) \(([A-Za-z0-9_]+)\)$/.exec(text);
	if (withPseud) {
		const pseud = withPseud[1].trim();
		// Another "(account)" or a comma inside the pseud part means a
		// co-authored byline ("A (a), B (b)") — don't guess.
		if (/\([A-Za-z0-9_]+\)/.test(pseud) || pseud.includes(', ')) return [];
		return [{ account: withPseud[2], pseud }];
	}
	return AO3_ACCOUNT.test(text) ? [{ account: text, pseud: null }] : [];
}

/** Comparison form for auto-matching: case-insensitive, spaces = underscores. */
export function normalizeAuthorName(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, '_');
}

type LinkRow = { alias: string; account: string; kind: 'auto' | 'manual' | 'blocked' };

/**
 * The derived byline rows for a LINKABLE work (any source outside
 * PARSED_SOURCES) whose raw byline is `rawAuthor`: one row on the linked
 * account, carrying the raw name as its pseud (so the byline reads
 * "Tsume Yuki (Tsume_Yuki)" and the account page shows it as a pseud pill;
 * an identical name collapses to plain "Trin303"). [] when unlinked.
 */
export function linkedWorkAuthors(db: Database, rawAuthor: string): WorkAuthor[] {
	const link = db
		.prepare(`SELECT account FROM author_links WHERE alias = ? AND kind <> 'blocked'`)
		.get(rawAuthor) as { account: string } | undefined;
	return link ? [{ account: link.account, pseud: rawAuthor }] : [];
}

/**
 * Move an author key's favorite / note / author-tags onto another key,
 * COALESCE-merging into an existing row (the target's own values win).
 * Plain statements — callers run it inside their transaction.
 */
export function rekeyAuthor(db: Database, oldName: string, newName: string): boolean {
	if (oldName === newName) return false;
	const row = db.prepare(`SELECT favorited_at, notes FROM authors WHERE name = ?`).get(oldName) as
		| { favorited_at: string | null; notes: string | null }
		| undefined;
	if (!row) return false;
	const tagIds = (
		db.prepare(`SELECT author_tag_id FROM author_tag_links WHERE author_name = ?`).all(oldName) as {
			author_tag_id: number;
		}[]
	).map((r) => r.author_tag_id);
	db.prepare(`DELETE FROM authors WHERE name = ?`).run(oldName); // FK-cascades its tag links
	db.prepare(
		`INSERT INTO authors (name, favorited_at, notes) VALUES (?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET
		   favorited_at = COALESCE(authors.favorited_at, excluded.favorited_at),
		   notes = COALESCE(authors.notes, excluded.notes)`
	).run(newName, row.favorited_at, row.notes);
	const relink = db.prepare(
		`INSERT INTO author_tag_links (author_name, author_tag_id) VALUES (?, ?)
		 ON CONFLICT(author_name, author_tag_id) DO NOTHING`
	);
	for (const id of tagIds) relink.run(newName, id);
	return true;
}

/**
 * Bring author_links and the derived work_authors rows up to date. Runs at
 * boot (after the parse backfill) and after every ingest; idempotent and
 * cheap (it only looks at linkable works, a few dozen today).
 *
 *  1. Drop `auto` links whose account no longer has any parsed AO3 work
 *     (the AO3 fics were purged) — those names go back to their own page.
 *  2. Add an `auto` link for every linkable name with no link row yet that
 *     matches EXACTLY ONE parsed AO3 account. Zero or several → nothing.
 *     `manual` and `blocked` rows are never touched here.
 *  3. Rewrite each linkable work's rows when they differ from what its link
 *     says (syncWorkAuthors also keeps authors_fts in step).
 *  4. Move a now-linked name's favorite / note / tags onto the account.
 *
 * Trashed works are included throughout (they can be restored).
 */
export function refreshAuthorLinks(db: Database): {
	added: number;
	dropped: number;
	rewritten: number;
} {
	const accounts = db
		.prepare(
			`SELECT DISTINCT wa.account FROM work_authors wa
			   JOIN works w ON w.id = wa.work_id
			  WHERE w.source IN ${PARSED_SOURCES}`
		)
		.all() as { account: string }[];
	const accountSet = new Set(accounts.map((a) => a.account));
	const byNorm = new Map<string, string[]>();
	for (const { account } of accounts) {
		const key = normalizeAuthorName(account);
		byNorm.set(key, [...(byNorm.get(key) ?? []), account]);
	}

	const linkable = db
		.prepare(
			`SELECT id, author FROM works
			  WHERE source IS NULL OR source NOT IN ${PARSED_SOURCES}`
		)
		.all() as { id: string; author: string }[];
	const names = new Set(linkable.map((w) => w.author));

	let added = 0;
	let dropped = 0;
	let rewritten = 0;
	db.transaction(() => {
		const links = new Map(
			(db.prepare(`SELECT alias, account, kind FROM author_links`).all() as LinkRow[]).map((l) => [
				l.alias,
				l
			])
		);

		for (const link of links.values()) {
			if (link.kind === 'auto' && !accountSet.has(link.account)) {
				db.prepare(`DELETE FROM author_links WHERE alias = ?`).run(link.alias);
				links.delete(link.alias);
				dropped += 1;
			}
		}

		const insertAuto = db.prepare(
			`INSERT INTO author_links (alias, account, kind) VALUES (?, ?, 'auto')`
		);
		for (const name of names) {
			if (links.has(name)) continue;
			const matches = byNorm.get(normalizeAuthorName(name)) ?? [];
			if (matches.length !== 1) continue;
			insertAuto.run(name, matches[0]);
			links.set(name, { alias: name, account: matches[0], kind: 'auto' });
			added += 1;
		}

		// No chains: a link whose target was itself linked away (manual A→B,
		// then B auto-linked to an AO3 account) follows it to the end.
		const repoint = db.prepare(`UPDATE author_links SET account = ? WHERE alias = ?`);
		for (const link of links.values()) {
			if (link.kind === 'blocked') continue;
			let end = link.account;
			for (let hops = 0; hops < 10; hops += 1) {
				const next = links.get(end);
				if (!next || next.kind === 'blocked' || next.account === end) break;
				end = next.account;
			}
			if (end !== link.account && end !== link.alias) {
				repoint.run(end, link.alias);
				link.account = end;
			}
		}

		const rowsOf = db.prepare(
			`SELECT account, pseud FROM work_authors WHERE work_id = ? ORDER BY position`
		);
		for (const w of linkable) {
			const link = links.get(w.author);
			const want: WorkAuthor[] =
				link && link.kind !== 'blocked' ? [{ account: link.account, pseud: w.author }] : [];
			const have = rowsOf.all(w.id) as WorkAuthor[];
			if (JSON.stringify(have) !== JSON.stringify(want)) {
				syncWorkAuthors(db, w.id, want);
				rewritten += 1;
			}
		}

		for (const link of links.values()) {
			if (link.kind !== 'blocked') rekeyAuthor(db, link.alias, link.account);
		}
	})();

	if (added || dropped || rewritten) {
		console.log(
			`[author-links] ${added} auto-linked, ${dropped} auto links dropped, ${rewritten} works updated`
		);
	}
	return { added, dropped, rewritten };
}

/**
 * Can a link be made FROM this author key ("Same author as…")? Only a raw
 * name of linkable (non-AO3) works that isn't already linked away and isn't
 * itself a parsed AO3 account (an account page is a link TARGET; same-name
 * FicHub works already share its page). Other names linked ONTO it don't
 * matter — they follow it if it moves.
 */
export function isLinkableName(db: Database, name: string): boolean {
	const onLinkableWork =
		db
			.prepare(
				`SELECT 1 FROM works
				  WHERE author = ? AND (source IS NULL OR source NOT IN ${PARSED_SOURCES})
				  LIMIT 1`
			)
			.get(name) !== undefined;
	if (!onLinkableWork) return false;
	const parsedAccount =
		db
			.prepare(
				`SELECT 1 FROM work_authors wa JOIN works w ON w.id = wa.work_id
				  WHERE wa.account = ? AND w.source IN ${PARSED_SOURCES}
				  LIMIT 1`
			)
			.get(name) !== undefined;
	const linkedAway =
		db.prepare(`SELECT 1 FROM author_links WHERE alias = ? AND kind <> 'blocked'`).get(name) !==
		undefined;
	return !parsedAccount && !linkedAway;
}

/**
 * Manual link (author page "Same author as…"): `alias` joins `target`.
 * Throws a plain Error with a user-facing message on a bad pair. Links that
 * pointed AT the alias follow it to the target, so nothing is left behind
 * on a page that no longer exists (no chains).
 */
export function linkAuthor(db: Database, alias: string, target: string): void {
	if (alias === target) throw new Error("can't link an author to itself");
	if (!isLinkableName(db, alias)) throw new Error('only FicHub authors can be linked');
	const active = db
		.prepare(`SELECT account FROM author_links WHERE alias = ? AND kind <> 'blocked'`)
		.get(alias) as { account: string } | undefined;
	if (active) throw new Error(`already linked to ${active.account}`);
	if (!authorKeyExists(db, target)) throw new Error('no such author');
	const targetLinked = db
		.prepare(`SELECT 1 FROM author_links WHERE alias = ? AND kind <> 'blocked'`)
		.get(target);
	if (targetLinked) throw new Error('that author is itself linked to someone else');

	db.transaction(() => {
		db.prepare(
			`INSERT INTO author_links (alias, account, kind) VALUES (?, ?, 'manual')
			 ON CONFLICT(alias) DO UPDATE SET account = excluded.account, kind = 'manual',
			   created_at = CURRENT_TIMESTAMP`
		).run(alias, target);
		db.prepare(`UPDATE author_links SET account = ? WHERE account = ? AND kind <> 'blocked'`).run(
			target,
			alias
		);
	})();
	refreshAuthorLinks(db);
}

/**
 * Unlink `alias` from `account` (the account page's "Unlink"). Marks it
 * blocked so the auto pass never re-links it; its works go back to their
 * own author page. Favorites/notes/tags stay with the account.
 */
export function unlinkAuthor(db: Database, account: string, alias: string): void {
	const link = db.prepare(`SELECT account, kind FROM author_links WHERE alias = ?`).get(alias) as
		| { account: string; kind: string }
		| undefined;
	if (!link || link.kind === 'blocked' || link.account !== account) {
		throw new Error(`${alias} isn't linked to ${account}`);
	}
	db.prepare(`UPDATE author_links SET kind = 'blocked' WHERE alias = ?`).run(alias);
	refreshAuthorLinks(db);
}

/**
 * Names linked onto this author key, for the author page's "Also here as"
 * block: active links whose works are still in the library, with the site
 * they came from. An alias identical to the key is left out (same name,
 * same page either way — there's nothing to unlink).
 */
export function linkedAliases(
	db: Database,
	account: string
): { alias: string; kind: 'auto' | 'manual'; source: string | null; works: number }[] {
	return db
		.prepare(
			`SELECT l.alias AS alias, l.kind AS kind,
			        (SELECT w2.source FROM works w2 WHERE w2.author = l.alias
			          GROUP BY w2.source ORDER BY COUNT(*) DESC LIMIT 1) AS source,
			        (SELECT COUNT(*) FROM works w3
			          WHERE w3.author = l.alias AND w3.trashed_at IS NULL
			            AND (w3.source IS NULL OR w3.source NOT IN ${PARSED_SOURCES})) AS works
			   FROM author_links l
			  WHERE l.account = ? AND l.kind <> 'blocked' AND l.alias <> l.account
			  ORDER BY l.alias COLLATE NOCASE`
		)
		.all(account)
		.filter((r) => (r as { works: number }).works > 0) as {
		alias: string;
		kind: 'auto' | 'manual';
		source: string | null;
		works: number;
	}[];
}

/**
 * Does any work (live or trashed) resolve to this author key? The shared
 * existence guard for the /api/authors/[name]/* endpoints (favorite / note /
 * tags). Part B semantics: an author key is any account appearing at ANY
 * byline position (co-authors are first-class — each is independently
 * favoritable/notable/taggable), else the raw works.author string for works
 * with no byline rows (non-AO3, Anonymous). Matches the membership clause in
 * /api/works so the guards and the listings can never disagree.
 */
export function authorKeyExists(db: Database, name: string): boolean {
	return (
		db
			.prepare(
				`SELECT 1 FROM works w
				  WHERE EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id AND wa.account = ?)
				     OR (w.author = ? AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id))
				  LIMIT 1`
			)
			.get(name, name) !== undefined
	);
}

/**
 * One-shot (idempotent) startup backfill — the existing library gets pseud/
 * account structure without re-uploads. Same guarded-once shape as
 * backfillSource / backfillDecodeText; wired in db.ts AFTER the text-decode
 * pass (so re-keys see decoded names) and before purge.
 *
 * Phase 1 — work_authors from stored wrappers: every AO3-source work
 * (including trashed — they can be restored) with zero work_authors rows has
 * its stored summary + preface files read and parsed. Second boot inserts 0
 * rows. A work whose byline has no author links (Anonymous) is re-scanned
 * each boot — one cheap file read; harmless, and it means a later restored
 * byline would still be picked up.
 *
 * Phase 2 — author re-key to account keys (the #64 textdecode idiom): the
 * `authors` table (favorites/notes) + `author_tag_links` are keyed by the
 * old raw `works.author` byline strings; author pages now group by the
 * ACCOUNT. Any authors row whose name is some work's raw byline but differs
 * from that work's primary account is re-keyed — favorites, notes, and
 * author-tags all survive (delete cascades the links away AFTER they're
 * captured; COALESCE-merge if the account row already exists). If one legacy
 * name maps to several accounts (byline-string collision), the most common
 * account wins and the choice is logged.
 *
 * `content_hash` is NEVER touched by any phase: works rows aren't written at
 * all, and ingest keeps hashing the raw title/author byline (#64) — the 🔴
 * hash-from-raw guarantee is structural here.
 */
export function backfillAuthorIdentity(db: Database): void {
	// ── Phase 1: work_authors rows from stored wrapper files ──
	// FicHub exports of AO3 fics (author links, 2026-11-07) get their byline
	// from the preface's plain-text "By:" line instead of /users/ links.
	const candidates = db
		.prepare(
			`SELECT w.id, w.source FROM works w
			  WHERE w.source IN ${PARSED_SOURCES}
			    AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id)`
		)
		.all() as { id: string; source: string }[];

	const wrapperStmt = db.prepare(
		`SELECT content_path FROM chapters
		  WHERE work_id = ? AND kind IN ('summary', 'preface')
		  ORDER BY CASE kind WHEN 'summary' THEN 0 ELSE 1 END`
	);

	let filled = 0;
	for (const work of candidates) {
		try {
			let html = '';
			for (const row of wrapperStmt.all(work.id) as { content_path: string }[]) {
				try {
					html += readFileSync(row.content_path, 'utf8');
				} catch {
					/* missing wrapper file — skip it, parse what we have */
				}
			}
			const authors =
				work.source === 'fichub-ao3' ? parseFichubByline(html) : extractWorkAuthors(html);
			if (authors.length > 0) {
				syncWorkAuthors(db, work.id, authors);
				filled += 1;
			}
		} catch (e) {
			console.error(`[author-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
	}

	// ── Phase 1b: author links for non-AO3 works (needs Phase 1's accounts) ──
	try {
		refreshAuthorLinks(db);
	} catch (e) {
		console.error('[author-links] refresh failed', e);
	}

	// ── Phase 2: re-key authors rows (favorites/notes/tags) to account keys ──
	// One row per (legacy byline name, primary account) pair where they
	// differ; COUNT ranks collision candidates so the most common account
	// wins deterministically.
	const rekeys = db
		.prepare(
			`SELECT a.name AS old_name, wa.account AS new_name, COUNT(*) AS n
			   FROM authors a
			   JOIN works w ON w.author = a.name
			   JOIN work_authors wa ON wa.work_id = w.id AND wa.position = 0
			  WHERE wa.account <> a.name
			  GROUP BY a.name, wa.account
			  ORDER BY a.name, n DESC`
		)
		.all() as { old_name: string; new_name: string; n: number }[];

	// rekeyAuthor no-ops when the old row is already gone (collision case
	// handled first).
	const rekeyTx = db.transaction((oldName: string, newName: string) =>
		rekeyAuthor(db, oldName, newName)
	);

	let rekeyed = 0;
	const done = new Set<string>();
	for (const r of rekeys) {
		if (done.has(r.old_name)) {
			console.log(
				`[author-backfill] byline "${r.old_name}" also maps to account "${r.new_name}" (${r.n} works) — kept the more common mapping`
			);
			continue;
		}
		done.add(r.old_name);
		rekeyTx(r.old_name, r.new_name);
		rekeyed += 1;
	}

	if (filled > 0 || rekeyed > 0) {
		console.log(`[author-backfill] ${filled} works linked, ${rekeyed} authors re-keyed`);
	} else {
		console.log('[author-backfill] 0 works');
	}
}
