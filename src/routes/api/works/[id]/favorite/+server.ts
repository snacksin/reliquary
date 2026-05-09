import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * STRICT NO-AUTO-FAVORITING POLICY
 * (per TRACKING.md Decisions Made 2026-04-29, reaffirmed 2026-05-07,
 *  also documented in migrations/0004_favorites.sql)
 *
 * These endpoints are the ONLY path that writes works.favorited_at.
 * Do not add automatic favoriting based on ratings, read counts,
 * time-spent, return-visit frequency, or any other heuristic. The
 * column is strictly user-toggled via the heart button on the
 * detail page.
 *
 * If you're tempted to add a `helpfullyMarkFavorite()` helper or
 * a `setFavorite=true` from anywhere else in the codebase, stop.
 * The whole point of this column is that it reflects an explicit,
 * intentional user signal.
 */

/**
 * POST /api/works/[id]/favorite
 *   Sets works.favorited_at = CURRENT_TIMESTAMP for the given work.
 *   Returns 204 No Content on success; 404 if no such work.
 *   Idempotent on repeated calls (each call resets the timestamp).
 */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	const result = db
		.prepare('UPDATE works SET favorited_at = CURRENT_TIMESTAMP WHERE id = ?')
		.run(params.id);
	if (result.changes === 0) {
		throw error(404, 'work not found');
	}
	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/works/[id]/favorite
 *   Sets works.favorited_at = NULL. Idempotent — works whether the
 *   row was already null or not. 404 only when the work itself
 *   doesn't exist.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}
	db.prepare('UPDATE works SET favorited_at = NULL WHERE id = ?').run(params.id);
	return new Response(null, { status: 204 });
};
