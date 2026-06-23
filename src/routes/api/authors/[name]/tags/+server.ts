import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Per-author tags (Author Pages Part 2). The tags themselves live in a shared,
 * reusable `author_tags` vocabulary; this route manages which of them are
 * attached to one author via `author_tag_links`. Removing a link detaches the
 * tag from the author but never deletes it from the vocabulary.
 *
 * All verbs 404 unless some work has that author (same guard as the favorite /
 * note endpoints).
 */
function authorExists(db: ReturnType<typeof getDb>, name: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE author = ? LIMIT 1').get(name) !== undefined;
}

type TagRow = { id: number; name: string };

/** GET /api/authors/[name]/tags — this author's attached tags, name-sorted. */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');
	const rows = db
		.prepare(
			`SELECT t.id AS id, t.name AS name
			   FROM author_tag_links l
			   JOIN author_tags t ON t.id = l.author_tag_id
			  WHERE l.author_name = ?
			  ORDER BY t.name COLLATE NOCASE ASC`
		)
		.all(params.name) as TagRow[];
	return json(rows);
};

/**
 * POST /api/authors/[name]/tags — attach a tag by name. Body: { name }.
 * Find-or-creates the vocabulary entry (case-insensitive), upserts the author
 * row, then links them (idempotent if already attached). Returns { id, name }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');

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
		// Find-or-create the vocabulary tag (UNIQUE COLLATE NOCASE on name).
		db.prepare('INSERT INTO author_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
		const row = db
			.prepare('SELECT id, name FROM author_tags WHERE name = ? COLLATE NOCASE')
			.get(name) as TagRow;
		// Ensure the author row exists (FK parent for the link), then link.
		db.prepare('INSERT INTO authors (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(
			params.name
		);
		db.prepare(
			`INSERT INTO author_tag_links (author_name, author_tag_id) VALUES (?, ?)
			 ON CONFLICT(author_name, author_tag_id) DO NOTHING`
		).run(params.name, row.id);
		return row;
	})();

	return json(tag, { status: 201 });
};

/**
 * DELETE /api/authors/[name]/tags — detach a tag from this author. Body:
 * { id }. Removes the link only; the vocabulary tag survives for reuse on
 * other authors. Idempotent (no-op if not attached). 204.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const id = (body as { id?: unknown })?.id;
	if (typeof id !== 'number' || !Number.isInteger(id)) throw error(400, 'id must be an integer');

	db.prepare('DELETE FROM author_tag_links WHERE author_name = ? AND author_tag_id = ?').run(
		params.name,
		id
	);

	return new Response(null, { status: 204 });
};
