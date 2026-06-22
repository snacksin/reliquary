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
 */
type Row = { name: string; work_count: number; favorited_at: string | null };

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT w.author AS name, COUNT(*) AS work_count, a.favorited_at AS favorited_at
			   FROM works w
			   LEFT JOIN authors a ON a.name = w.author
			  WHERE w.trashed_at IS NULL
			  GROUP BY w.author
			  ORDER BY work_count DESC, w.author COLLATE NOCASE ASC`
		)
		.all() as Row[];

	return json(
		rows.map((r) => ({
			name: r.name,
			work_count: r.work_count,
			is_favorite: r.favorited_at !== null,
			favorited_at: r.favorited_at
		}))
	);
};
