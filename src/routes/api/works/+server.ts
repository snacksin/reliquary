import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

type Row = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	favorited_at: string | null;
	last_chapter: number | null;
	last_scroll_y: number | null;
	last_updated_at: string | null;
};

/**
 * Parse the `tags` query param: a comma-separated list of tag IDs.
 * Untrusted client input — coerce to positive integers and drop
 * anything that doesn't parse. Returns [] for missing/empty/all-bogus
 * inputs, which the caller treats as "no tag filter".
 */
function parseTagIds(raw: string | null): number[] {
	if (!raw) return [];
	const ids = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isFinite(n) && n > 0) ids.add(n);
	}
	return [...ids];
}

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();
	const tagIds = parseTagIds(url.searchParams.get('tags'));

	let rows: Row[];

	if (tagIds.length === 0) {
		rows = db
			.prepare(
				`SELECT
				   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
				   w.favorited_at,
				   rp.last_chapter, rp.last_scroll_y,
				   rp.updated_at AS last_updated_at
				 FROM works w
				 LEFT JOIN reading_progress rp ON rp.work_id = w.id
				 ORDER BY w.ingested_at DESC`
			)
			.all() as Row[];
	} else {
		// Tag filter: OR within a category, AND across categories.
		// The subquery selects work_ids that match at least one of the
		// requested tags, grouped per work; the HAVING clause requires
		// each kept work covers as many distinct categories as the
		// request spans. Example: if the request is {fandom: [A, B],
		// freeform: [X]}, the request spans 2 distinct categories; a
		// work must have at least one fandom in {A, B} AND at least
		// one freeform in {X} to survive.
		//
		// Tag-ID list passed twice via json_each so we don't have to
		// build a dynamic IN (?, ?, ?) clause. JSON parameter is
		// stringified once and reused by reference.
		const tagJson = JSON.stringify(tagIds);
		rows = db
			.prepare(
				`SELECT
				   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
				   w.favorited_at,
				   rp.last_chapter, rp.last_scroll_y,
				   rp.updated_at AS last_updated_at
				 FROM works w
				 LEFT JOIN reading_progress rp ON rp.work_id = w.id
				 WHERE w.id IN (
				   SELECT wt.work_id
				   FROM work_tags wt
				   JOIN tags t ON t.id = wt.tag_id
				   WHERE wt.tag_id IN (SELECT value FROM json_each(?))
				   GROUP BY wt.work_id
				   HAVING COUNT(DISTINCT t.category) = (
				     SELECT COUNT(DISTINCT category) FROM tags
				     WHERE id IN (SELECT value FROM json_each(?))
				   )
				 )
				 ORDER BY w.ingested_at DESC`
			)
			.all(tagJson, tagJson) as Row[];
	}

	return json(
		rows.map((r) => ({
			id: r.id,
			title: r.title,
			author: r.author,
			summary: r.summary,
			chapter_count: r.chapter_count,
			word_count: r.word_count,
			is_favorite: r.favorited_at !== null,
			favorited_at: r.favorited_at,
			// `updated_at` ships with last_read so the Continue Reading
			// carousel can sort by reading recency (not upload order)
			// without an extra round-trip — symmetric to how Favorites
			// uses works.favorited_at.
			last_read:
				r.last_chapter !== null && r.last_scroll_y !== null && r.last_updated_at !== null
					? {
							chapter: r.last_chapter,
							scroll_y: r.last_scroll_y,
							updated_at: r.last_updated_at
						}
					: null
		}))
	);
};
