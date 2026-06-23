import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/author-tags` — the full reusable author-tag vocabulary with a
 * per-tag author count. Powers two surfaces:
 *  - the author-detail add combobox autocomplete (offers every vocabulary tag)
 *  - the /authors index filter chips (which show only tags with author_count > 0)
 *
 * author_count is the number of DISTINCT authors carrying the tag — note this
 * counts links regardless of whether the author still has non-trashed works, so
 * it can exceed the visible author count; close enough for a filter affordance,
 * and avoids coupling to the works/trash join.
 */
type Row = { id: number; name: string; author_count: number };

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT t.id AS id, t.name AS name, COUNT(l.author_name) AS author_count
			   FROM author_tags t
			   LEFT JOIN author_tag_links l ON l.author_tag_id = t.id
			  GROUP BY t.id, t.name
			  ORDER BY t.name COLLATE NOCASE ASC`
		)
		.all() as Row[];
	return json(rows);
};
