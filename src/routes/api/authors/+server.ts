import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/authors` — every distinct author with ≥1 non-trashed work,
 * plus their non-trashed work count and manual-favorite flag. Sorted by
 * work count DESC, name ASC (case-insensitive) tiebreak. Powers the
 * /authors index.
 *
 * Author Identity Part A→B: "author" is the EFFECTIVE key — any ACCOUNT
 * appearing at any byline position (Part B: a co-authored work counts on
 * EVERY co-author's entry), else the raw `works.author` string (non-AO3,
 * Anonymous). Same membership shape as the author scopes in /api/works
 * and /api/tags. A pseud-authored fic and an unpseuded fic by the same
 * account group into one index entry.
 *
 * Trashed works are excluded from both membership and the count.
 *
 * Author Pages Part 2: optional `?author_tags=1,2` narrows the list to
 * authors carrying ALL of the given author-tag ids (intersection). This
 * filter lives only on the /authors index. Malformed / unknown ids are
 * dropped; an all-invalid list behaves as no filter.
 */
type Row = { name: string; work_count: number; favorited_at: string | null };

function parseTagIds(raw: string | null): number[] {
	if (!raw) return [];
	const ids = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isInteger(n) && n > 0) ids.add(n);
	}
	return [...ids];
}

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();

	// Intersection guard: only authors linked to every selected tag survive.
	// `HAVING COUNT(DISTINCT …) = n` over the filtered links enforces ALL.
	const tagIds = parseTagIds(url.searchParams.get('author_tags'));
	let tagClause = '';
	const params: unknown[] = [];
	if (tagIds.length > 0) {
		const placeholders = tagIds.map(() => '?').join(', ');
		tagClause = `
			  AND author_key IN (
			    SELECT author_name FROM author_tag_links
			     WHERE author_tag_id IN (${placeholders})
			     GROUP BY author_name
			    HAVING COUNT(DISTINCT author_tag_id) = ?
			  )`;
		params.push(...tagIds, tagIds.length);
	}

	// Part B membership: the inner derived table yields one (author_key,
	// work) pair per author PER WORK — a co-authored work contributes to
	// every co-author's entry (intended, controlled fan-out; DISTINCT
	// collapses a work whose byline lists two pseuds of ONE account to a
	// single pair). Works with no byline rows fall back to the raw
	// works.author string; the two branches are disjoint by construction,
	// so UNION ALL is safe.
	const rows = db
		.prepare(
			`SELECT author_key AS name, COUNT(*) AS work_count, a.favorited_at AS favorited_at
			   FROM (
			     SELECT DISTINCT wa.account AS author_key, w.id AS work_id
			       FROM works w
			       JOIN work_authors wa ON wa.work_id = w.id
			      WHERE w.trashed_at IS NULL
			     UNION ALL
			     SELECT w.author AS author_key, w.id AS work_id
			       FROM works w
			      WHERE w.trashed_at IS NULL
			        AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id)
			   )
			   LEFT JOIN authors a ON a.name = author_key
			  WHERE 1=1${tagClause}
			  GROUP BY author_key
			  ORDER BY work_count DESC, author_key COLLATE NOCASE ASC`
		)
		.all(...params) as Row[];

	return json(
		rows.map((r) => ({
			name: r.name,
			work_count: r.work_count,
			is_favorite: r.favorited_at !== null,
			favorited_at: r.favorited_at
		}))
	);
};
