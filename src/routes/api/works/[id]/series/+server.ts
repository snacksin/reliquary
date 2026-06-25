import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { findOrCreateSeriesByName } from '$lib/server/series';

/**
 * `GET /api/works/[id]/series` — the series this work belongs to, for the
 * preface "Part N of …" section (Part 1) and the detail-page set-series UI
 * (Part 4). Returns id + name + position + `manual` flag, in position order.
 * No trashed filter — it's the work's own membership.
 */
type Row = { id: number; name: string; position: number | null; manual: number };

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.id AS id, s.name AS name, sw.position AS position, sw.manual AS manual
			   FROM series_works sw
			   JOIN series s ON s.id = sw.series_id
			  WHERE sw.work_id = ?
			  ORDER BY (sw.position IS NULL), sw.position ASC, s.name COLLATE NOCASE ASC`
		)
		.all(params.id) as Row[];
	return json(rows.map((r) => ({ id: r.id, name: r.name, position: r.position, manual: r.manual === 1 })));
};

function workExists(db: ReturnType<typeof getDb>, id: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE id = ?').get(id) !== undefined;
}

/**
 * `POST /api/works/[id]/series` — manually assign the work to a series (Part 4).
 * Body: { series_id?, name?, position? }. Pick an existing series by id, or
 * create/reuse a name-only series by name (so picking an existing AO3 series
 * unifies; only a brand-new name makes a row). Upserts the link with
 * `manual = 1` — also overriding an auto link's position and protecting it
 * from future auto-refresh. Returns the resulting link.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const { series_id, name, position } = (body ?? {}) as {
		series_id?: unknown;
		name?: unknown;
		position?: unknown;
	};

	// position: optional positive integer, or null/absent.
	let pos: number | null = null;
	if (position !== undefined && position !== null) {
		if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) {
			throw error(400, 'position must be a positive integer');
		}
		pos = position;
	}

	// Resolve the target series id.
	let seriesId: number;
	if (typeof series_id === 'number' && Number.isInteger(series_id)) {
		if (db.prepare('SELECT 1 FROM series WHERE id = ?').get(series_id) === undefined) {
			throw error(404, 'series not found');
		}
		seriesId = series_id;
	} else if (typeof name === 'string' && name.trim().length > 0) {
		seriesId = findOrCreateSeriesByName(db, name.trim());
	} else {
		throw error(400, 'provide a series_id or a non-empty name');
	}

	db.prepare(
		`INSERT INTO series_works (series_id, work_id, position, manual) VALUES (?, ?, ?, 1)
		 ON CONFLICT(series_id, work_id) DO UPDATE SET position = excluded.position, manual = 1`
	).run(seriesId, params.id, pos);

	const row = db.prepare('SELECT id, name FROM series WHERE id = ?').get(seriesId) as {
		id: number;
		name: string;
	};
	return json({ id: row.id, name: row.name, position: pos, manual: true }, { status: 201 });
};
