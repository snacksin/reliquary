import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Author note (Author Pages Part 2). One free-text note per author, keyed by
 * the exact `works.author` string (URL-encoded in the route, decoded by
 * SvelteKit). The `authors` row is shared with the Part 1 favorite flag and
 * the Part 2 tag links; it's upserted on first write so a note can exist for
 * an author who was never favorited.
 *
 * Both verbs 404 unless some work actually has that author, mirroring the
 * favorite endpoint — you can't annotate a phantom name.
 */
function authorExists(db: ReturnType<typeof getDb>, name: string): boolean {
	return db.prepare('SELECT 1 FROM works WHERE author = ? LIMIT 1').get(name) !== undefined;
}

/** GET /api/authors/[name] — the author's saved note (null if none). */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');
	const row = db.prepare('SELECT notes FROM authors WHERE name = ?').get(params.name) as
		| { notes: string | null }
		| undefined;
	return json({ name: params.name, notes: row?.notes ?? null });
};

/**
 * PATCH /api/authors/[name] — save the note. Body: { notes: string }. Upserts
 * the `authors` row; an empty / whitespace-only note is stored as NULL so the
 * page shows nothing (empty note allowed). 204 on success.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorExists(db, params.name)) throw error(404, 'author not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const raw = (body as { notes?: unknown })?.notes;
	if (raw !== undefined && typeof raw !== 'string') throw error(400, 'notes must be a string');
	const trimmed = typeof raw === 'string' ? raw.trim() : '';
	const notes = trimmed.length > 0 ? trimmed : null;

	db.prepare(
		`INSERT INTO authors (name, notes) VALUES (?, ?)
		 ON CONFLICT(name) DO UPDATE SET notes = excluded.notes`
	).run(params.name, notes);

	return new Response(null, { status: 204 });
};
