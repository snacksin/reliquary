import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-work star rating (you-layer). These endpoints are the only path that
 * writes the `ratings` table. Ratings are their OWN dimension — fully
 * decoupled from reading progress, Continue Reading, the read flag, and
 * favorites. Setting/clearing a rating never reads or writes any of those.
 *
 * Unrated = no row (DELETE removes it), so `stars` is always a real 1-5.
 */

/**
 * POST /api/works/[id]/rating
 *   Body: { stars: 1..5 }. Upserts the work's rating (resets updated_at).
 *   400 on a non-integer / out-of-range stars; 404 if no such work;
 *   idempotent (re-POSTing the same value just restamps updated_at).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { stars?: unknown } | null;
	if (!body || typeof body.stars !== 'number' || !Number.isInteger(body.stars)) {
		throw error(400, 'expected { stars: integer }');
	}
	if (body.stars < 1 || body.stars > 5) {
		throw error(400, 'stars must be between 1 and 5');
	}

	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}

	db.prepare(
		`INSERT INTO ratings (work_id, stars, updated_at)
		 VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(work_id) DO UPDATE SET
		   stars = excluded.stars,
		   updated_at = CURRENT_TIMESTAMP`
	).run(params.id, body.stars);

	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/works/[id]/rating
 *   Clears the rating by removing the row (back to unrated). Idempotent —
 *   a no-op when already unrated. 404 only when the work itself doesn't exist.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}
	db.prepare('DELETE FROM ratings WHERE work_id = ?').run(params.id);
	return new Response(null, { status: 204 });
};
