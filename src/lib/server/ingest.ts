import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db';
import { parseEpub, type ParsedChapter } from './epub';

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

export type IngestResult = { work_id: string };

/**
 * Phases of ingestion where a failure originated. Used by the upload
 * endpoints to pick the right HTTP status (`parse` → 400 for invalid
 * input, `write` / `db` → 500 for server-side problems) and by the
 * bulk endpoint's structured failure log.
 */
export type IngestErrorCode = 'parse' | 'write' | 'db';

export class IngestError extends Error {
	readonly code: IngestErrorCode;
	constructor(message: string, code: IngestErrorCode, options?: { cause?: unknown }) {
		super(message, options);
		this.code = code;
		this.name = 'IngestError';
	}
}

/**
 * Ingest a single EPUB from buffer: parse, write chapter HTML + images
 * to disk, insert the work + chapters + tags into the DB. On success
 * returns the new work_id.
 *
 * On any failure:
 *   - Logs the real error (with the `sourceLabel` from the caller —
 *     filename, batch index, etc.) so server-side debugging works.
 *   - Removes the partial `data/works/<id>/` directory so a failed
 *     ingest can't leave orphans.
 *   - Throws `IngestError` with a generic client-safe message and a
 *     `code` discriminator (`parse` / `write` / `db`) so callers can
 *     map to status codes or aggregate failures structurally.
 *
 * Designed to be safe to call concurrently for distinct work_ids
 * (each gets its own randomUUID), but the bulk endpoint calls it
 * sequentially to keep the streaming progress order well-defined.
 */
export async function ingestEpub(
	buffer: Buffer,
	sourceLabel: string
): Promise<IngestResult> {
	const work_id = randomUUID();
	const workDir = join('data', 'works', work_id);

	function cleanupWorkDir() {
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup; never mask the original error
		}
	}

	let parsed;
	try {
		parsed = await parseEpub(buffer, work_id);
	} catch (e) {
		console.error(
			`[ingest] EPUB parse failed for ${sourceLabel}:`,
			e instanceof Error ? e.message : e
		);
		cleanupWorkDir();
		throw new IngestError('Invalid EPUB file', 'parse', { cause: e });
	}

	// File writes wrapped so any I/O failure cleans up the on-disk
	// artifacts. The DB transaction below cleans itself up on throw;
	// rmSync handles the filesystem half.
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
		console.error(
			`[ingest] write failed for ${sourceLabel}:`,
			e instanceof Error ? e.message : e
		);
		cleanupWorkDir();
		throw new IngestError('Failed to write work files', 'write', { cause: e });
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
		console.error(
			`[ingest] DB write failed for ${sourceLabel}:`,
			e instanceof Error ? e.message : e
		);
		cleanupWorkDir();
		throw new IngestError('Failed to record work', 'db', { cause: e });
	}

	return { work_id };
}
