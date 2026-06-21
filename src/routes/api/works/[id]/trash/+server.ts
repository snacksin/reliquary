import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Soft-trash endpoints (M2.3 Step 4). `works.trashed_at` (migration
 * 0009) is the marker: non-NULL = in Trash. A trashed work vanishes from
 * every discovery surface (library list, Continue Reading, Favorites,
 * tag counts, search) but is NOT deleted — its files and its
 * detail/reader/history pages stay intact (preservation). The `/trash`
 * view that surfaces trashed works for restore is Step 5; until then
 * restore is API-only via DELETE here.
 *
 * The same `trashed_at` marker drives Step 3's dedup restore-then-apply
 * branch in ingest.ts (re-uploading a trashed fic un-trashes it).
 */

/**
 * POST /api/works/[id]/trash
 *   Moves the work to Trash (trashed_at = CURRENT_TIMESTAMP).
 *   Idempotent: re-trashing an already-trashed work is a 204 no-op and
 *   PRESERVES the original trash time (the conditional UPDATE), so the
 *   future 30-day purge clock isn't reset. 404 if no such work.
 */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}
	db.prepare('UPDATE works SET trashed_at = CURRENT_TIMESTAMP WHERE id = ? AND trashed_at IS NULL').run(
		params.id
	);
	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/works/[id]/trash
 *   Restores the work (trashed_at = NULL). Idempotent — works whether
 *   the row was trashed or already live. 404 only if no such work.
 *   Non-destructive: favorited_at, reading_progress, and tag/hide state
 *   are untouched, so a restored work comes back exactly as it was.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}
	db.prepare('UPDATE works SET trashed_at = NULL WHERE id = ?').run(params.id);
	return new Response(null, { status: 204 });
};
