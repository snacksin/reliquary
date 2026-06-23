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
 *
 * **M2.1.5 — show-wins hide semantics.** By default this endpoint
 * excludes any tag where every one of its `tag_aliases` rows (treating
 * the tag as `alias_tag_id`) has `hide_from_sidebar = 1`. If at least
 * one parent says show — or if the tag has no parent-alias rows — it
 * stays visible.
 *
 * **`?include_hidden=true`** — the `/tags` management page needs to
 * see hidden tags so the user can un-hide them. In this mode every
 * tag is returned and each row carries a computed `hidden_from_sidebar`
 * boolean so the UI can render the visual difference.
 */

type Row = {
	id: number;
	category: string;
	name: string;
	count: number;
	created_at: string;
	hidden_from_sidebar: number;
};

type Category =
	| 'rating'
	| 'warning'
	| 'category'
	| 'fandom'
	| 'relationship'
	| 'character'
	| 'freeform';

type OutTag = {
	id: number;
	name: string;
	count: number;
	created_at?: string;
	hidden_from_sidebar?: boolean;
};

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();
	const includeHidden = url.searchParams.get('include_hidden') === 'true';

	// Same `hidden_from_sidebar` predicate in both modes — defined once
	// here so the WHERE clause and the SELECT'd column can't drift.
	//
	// Two independent hide mechanisms OR together (M2.1.6):
	//
	// 1. Per-tag flag: `tags.hide_from_sidebar = 1` (migration 0008),
	//    toggled per-row on the /tags management page. Only affects the
	//    tag's own sidebar row.
	// 2. Per-edge show-wins (M2.1.5): a tag is edge-hidden iff EVERY
	//    parent-alias row has hide=1. Equivalently, edge-visible iff it
	//    has no parent-alias rows OR at least one row with hide=0.
	//
	// The SELECT'd expression is the combined effective state for the
	// management view's `hidden_from_sidebar` flag. For root tags (no
	// parent edges) it reduces to the per-tag flag exactly.
	const hiddenExpr = `(
		t.hide_from_sidebar = 1
		OR (
			EXISTS (SELECT 1 FROM tag_aliases ta WHERE ta.alias_tag_id = t.id)
			AND NOT EXISTS (
				SELECT 1 FROM tag_aliases ta
				WHERE ta.alias_tag_id = t.id AND ta.hide_from_sidebar = 0
			)
		)
	)`;

	const whereClauses = [`t.category != 'personal'`];
	if (!includeHidden) {
		whereClauses.push(`NOT ${hiddenExpr}`);
	}

	// Author Pages Part 1: optional author scope. When present, counts
	// (and the join's liveness EXISTS) are restricted to that author's
	// non-trashed works, so the author-detail sidebar shows only that
	// author's tags with author-scoped counts. Bound param appended only
	// when scoping.
	const author = url.searchParams.get('author');
	const authorClause = author ? ` AND w.author = ?` : '';
	const params: unknown[] = author ? [author] : [];

	// M2.3 Step 4: trashed works don't inflate sidebar counts. The join
	// only matches work_tags whose work is live, so COUNT(wt.work_id)
	// counts non-trashed links (a tag whose works are all trashed drops
	// to 0, same as any unused tag).
	// When author-scoped, drop tags the author doesn't use (count 0) so
	// the author-detail sidebar shows only that author's tags. The global
	// (unscoped) feed keeps every tag — unchanged from before.
	const havingClause = author ? 'HAVING count > 0' : '';

	const sql = `
		SELECT t.id, t.category, t.name, t.created_at, COUNT(wt.work_id) AS count,
		       ${hiddenExpr} AS hidden_from_sidebar
		 FROM tags t
		 LEFT JOIN work_tags wt ON wt.tag_id = t.id
		   AND EXISTS (SELECT 1 FROM works w WHERE w.id = wt.work_id AND w.trashed_at IS NULL${authorClause})
		 WHERE ${whereClauses.join(' AND ')}
		 GROUP BY t.id
		 ${havingClause}
		 ORDER BY t.category ASC, count DESC, t.name ASC`;

	const rows = db.prepare(sql).all(...params) as Row[];

	const groups: Record<Category, OutTag[]> = {
		rating: [],
		warning: [],
		category: [],
		fandom: [],
		relationship: [],
		character: [],
		freeform: []
	};

	for (const r of rows) {
		if (r.category in groups) {
			const out: OutTag = { id: r.id, name: r.name, count: r.count };
			if (includeHidden) {
				// Management-page-only fields (M2.1.6): the /tags page sorts
				// by recency client-side, so created_at is carried only in
				// include_hidden mode — same scoping as hidden_from_sidebar.
				out.created_at = r.created_at;
				out.hidden_from_sidebar = r.hidden_from_sidebar === 1;
			}
			groups[r.category as Category].push(out);
		}
	}

	return json(groups);
};
