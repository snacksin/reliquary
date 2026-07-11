import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { authorKeyExists } from '$lib/server/authors';

/**
 * Author note (Author Pages Part 2) + pseud list (Author Identity Part A).
 * One free-text note per author, keyed by the EFFECTIVE author key — the
 * parsed primary account for AO3 works, else the raw `works.author` string
 * (URL-encoded in the route, decoded by SvelteKit). The `authors` row is
 * shared with the Part 1 favorite flag and the Part 2 tag links; it's
 * upserted on first write so a note can exist for an author who was never
 * favorited.
 *
 * Both verbs 404 unless some work resolves to that author key, mirroring
 * the favorite endpoint — you can't annotate a phantom name.
 */

/**
 * GET /api/authors/[name] — the author's saved note (null if none) plus the
 * account's "pseuds seen so far": distinct pseud labels over this account's
 * byline rows at ANY position (Part B: co-authoring under a pseud counts) on
 * LIVE works, with per-pseud work counts (drives the author page's pseud
 * sub-filter). Unpseuded byline URLs label as the account name itself.
 * Empty for authors with no byline rows (non-AO3, Anonymous).
 */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');
	const row = db.prepare('SELECT notes FROM authors WHERE name = ?').get(params.name) as
		| { notes: string | null }
		| undefined;
	const pseuds = db
		.prepare(
			`SELECT COALESCE(wa.pseud, wa.account) AS pseud, COUNT(DISTINCT wa.work_id) AS count
			   FROM work_authors wa
			   JOIN works w ON w.id = wa.work_id
			  WHERE wa.account = ? AND w.trashed_at IS NULL
			  GROUP BY COALESCE(wa.pseud, wa.account)
			  ORDER BY count DESC, pseud COLLATE NOCASE ASC`
		)
		.all(params.name) as { pseud: string; count: number }[];
	return json({ name: params.name, notes: row?.notes ?? null, pseuds });
};

/**
 * PATCH /api/authors/[name] — save the note. Body: { notes: string }. Upserts
 * the `authors` row; an empty / whitespace-only note is stored as NULL so the
 * page shows nothing (empty note allowed). 204 on success.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');

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
