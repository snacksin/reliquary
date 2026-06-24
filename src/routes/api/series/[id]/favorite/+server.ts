import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Manual favorite-series toggle (Series Pages Part 2). Mirrors the
 * favorite-author endpoint exactly — the ONLY path that writes
 * `series.favorited_at`, never auto-set. The series row already exists from
 * extraction, so this is a plain UPDATE (no upsert). 404 if the id is unknown.
 */
function seriesExists(db: ReturnType<typeof getDb>, id: number): boolean {
	return db.prepare('SELECT 1 FROM series WHERE id = ?').get(id) !== undefined;
}

/** POST /api/series/[id]/favorite — mark favorite. Idempotent. 204. */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id) || !seriesExists(db, id)) throw error(404, 'series not found');
	db.prepare('UPDATE series SET favorited_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
	return new Response(null, { status: 204 });
};

/** DELETE /api/series/[id]/favorite — clear favorite. Idempotent. 204. */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id) || !seriesExists(db, id)) throw error(404, 'series not found');
	db.prepare('UPDATE series SET favorited_at = NULL WHERE id = ?').run(id);
	return new Response(null, { status: 204 });
};
