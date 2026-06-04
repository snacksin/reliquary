import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-edge alias mutations: toggle visibility or remove. Both
 * idempotent — a PATCH that doesn't change the flag returns the
 * current row, and a DELETE on a non-existent edge returns 200
 * (a future "remove this old alias" UI press should never 404).
 */

function parseId(raw: string): number | null {
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * PATCH — flip `hide_from_sidebar` on an existing edge.
 * Body: { hide_from_sidebar: boolean }
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const parentId = parseId(params.parent_id);
	const aliasId = parseId(params.alias_id);
	if (parentId === null) throw error(400, 'invalid parent_id');
	if (aliasId === null) throw error(400, 'invalid alias_id');

	let body: { hide_from_sidebar?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'expected JSON body');
	}
	if (typeof body.hide_from_sidebar !== 'boolean') {
		throw error(400, 'expected boolean hide_from_sidebar');
	}
	const hide = body.hide_from_sidebar ? 1 : 0;

	const result = db
		.prepare(
			`UPDATE tag_aliases
			 SET hide_from_sidebar = ?
			 WHERE parent_tag_id = ? AND alias_tag_id = ?`
		)
		.run(hide, parentId, aliasId);

	if (result.changes === 0) {
		// Edge doesn't exist. 404 to surface the misconfiguration —
		// distinct from DELETE's idempotent behavior because PATCH is
		// targeted at a specific row that's expected to exist.
		throw error(404, 'alias edge not found');
	}

	return json({ parent_tag_id: parentId, alias_tag_id: aliasId, hide_from_sidebar: hide });
};

/**
 * DELETE — remove the edge. Idempotent: returns 200 even if the row
 * didn't exist (matches /api/works/[id]/progress DELETE semantics).
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const parentId = parseId(params.parent_id);
	const aliasId = parseId(params.alias_id);
	if (parentId === null) throw error(400, 'invalid parent_id');
	if (aliasId === null) throw error(400, 'invalid alias_id');

	db.prepare(`DELETE FROM tag_aliases WHERE parent_tag_id = ? AND alias_tag_id = ?`).run(
		parentId,
		aliasId
	);

	return new Response(null, { status: 204 });
};
