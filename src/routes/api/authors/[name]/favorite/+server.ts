import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { authorKeyExists } from '$lib/server/authors';

/**
 * Manual favorite-author toggle (Author Pages Part 1). Independent of
 * fic favorites; the ONLY path that writes `authors.favorited_at` —
 * never auto-set from any heuristic (mirrors the no-auto-favoriting
 * policy on works.favorited_at).
 *
 * The `[name]` route param is the URL-encoded EFFECTIVE author key
 * (Author Identity Part A: the account for AO3 works, else the raw
 * `works.author` string); SvelteKit decodes it. Both verbs 404 unless
 * some work resolves to that key, so you can't favorite a phantom name.
 */

/**
 * POST /api/authors/[name]/favorite — mark the author a favorite.
 * Upserts the `authors` row; idempotent (re-favoriting just resets the
 * timestamp). 204 on success, 404 if no work has that author.
 */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');
	db.prepare(
		`INSERT INTO authors (name, favorited_at) VALUES (?, CURRENT_TIMESTAMP)
		 ON CONFLICT(name) DO UPDATE SET favorited_at = CURRENT_TIMESTAMP`
	).run(params.name);
	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/authors/[name]/favorite — clear the favorite. Idempotent
 * (no-op if the author was never favorited). Leaves the `authors` row
 * (with favorited_at = NULL) for Part 2's notes/tags to attach to.
 * 204 on success, 404 if no work has that author.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');
	db.prepare('UPDATE authors SET favorited_at = NULL WHERE name = ?').run(params.name);
	return new Response(null, { status: 204 });
};
