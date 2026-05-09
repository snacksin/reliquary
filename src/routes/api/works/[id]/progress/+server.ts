import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Upsert this work's reading_progress row. Body: { chapter, scroll_y }.
 *
 * - Validates the work exists (404 otherwise) so we don't silently
 *   drop progress writes that point at nothing.
 * - 400 on malformed body / negative or non-integer chapter / negative
 *   scroll_y. The reader page rounds scroll_y client-side; we round
 *   again here defensively (DB column is INTEGER).
 * - The localStorage-side write on the reader stays the source of
 *   truth for restore-on-reload (see M1.md gotchas + Step 9 logic);
 *   this row is for the library's "Continue Reading" surfacing and
 *   future cross-device hand-off.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as
		| { chapter?: unknown; scroll_y?: unknown }
		| null;

	if (
		!body ||
		typeof body.chapter !== 'number' ||
		typeof body.scroll_y !== 'number'
	) {
		throw error(400, 'expected { chapter, scroll_y }');
	}
	if (!Number.isInteger(body.chapter) || body.chapter < 1) {
		throw error(400, 'invalid chapter');
	}
	if (!Number.isFinite(body.scroll_y) || body.scroll_y < 0) {
		throw error(400, 'invalid scroll_y');
	}

	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}

	db.prepare(
		`INSERT INTO reading_progress (work_id, last_chapter, last_scroll_y, updated_at)
		 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(work_id) DO UPDATE SET
		   last_chapter = excluded.last_chapter,
		   last_scroll_y = excluded.last_scroll_y,
		   updated_at = CURRENT_TIMESTAMP`
	).run(params.id, body.chapter, Math.round(body.scroll_y));

	return new Response(null, { status: 204 });
};

/**
 * Remove this work's reading_progress row. Idempotent — DELETE on a
 * missing row is a no-op and returns 204; we don't even check whether
 * the work exists, since revealing existence would be unnecessary
 * (and the on-disk effect is the same either way: no row).
 */
export const DELETE: RequestHandler = ({ params }) => {
	getDb().prepare('DELETE FROM reading_progress WHERE work_id = ?').run(params.id);
	return new Response(null, { status: 204 });
};
