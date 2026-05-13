import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '$lib/server/db';
import { parseEpub, type ParsedChapter } from '$lib/server/epub';

/**
 * Disk filename for a parsed chapter. Real chapters use `ch-N.html`
 * (matching the existing /ch/[n] route); wrappers use kind-based
 * names (`preface.html`, `summary.html`, `afterword.html`) so the
 * `data/works/{id}/` directory stays human-readable instead of
 * littering it with `ch--2.html`-style entries from the negative
 * wrapper numbers.
 */
function chapterFilename(ch: ParsedChapter): string {
	if (ch.kind === 'chapter') return `ch-${ch.number}.html`;
	return `${ch.kind}.html`;
}

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (e) {
		// SvelteKit's body-size-limit error carries { status, text } — surface it as-is.
		if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
			const err = e as { status: number; text?: string };
			throw error(err.status, err.text ?? 'Request error');
		}
		throw error(400, 'expected multipart/form-data body');
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		throw error(400, 'expected multipart field "file"');
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	// Generate work_id up front so the parser can bake it into the
	// rewritten image-src URLs in chapter HTML.
	const work_id = randomUUID();

	const workDir = join('data', 'works', work_id);

	/**
	 * Best-effort cleanup of partial data for this work. Called from
	 * every error path below so a failed ingest can't leave orphaned
	 * chapter HTML / image bytes on disk. `force: true` swallows
	 * not-found ENOENT (the typical case — parseEpub failed before
	 * any file write), and the outer catch swallows any rmSync
	 * failure so cleanup never masks the original error.
	 */
	function cleanupWorkDir() {
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			// noop — cleanup is best-effort
		}
	}

	let parsed;
	try {
		parsed = await parseEpub(buffer, work_id);
	} catch (e) {
		// Log the real failure for debugging — but ship a generic 400
		// to the client. The raw error.message from epub2 often leaks
		// the OS temp-path (e.g., "Invalid/missing file
		// /var/folders/.../reliquary-epub-{uuid}.epub") which is both
		// unhelpful UX and minor info-leak ahead of M2.2's LAN
		// exposure. See TRACKING.md working-notes for the standing
		// error-message hygiene rule.
		console.error('[upload] EPUB parse failed:', e instanceof Error ? e.message : e);
		cleanupWorkDir();
		throw error(400, 'Invalid EPUB file');
	}

	// File writes + DB inserts wrapped together so any failure cleans
	// up the on-disk artifacts AND prevents the half-written DB rows
	// from referencing missing files. The transaction below rolls
	// itself back on throw; the rmSync handles the filesystem half.
	try {
		mkdirSync(workDir, { recursive: true });

		for (const ch of parsed.chapters) {
			writeFileSync(join(workDir, chapterFilename(ch)), ch.html, 'utf8');
		}

		if (parsed.images.length > 0) {
			const imagesDir = join(workDir, 'images');
			mkdirSync(imagesDir, { recursive: true });
			for (const img of parsed.images) {
				writeFileSync(join(imagesDir, img.filename), img.buffer);
			}
		}
	} catch (e) {
		console.error('[upload] write failed:', e instanceof Error ? e.message : e);
		cleanupWorkDir();
		throw error(500, 'Failed to write work files');
	}

	const db = getDb();

	const insertWork = db.prepare(
		`INSERT INTO works (id, title, author, summary, chapter_count, word_count)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);
	const insertChapter = db.prepare(
		`INSERT INTO chapters (id, work_id, number, title, content_path, kind)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);
	// Tag upsert: ON CONFLICT lets us always get a row id back via
	// RETURNING regardless of insert vs. existing — no separate
	// SELECT-after-INSERT round trip. The DO UPDATE is a no-op write
	// just to make RETURNING fire on the conflict path.
	//
	// `personal` category rows are NEVER created by this code path.
	// See TagCategory in src/lib/server/epub.ts for the matching
	// type-level rule. Future contributors: do not add an `INSERT INTO
	// tags (category, name) VALUES ('personal', ...)` anywhere in any
	// ingest path. Personal tags are user-toggled only.
	const upsertTag = db.prepare<[string, string], { id: number }>(
		`INSERT INTO tags (category, name) VALUES (?, ?)
		 ON CONFLICT(category, name) DO UPDATE SET name = excluded.name
		 RETURNING id`
	);
	const linkWorkTag = db.prepare(
		`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`
	);

	// DB writes wrapped so a transaction failure also rolls back the
	// on-disk artifacts we just wrote — otherwise we'd have orphan
	// chapter HTML referenced by no DB row.
	try {
		db.transaction(() => {
			insertWork.run(
				work_id,
				parsed.title,
				parsed.author,
				parsed.summary,
				parsed.chapterCount,
				null
			);
			for (const ch of parsed.chapters) {
				insertChapter.run(
					randomUUID(),
					work_id,
					ch.number,
					ch.title,
					join(workDir, chapterFilename(ch)),
					ch.kind
				);
			}
			for (const tag of parsed.tags) {
				const row = upsertTag.get(tag.category, tag.name);
				if (row) linkWorkTag.run(work_id, row.id);
			}
		})();
	} catch (e) {
		console.error('[upload] DB write failed:', e instanceof Error ? e.message : e);
		cleanupWorkDir();
		throw error(500, 'Failed to record work');
	}

	return json({ work_id });
};
