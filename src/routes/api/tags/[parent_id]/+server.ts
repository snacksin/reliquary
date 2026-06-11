import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `PATCH /api/tags/<id>` — update a single tag's own
 * `hide_from_sidebar` flag (M2.1.6, migration 0008).
 *
 * Body: `{ hide_from_sidebar: boolean }`.
 *
 * This is the per-TAG hide — independent of M2.1.5's per-edge flag on
 * `tag_aliases` (managed via the `aliases/` subroutes below this one).
 * The sidebar feed in `GET /api/tags` excludes a tag when its own flag
 * is 1 OR the edge show-wins rule says hidden.
 *
 * Route note: the param is named `parent_id` because this directory is
 * shared with the alias subroutes and SvelteKit forbids sibling
 * `[id]` / `[parent_id]` param directories. Here it's just "the tag id".
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const tagId = Number(params.parent_id);
	if (!Number.isInteger(tagId) || tagId < 1) {
		return json({ error: 'Invalid tag id' }, { status: 404 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const hide = (body as { hide_from_sidebar?: unknown })?.hide_from_sidebar;
	if (typeof hide !== 'boolean') {
		return json({ error: 'hide_from_sidebar must be a boolean' }, { status: 400 });
	}

	const db = getDb();
	const result = db
		.prepare(`UPDATE tags SET hide_from_sidebar = ? WHERE id = ?`)
		.run(hide ? 1 : 0, tagId);
	if (result.changes === 0) {
		return json({ error: 'Tag not found' }, { status: 404 });
	}

	return json({ id: tagId, hide_from_sidebar: hide });
};
