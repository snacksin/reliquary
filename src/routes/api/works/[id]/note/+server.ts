import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-work markdown note (you-layer). This endpoint is the only path that
 * writes the `notes` table. Notes are their own dimension — decoupled from
 * reading progress, Continue Reading, the read flag, ratings, and favorites.
 *
 * PUT /api/works/[id]/note   Body: { body: string }
 *   Explicit Save, doubling as clear: a non-empty (trimmed) body upserts the
 *   note; an empty body DELETEs the row (an empty note is "nothing shown", no
 *   stray empty rows). The notes_fts trigger keeps search in sync either way.
 *   400 on a malformed body; 404 if no such work; idempotent.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const payload = (await request.json().catch(() => null)) as { body?: unknown } | null;
	if (!payload || typeof payload.body !== 'string') {
		throw error(400, 'expected { body: string }');
	}

	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}

	// We store the body verbatim (markdown is rendered + sanitized on the
	// client); only the empty/clear decision trims.
	const body = payload.body;
	if (body.trim() === '') {
		db.prepare('DELETE FROM notes WHERE work_id = ?').run(params.id);
	} else {
		db.prepare(
			`INSERT INTO notes (work_id, body, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(work_id) DO UPDATE SET
			   body = excluded.body,
			   updated_at = CURRENT_TIMESTAMP`
		).run(params.id, body);
	}

	return new Response(null, { status: 204 });
};
