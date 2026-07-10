import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-parent tag-alias CRUD. The `parent_id` route param is the tag
 * whose aliases (children) we're listing or modifying. Aliases are
 * one-way (parent → child) and within-category only — both invariants
 * are enforced here at the API layer.
 */

type AliasRow = {
	id: number;
	name: string;
	category: string;
	hide_from_sidebar: number;
};

type TagRow = {
	id: number;
	category: string;
	name: string;
};

function parseTagId(raw: string): number | null {
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET — list the parent's direct aliases. Each row carries the child
 * tag's display fields plus the visibility flag for THIS edge.
 * The `/tags` UI uses this both to render the child chips for a parent
 * and (with the parent_id swapped) to display the parent chip when
 * editing a child.
 */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const parentId = parseTagId(params.parent_id);
	if (parentId === null) throw error(400, 'invalid parent_id');

	// 404 if the parent tag doesn't exist — defends against the UI
	// holding stale tag IDs after a manual DB edit.
	const parent = db
		.prepare<[number], TagRow>(`SELECT id, category, name FROM tags WHERE id = ?`)
		.get(parentId);
	if (!parent) throw error(404, 'parent tag not found');

	const rows = db
		.prepare<[number], AliasRow>(
			`SELECT t.id, t.name, t.category, ta.hide_from_sidebar
			 FROM tag_aliases ta
			 JOIN tags t ON t.id = ta.alias_tag_id
			 WHERE ta.parent_tag_id = ?
			 ORDER BY t.name ASC`
		)
		.all(parentId);

	return json({ parent, aliases: rows });
};

/**
 * POST — add a new alias under this parent.
 *
 * Body: { alias_tag_id: number, hide_from_sidebar?: boolean }
 *
 * Validation cascade:
 *   1. Parent and alias both exist.
 *   2. Same category (fandom→fandom, etc.).
 *   3. parent ≠ alias (self-loop; also caught by the SQL CHECK).
 *   4. No cycle: walking down from the proposed alias should never
 *      reach the proposed parent. If it does, this edge would close
 *      a cycle. Reject explicitly even though the recursive CTE in
 *      /api/works uses UNION (which would short-circuit safely) —
 *      better to surface the error to the caller than to silently
 *      paper over a misconfiguration.
 *
 * Idempotent on duplicate: inserting an existing edge with the same
 * visibility returns 200 + the existing row. With a different
 * visibility, the existing row's flag is updated (UPSERT semantics).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const parentId = parseTagId(params.parent_id);
	if (parentId === null) throw error(400, 'invalid parent_id');

	let body: { alias_tag_id?: unknown; hide_from_sidebar?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'expected JSON body');
	}

	const aliasId =
		typeof body.alias_tag_id === 'number' && Number.isFinite(body.alias_tag_id)
			? body.alias_tag_id
			: null;
	if (aliasId === null || aliasId <= 0) throw error(400, 'invalid alias_tag_id');

	const hide = body.hide_from_sidebar === true ? 1 : 0;

	if (parentId === aliasId) throw error(400, 'a tag cannot alias itself');

	const parent = db
		.prepare<[number], TagRow>(`SELECT id, category, name FROM tags WHERE id = ?`)
		.get(parentId);
	if (!parent) throw error(404, 'parent tag not found');

	const alias = db
		.prepare<[number], TagRow>(`SELECT id, category, name FROM tags WHERE id = ?`)
		.get(aliasId);
	if (!alias) throw error(404, 'alias tag not found');

	if (parent.category !== alias.category) {
		throw error(
			400,
			`aliases must be within the same category (parent is ${parent.category}, alias is ${alias.category})`
		);
	}

	// Personal tags (you-layer Private tags) stay out of the alias system this
	// round. No UI path reaches here with one (the /tags page feed excludes the
	// category); this closes the direct-API hole. Same-category above means one
	// check covers both ends.
	if (parent.category === 'personal') {
		throw error(400, 'personal tags cannot participate in aliases');
	}

	// Cycle check. Walk down from the proposed alias's subtree and look
	// for the proposed parent. If we find it, adding this edge would
	// close a cycle. Uses the same WITH RECURSIVE shape as the filter
	// expansion in /api/works for consistency.
	const cycle = db
		.prepare<[number, number], { hit: number }>(
			`WITH RECURSIVE descendants(id) AS (
			   SELECT ?
			   UNION
			   SELECT ta.alias_tag_id
			   FROM tag_aliases ta
			   JOIN descendants d ON ta.parent_tag_id = d.id
			 )
			 SELECT 1 AS hit FROM descendants WHERE id = ? LIMIT 1`
		)
		.get(aliasId, parentId);
	if (cycle) {
		throw error(
			400,
			`Cycle would be created. Tag ${alias.name} (id ${aliasId}) is already a descendant of tag ${parent.name} (id ${parentId}).`
		);
	}

	// UPSERT: insert the edge, or update the visibility flag if it
	// already exists. Keeps the endpoint idempotent and lets a re-POST
	// flip the flag.
	db.prepare(
		`INSERT INTO tag_aliases (parent_tag_id, alias_tag_id, hide_from_sidebar)
		 VALUES (?, ?, ?)
		 ON CONFLICT(parent_tag_id, alias_tag_id)
		 DO UPDATE SET hide_from_sidebar = excluded.hide_from_sidebar`
	).run(parentId, aliasId, hide);

	return json({
		parent,
		alias: { ...alias, hide_from_sidebar: hide }
	});
};
