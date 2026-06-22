import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Manual favorite-author toggle (Author Pages Part 1). Independent of
 * fic favorites; the ONLY path that writes `authors.favorited_at` —
 * never auto-set from any heuristic (mirrors the no-auto-favoriting
 * policy on works.favorited_at).
 *
 * The `[name]` route param is the URL-encoded exact `works.author`
 * string; SvelteKit decodes it. Both verbs 404 unless some work
 * actually has that author, so you can't favorite a phantom name.
 */
function authorExists(db: ReturnType<typeof getDb>, name: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE author = ? LIMIT 1').get(name) !== undefined;
}

/**
 * POST /api/authors/[name]/favorite — mark the author a favorite.
 * Upserts the `authors` row; idempotent (re-favoriting just resets the
 * timestamp). 204 on success, 404 if no work has that author.
 */
export const POST: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');
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
	if (!authorExists(db, params.name)) throw error(404, 'author not found');
	db.prepare('UPDATE authors SET favorited_at = NULL WHERE name = ?').run(params.name);
	return new Response(null, { status: 204 });
};
