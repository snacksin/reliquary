import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '$lib/server/db';
import { extractPastedSkin, sanitizeAndScopeSkin } from '$lib/server/skin';
import { applyPastedChapters, extractAo3PageChapters } from '$lib/server/pagepaste';

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

// An entire AO3 page source can run to a few MB on a long chapter; the paste
// is reduced to the skin's <style> body before the sanitizer's own 200 KB
// cap ever applies, so this only guards against absurd request bodies.
const MAX_PASTE_BYTES = 5 * 1024 * 1024;

/**
 * `PUT /api/works/[id]/skin` — paste the creator's style (WS Part 3). Body:
 * { css: string } holding whatever the user copied from AO3's view-source
 * (bare CSS, a <style> block, or the whole page — extractPastedSkin sorts it
 * out), which then rides the EXISTING #82 pipeline unchanged: sanitize →
 * #workskin-scope → data/works/<id>/skin.css → skin_path (cwd-relative, the
 * content_path convention) → serve → toggle. One skin per work (AO3's own
 * model), so a re-paste replaces. A paste with no usable CSS after the
 * sanitizer → 400 with a human message, nothing stored. The skin is never
 * hashed (#82 invariant) — dedup identity is untouched.
 *
 * WS Part 4 (2026-09-15): a whole-page paste also replaces the stored
 * chapter HTML with the page's own (src/lib/server/pagepaste.ts) so the
 * skin has its class hooks. Responds 200 { skin, chapters_updated }.
 *
 * Stamps skin_source='manual' (migration 0026) — the covers precedence
 * rule: ingest may set/replace a skin only when skin_source IS NOT
 * 'manual', and update-in-place carries the pasted file through the dir
 * swap, so a re-dropped EPUB never overwrites a paste.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const payload = (await request.json().catch(() => null)) as { css?: unknown } | null;
	if (!payload || typeof payload.css !== 'string') {
		throw error(400, 'expected { css: string }');
	}
	if (Buffer.byteLength(payload.css, 'utf8') > MAX_PASTE_BYTES) {
		throw error(400, 'That paste is too large — copy just the <style> block from the page source.');
	}

	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) throw error(404, 'work not found');

	// WS Part 4: a whole-page paste ALSO carries the chapter bodies with the
	// author's original class names — the hooks every EPUB (AO3's included,
	// all Calibre-built) strips. Extract them here; a skin-only paste (bare
	// CSS / a style block) yields null and the chapter step is skipped.
	const skinCss = sanitizeAndScopeSkin(extractPastedSkin(payload.css));
	const pasted = extractAo3PageChapters(payload.css);
	if (!skinCss && !pasted) {
		throw error(
			400,
			'Nothing usable in that paste — open the fic on AO3 (Entire Work view), View Page Source, select all, and paste the whole page here.'
		);
	}

	const workDir = join('data', 'works', params.id);
	if (!existsSync(workDir)) throw error(404, 'work not found');

	// Chapter count must match exactly: a chapter-by-chapter page view gives
	// one chapter, and a WIP page newer than the library copy gives more.
	// Either way the safe move is to refuse rather than half-replace.
	let chapters = { updated: 0, unchanged: 0 };
	if (pasted) {
		const { chapter_count } = db
			.prepare('SELECT chapter_count FROM works WHERE id = ?')
			.get(params.id) as { chapter_count: number };
		if (pasted.length !== chapter_count) {
			throw error(
				400,
				pasted.length < chapter_count
					? `That page has ${pasted.length} chapter${pasted.length === 1 ? '' : 's'} but this fic has ${chapter_count} — on AO3 pick "Entire Work" first, then View Page Source.`
					: `That page has ${pasted.length} chapters but this fic has ${chapter_count} — upload the newer EPUB first, then paste again.`
			);
		}
		chapters = applyPastedChapters(db, params.id, pasted);
	}

	if (skinCss) {
		const skinPath = join(workDir, 'skin.css');
		writeFileSync(skinPath, skinCss, 'utf8');
		db.prepare(`UPDATE works SET skin_path = ?, skin_source = 'manual' WHERE id = ?`).run(
			skinPath,
			params.id
		);
	}
	// `chapters_unchanged` lets the client tell "the paste had no chapters"
	// (CSS-only) apart from "the chapters were already identical" (re-paste).
	return json({
		skin: skinCss !== null,
		chapters_updated: chapters.updated,
		chapters_unchanged: chapters.unchanged
	});
};

/**
 * `DELETE /api/works/[id]/skin` — clear back to the no-skin state (WS
 * Part 3). Removes the stored skin.css (best-effort — whether it came from
 * ingest extraction or a paste, skin_path is its only owner) and nulls
 * BOTH skin columns, so the reader drops the <link> and the settings
 * toggle disappears — and the work returns to EXTRACTABLE: with
 * skin_source no longer 'manual', a later re-drop may set an 'epub' skin
 * again. Idempotent.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = db.prepare(`SELECT skin_path FROM works WHERE id = ?`).get(params.id) as
		| { skin_path: string | null }
		| undefined;
	if (!row) throw error(404, 'work not found');

	if (row.skin_path) {
		try {
			unlinkSync(row.skin_path);
		} catch {
			/* already gone — fine */
		}
	}
	db.prepare(`UPDATE works SET skin_path = NULL, skin_source = NULL WHERE id = ?`).run(params.id);
	return new Response(null, { status: 204 });
};
