import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db';
import {
	extractCanonicalAo3Url,
	parseEpub,
	type ParsedChapter,
	type ParsedEpub,
	type ParsedImage
} from './epub';
import { computeContentHash } from './identity';

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

/**
 * M2.3 Step 3: outcome of an ingest, after the dedup decision table
 * (M2.3.md §Step 3). Only `created` and `updated` actually write a fic;
 * `duplicate` and `stale` are no-ops on content (the upload is rejected
 * with a friendly message and a link to the existing `work_id`).
 * `restored` is true when the matched work was in Trash and got
 * un-trashed by this upload (restore-then-apply).
 */
export type IngestResult =
	| { status: 'created' | 'updated'; work_id: string; title: string }
	| { status: 'duplicate'; work_id: string; title: string; restored: boolean }
	| {
			status: 'stale';
			work_id: string;
			title: string;
			existingChapters: number;
			incomingChapters: number;
			restored: boolean;
	  };

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

/** Write a parsed work's chapter HTML + images into `targetDir`. */
function writeWorkFiles(targetDir: string, chapters: ParsedChapter[], images: ParsedImage[]) {
	mkdirSync(targetDir, { recursive: true });
	for (const ch of chapters) {
		writeFileSync(join(targetDir, chapterFilename(ch)), ch.html, 'utf8');
	}
	if (images.length > 0) {
		const imagesDir = join(targetDir, 'images');
		mkdirSync(imagesDir, { recursive: true });
		for (const img of images) {
			writeFileSync(join(imagesDir, img.filename), img.buffer);
		}
	}
}

/**
 * Re-point a chapter's embedded image srcs from one work id to another.
 * parseEpub bakes the parse-time id into every `/api/works/<id>/images/`
 * URL; for an update-in-place the content moves under the EXISTING
 * work's id, so the URLs have to follow. Pure string swap (the content
 * hash already normalizes this prefix out, so identity is unaffected).
 */
function remapImageSrcs(chapters: ParsedChapter[], fromId: string, toId: string): ParsedChapter[] {
	if (fromId === toId) return chapters;
	const from = `/api/works/${fromId}/images/`;
	const to = `/api/works/${toId}/images/`;
	return chapters.map((ch) => ({ ...ch, html: ch.html.split(from).join(to) }));
}

/**
 * Replace `finalDir`'s contents with `stagingDir`, non-destructively.
 * The old directory is renamed aside first and only removed once the
 * staging dir is safely in place; on failure the old dir is restored.
 * Preservation matters here — a half-written update must never lose the
 * existing fic.
 */
function swapWorkDir(finalDir: string, stagingDir: string) {
	if (!existsSync(finalDir)) {
		renameSync(stagingDir, finalDir);
		return;
	}
	const backup = `${finalDir}.bak-${randomUUID()}`;
	renameSync(finalDir, backup);
	try {
		renameSync(stagingDir, finalDir);
	} catch (e) {
		// Put the original back so the work survives a swap fault.
		try {
			renameSync(backup, finalDir);
		} catch {
			/* if even the restore fails, the backup dir is left on disk for manual recovery */
		}
		throw e;
	}
	rmSync(backup, { recursive: true, force: true });
}

/**
 * Look an incoming fic up against the library by its dedup identity.
 * source_url is primary; content_hash is the fallback for URL-less fics.
 * Returns the matched work + which decision-table branch applies, or
 * null for a genuinely new fic. The library may already hold same-URL
 * duplicates (POC + Step 2 testing), so the URL path compares against
 * the richest existing copy (most chapters).
 */
type MatchRow = {
	id: string;
	title: string;
	chapter_count: number;
	content_hash: string | null;
	trashed_at: string | null;
};

function findMatch(
	db: ReturnType<typeof getDb>,
	sourceUrl: string | null,
	contentHash: string,
	incomingChapters: number
): { kind: 'duplicate' | 'update' | 'stale'; row: MatchRow } | null {
	if (sourceUrl) {
		const candidates = db
			.prepare(
				`SELECT id, title, chapter_count, content_hash, trashed_at
				 FROM works WHERE source_url = ?
				 ORDER BY chapter_count DESC, ingested_at DESC`
			)
			.all(sourceUrl) as MatchRow[];
		if (candidates.length === 0) return null;
		const exact = candidates.find((c) => c.content_hash === contentHash);
		if (exact) return { kind: 'duplicate', row: exact };
		const richest = candidates[0];
		return incomingChapters >= richest.chapter_count
			? { kind: 'update', row: richest }
			: { kind: 'stale', row: richest };
	}
	// URL-less: only exact content_hash counts as already-in-library. A
	// URL-less WIP gains a new hash and has no stable identity across
	// chapter changes, so it correctly falls through to a new row.
	const exact = db
		.prepare(
			`SELECT id, title, chapter_count, content_hash, trashed_at
			 FROM works WHERE content_hash = ? LIMIT 1`
		)
		.get(contentHash) as MatchRow | undefined;
	return exact ? { kind: 'duplicate', row: exact } : null;
}

/**
 * Ingest a single EPUB from buffer. Parses, then applies the M2.3 Step 3
 * dedup decision table BEFORE writing anything:
 *
 *   - new fic (no identity match)        → write + insert  → 'created'
 *   - same URL, more/equal chapters      → update in place → 'updated'
 *   - same URL, identical content_hash   → reject          → 'duplicate'
 *   - same URL, fewer chapters           → reject          → 'stale'
 *   - URL-less, content_hash already seen → reject          → 'duplicate'
 *
 * A matched work that's in Trash is restored (`trashed_at = NULL`) before
 * the branch is applied. Only `created`/`updated` touch disk; the reject
 * branches are no-ops on content. The single mutation (update-in-place)
 * preserves the work row — `favorited_at`, `reading_progress`, and all
 * tag-manager state (`tags` rows, `tag_aliases` edges, hide flags) — and
 * rewrites only this work's chapters + `work_tags`.
 *
 * On parse/write/db failure: logs the real error against `sourceLabel`,
 * removes any partial dir, and throws `IngestError` with a generic
 * client-safe message + a `code` discriminator.
 */
export async function ingestEpub(buffer: Buffer, sourceLabel: string): Promise<IngestResult> {
	const parseId = randomUUID();

	let parsed: ParsedEpub;
	try {
		parsed = await parseEpub(buffer, parseId);
	} catch (e) {
		console.error(
			`[ingest] EPUB parse failed for ${sourceLabel}:`,
			e instanceof Error ? e.message : e
		);
		throw new IngestError('Invalid EPUB file', 'parse', { cause: e });
	}

	// M2.3 dedup identity. source_url (preface AO3 link) is primary;
	// content_hash (normalized real-chapter content, id-independent) is
	// the fallback. See identity.ts.
	const prefaceChapter = parsed.chapters.find((c) => c.kind === 'preface');
	const sourceUrl = extractCanonicalAo3Url(prefaceChapter?.html ?? '');
	const contentHash = computeContentHash(parseId, parsed.title, parsed.author, parsed.chapters);

	const db = getDb();
	const match = findMatch(db, sourceUrl, contentHash, parsed.chapterCount);

	const restoreIfTrashed = db.prepare(
		`UPDATE works SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL`
	);

	// ── Reject branches: no disk write, no new row. Restore-then-apply. ──
	if (match && (match.kind === 'duplicate' || match.kind === 'stale')) {
		const restored = restoreIfTrashed.run(match.row.id).changes > 0;
		if (match.kind === 'duplicate') {
			return { status: 'duplicate', work_id: match.row.id, title: match.row.title, restored };
		}
		return {
			status: 'stale',
			work_id: match.row.id,
			title: match.row.title,
			existingChapters: match.row.chapter_count,
			incomingChapters: parsed.chapterCount,
			restored
		};
	}

	// Tag upsert: ON CONFLICT lets us always get a row id back via
	// RETURNING regardless of insert vs. existing — no separate
	// SELECT-after-INSERT round trip, and existing tags keep their
	// tag_id so /tags aliases + hide flags survive an update untouched.
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
	const linkWorkTag = db.prepare(`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`);

	// ── Update-in-place: the WIP-got-new-chapters path. ──
	if (match && match.kind === 'update') {
		const finalId = match.row.id;
		const finalDir = join('data', 'works', finalId);
		const stagingDir = join('data', 'works', `.staging-${parseId}`);
		const chapters = remapImageSrcs(parsed.chapters, parseId, finalId);

		try {
			writeWorkFiles(stagingDir, chapters, parsed.images);
		} catch (e) {
			console.error(`[ingest] staging write failed for ${sourceLabel}:`, e instanceof Error ? e.message : e);
			try {
				rmSync(stagingDir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
			throw new IngestError('Failed to write work files', 'write', { cause: e });
		}

		const updateWork = db.prepare(
			`UPDATE works
			   SET title = ?, author = ?, summary = ?, chapter_count = ?,
			       content_hash = ?, trashed_at = NULL
			 WHERE id = ?`
		);
		const deleteChapters = db.prepare(`DELETE FROM chapters WHERE work_id = ?`);
		const deleteWorkTags = db.prepare(`DELETE FROM work_tags WHERE work_id = ?`);
		const insertChapter = db.prepare(
			`INSERT INTO chapters (id, work_id, number, title, content_path, kind)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);

		try {
			db.transaction(() => {
				// trashed_at = NULL here also performs the restore-then-apply
				// for a matched-in-trash WIP update. FK rows (reading_progress,
				// favorited_at on works) are left untouched.
				updateWork.run(
					parsed.title,
					parsed.author,
					parsed.summary,
					parsed.chapterCount,
					contentHash,
					finalId
				);
				deleteChapters.run(finalId);
				for (const ch of chapters) {
					insertChapter.run(
						randomUUID(),
						finalId,
						ch.number,
						ch.title,
						join(finalDir, chapterFilename(ch)),
						ch.kind
					);
				}
				// Rewrite ONLY this work's work_tags. upsertTag keeps shared
				// tags rows (and thus tag_aliases edges + hide flags) intact.
				deleteWorkTags.run(finalId);
				for (const tag of parsed.tags) {
					const row = upsertTag.get(tag.category, tag.name);
					if (row) linkWorkTag.run(finalId, row.id);
				}
			})();
		} catch (e) {
			console.error(`[ingest] DB update failed for ${sourceLabel}:`, e instanceof Error ? e.message : e);
			try {
				rmSync(stagingDir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
			throw new IngestError('Failed to record work', 'db', { cause: e });
		}

		// DB committed; move the new content into place (old dir kept until
		// the swap succeeds). content_path already points at finalDir.
		try {
			swapWorkDir(finalDir, stagingDir);
		} catch (e) {
			console.error(
				`[ingest] dir swap failed for ${sourceLabel} (DB updated, on-disk content may be stale):`,
				e instanceof Error ? e.message : e
			);
			throw new IngestError('Failed to write work files', 'write', { cause: e });
		}

		return { status: 'updated', work_id: finalId, title: parsed.title };
	}

	// ── New work. ──
	const work_id = parseId;
	const workDir = join('data', 'works', work_id);

	function cleanupWorkDir() {
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup; never mask the original error
		}
	}

	try {
		writeWorkFiles(workDir, parsed.chapters, parsed.images);
	} catch (e) {
		console.error(`[ingest] write failed for ${sourceLabel}:`, e instanceof Error ? e.message : e);
		cleanupWorkDir();
		throw new IngestError('Failed to write work files', 'write', { cause: e });
	}

	const insertWork = db.prepare(
		`INSERT INTO works (id, title, author, summary, chapter_count, word_count, source_url, content_hash)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insertChapter = db.prepare(
		`INSERT INTO chapters (id, work_id, number, title, content_path, kind)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	try {
		db.transaction(() => {
			insertWork.run(
				work_id,
				parsed.title,
				parsed.author,
				parsed.summary,
				parsed.chapterCount,
				null,
				sourceUrl,
				contentHash
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
		console.error(`[ingest] DB write failed for ${sourceLabel}:`, e instanceof Error ? e.message : e);
		cleanupWorkDir();
		throw new IngestError('Failed to record work', 'db', { cause: e });
	}

	return { status: 'created', work_id, title: parsed.title };
}
