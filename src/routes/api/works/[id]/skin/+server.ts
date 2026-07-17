import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/works/[id]/skin` — the work's creator stylesheet (WS Part 2),
 * already sanitized + #workskin-scoped at ingest (src/lib/server/skin.ts);
 * this endpoint only streams the stored file. 404 when the work has no
 * skin. Served as a real stylesheet — never inline through the HTML path —
 * so the M2.2 DOMPurify pass over chapter HTML never has to reason about
 * CSS. `no-cache` keeps a re-dropped skin fresh (the file is small).
 */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = db.prepare(`SELECT skin_path FROM works WHERE id = ?`).get(params.id) as
		| { skin_path: string | null }
		| undefined;
	if (!row?.skin_path) throw error(404, 'no skin');

	let css: string;
	try {
		css = readFileSync(row.skin_path, 'utf8');
	} catch {
		throw error(404, 'no skin');
	}
	return new Response(css, {
		headers: {
			'content-type': 'text/css; charset=utf-8',
			'cache-control': 'private, no-cache'
		}
	});
};
