import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/tag-aliases` — every alias edge in one round-trip.
 *
 * The /tags management page needs to render the full tree across all
 * categories. Hitting `/api/tags/<id>/aliases` per parent would be
 * O(parents) round trips — fine for the inline edit panel but lousy
 * for the tree view that wants to show every relationship at once.
 *
 * Edges are returned in (parent name, alias name) order so a future
 * caller that wants a stable serialization (e.g. exporting the alias
 * graph to a backup file) gets one without sorting client-side.
 */

type EdgeRow = {
	parent_tag_id: number;
	alias_tag_id: number;
	hide_from_sidebar: number;
};

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT ta.parent_tag_id, ta.alias_tag_id, ta.hide_from_sidebar
			 FROM tag_aliases ta
			 JOIN tags p ON p.id = ta.parent_tag_id
			 JOIN tags c ON c.id = ta.alias_tag_id
			 ORDER BY p.name ASC, c.name ASC`
		)
		.all() as EdgeRow[];
	return json({ edges: rows });
};
