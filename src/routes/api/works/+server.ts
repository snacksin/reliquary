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

/**
 * Recognized tag categories. Mirrors the TagCategory type in
 * src/lib/server/epub.ts; kept duplicated as a `Set` lookup here so
 * the endpoint can reject unknown category names from the query
 * param without importing the server-only epub module.
 */
const KNOWN_CATEGORIES = new Set<string>([
	'rating',
	'warning',
	'category',
	'fandom',
	'relationship',
	'character',
	'freeform'
]);

/**
 * Parse the `match_all` query param: comma-separated category names
 * that should use AND-within semantics (all selected tags in that
 * category must be present) instead of the default OR-within. Drops
 * unknown names, lowercases, dedupes.
 */
function parseMatchAll(raw: string | null): string[] {
	if (!raw) return [];
	const cats = new Set<string>();
	for (const token of raw.split(',')) {
		const c = token.trim().toLowerCase();
		if (KNOWN_CATEGORIES.has(c)) cats.add(c);
	}
	return [...cats];
}

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();
	const tagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAll = parseMatchAll(url.searchParams.get('match_all'));

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
		// Tag filter. Per-category mode is OR by default (any selected
		// tag matches), or AND when that category is in `match_all`
		// (every selected tag in that category must be present on the
		// work). Across categories: always AND.
		//
		// The CTE pipeline:
		//   filter_tags     — selected tag IDs (json_each)
		//   match_all_cats  — category names in AND-within mode (json_each)
		//   required_per_cat — for each category in the selection,
		//                     how many selected tags must a work match?
		//                     AND-mode → COUNT(*); OR-mode → 1.
		//   work_matches    — for each (work, category) pair, how many
		//                     distinct selected tags the work has.
		//
		// A work passes iff for every required category, its match
		// count meets the per-category requirement (WHERE matched >=
		// required), and it touches every required category (the
		// COUNT(DISTINCT category) HAVING clause).
		//
		// Empty match_all keeps the OR-everywhere behavior — match_all_cats
		// returns 0 rows, the CASE falls through to ELSE 1, and the
		// query reduces to Step 5's filter exactly.
		const tagJson = JSON.stringify(tagIds);
		const matchAllJson = JSON.stringify(matchAll);
		rows = db
			.prepare(
				`WITH
				   filter_tags AS (SELECT value AS tag_id FROM json_each(?)),
				   match_all_cats AS (SELECT value AS category FROM json_each(?)),
				   required_per_cat AS (
				     SELECT t.category,
				       CASE WHEN t.category IN (SELECT category FROM match_all_cats)
				         THEN COUNT(*)
				         ELSE 1
				       END AS required
				     FROM filter_tags ft
				     JOIN tags t ON t.id = ft.tag_id
				     GROUP BY t.category
				   ),
				   work_matches AS (
				     SELECT wt.work_id, t.category,
				            COUNT(DISTINCT wt.tag_id) AS matched
				     FROM work_tags wt
				     JOIN tags t ON t.id = wt.tag_id
				     WHERE wt.tag_id IN (SELECT tag_id FROM filter_tags)
				     GROUP BY wt.work_id, t.category
				   )
				 SELECT
				   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
				   w.favorited_at,
				   rp.last_chapter, rp.last_scroll_y,
				   rp.updated_at AS last_updated_at
				 FROM works w
				 LEFT JOIN reading_progress rp ON rp.work_id = w.id
				 WHERE w.id IN (
				   SELECT wm.work_id
				   FROM work_matches wm
				   JOIN required_per_cat r ON r.category = wm.category
				   WHERE wm.matched >= r.required
				   GROUP BY wm.work_id
				   HAVING COUNT(DISTINCT wm.category) = (SELECT COUNT(*) FROM required_per_cat)
				 )
				 ORDER BY w.ingested_at DESC`
			)
			.all(tagJson, matchAllJson) as Row[];
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
