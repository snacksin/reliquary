import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/works/[id]/series` — the series this work belongs to, for the
 * preface "Part N of …" section (Series Pages Part 1). Returns the series id +
 * name + this work's position, in position order. Empty array when the work is
 * in no series. No trashed filter — it's the work's own membership.
 */
type Row = { id: number; name: string; position: number | null };

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.id AS id, s.name AS name, sw.position AS position
			   FROM series_works sw
			   JOIN series s ON s.id = sw.series_id
			  WHERE sw.work_id = ?
			  ORDER BY (sw.position IS NULL), sw.position ASC, s.name COLLATE NOCASE ASC`
		)
		.all(params.id) as Row[];
	return json(rows);
};
