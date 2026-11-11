import { randomUUID } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db';
import {
	extractSourceUrl,
	extractSeriesEntries,
	detectSource,
	decodeEntities,
	fixDoubleEncodedHeading,
	parseEpub,
	type ParsedChapter,
	type ParsedEpub,
	type ParsedImage
} from './epub';
import { computeContentHash, countWords, hashChapterContent } from './identity';
import { syncWorkSeries } from './series';
import {
	extractWorkAuthors,
	incomingAuthorKeys,
	linkedWorkAuthors,
	parseFichubByline,
	refreshAuthorLinks,
	syncWorkAuthors
} from './authors';
import { isFichubSource, sanitizeAndScopeSkin, stripCalibreBoilerplate } from './skin';

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

/**
 * M2.2 Step 4 (error hygiene): the CLIENT-FACING text for an ingest
 * failure, derived from the code — never from .message. Every string a
 * stranger can see lives in this one switch, so no future IngestError
 * construction site can accidentally put a path or an exception detail
 * into a response body. The rich detail stays in .message/.cause and
 * the server log.
 */
export function publicIngestMessage(e: IngestError): string {
	switch (e.code) {
		case 'parse':
			return 'Invalid EPUB file';
		case 'write':
			return 'Failed to write work files';
		default:
			return 'Failed to record work';
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

/** Which site a canonical source URL (normalizeSourceUrl) belongs to. */
function siteOf(url: string | null): 'ao3' | 'ffn' | null {
	if (!url) return null;
	if (/archiveofourown\.org\/works\//i.test(url)) return 'ao3';
	if (/fanfiction\.net\/s\//i.test(url)) return 'ffn';
	return null;
}

/**
 * Title comparison key for cross-site twins: lowercase, curly quotes and
 * dashes folded, everything but letters/digits dropped ("Rhaegar's Odes"
 * vs "Rhaegar’s  Odes!" match). Unicode letters are kept (accents count).
 */
export function normalizeTitle(s: string): string {
	return s
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[‘’‛′]/g, "'")
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Twin identity of an incoming fic: the same story the author cross-posted
 * to another site (AO3 ↔ FanFiction.net), which has an unrelated source URL.
 */
type TwinKey = { site: 'ao3' | 'ffn'; titleKey: string; authorKeys: string[] };

/**
 * Cross-site twin lookup (2026-11-07, Allie: "one fic, newest wins").
 * Only reached when the incoming fic's source URL matched nothing. A twin is
 * an existing work on a DIFFERENT known site with the same title key and an
 * overlapping author key (parsed/linked account, else the raw byline — so
 * author links decide "same author"). Exactly one candidate or nothing:
 * several means we can't tell which, and a same-site look-alike is never a
 * twin (two AO3 works can share a title).
 *
 * Decision differs from the same-URL table on equal counts: across sites a
 * different file with the same number of chapters is the same fic, not an
 * edit, so it's a duplicate (no churn between differently formatted copies).
 */
function findTwin(
	db: ReturnType<typeof getDb>,
	twin: TwinKey,
	incomingChapters: number
): { kind: 'duplicate' | 'update' | 'stale'; row: MatchRow; twin: true } | null {
	if (twin.authorKeys.length === 0 || !twin.titleKey) return null;
	const keys = twin.authorKeys;
	const marks = keys.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT DISTINCT w.id, w.title, w.chapter_count, w.content_hash, w.trashed_at,
			        w.source_url AS source_url
			   FROM works w
			  WHERE w.source_url IS NOT NULL
			    AND (EXISTS (SELECT 1 FROM work_authors wa
			                  WHERE wa.work_id = w.id AND wa.account IN (${marks}))
			         OR (w.author IN (${marks})
			             AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.work_id = w.id)))`
		)
		.all(...keys, ...keys) as (MatchRow & { source_url: string })[];
	const twins = rows.filter((r) => {
		const site = siteOf(r.source_url);
		return site !== null && site !== twin.site && normalizeTitle(r.title) === twin.titleKey;
	});
	if (twins.length !== 1) return null;
	const row = twins[0];
	const kind =
		incomingChapters > row.chapter_count
			? 'update'
			: incomingChapters < row.chapter_count
				? 'stale'
				: 'duplicate';
	return { kind, row, twin: true };
}

function findMatch(
	db: ReturnType<typeof getDb>,
	sourceUrl: string | null,
	contentHash: string,
	incomingChapters: number,
	twin: TwinKey | null
): { kind: 'duplicate' | 'update' | 'stale'; row: MatchRow; twin?: true } | null {
	if (sourceUrl) {
		const candidates = db
			.prepare(
				`SELECT id, title, chapter_count, content_hash, trashed_at
				 FROM works WHERE source_url = ?
				 ORDER BY chapter_count DESC, ingested_at DESC`
			)
			.all(sourceUrl) as MatchRow[];
		if (candidates.length === 0) return twin ? findTwin(db, twin, incomingChapters) : null;
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
	const result = await ingestEpubOnce(buffer, sourceLabel);
	// Author links: a new AO3 fic can be the account an existing FicHub
	// name auto-matches (and a new FicHub fic may need its derived rows).
	// A convenience only — never fails an upload that already succeeded.
	try {
		refreshAuthorLinks(getDb());
	} catch (e) {
		console.error('[author-links] refresh after ingest failed', e);
	}
	return result;
}

async function ingestEpubOnce(buffer: Buffer, sourceLabel: string): Promise<IngestResult> {
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
	// MS Step 2: canonical original-source URL — AO3-native via the existing
	// "Posted originally…" anchor, else FicHub's "Original source:" link
	// normalized per site. Feeds M2.3's findMatch unchanged, so a FicHub
	// re-upload now dedups instead of duplicating.
	const sourceUrl = extractSourceUrl(prefaceChapter?.html ?? '');
	// content_hash is computed from the RAW extracted title/author (the
	// historical value), NOT the decoded display strings below — so the dedup
	// key stays byte-identical to every previously-stored hash and a re-upload
	// still matches. The decoded title/author are a display concern only.
	const contentHash = computeContentHash(parseId, parsed.title, parsed.author, parsed.chapters);
	// 🔴 Hash-from-raw (#64 precedent): the dedup hash above is computed on the
	// RAW chapter HTML, BEFORE the heading normalization below — so identity
	// keys never move and a re-upload of the same EPUB still matches every
	// previously-stored works.content_hash. Everything downstream (staged
	// files, per-chapter hashChapterContent stamps, edit detection) sees only
	// the normalized form, so the stored file and the incoming side of a
	// future re-drop always compare like-for-like (no spurious history
	// archives).
	parsed.chapters = parsed.chapters.map((ch) => ({
		...ch,
		html: fixDoubleEncodedHeading(ch.html)
	}));
	// Decode HTML entities in the title/author for storage + display (the EPUB
	// `<dc:title>`/`<dc:creator>` can carry `&amp;`, `&#39;`, etc.). Mirrors how
	// chapter titles, tags, and series names are already decoded at parse time.
	// Summary is left raw — it's rendered with `{@html}`, so the browser decodes
	// its entities, and decoding here would corrupt embedded AO3 markup.
	const displayTitle = decodeEntities(parsed.title);
	const displayAuthor = decodeEntities(parsed.author);
	// Series Pages Part 1: memberships parsed from the preface "Series:" line.
	// Written to series/series_works inside whichever write transaction fires.
	const seriesEntries = extractSeriesEntries(prefaceChapter?.html ?? '');
	// MS Step 1: where this EPUB came from (ao3 / fichub-* / unknown), from the
	// same preface. Recorded on the works row; identical logic to the backfill.
	const source = detectSource(prefaceChapter?.html ?? '');
	// Author Identity Part A: byline authors from the rel="author" LINKS
	// (account + pseud straight from the /users/… URL — never the display
	// string). The byline anchor lives in the SUMMARY wrapper in AO3 EPUBs,
	// so both wrappers are scanned. Other sources: see the author-links
	// block below (unlinked → no rows → works.author fallback, as before).
	// Deliberately NOT part of the content hash — computeContentHash inputs
	// above are untouched (#64 hash-from-raw stays byte-identical).
	// WS Part 2: sanitize + #workskin-scope the creator CSS once, up front —
	// what's stored is only ever this cleaned form. Null when the EPUB ships
	// no CSS or nothing survives the scrub. Not a hash input. Calibre's own
	// flattened stylesheet is NOT a skin — strip it (skin.ts) so a plain fic
	// doesn't come in wearing a font override and stretched images.
	// FicHub's stylesheets aren't a skin either (2026-11-08): FicHub builds
	// its own EPUB, so its CSS is never the author's. Its main.css forces
	// Verdana, and its unlinked nav.css says `BODY {color: white;}`, which
	// turned whole fics white. A FicHub export carries no skin at all
	// (a pasted one is still allowed later; that's 'manual').
	const skinCss = isFichubSource(source)
		? null
		: stripCalibreBoilerplate(sanitizeAndScopeSkin(parsed.skinCss));

	const db = getDb();

	// Author links (2026-11-07): a FicHub export of an AO3 fic carries the
	// byline as plain "pseud (account)" text → parsed rows; any other site's
	// name gets rows only if author_links joins it to an account (keyed by
	// the decoded display name, which is what works.author stores).
	const summaryChapter = parsed.chapters.find((c) => c.kind === 'summary');
	const workAuthors =
		source === 'ao3'
			? extractWorkAuthors((summaryChapter?.html ?? '') + (prefaceChapter?.html ?? ''))
			: source === 'fichub-ao3'
				? parseFichubByline(prefaceChapter?.html ?? '')
				: linkedWorkAuthors(db, displayAuthor);
	// Cross-site twins (2026-11-07): the same story cross-posted to AO3 and
	// FanFiction.net. Only consulted when the source URL matches nothing.
	const incomingSite = siteOf(sourceUrl);
	const twinKey: TwinKey | null = incomingSite
		? {
				site: incomingSite,
				titleKey: normalizeTitle(displayTitle),
				authorKeys: incomingAuthorKeys(db, displayAuthor, workAuthors)
			}
		: null;
	const match = findMatch(db, sourceUrl, contentHash, parsed.chapterCount, twinKey);
	// A twin update from a non-AO3 copy brings newer CHAPTERS only: the
	// AO3 work keeps its title/author/summary, source + source_url, tags,
	// series, author rows, cover, skin and its preface/summary/end-notes
	// pages (FanFiction.net has none of that richness). An AO3 copy
	// arriving ahead of a non-AO3 one is a normal full update instead, plus
	// the AO3 source_url so later AO3 downloads match by URL.
	const twinUpdate = match?.twin === true && match.kind === 'update';
	const keepIdentity = twinUpdate && incomingSite !== 'ao3';

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
	// source defaults to 'extracted' (migration 0031). OR IGNORE: a link the
	// user already added by hand keeps source = 'manual'.
	const linkWorkTag = db.prepare(`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`);

	// ── Update-in-place: the WIP-got-new-chapters / edited-chapter path. ──
	if (match && match.kind === 'update') {
		const finalId = match.row.id;
		const finalDir = join('data', 'works', finalId);
		const stagingDir = join('data', 'works', `.staging-${parseId}`);
		// keepIdentity (cross-site twin from a non-AO3 copy): only the REAL
		// chapters come from the incoming EPUB; the work's own preface /
		// summary / end-notes pages stay (carried into staging below).
		const remapped = remapImageSrcs(parsed.chapters, parseId, finalId);
		const chapters = keepIdentity ? remapped.filter((c) => c.kind === 'chapter') : remapped;

		// Existing chapter rows, keyed by number. Update-in-place reconciles
		// against these (preserving real-chapter ids) rather than
		// delete+reinsert, so chapter_history.chapter_id stays valid as a
		// chapter is edited across multiple updates.
		type ExistingChapter = {
			id: string;
			number: number;
			kind: string;
			content_path: string;
		};
		const existingChapters = db
			.prepare(`SELECT id, number, kind, content_path FROM chapters WHERE work_id = ?`)
			.all(finalId) as ExistingChapter[];
		const existingByNumber = new Map(existingChapters.map((c) => [c.number, c]));
		const incomingNumbers = new Set(chapters.map((c) => c.number));
		// Kept wrappers count as present, so the reconcile below doesn't
		// delete their rows.
		const keptWrappers = keepIdentity ? existingChapters.filter((c) => c.kind !== 'chapter') : [];
		for (const w of keptWrappers) incomingNumbers.add(w.number);

		// Chapter History (DESIGN §6.7b): for each EXISTING real chapter
		// whose stored HTML differs from the incoming HTML, stage the OLD
		// version into _history before the swap overwrites it. Filesystem-
		// safe ISO timestamp; uniqueness is guaranteed across updates (ms
		// precision differs) and within an update (the chapter number
		// differs per file).
		const archiveTs = new Date().toISOString().replace(/[:.]/g, '-');
		type ArchiveEntry = {
			chapterId: string;
			previousHash: string;
			previousPath: string;
			wordCount: number;
		};
		const archives: ArchiveEntry[] = [];

		// Cover precedence (Cover Art Part A): a manually-set cover ALWAYS
		// survives a re-upload — its file must ride the dir swap like
		// _history does. Extracted ('epub') covers instead track the incoming
		// EPUB: re-pointed at the new parse's cover, or CLEARED when the new
		// upload has none (the old extracted file won't exist post-swap).
		const existingCover = db
			.prepare(`SELECT cover_path, cover_source FROM works WHERE id = ?`)
			.get(finalId) as { cover_path: string | null; cover_source: string | null } | undefined;
		const keepManualCover = existingCover?.cover_source === 'manual';
		// keepIdentity keeps ANY existing cover (an AO3 work's extracted one
		// too): a FanFiction.net copy has no cover worth replacing it with.
		const keepCover = keepManualCover || (keepIdentity && !!existingCover?.cover_path);

		// Skin precedence (WS Part 3): same rule as covers — a PASTED
		// ('manual') skin always survives a re-drop; extracted ('epub') skins
		// keep tracking the incoming EPUB.
		// keepIdentity keeps an extracted skin too (same reasoning as covers).
		const keepManualSkin =
			keepIdentity ||
			(
				db.prepare(`SELECT skin_source FROM works WHERE id = ?`).get(finalId) as {
					skin_source: string | null;
				}
			).skin_source === 'manual';

		try {
			writeWorkFiles(stagingDir, chapters, parsed.images);

			// Carry any prior archives forward — the dir swap below replaces
			// the whole work dir, so existing _history must live in staging
			// or it'd be lost. Archives are never deleted by the update path.
			const existingHistoryDir = join(finalDir, '_history');
			const stagingHistoryDir = join(stagingDir, '_history');
			if (existsSync(existingHistoryDir)) {
				cpSync(existingHistoryDir, stagingHistoryDir, { recursive: true });
			}

			// WS Part 2/3: a pasted ('manual') skin's file must ride the dir
			// swap like the manual cover / _history below, or it'd be lost —
			// carry it and IGNORE the incoming EPUB's CSS. Otherwise the
			// incoming (sanitized) skin rides staging like every other
			// ingest-owned file; skin-less upload → no file → the swap clears
			// the old one naturally.
			if (keepManualSkin) {
				const src = join(finalDir, 'skin.css');
				if (existsSync(src)) {
					cpSync(src, join(stagingDir, 'skin.css'));
				}
			} else if (skinCss) {
				writeFileSync(join(stagingDir, 'skin.css'), skinCss, 'utf8');
			}

			// Carry a manual cover file forward (same reasoning as _history).
			// cover_path is cwd-relative under finalDir; re-root it to staging.
			if (keepManualCover && existingCover.cover_path) {
				const coverFile = existingCover.cover_path.split('/').pop() ?? '';
				const src = join(finalDir, coverFile);
				if (coverFile && existsSync(src)) {
					cpSync(src, join(stagingDir, coverFile));
				}
			} else if (keepCover && existingCover?.cover_path) {
				// keepIdentity, extracted cover: it lives under images/, so keep
				// its path relative to the work dir.
				const prefix = finalDir + '/';
				if (existingCover.cover_path.startsWith(prefix)) {
					const rel = existingCover.cover_path.slice(prefix.length);
					const src = join(finalDir, rel);
					if (existsSync(src)) {
						mkdirSync(join(stagingDir, rel, '..'), { recursive: true });
						cpSync(src, join(stagingDir, rel));
					}
				}
			}

			// keepIdentity: the work's own wrapper pages ride the swap.
			for (const w of keptWrappers) {
				const prefix = finalDir + '/';
				if (!w.content_path.startsWith(prefix)) continue;
				const rel = w.content_path.slice(prefix.length);
				if (existsSync(w.content_path)) cpSync(w.content_path, join(stagingDir, rel));
			}

			for (const inc of chapters) {
				const ex = existingByNumber.get(inc.number);
				if (!ex || ex.kind !== 'chapter') continue; // appended or wrapper → nothing to archive
				let oldHtml: string;
				try {
					oldHtml = readFileSync(ex.content_path, 'utf8');
				} catch {
					continue; // missing old file → can't archive; don't fabricate
				}
				const oldHash = hashChapterContent(oldHtml, finalId);
				const newHash = hashChapterContent(inc.html, finalId);
				if (oldHash === newHash) continue; // unchanged → no archive, no row

				const archiveRel = join('_history', `ch-${inc.number}-${archiveTs}.html`);
				mkdirSync(stagingHistoryDir, { recursive: true });
				writeFileSync(join(stagingDir, archiveRel), oldHtml, 'utf8');
				archives.push({
					chapterId: ex.id,
					previousHash: oldHash,
					previousPath: join(finalDir, archiveRel),
					wordCount: countWords(oldHtml)
				});
			}
		} catch (e) {
			console.error(
				`[ingest] staging write failed for ${sourceLabel}:`,
				e instanceof Error ? e.message : e
			);
			try {
				rmSync(stagingDir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
			throw new IngestError('Failed to write work files', 'write', { cause: e });
		}

		const archiveByChapterId = new Map(archives.map((a) => [a.chapterId, a]));

		// `chapters_updated_at` is bumped only when this update GREW the
		// chapter_count — that's the signal the Continue Reading carousel uses
		// to bump a resurfaced (newly-grown) work up to its new-chapter time.
		// The CASE keeps any prior stamp when chapters didn't grow, rather than
		// nulling it out. (`chaptersGrew` is computed at the run site.)
		const updateWork = db.prepare(
			`UPDATE works
			   SET title = ?, author = ?, summary = ?, chapter_count = ?,
			       content_hash = ?, source = ?, trashed_at = NULL,
			       chapters_updated_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE chapters_updated_at END
			 WHERE id = ?`
		);
		// keepIdentity: content-only refresh — the work's metadata stays.
		const updateContent = db.prepare(
			`UPDATE works
			   SET chapter_count = ?, content_hash = ?, trashed_at = NULL,
			       chapters_updated_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE chapters_updated_at END
			 WHERE id = ?`
		);
		// Twin update from an AO3 copy: AO3 becomes the work's identity, so
		// later AO3 downloads match it by URL.
		const setSourceUrl = db.prepare(`UPDATE works SET source_url = ? WHERE id = ?`);
		// Cover columns are deliberately NOT in updateWork: they follow the
		// precedence rule (manual wins), not the metadata refresh.
		const setCover = db.prepare(`UPDATE works SET cover_path = ?, cover_source = ? WHERE id = ?`);
		// Skin columns follow the covers precedence rule (WS Part 3): ingest
		// may set/replace only when skin_source IS NOT 'manual'.
		const setSkin = db.prepare(`UPDATE works SET skin_path = ?, skin_source = ? WHERE id = ?`);
		const updateChapter = db.prepare(
			`UPDATE chapters SET title = ?, content_path = ?, kind = ?, content_hash = ? WHERE id = ?`
		);
		const insertChapter = db.prepare(
			`INSERT INTO chapters (id, work_id, number, title, content_path, kind, content_hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		);
		const deleteChapter = db.prepare(`DELETE FROM chapters WHERE id = ?`);
		const insertHistory = db.prepare(
			`INSERT INTO chapter_history (chapter_id, previous_hash, previous_path, word_count)
			 VALUES (?, ?, ?, ?)`
		);
		const stampEdited = db.prepare(
			`UPDATE chapters SET last_edited_at = CURRENT_TIMESTAMP WHERE id = ?`
		);
		// Only EPUB-parsed links are rewritten. Personal tags (you-layer) and
		// hand-added tags (manual tags, migration 0031) live in the SAME
		// work_tags table with source = 'manual' and are user-authored, so
		// the re-ingest rewrite must never touch them — that is what lets a
		// WIP update / duplicate re-upload / restore-via-re-upload keep your
		// tags (same preserved-data class as favorites/ratings/notes). The
		// personal-category guard predates the source column and stays as a
		// second lock.
		const deleteWorkTags = db.prepare(
			`DELETE FROM work_tags
			  WHERE work_id = ?
			    AND source = 'extracted'
			    AND tag_id NOT IN (SELECT id FROM tags WHERE category = 'personal')`
		);

		try {
			db.transaction(() => {
				// trashed_at = NULL here also performs the restore-then-apply
				// for a matched-in-trash WIP update. FK rows (reading_progress,
				// favorited_at on works) are left untouched.
				const chaptersGrew = parsed.chapterCount > match.row.chapter_count ? 1 : 0;
				if (keepIdentity) {
					updateContent.run(parsed.chapterCount, contentHash, chaptersGrew, finalId);
				} else {
					updateWork.run(
						displayTitle,
						displayAuthor,
						parsed.summary,
						parsed.chapterCount,
						contentHash,
						source,
						chaptersGrew,
						finalId
					);
					if (twinUpdate && sourceUrl) setSourceUrl.run(sourceUrl, finalId);
				}

				// Reconcile chapters by number: update existing rows in place
				// (preserving their ids), insert genuinely-new numbers, archive
				// the ones that changed.
				for (const inc of chapters) {
					const ex = existingByNumber.get(inc.number);
					const path = join(finalDir, chapterFilename(inc));
					const newHash = hashChapterContent(inc.html, finalId);
					if (ex) {
						updateChapter.run(inc.title, path, inc.kind, newHash, ex.id);
						const plan = archiveByChapterId.get(ex.id);
						if (plan) {
							insertHistory.run(
								plan.chapterId,
								plan.previousHash,
								plan.previousPath,
								plan.wordCount
							);
							stampEdited.run(ex.id);
						}
					} else {
						insertChapter.run(
							randomUUID(),
							finalId,
							inc.number,
							inc.title,
							path,
							inc.kind,
							newHash
						);
					}
				}
				// Drop existing rows whose number vanished from the new upload
				// (only wrappers in practice — they carry no history rows, so
				// the cascade can't lose an archive).
				for (const ex of existingChapters) {
					if (!incomingNumbers.has(ex.number)) deleteChapter.run(ex.id);
				}

				// Rewrite ONLY this work's AO3-parsed work_tags (personal and
				// manual links survive — the delete is source-scoped, and
				// linkWorkTag's INSERT OR IGNORE leaves an existing manual link
				// manual). upsertTag keeps
				// shared tags rows (and thus tag_aliases edges + hide flags)
				// intact.
				// keepIdentity skips all three: tags, series and byline rows
				// stay the AO3 work's own.
				if (!keepIdentity) {
					deleteWorkTags.run(finalId);
					for (const tag of parsed.tags) {
						const row = upsertTag.get(tag.category, tag.name);
						if (row) linkWorkTag.run(finalId, row.id);
					}

					// Series Pages Part 1: refresh this work's series links (and
					// stamp series_scanned_at) from the re-parsed preface.
					syncWorkSeries(db, finalId, seriesEntries);

					// Author Identity Part A: refresh the byline author rows.
					// work_authors is ingest-owned, so a full rewrite is safe.
					syncWorkAuthors(db, finalId, workAuthors);
				}

				// WS Part 2/3: an EXTRACTED skin tracks the incoming EPUB
				// (present → set, absent → clear); a pasted skin is untouchable
				// (its file already carried into staging above) — the covers
				// precedence rule, applied to skins.
				if (!keepManualSkin) {
					setSkin.run(
						skinCss ? join(finalDir, 'skin.css') : null,
						skinCss ? 'epub' : null,
						finalId
					);
				}

				// Cover Art Part A: extracted covers track the incoming EPUB;
				// manual covers are untouchable (file already carried into
				// staging above). A coverless re-drop CLEARS a prior extracted
				// cover — its file is gone post-swap either way.
				if (!keepCover) {
					const newCoverPath = parsed.coverFilename
						? join(finalDir, 'images', parsed.coverFilename)
						: null;
					setCover.run(newCoverPath, newCoverPath ? 'epub' : null, finalId);
				}
			})();
		} catch (e) {
			console.error(
				`[ingest] DB update failed for ${sourceLabel}:`,
				e instanceof Error ? e.message : e
			);
			try {
				rmSync(stagingDir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
			throw new IngestError('Failed to record work', 'db', { cause: e });
		}

		// DB committed; move the new content (including _history) into place.
		// content_path + previous_path already point at finalDir.
		try {
			swapWorkDir(finalDir, stagingDir);
		} catch (e) {
			console.error(
				`[ingest] dir swap failed for ${sourceLabel} (DB updated, on-disk content may be stale):`,
				e instanceof Error ? e.message : e
			);
			throw new IngestError('Failed to write work files', 'write', { cause: e });
		}

		return { status: 'updated', work_id: finalId, title: displayTitle };
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

	// Cover Art Part A: the extracted cover file is already on disk (it's a
	// member of parsed.images written by writeWorkFiles above) — cover_path
	// just points at it, cwd-relative like every content_path.
	const coverPath = parsed.coverFilename ? join(workDir, 'images', parsed.coverFilename) : null;
	// WS Part 2: the sanitized skin file (written just below, with the same
	// error handling as the chapter files).
	const skinPath = skinCss ? join(workDir, 'skin.css') : null;
	if (skinCss) {
		try {
			writeFileSync(join(workDir, 'skin.css'), skinCss, 'utf8');
		} catch (e) {
			console.error(
				`[ingest] skin write failed for ${sourceLabel}:`,
				e instanceof Error ? e.message : e
			);
		}
	}
	const insertWork = db.prepare(
		`INSERT INTO works (id, title, author, summary, chapter_count, word_count, source_url, content_hash, source, cover_path, cover_source, skin_path, skin_source)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insertChapter = db.prepare(
		`INSERT INTO chapters (id, work_id, number, title, content_path, kind, content_hash)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	try {
		db.transaction(() => {
			insertWork.run(
				work_id,
				displayTitle,
				displayAuthor,
				parsed.summary,
				parsed.chapterCount,
				null,
				sourceUrl,
				contentHash,
				source,
				coverPath,
				coverPath ? 'epub' : null,
				skinPath,
				skinPath ? 'epub' : null
			);
			for (const ch of parsed.chapters) {
				// Stamp per-chapter content_hash from creation so future
				// update-in-place edit detection has a stored baseline (it
				// still falls back to reading the file, so this is additive).
				insertChapter.run(
					randomUUID(),
					work_id,
					ch.number,
					ch.title,
					join(workDir, chapterFilename(ch)),
					ch.kind,
					hashChapterContent(ch.html, work_id)
				);
			}
			for (const tag of parsed.tags) {
				const row = upsertTag.get(tag.category, tag.name);
				if (row) linkWorkTag.run(work_id, row.id);
			}

			// Series Pages Part 1: write this work's series links (and stamp
			// series_scanned_at) so the backfill skips this fresh work.
			syncWorkSeries(db, work_id, seriesEntries);

			// Author Identity Part A: byline author rows (fresh work — the
			// boot backfill will find rows present and skip it).
			syncWorkAuthors(db, work_id, workAuthors);
		})();
	} catch (e) {
		console.error(
			`[ingest] DB write failed for ${sourceLabel}:`,
			e instanceof Error ? e.message : e
		);
		cleanupWorkDir();
		throw new IngestError('Failed to record work', 'db', { cause: e });
	}

	return { status: 'created', work_id, title: displayTitle };
}
