import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Edit / detach a work's series link (Series Pages Part 4). The UI only
 * exposes these on manual links, but they operate on the (work, series) link
 * regardless. Detaching removes the link only — the `series` row survives for
 * its other parts.
 */
function workExists(db: ReturnType<typeof getDb>, id: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE id = ?').get(id) !== undefined;
}

/** PATCH /api/works/[id]/series/[series_id] — change the link's position. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');
	const seriesId = Number.parseInt(params.series_id, 10);
	if (!Number.isInteger(seriesId)) throw error(404, 'series not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const position = (body as { position?: unknown })?.position;
	let pos: number | null = null;
	if (position !== undefined && position !== null) {
		if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) {
			throw error(400, 'position must be a positive integer');
		}
		pos = position;
	}

	db.prepare('UPDATE series_works SET position = ? WHERE work_id = ? AND series_id = ?').run(
		pos,
		params.id,
		seriesId
	);
	return new Response(null, { status: 204 });
};

/** DELETE /api/works/[id]/series/[series_id] — detach (remove the link only). */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');
	const seriesId = Number.parseInt(params.series_id, 10);
	if (!Number.isInteger(seriesId)) throw error(404, 'series not found');

	db.prepare('DELETE FROM series_works WHERE work_id = ? AND series_id = ?').run(
		params.id,
		seriesId
	);
	return new Response(null, { status: 204 });
};
