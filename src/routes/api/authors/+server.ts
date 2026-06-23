import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/authors` — every distinct author (exact `works.author`
 * string) with ≥1 non-trashed work, plus their non-trashed work count
 * and manual-favorite flag. Sorted by work count DESC, name ASC
 * (case-insensitive) tiebreak. Powers the /authors index.
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
			  AND w.author IN (
			    SELECT author_name FROM author_tag_links
			     WHERE author_tag_id IN (${placeholders})
			     GROUP BY author_name
			    HAVING COUNT(DISTINCT author_tag_id) = ?
			  )`;
		params.push(...tagIds, tagIds.length);
	}

	const rows = db
		.prepare(
			`SELECT w.author AS name, COUNT(*) AS work_count, a.favorited_at AS favorited_at
			   FROM works w
			   LEFT JOIN authors a ON a.name = w.author
			  WHERE w.trashed_at IS NULL${tagClause}
			  GROUP BY w.author
			  ORDER BY work_count DESC, w.author COLLATE NOCASE ASC`
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
