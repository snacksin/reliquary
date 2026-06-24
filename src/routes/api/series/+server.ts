import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/series` — every series you own ≥1 non-trashed part of, with its
 * part count, favorite flag, and hide flag (Series Pages Part 2). Powers the
 * /series index. Hidden series ARE included (with the flag) so the client can
 * filter + sort without a refetch — same client-side approach as the /authors
 * favorites grouping. A series whose every part is trashed drops out, mirroring
 * the /api/authors membership rule.
 */
type Row = {
	id: number;
	name: string;
	ao3_series_url: string | null;
	part_count: number;
	favorited_at: string | null;
	hidden_from_index: number;
};

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.id, s.name, s.ao3_series_url, s.favorited_at, s.hidden_from_index,
			        COUNT(sw.work_id) AS part_count
			   FROM series s
			   JOIN series_works sw ON sw.series_id = s.id
			   JOIN works w ON w.id = sw.work_id AND w.trashed_at IS NULL
			  GROUP BY s.id
			 HAVING part_count > 0
			  ORDER BY s.name COLLATE NOCASE ASC`
		)
		.all() as Row[];

	return json(
		rows.map((r) => ({
			id: r.id,
			name: r.name,
			ao3_series_url: r.ao3_series_url,
			part_count: r.part_count,
			is_favorite: r.favorited_at !== null,
			favorited_at: r.favorited_at,
			hidden_from_index: r.hidden_from_index === 1
		}))
	);
};
