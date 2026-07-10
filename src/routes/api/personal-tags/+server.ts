import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/personal-tags` — the personal-tag vocabulary (you-layer, Private
 * tags): every `tags` row with `category = 'personal'`, each with a count of
 * LIVE (non-trashed) works carrying it. One feed serves both consumers:
 *
 *   - the library FilterSidebar's "My Tags" section (count DESC ordering,
 *     same shape/sort as an /api/tags category group), and
 *   - the detail-page add-combobox vocabulary (it name-sorts client-side).
 *
 * Deliberately its OWN surface rather than an eighth key on /api/tags — that
 * endpoint (and its two consumers, the AO3 sidebar feed and the /tags
 * management page) structurally excludes the personal category, which is what
 * keeps personal tags out of AO3 counts, alias management, and hide flags.
 * Counts use the same live-work EXISTS idiom as /api/tags so trashed works
 * never inflate them. Personal hide/alias state is ignored (no UI sets it).
 */

type Row = { id: number; name: string; count: number };

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT t.id, t.name, COUNT(wt.work_id) AS count
			   FROM tags t
			   LEFT JOIN work_tags wt ON wt.tag_id = t.id
			     AND EXISTS (SELECT 1 FROM works w WHERE w.id = wt.work_id AND w.trashed_at IS NULL)
			  WHERE t.category = 'personal'
			  GROUP BY t.id
			  ORDER BY count DESC, t.name COLLATE NOCASE ASC`
		)
		.all() as Row[];
	return json(rows);
};
