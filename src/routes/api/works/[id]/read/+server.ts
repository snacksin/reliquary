import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * STRICT MANUAL-ONLY "READ" MARK
 * (mirrors the no-auto-favoriting policy; see migrations/0018_read_at.sql)
 *
 * These endpoints are the ONLY path that writes works.read_at. The mark is
 * DELIBERATELY decoupled from reading progress: finishing a fic, the reader's
 * ~95% auto-mark, the "Read again" reset, dedup/ingest — none of them touch
 * read_at. It reflects an explicit user signal ("I consider this read"),
 * independent of where you physically are in the text.
 *
 * If you're tempted to add a `markReadOnFinish()` helper, or set read_at from
 * the progress endpoint / ingest / any heuristic (max_read_chapter, completion,
 * return visits), stop. The single write path is the whole point — it's what
 * makes this column trustworthy as the you-layer's read state.
 */

/**
 * POST /api/works/[id]/read
 *   Sets works.read_at = CURRENT_TIMESTAMP for the given work.
 *   Returns 204 No Content on success; 404 if no such work.
 *   Idempotent on repeated calls (each call resets the timestamp).
 */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	const result = db
		.prepare('UPDATE works SET read_at = CURRENT_TIMESTAMP WHERE id = ?')
		.run(params.id);
	if (result.changes === 0) {
		throw error(404, 'work not found');
	}
	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/works/[id]/read
 *   Sets works.read_at = NULL. Idempotent — works whether the row was already
 *   null or not. 404 only when the work itself doesn't exist.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}
	db.prepare('UPDATE works SET read_at = NULL WHERE id = ?').run(params.id);
	return new Response(null, { status: 204 });
};
