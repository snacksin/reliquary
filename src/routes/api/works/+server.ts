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

/** Allowed per-page values. Anything else clamps to the default. */
const ALLOWED_PER_PAGE = new Set([10, 12, 15]);
const DEFAULT_PER_PAGE = 12;

function parsePage(raw: string | null): number {
	if (!raw) return 1;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePerPage(raw: string | null): number {
	if (!raw) return DEFAULT_PER_PAGE;
	const n = Number.parseInt(raw, 10);
	return ALLOWED_PER_PAGE.has(n) ? n : DEFAULT_PER_PAGE;
}

/** Map a DB row into the public-API work shape. */
function rowToWork(r: Row) {
	return {
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
	};
}

/**
 * The SELECT columns shared by all variants of the works listing —
 * keeps the page/total query symmetric so a future refactor doesn't
 * accidentally drift their projections apart.
 */
const SELECT_COLUMNS = `
  w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
  w.favorited_at,
  rp.last_chapter, rp.last_scroll_y,
  rp.updated_at AS last_updated_at
`;

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();
	const tagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAll = parseMatchAll(url.searchParams.get('match_all'));
	const paginate = url.searchParams.get('paginate') !== 'false';
	const page = parsePage(url.searchParams.get('page'));
	const perPage = parsePerPage(url.searchParams.get('per_page'));

	// Filter pipeline: same CTE-based shape as Step 5.5. Empty filter
	// short-circuits to a non-CTE query for clarity (this is the most
	// common code path — every bare /api/works call hits it).
	let baseSql: string;
	let baseParams: unknown[];

	if (tagIds.length === 0) {
		baseSql = `
			FROM works w
			LEFT JOIN reading_progress rp ON rp.work_id = w.id
		`;
		baseParams = [];
	} else {
		// Tag filter. OR-within / AND-within per category (via
		// match_all_cats) / AND-across categories. See Step 5.5's
		// detailed comment for the pipeline rationale.
		const tagJson = JSON.stringify(tagIds);
		const matchAllJson = JSON.stringify(matchAll);
		baseSql = `
			FROM works w
			LEFT JOIN reading_progress rp ON rp.work_id = w.id
			WHERE w.id IN (
			  WITH
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
			  SELECT wm.work_id
			  FROM work_matches wm
			  JOIN required_per_cat r ON r.category = wm.category
			  WHERE wm.matched >= r.required
			  GROUP BY wm.work_id
			  HAVING COUNT(DISTINCT wm.category) = (SELECT COUNT(*) FROM required_per_cat)
			)
		`;
		baseParams = [tagJson, matchAllJson];
	}

	// `paginate=false` returns the flat array — used by the library
	// page's Continue Reading + Favorites lists, which derive their
	// subsets from the full unfiltered set client-side and can't be
	// sliced to a page. Default path returns the new paginated shape
	// with metadata.
	if (!paginate) {
		const rows = db
			.prepare(`SELECT ${SELECT_COLUMNS} ${baseSql} ORDER BY w.ingested_at DESC`)
			.all(...baseParams) as Row[];
		return json(rows.map(rowToWork));
	}

	// Total first (cheap with the same WHERE), then the LIMIT/OFFSET
	// slice. Two prepared statements share `baseParams`. Clamp the
	// requested page to the actual page range so a stale URL after a
	// delete doesn't 404 — instead it returns the last page.
	const totalRow = db
		.prepare(`SELECT COUNT(*) AS n ${baseSql}`)
		.get(...baseParams) as { n: number };
	const total = totalRow.n;
	const totalPages = Math.max(1, Math.ceil(total / perPage));
	const clampedPage = Math.min(page, totalPages);
	const offset = (clampedPage - 1) * perPage;

	const rows = db
		.prepare(
			`SELECT ${SELECT_COLUMNS} ${baseSql} ORDER BY w.ingested_at DESC LIMIT ? OFFSET ?`
		)
		.all(...baseParams, perPage, offset) as Row[];

	return json({
		works: rows.map(rowToWork),
		page: clampedPage,
		per_page: perPage,
		total,
		total_pages: totalPages
	});
};
