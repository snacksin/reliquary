import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/tag-vocab?category=fandom` — one AO3 category's whole tag
 * vocabulary, for the detail page's manual-tag picker (2026-11-09). Each row
 * carries its live-work count; ordered count DESC then name, so the most-used
 * names come first when the box is opened empty.
 *
 * Its own surface rather than a mode on /api/tags: that feed always returns
 * all seven keys at once (≈7,700 rows) and is sidebar-shaped. The picker
 * loads one category at a time, only when it's opened. Hidden tags are
 * included — hiding is a sidebar declutter, not "never use this name".
 * `personal` is not a category here (it has /api/personal-tags).
 */

const CATEGORIES = new Set([
	'rating',
	'warning',
	'category',
	'fandom',
	'relationship',
	'character',
	'freeform'
]);

type Row = { id: number; name: string; count: number };

export const GET: RequestHandler = ({ url }) => {
	const category = url.searchParams.get('category');
	if (!category || !CATEGORIES.has(category)) throw error(400, 'unknown tag category');
	const rows = getDb()
		.prepare(
			`SELECT t.id, t.name, COUNT(wt.work_id) AS count
			   FROM tags t
			   LEFT JOIN work_tags wt ON wt.tag_id = t.id
			     AND EXISTS (SELECT 1 FROM works w WHERE w.id = wt.work_id AND w.trashed_at IS NULL)
			  WHERE t.category = ?
			  GROUP BY t.id
			  ORDER BY count DESC, t.name COLLATE NOCASE ASC`
		)
		.all(category) as Row[];
	return json(rows);
};
