import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';

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
 * Anchors are matched attribute-order-agnostically: any `<a …>` tag carrying
 * `rel="author"` contributes its href's `/users/{account}(/pseuds/{pseud})?`
 * path segments. Duplicate (account, pseud) pairs collapse to the first
 * occurrence so a byline repeated across the summary + preface wrappers
 * yields one row per author.
 */
export function extractWorkAuthors(html: string): WorkAuthor[] {
	const out: WorkAuthor[] = [];
	const seen = new Set<string>();
	for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
		const attrs = tag[0];
		if (!/\brel\s*=\s*["']author["']/i.test(attrs)) continue;
		const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
		if (!href) continue;
		const m = /\/users\/([^/?"#]+)(?:\/pseuds\/([^/?"#]+))?/.exec(href);
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
 * Rewrite one work's author rows. work_authors is INGEST-OWNED (rows only
 * ever come from parsing), so unlike work_tags this is a full, unscoped
 * delete+rewrite. Statements are plain (not a transaction) so the ingest
 * write transactions can call this inline — same contract as syncWorkSeries.
 */
export function syncWorkAuthors(db: Database, workId: string, authors: WorkAuthor[]): void {
	db.prepare(`DELETE FROM work_authors WHERE work_id = ?`).run(workId);
	const insert = db.prepare(
		`INSERT INTO work_authors (work_id, position, account, pseud) VALUES (?, ?, ?, ?)`
	);
	authors.forEach((a, i) => insert.run(workId, i, a.account, a.pseud));
}

/**
 * Does any work (live or trashed) resolve to this author key? The shared
 * existence guard for the /api/authors/[name]/* endpoints (favorite / note /
 * tags), all keyed on the EFFECTIVE author key: the parsed primary account
 * when the work has byline rows, else the raw works.author string. Matches
 * the AUTHOR_KEY expression in /api/works so the guards and the listing can
 * never disagree.
 */
export function authorKeyExists(db: Database, name: string): boolean {
	return (
		db
			.prepare(
				`SELECT 1 FROM works w
				  WHERE COALESCE(
				    (SELECT wa.account FROM work_authors wa WHERE wa.work_id = w.id AND wa.position = 0),
				    w.author
				  ) = ? LIMIT 1`
			)
			.get(name) !== undefined
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
	const candidates = db
		.prepare(
			`SELECT w.id FROM works w
			  WHERE w.source = 'ao3'
			    AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id)`
		)
		.all() as { id: string }[];

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
			const authors = extractWorkAuthors(html);
			if (authors.length > 0) {
				syncWorkAuthors(db, work.id, authors);
				filled += 1;
			}
		} catch (e) {
			console.error(`[author-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
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

	const linksOf = db.prepare(`SELECT author_tag_id FROM author_tag_links WHERE author_name = ?`);
	const readAuthor = db.prepare(`SELECT favorited_at, notes FROM authors WHERE name = ?`);
	const delAuthor = db.prepare(`DELETE FROM authors WHERE name = ?`);
	const upsertAuthor = db.prepare(
		`INSERT INTO authors (name, favorited_at, notes) VALUES (?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET
		   favorited_at = COALESCE(authors.favorited_at, excluded.favorited_at),
		   notes = COALESCE(authors.notes, excluded.notes)`
	);
	const relink = db.prepare(
		`INSERT INTO author_tag_links (author_name, author_tag_id) VALUES (?, ?)
		 ON CONFLICT(author_name, author_tag_id) DO NOTHING`
	);
	const rekeyTx = db.transaction((oldName: string, newName: string) => {
		const row = readAuthor.get(oldName) as
			| { favorited_at: string | null; notes: string | null }
			| undefined;
		if (!row) return; // already re-keyed (collision case handled first)
		const tagIds = (linksOf.all(oldName) as { author_tag_id: number }[]).map(
			(r) => r.author_tag_id
		);
		delAuthor.run(oldName); // FK-cascades its author_tag_links away
		upsertAuthor.run(newName, row.favorited_at, row.notes);
		for (const id of tagIds) relink.run(newName, id);
	});

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
