import type { Database } from 'better-sqlite3';
import { decodeEntities } from './epub';

/**
 * One-shot (idempotent) backfill: decode HTML entities in already-stored
 * `works.title` / `works.author` for the existing library — the companion to
 * decoding at ingest (ingest.ts). Entity-bearing values like "Mistletoe
 * &amp; Holly" were stored verbatim before this change; here they're decoded
 * in place, exactly as new uploads now are.
 *
 * - The `works_fts_update` trigger (0006_search.sql) re-indexes search to the
 *   decoded text automatically on the UPDATE.
 * - `content_hash` is intentionally NOT recomputed: it's keyed on the RAW
 *   title/author for dedup stability (see ingest.ts), so leaving it untouched
 *   keeps every stored hash byte-identical and re-uploads still matching.
 *
 * Candidates are scoped to rows containing `&` (every HTML entity does), so
 * this is a tiny set and the pass is cheap. Decoding an already-decoded string
 * is a no-op (no UPDATE), so it's safe to run on every boot without a
 * skip-marker. Guarded by the caller so it can never block boot.
 */
export function backfillDecodeText(db: Database): void {
	let worksFixed = 0;
	let authorsRekeyed = 0;

	// ── works.title / works.author ──
	const works = db
		.prepare(`SELECT id, title, author FROM works WHERE title LIKE '%&%' OR author LIKE '%&%'`)
		.all() as { id: string; title: string; author: string }[];
	const updateWork = db.prepare(`UPDATE works SET title = ?, author = ? WHERE id = ?`);
	for (const w of works) {
		const title = decodeEntities(w.title);
		const author = decodeEntities(w.author);
		if (title !== w.title || author !== w.author) {
			updateWork.run(title, author, w.id);
			worksFixed += 1;
		}
	}

	// ── authors table re-key ──
	// The `authors` table (favorite / notes) and `author_tag_links` are keyed
	// by the exact author string. Decoding `works.author` above would orphan
	// any state on an entity-named author, so re-key it here. Delete+reinsert
	// keeps the FK (author_tag_links.author_name → authors(name) ON DELETE
	// CASCADE) consistent; tag links are captured first, then re-inserted under
	// the decoded name. ON CONFLICT merges if the decoded name already exists.
	const authors = db
		.prepare(`SELECT name, favorited_at, notes FROM authors WHERE name LIKE '%&%'`)
		.all() as { name: string; favorited_at: string | null; notes: string | null }[];
	const linksOf = db.prepare(`SELECT author_tag_id FROM author_tag_links WHERE author_name = ?`);
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
	const rekey = db.transaction(
		(
			oldName: string,
			newName: string,
			fav: string | null,
			notes: string | null,
			tagIds: number[]
		) => {
			delAuthor.run(oldName); // FK-cascades its author_tag_links away
			upsertAuthor.run(newName, fav, notes);
			for (const id of tagIds) relink.run(newName, id);
		}
	);
	for (const au of authors) {
		const decoded = decodeEntities(au.name);
		if (decoded === au.name) continue;
		const tagIds = (linksOf.all(au.name) as { author_tag_id: number }[]).map(
			(r) => r.author_tag_id
		);
		rekey(au.name, decoded, au.favorited_at, au.notes, tagIds);
		authorsRekeyed += 1;
	}

	if (worksFixed > 0 || authorsRekeyed > 0) {
		console.log(`[text-decode] decoded ${worksFixed} works, re-keyed ${authorsRekeyed} authors`);
	}
}
