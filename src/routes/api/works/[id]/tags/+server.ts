import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-work PERSONAL tags (you-layer, Private tags). The vocabulary lives in
 * the shared `tags` table under `category = 'personal'` (reserved for exactly
 * this since migration 0005) with links in `work_tags`; this route manages
 * which personal tags are attached to one work. Removing a link detaches the
 * tag from the work but never deletes it from the vocabulary — mirrors the
 * author-tag endpoints (Author Pages Part 2).
 *
 * Every statement here is category-scoped so this route can neither read nor
 * detach AO3-parsed tags, and AO3 surfaces never see personal rows (the
 * /api/tags feed structurally excludes the category).
 */
function workExists(db: ReturnType<typeof getDb>, id: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE id = ?').get(id) !== undefined;
}

type TagRow = { id: number; name: string };

/** GET /api/works/[id]/tags — this work's attached personal tags, name-sorted. */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');
	const rows = db
		.prepare(
			`SELECT t.id AS id, t.name AS name
			   FROM work_tags wt
			   JOIN tags t ON t.id = wt.tag_id
			  WHERE wt.work_id = ? AND t.category = 'personal'
			  ORDER BY t.name COLLATE NOCASE ASC`
		)
		.all(params.id) as TagRow[];
	return json(rows);
};

/**
 * POST /api/works/[id]/tags — attach a personal tag by name. Body: { name }.
 * Find-or-creates the vocabulary entry, then links it (idempotent if already
 * attached). Returns { id, name }.
 *
 * `tags` has UNIQUE(category, name) which is case-SENSITIVE (unlike
 * author_tags' COLLATE NOCASE), so case-insensitivity is enforced here: a
 * NOCASE lookup runs first and wins, so "Reread" and "reread" resolve to one
 * vocabulary row. Both steps run in one transaction to keep the check-then-
 * insert atomic.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const raw = (body as { name?: unknown })?.name;
	if (typeof raw !== 'string') throw error(400, 'name must be a string');
	const name = raw.trim();
	if (name.length === 0) throw error(400, 'name must not be empty');

	const tag = db.transaction((): TagRow => {
		let row = db
			.prepare(`SELECT id, name FROM tags WHERE category = 'personal' AND name = ? COLLATE NOCASE`)
			.get(name) as TagRow | undefined;
		if (!row) {
			const info = db.prepare(`INSERT INTO tags (category, name) VALUES ('personal', ?)`).run(name);
			row = { id: Number(info.lastInsertRowid), name };
		}
		db.prepare(
			`INSERT INTO work_tags (work_id, tag_id) VALUES (?, ?)
			 ON CONFLICT(work_id, tag_id) DO NOTHING`
		).run(params.id, row.id);
		return row;
	})();

	return json(tag, { status: 201 });
};

/**
 * DELETE /api/works/[id]/tags — detach a personal tag from this work. Body:
 * { id }. Removes the link only; the vocabulary tag survives for reuse on
 * other works. The category guard means an AO3 tag id here is a no-op — this
 * endpoint structurally cannot strip parsed tags. Idempotent. 204.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!workExists(db, params.id)) throw error(404, 'work not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const id = (body as { id?: unknown })?.id;
	if (typeof id !== 'number' || !Number.isInteger(id)) throw error(400, 'id must be an integer');

	db.prepare(
		`DELETE FROM work_tags
		  WHERE work_id = ? AND tag_id = ?
		    AND tag_id IN (SELECT id FROM tags WHERE category = 'personal')`
	).run(params.id, id);

	return new Response(null, { status: 204 });
};
