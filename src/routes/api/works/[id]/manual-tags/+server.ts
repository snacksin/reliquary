import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Manual tags (2026-11-09): hand-added AO3-category tags for works whose
 * EPUB carries none — FicHub exports (FanFiction.net has no AO3-style tag
 * system), plus `unknown`-source files. They use the SAME `tags` vocabulary
 * and `work_tags` links as parsed tags, so every browse path AO3 tags feed
 * (sidebar filter sections, alias expansion, author-page sidebars) picks
 * them up with no query change. What marks them is `work_tags.source =
 * 'manual'` (migration 0031), which the ingest rewrite never deletes — a
 * FicHub re-upload or a twin update keeps them.
 *
 * Rules (Allie, 2026-11-09):
 *   - adding is for non-AO3 works only (`works.source != 'ao3'`). AO3 works
 *     keep AO3's own tags. Removing a manual link works on any work, so a
 *     FanFiction.net fic later overtaken by its AO3 twin can still be tidied.
 *   - all seven AO3 categories. rating / warning / category are AO3's fixed
 *     lists, so those pick from the existing vocabulary only; the other four
 *     find-or-create (case-insensitively, like personal tags).
 *   - one rating per work: a new manual rating replaces the old manual one.
 *
 * This route never reads or writes `personal` tags (their own route is
 * ../tags) and never removes a parsed (`extracted`) link.
 */

const CATEGORIES = [
	'rating',
	'warning',
	'category',
	'fandom',
	'relationship',
	'character',
	'freeform'
] as const;
type Category = (typeof CATEGORIES)[number];

/** AO3's fixed lists — pick-only, never created by hand. */
const FIXED: ReadonlySet<Category> = new Set(['rating', 'warning', 'category']);

/** Tag names past this are surely a paste accident. */
const MAX_NAME = 200;

type TagRow = { id: number; category: Category; name: string };

function isCategory(v: unknown): v is Category {
	return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (body && typeof body === 'object') return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	throw error(400, 'invalid JSON body');
}

/**
 * POST /api/works/[id]/manual-tags — body { category, name }. Find-or-creates
 * the tag and links it with source = 'manual'. Idempotent: a tag already on
 * the work (parsed or manual) is returned unchanged. 201 { id, category, name }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const work = db.prepare('SELECT source FROM works WHERE id = ?').get(params.id) as
		| { source: string | null }
		| undefined;
	if (!work) throw error(404, 'work not found');
	if (work.source === 'ao3') throw error(409, 'AO3 fics keep the tags AO3 gave them');

	const body = await readBody(request);
	if (!isCategory(body.category)) throw error(400, 'unknown tag category');
	const category = body.category;
	if (typeof body.name !== 'string') throw error(400, 'name must be a string');
	const name = body.name.trim().replace(/\s+/g, ' ');
	if (name.length === 0) throw error(400, 'name must not be empty');
	if (name.length > MAX_NAME) throw error(400, 'tag name is too long');

	const tag = db.transaction((): TagRow => {
		let row = db
			.prepare(
				`SELECT id, category, name FROM tags
				  WHERE category = ? AND name = ? COLLATE NOCASE
				  ORDER BY id LIMIT 1`
			)
			.get(category, name) as TagRow | undefined;
		if (!row) {
			if (FIXED.has(category)) throw error(400, `pick an existing ${category} tag`);
			const info = db
				.prepare(`INSERT INTO tags (category, name) VALUES (?, ?)`)
				.run(category, name);
			row = { id: Number(info.lastInsertRowid), category, name };
		}
		if (category === 'rating') {
			db.prepare(
				`DELETE FROM work_tags
				  WHERE work_id = ? AND source = 'manual' AND tag_id != ?
				    AND tag_id IN (SELECT id FROM tags WHERE category = 'rating')`
			).run(params.id, row.id);
		}
		db.prepare(
			`INSERT INTO work_tags (work_id, tag_id, source) VALUES (?, ?, 'manual')
			 ON CONFLICT(work_id, tag_id) DO NOTHING`
		).run(params.id, row.id);
		return row;
	})();

	return json(tag, { status: 201 });
};

/**
 * DELETE /api/works/[id]/manual-tags — body { id }. Removes this work's
 * MANUAL link to that tag; a parsed link or a personal tag id is a no-op.
 * If that leaves the tag on no work at all, with no alias edges and no hide
 * flag (a typo, say), the tag row goes too, so it doesn't linger in the
 * sidebar at count 0. Idempotent. 204.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	if (db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id) === undefined) {
		throw error(404, 'work not found');
	}
	const body = await readBody(request);
	const id = body.id;
	if (typeof id !== 'number' || !Number.isInteger(id)) throw error(400, 'id must be an integer');

	db.transaction(() => {
		const removed = db
			.prepare(
				`DELETE FROM work_tags
				  WHERE work_id = ? AND tag_id = ? AND source = 'manual'
				    AND tag_id IN (SELECT id FROM tags WHERE category != 'personal')`
			)
			.run(params.id, id).changes;
		if (removed === 0) return;
		db.prepare(
			`DELETE FROM tags
			  WHERE id = ? AND category != 'personal' AND hide_from_sidebar = 0
			    AND NOT EXISTS (SELECT 1 FROM work_tags WHERE tag_id = tags.id)
			    AND NOT EXISTS (SELECT 1 FROM tag_aliases
			                     WHERE parent_tag_id = tags.id OR alias_tag_id = tags.id)`
		).run(id);
	})();

	return new Response(null, { status: 204 });
};
