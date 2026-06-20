import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { extractCanonicalAo3Url } from './epub';

/**
 * M2.3 Step 2 — content identity for dedup.
 *
 * `content_hash` is a sha256 over **normalized parsed content**, NOT the
 * raw EPUB bytes. The hash input is:
 *
 *   title.trim()  \0  author.trim()  \0  ch1Html \0 ch2Html \0 … chNHtml
 *
 * where the chapters are the REAL chapters only (`kind === 'chapter'`),
 * in ascending `number` order, each with its per-work image-URL prefix
 * normalized out (see below). NUL (`\0`) separators can't appear in the
 * HTML/text, so field boundaries are unambiguous.
 *
 * Why this shape:
 *   - Recomputable from data already on disk (the stored chapter HTML
 *     files) → the existing library can be backfilled without the
 *     original EPUBs.
 *   - Real-chapters-only excludes the preface, whose AO3 stat block
 *     (Words/Chapters/Published/Updated) can shift between downloads of
 *     the same fic — story content is the stable identity.
 *   - Deterministic: the same EPUB always yields the same hash.
 *
 * Image-URL normalization: at ingest, `rewriteImageSrcs` (epub.ts) bakes
 * the work_id into every embedded image src as
 * `/api/works/<workId>/images/<file>`. That id is per-row, so without
 * normalization two uploads of the same image-bearing fic would hash
 * differently. We collapse the per-work prefix back to a stable token
 * before hashing; non-image fics are unaffected.
 */

type HashChapter = { kind: string; number: number; html: string };

function normalizeChapterHtml(html: string, workId: string): string {
	return html.split(`/api/works/${workId}/images/`).join('/__img__/');
}

export function computeContentHash(
	workId: string,
	title: string,
	author: string,
	chapters: HashChapter[]
): string {
	const realChapters = chapters
		.filter((c) => c.kind === 'chapter')
		.sort((a, b) => a.number - b.number);

	const hash = createHash('sha256');
	hash.update(title.trim());
	hash.update('\0');
	hash.update(author.trim());
	for (const ch of realChapters) {
		hash.update('\0');
		hash.update(normalizeChapterHtml(ch.html, workId));
	}
	return hash.digest('hex');
}

/**
 * One-shot startup backfill (M2.3 Step 2). Populates `content_hash` (and
 * `source_url` where extractable) for every pre-existing work that
 * doesn't have a hash yet, recomputing identity from the stored chapter
 * files on disk.
 *
 * `content_hash IS NULL` is the skip-marker: a populated row is never
 * touched, so the pass is idempotent (a clean second boot backfills 0
 * rows) and URL-less fics aren't retried for a URL they don't have.
 *
 * Per-work failures (a missing/unreadable file, say) are logged and
 * skipped so one bad work can't abort the whole pass. Called once per
 * boot from getDb() after migrations; never throws to its caller.
 */
export function backfillIdentity(db: Database): void {
	const works = db
		.prepare(`SELECT id, title, author FROM works WHERE content_hash IS NULL`)
		.all() as { id: string; title: string; author: string }[];

	if (works.length === 0) {
		console.log('[backfill] 0 rows backfilled');
		return;
	}

	const chaptersStmt = db.prepare(
		`SELECT number, kind, content_path FROM chapters WHERE work_id = ?`
	);
	const update = db.prepare(`UPDATE works SET content_hash = ?, source_url = ? WHERE id = ?`);

	let filled = 0;
	let urlless = 0;
	for (const work of works) {
		try {
			const rows = chaptersStmt.all(work.id) as {
				number: number;
				kind: string;
				content_path: string;
			}[];

			const chapters: HashChapter[] = rows.map((r) => ({
				kind: r.kind,
				number: r.number,
				html: readFileSync(r.content_path, 'utf8')
			}));

			const contentHash = computeContentHash(work.id, work.title, work.author, chapters);

			const prefaceRow = rows.find((r) => r.kind === 'preface');
			const prefaceHtml = prefaceRow ? readFileSync(prefaceRow.content_path, 'utf8') : '';
			const sourceUrl = extractCanonicalAo3Url(prefaceHtml);
			if (!sourceUrl) urlless += 1;

			update.run(contentHash, sourceUrl, work.id);
			filled += 1;
		} catch (e) {
			console.error(
				`[backfill] skip ${work.id}:`,
				e instanceof Error ? e.message : e
			);
		}
	}

	console.log(
		`[backfill] ${filled} rows backfilled` +
			(urlless > 0 ? ` (${urlless} without an AO3 URL — content_hash only)` : '')
	);
}
