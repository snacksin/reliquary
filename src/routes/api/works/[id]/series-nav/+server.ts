import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/works/[id]/series-nav` — for the reader's "next/previous part"
 * buttons (Series Pages Part 3). For each series the work belongs to (with a
 * known position), returns the **next/previous owned, non-trashed part by
 * position** — i.e. it chains the parts you actually own into one continuous
 * read, skipping gaps. (AO3 series positions are often sparse: a library may
 * hold parts 6, 12, 17, 22 of a series, so exact position±1 would never match.)
 * `next` is null on the last owned part, `prev` on the first.
 *
 * Returns [] for works in no positioned series → the reader footer is unchanged.
 */
type Membership = { series_id: number; series_name: string; position: number };
type Adjacent = { id: string; title: string };

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();

	const memberships = db
		.prepare(
			`SELECT s.id AS series_id, s.name AS series_name, sw.position AS position
			   FROM series_works sw
			   JOIN series s ON s.id = sw.series_id
			  WHERE sw.work_id = ? AND sw.position IS NOT NULL
			  ORDER BY s.name COLLATE NOCASE ASC`
		)
		.all(params.id) as Membership[];

	// The nearest owned non-trashed part STRICTLY after / before this position
	// (strict so same-position duplicate uploads don't count as the next part).
	// chapter_count DESC tiebreaks dup rows at the chosen position (richest copy).
	const nextStmt = db.prepare(
		`SELECT w.id AS id, w.title AS title
		   FROM series_works sw
		   JOIN works w ON w.id = sw.work_id AND w.trashed_at IS NULL
		  WHERE sw.series_id = ? AND sw.position > ?
		  ORDER BY sw.position ASC, w.chapter_count DESC, w.id ASC
		  LIMIT 1`
	);
	const prevStmt = db.prepare(
		`SELECT w.id AS id, w.title AS title
		   FROM series_works sw
		   JOIN works w ON w.id = sw.work_id AND w.trashed_at IS NULL
		  WHERE sw.series_id = ? AND sw.position < ?
		  ORDER BY sw.position DESC, w.chapter_count DESC, w.id ASC
		  LIMIT 1`
	);

	const result = memberships.map((m) => ({
		series_id: m.series_id,
		series_name: m.series_name,
		position: m.position,
		prev: (prevStmt.get(m.series_id, m.position) as Adjacent | undefined) ?? null,
		next: (nextStmt.get(m.series_id, m.position) as Adjacent | undefined) ?? null
	}));

	return json(result);
};
