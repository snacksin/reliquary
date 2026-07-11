import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/works/[id]/images` — the work's extracted image FILENAMES
 * (Cover Art Part A.5). Feeds the detail page's pick-a-cover gallery: AO3's
 * EPUB generator declares no covers even on illustrated fics, but the body
 * images are already extracted to `data/works/<id>/images/` — this lists
 * them so one can be picked as the cover (each renders via the existing
 * `/api/works/[id]/images/[filename]` route). Raster images only, sorted;
 * `[]` when the work has no images dir. 404 for unknown works.
 */

const RASTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) throw error(404, 'work not found');

	let files: string[];
	try {
		files = readdirSync(join('data', 'works', params.id, 'images'));
	} catch {
		return json([]);
	}
	return json(
		files
			.filter((f) => RASTER_EXTS.has(extname(f).toLowerCase()))
			.sort((a, b) => a.localeCompare(b))
	);
};
