import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/tags` — every tag in the library, grouped by category and
 * sorted within each group by usage count (DESC) then name (ASC).
 *
 * Always returns the seven AO3 categories as top-level keys, even when
 * a category has zero tags. The filter sidebar (Step 5) renders all
 * seven sections without per-key conditional checks.
 *
 * `personal` is deliberately not a key here. Personal tags don't exist
 * in the DB yet (Step 2 enforces this structurally), and even if they
 * did, surfacing them belongs to a later milestone — the M3+ user-tag
 * UI builds its own surface rather than piggybacking on this endpoint.
 */

type Row = {
	id: number;
	category: string;
	name: string;
	count: number;
};

type Category =
	| 'rating'
	| 'warning'
	| 'category'
	| 'fandom'
	| 'relationship'
	| 'character'
	| 'freeform';

export const GET: RequestHandler = () => {
	const db = getDb();

	// LEFT JOIN so a tag with no current uses (e.g. a future migration
	// that pre-seeds tags) still shows up with count=0 instead of
	// silently disappearing. Today every tag is created in lockstep
	// with at least one work_tags row, so count is always >= 1 in
	// practice, but the LEFT JOIN keeps the contract truthful.
	//
	// Defensive `category != 'personal'` filter — the type-level rules
	// in src/lib/server/epub.ts already prevent personal rows from
	// being written, but a SQL filter here means even a hand-edited
	// DB row couldn't leak personal tags through the API.
	const rows = db
		.prepare(
			`SELECT t.id, t.category, t.name, COUNT(wt.work_id) AS count
			 FROM tags t
			 LEFT JOIN work_tags wt ON wt.tag_id = t.id
			 WHERE t.category != 'personal'
			 GROUP BY t.id
			 ORDER BY t.category ASC, count DESC, t.name ASC`
		)
		.all() as Row[];

	const groups: Record<Category, { id: number; name: string; count: number }[]> = {
		rating: [],
		warning: [],
		category: [],
		fandom: [],
		relationship: [],
		character: [],
		freeform: []
	};

	for (const r of rows) {
		// Reject any unexpected category value (shouldn't happen given
		// Step 2's allow-list, but keeps the response shape stable if
		// future code somehow inserts an unknown category).
		if (r.category in groups) {
			groups[r.category as Category].push({ id: r.id, name: r.name, count: r.count });
		}
	}

	return json(groups);
};
