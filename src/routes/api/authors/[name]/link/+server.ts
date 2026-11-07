import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { authorKeyExists, linkAuthor, unlinkAuthor } from '$lib/server/authors';

/**
 * Author links (2026-11-07): one writer under two bylines — usually a
 * FanFiction.net name exported through FicHub and the same writer's AO3
 * account. See author_links (0030) and refreshAuthorLinks in authors.ts.
 *
 * The `[name]` param is the author key of the page the request comes from
 * (SvelteKit decodes it). Same-origin only via the global CSRF check in
 * hooks.server.ts, like every other mutating endpoint.
 */

async function readField(request: Request, field: string): Promise<string> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const value = (body as Record<string, unknown>)?.[field];
	if (typeof value !== 'string' || value.trim() === '') throw error(400, `${field} is required`);
	return value;
}

/**
 * POST /api/authors/[name]/link — body { target }. Links this (FicHub-only)
 * author onto `target`; its works then appear on the target's page. 204.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');
	const target = await readField(request, 'target');
	try {
		linkAuthor(db, params.name, target);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'could not link');
	}
	return new Response(null, { status: 204 });
};

/**
 * DELETE /api/authors/[name]/link — body { alias }. Unlinks `alias` from
 * this author; the alias's works go back to their own page and the auto
 * pass won't re-link them. 204.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (!authorKeyExists(db, params.name)) throw error(404, 'author not found');
	const alias = await readField(request, 'alias');
	try {
		unlinkAuthor(db, params.name, alias);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'could not unlink');
	}
	return new Response(null, { status: 204 });
};
