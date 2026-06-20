import { EPub } from 'epub2';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export type ChapterKind = 'preface' | 'summary' | 'chapter' | 'afterword';

export type ParsedChapter = {
	number: number;
	kind: ChapterKind;
	title: string | null;
	html: string;
};

export type ParsedImage = {
	filename: string;
	buffer: Buffer;
	mediaType: string;
};

/**
 * Tag categories the parser populates from the AO3 preface metadata.
 *
 * Deliberately excludes `'personal'` — that category is reserved for
 * user-toggled tags and is NEVER created during ingest. Don't add a
 * branch here that auto-derives a personal tag from any signal (read
 * time, rating, etc.); see migrations/0004_favorites.sql for the
 * companion no-auto-favoriting rule that established this pattern.
 */
export type TagCategory =
	| 'rating'
	| 'warning'
	| 'category'
	| 'fandom'
	| 'relationship'
	| 'character'
	| 'freeform';

export type ParsedTag = {
	category: TagCategory;
	name: string;
};

export type ParsedEpub = {
	title: string;
	author: string;
	summary: string | null;
	chapters: ParsedChapter[];
	chapterCount: number;
	images: ParsedImage[];
	tags: ParsedTag[];
};

/**
 * Sentinel imagewebroot we hand to epub2 at parse time. epub2 rewrites
 * `<img src="...">` paths in chapter HTML using this prefix; we
 * post-process the resulting URLs to point at our serving endpoint.
 * Using a sentinel (rather than the lib's default `/images/`) means we
 * don't accidentally rewrite any unrelated `/images/` references that
 * might appear in the original EPUB content.
 */
const IMG_SENTINEL = '/__reliquary_img__/';

/**
 * Wrapper rows still need a `number` (NOT NULL UNIQUE). Real chapters
 * take 1..N; wrappers take fixed negatives so they sort outside the
 * navigable range and never collide with the chapter sequence. The
 * existing /ch/[n] endpoint validates n >= 1, so wrappers stay
 * unreachable through that route.
 */
export const WRAPPER_NUMBER: Record<Exclude<ChapterKind, 'chapter'>, number> = {
	preface: -2,
	summary: -1,
	afterword: -3
};

const FILENAME_PREFACE = /^preface\.xhtml$/i;
const FILENAME_PREFACE_EXTRA = /^preface_(\d+)\.xhtml$/i;
const FILENAME_CHAPTER = /^chapter[_-]?(\d+)\.xhtml$/i;
const FILENAME_AFTERWORD = /^afterword\.xhtml$/i;

const TITLE_CHAPTER = /^chapter\s+(\d+)\b/i;

type Classification = ChapterKind | null;

function classifyByFilename(href: string | undefined): Classification {
	if (!href) return null;
	const fname = basename(href);
	if (FILENAME_PREFACE.test(fname)) return 'preface';
	if (FILENAME_PREFACE_EXTRA.test(fname)) return 'summary';
	if (FILENAME_CHAPTER.test(fname)) return 'chapter';
	if (FILENAME_AFTERWORD.test(fname)) return 'afterword';
	return null;
}

function classifyByTitle(title: string | undefined): Classification {
	const t = (title ?? '').trim();
	if (!t) return null;
	if (/^preface$/i.test(t)) return 'preface';
	if (/^afterword$/i.test(t)) return 'afterword';
	if (TITLE_CHAPTER.test(t)) return 'chapter';
	return null;
}

/**
 * Hybrid classification cascade:
 *   1. Filename canonical (raw AO3 EPUBs use `chapter_NNN.xhtml` etc.)
 *   2. Title canonical (Calibre-renamed AO3 EPUBs lose the canonical
 *      filenames but keep useful titles like "Preface" / "Chapter N: ...")
 *   3. Position fallback (first → preface, last → afterword,
 *      empty-title item right after preface → summary, otherwise chapter)
 *
 * Title-based detection is also more WIP-stable than filename in practice:
 * Calibre's `_split_NNN.xhtml` numbering shifts when a fic gains chapters,
 * but the "Afterword" title doesn't.
 */
function classify(
	flow: { href?: string; title?: string }[],
	index: number,
	prefaceClassifications: (Classification | null)[]
): ChapterKind {
	const item = flow[index];

	const byFilename = classifyByFilename(item.href);
	if (byFilename) return byFilename;

	const byTitle = classifyByTitle(item.title);
	if (byTitle) return byTitle;

	// Position fallback
	if (index === 0) return 'preface';
	if (index === flow.length - 1) return 'afterword';
	if (index === 1 && prefaceClassifications[0] === 'preface') {
		// AO3 layout: empty-title item right after preface = summary block
		return 'summary';
	}
	return 'chapter';
}

/**
 * Map AO3 preface heading text (singular or plural, colon optional) to
 * the database tag category. Headings outside this map (Language,
 * Series, Collections, Stats, Words, Published, Updated, etc.) are
 * deliberately skipped — they're metadata, not tags.
 */
const HEADING_TO_CATEGORY: Record<string, TagCategory> = {
	rating: 'rating',
	ratings: 'rating',
	'archive warning': 'warning',
	'archive warnings': 'warning',
	category: 'category',
	categories: 'category',
	fandom: 'fandom',
	fandoms: 'fandom',
	relationship: 'relationship',
	relationships: 'relationship',
	character: 'character',
	characters: 'character',
	'additional tag': 'freeform',
	'additional tags': 'freeform'
};

/**
 * Decode the small set of HTML entities AO3 actually emits in tag text:
 * the named XML/HTML5 basics plus numeric (decimal + hex) refs. AO3 tag
 * names are otherwise stored verbatim — Unicode characters (curly quotes,
 * emoji, kanji) are already correctly UTF-8 in the source XHTML.
 */
function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

/**
 * Extract AO3 preface tags from the preface chapter's HTML. AO3 wraps
 * its tag block in a `<dl>` with class either `tags` (current) or
 * `meta` (older fic ages, ~pre-2015). The structure inside is identical:
 * alternating `<dt>Heading:</dt><dd><a>value</a>, <a>value</a></dd>`.
 *
 * Each <a> inside a recognized category's <dd> becomes one tag row.
 * Categories not in HEADING_TO_CATEGORY (Language, Series, Stats, etc.)
 * are skipped. Returns deduped tags — if a fic somehow repeats the same
 * (category, name) pair, only one row is returned.
 *
 * Resilience choices: we don't use a full HTML parser because the input
 * is well-formed AO3 XHTML with a tightly-bounded grammar and we want
 * to avoid a dep. The regex is anchored on the `<dl class="tags|meta">`
 * shell so it can't pick up dt/dd pairs from unrelated `<dl>` blocks
 * elsewhere in the preface.
 */
export function extractPrefaceTags(html: string): ParsedTag[] {
	if (!html) return [];

	// Find the AO3 tag block. Tolerant of class-attribute ordering and
	// additional class tokens (calibre rewrites can add their own).
	const dlMatch = html.match(
		/<dl\b[^>]*class\s*=\s*(["'])[^"']*\b(?:tags|meta)\b[^"']*\1[^>]*>([\s\S]*?)<\/dl>/i
	);
	if (!dlMatch) return [];
	const dlInner = dlMatch[2];

	// Walk dt → dd pairs. The dd extends from after its opening tag to
	// the next dt or the end of the dl block. Capture both in one pass.
	const pairRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;

	const tags: ParsedTag[] = [];
	const seen = new Set<string>(); // dedupe across (category, name)

	let m: RegExpExecArray | null;
	while ((m = pairRe.exec(dlInner)) !== null) {
		const heading = decodeEntities(m[1].replace(/<[^>]+>/g, ''))
			.replace(/[:\s]+$/u, '')
			.trim()
			.toLowerCase();
		const category = HEADING_TO_CATEGORY[heading];
		if (!category) continue;

		// Each tag value is the text content of one <a> inside the <dd>.
		const ddInner = m[2];
		const linkRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
		let a: RegExpExecArray | null;
		while ((a = linkRe.exec(ddInner)) !== null) {
			const raw = a[1].replace(/<[^>]+>/g, ''); // strip any inner markup
			const name = decodeEntities(raw).replace(/\s+/g, ' ').trim();
			if (!name) continue;
			const key = `${category}::${name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			tags.push({ category, name });
		}
	}

	return tags;
}

/**
 * Extract the canonical AO3 work URL from a preface's HTML (M2.3 Step 2,
 * the dedup identity key). AO3 EPUB prefaces carry a message block —
 * "Posted originally on the <a href="https://archiveofourown.org/">
 * Archive of Our Own</a> at <a href="https://archiveofourown.org/works/
 * <id>">…</a>." — where the SECOND link is the work's public URL.
 *
 * We anchor on "Posted originally" and grab the next `/works/<digits>`,
 * which skips the bare-domain link before it and ignores any unrelated
 * `/tags/` or `/series/` links. Only the numeric id is captured; the
 * canonical string is rebuilt from scratch, so any `/chapters/<cid>`
 * suffix, query string, or trailing slash on the source href is
 * discarded by construction.
 *
 * Returns `null` for non-AO3 prefaces (e.g. FicHub exports, which link
 * to fichub.net) — those rely on content_hash for identity instead.
 */
export function extractCanonicalAo3Url(prefaceHtml: string): string | null {
	if (!prefaceHtml) return null;
	const m = prefaceHtml.match(/Posted originally[\s\S]*?archiveofourown\.org\/works\/(\d+)/i);
	if (!m) return null;
	return `https://archiveofourown.org/works/${m[1]}`;
}

/**
 * Rewrite the sentinel image-src prefix epub2 emitted in chapter HTML
 * to point at this server's images endpoint for the given work.
 *
 *   <img src="/__reliquary_img__/foo.jpg">
 *     → <img src="/api/works/<workId>/images/foo.jpg">
 *
 * Anything after the sentinel that contains slashes (epub2 sometimes
 * emits `<sentinel>/manifest_id/zip/path.jpg`) is collapsed to its
 * basename so the URL matches what we wrote to disk
 * (data/works/<id>/images/<basename>).
 */
/**
 * Race a promise against a hard timeout. epub2 has at least one known
 * shape where an internal `String.replace` callback throws
 * synchronously inside an EventEmitter handler (the
 * `linkparts.shift is not a function` case on certain AO3 EPUBs).
 * When that happens, the `await book.getChapterAsync(id)` for the
 * affected spine item neither resolves nor rejects — it hangs
 * forever, which hangs `parseEpub`, the upload endpoint, and the UI.
 *
 * Wrapping each epub2 call in this race guarantees the await
 * eventually settles. 10 seconds is generous for a real
 * extraction (in-memory ZIP reads complete in < 100 ms on healthy
 * data) and short enough that a hung request fails fast.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out after ${ms}ms`));
		}, ms);
		promise.then(
			(val) => {
				clearTimeout(timer);
				resolve(val);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

const EPUB_CALL_TIMEOUT_MS = 10_000;

function rewriteImageSrcs(html: string, workId: string): string {
	const re = new RegExp(
		`(src|href)=(["'])${IMG_SENTINEL.replace(/\//g, '\\/')}([^"']+)`,
		'g'
	);
	return html.replace(re, (_match, attr, quote, path) => {
		const filename = path.split('/').pop() || path;
		return `${attr}=${quote}/api/works/${workId}/images/${filename}`;
	});
}

export async function parseEpub(buffer: Buffer, workId: string): Promise<ParsedEpub> {
	const tmpPath = join(tmpdir(), `reliquary-epub-${randomUUID()}.epub`);
	await writeFile(tmpPath, buffer);

	try {
		// Pass our sentinel as imagewebroot so epub2 rewrites all `<img>`
		// paths in chapter HTML to use it. We post-process to the real
		// serving URL after fetching each chapter.
		const book = await EPub.createAsync(tmpPath, IMG_SENTINEL);

		// Defensive listener for deferred error events. epub2's
		// `createAsync` wraps the legacy EventEmitter-based EPub class
		// with `once('end', resolve)` + `once('error', reject)`. If a
		// SECOND 'error' event fires later (e.g., the internal stream
		// pipeline throws after createAsync's promise has already
		// resolved), Node's EventEmitter contract is "any 'error' event
		// with no listener throws synchronously into the event loop"
		// — which becomes an uncaughtException and crashes the process.
		// Pinning a permanent listener swallows those deferred errors so
		// the server stays up. The originating call still gets a clean
		// rejection (from `await getChapterAsync(…)` etc.) and the
		// upload endpoint surfaces a 400 to the client. The known
		// `linkparts.shift is not a function` bug on certain locked-fic
		// AO3 EPUBs takes this path.
		(book as unknown as { on: (e: string, cb: (e: unknown) => void) => void }).on(
			'error',
			() => {
				/* swallowed — see comment above */
			}
		);

		const title = book.metadata.title?.trim() || 'Untitled';
		const author = book.metadata.creator?.trim() || 'Unknown';
		const summary = book.metadata.description?.trim() || null;

		// Narrow view of each spine item that this module reads. epub2's
		// TocElement isn't re-exported, so we type the fields we use directly.
		type SpineItem = { id?: string; href?: string; title?: string };
		const flow = book.flow as unknown as SpineItem[];

		// Pass 1: try filename + title for each spine item, leaving null where
		// neither matched. We need pass 1 done before pass 2 because the
		// summary fallback (index 1) checks whether index 0 is a preface.
		const provisional: (Classification | null)[] = flow.map((f: SpineItem) => {
			return classifyByFilename(f.href) ?? classifyByTitle(f.title) ?? null;
		});

		// Pass 2: resolve nulls with position fallback.
		const kinds: ChapterKind[] = flow.map((_: SpineItem, i: number) => {
			if (provisional[i]) return provisional[i] as ChapterKind;
			return classify(flow, i, provisional);
		});

		// Pass 3: number assignment + content fetch. Real chapters are 1..N
		// in spine order; wrappers get their fixed-negative number.
		const chapters: ParsedChapter[] = [];
		let chapterIndex = 0;

		for (let i = 0; i < flow.length; i++) {
			const f = flow[i];
			if (!f.id) continue;
			const kind = kinds[i];

			// Each chapter fetch is raced against a timeout AND wrapped in
			// try/catch. If the chapter HTML can't be extracted for any
			// reason — sync throw inside epub2, deferred error event, or a
			// hang — the whole parse rejects with a clean error rather
			// than silently dropping the chapter (which would produce a
			// half-imported fic) or hanging forever.
			let rawHtml: string;
			try {
				rawHtml = await withTimeout(
					book.getChapterAsync(f.id),
					EPUB_CALL_TIMEOUT_MS,
					`getChapterAsync(${f.id})`
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				throw new Error(`chapter extraction failed at spine index ${i} (${f.href ?? f.id}): ${msg}`);
			}
			const html = rewriteImageSrcs(rawHtml, workId);

			let number: number;
			if (kind === 'chapter') {
				chapterIndex += 1;
				number = chapterIndex;
			} else {
				number = WRAPPER_NUMBER[kind];
			}

			chapters.push({
				number,
				kind,
				title: f.title?.trim() || null,
				html
			});
		}

		const chapterCount = chapters.filter((c) => c.kind === 'chapter').length;
		if (chapterCount === 0) {
			throw new Error('EPUB has no chapters');
		}

		// Tag extraction. Reads the preface row's HTML (already isolated
		// by the wrapper-aware classification above) and pulls structured
		// AO3 tags out of its `<dl class="tags">` (or .meta) block. If
		// there's no preface or the dl is missing, tags stays [].
		const prefaceChapter = chapters.find((c) => c.kind === 'preface');
		const tags = prefaceChapter ? extractPrefaceTags(prefaceChapter.html) : [];

		// Image extraction. listImage() returns image manifest entries;
		// getImageAsync(id) returns [Buffer, mediaType]. We collapse
		// each href to its basename so the on-disk filename matches the
		// URL we baked into the chapter HTML above.
		type ImageManifest = { id?: string; href?: string };
		const imageEntries = (book.listImage?.() ?? []) as ImageManifest[];
		const images: ParsedImage[] = [];
		const seen = new Set<string>();
		for (const entry of imageEntries) {
			if (!entry.id || !entry.href) continue;
			const filename = (entry.href.split('/').pop() || '').trim();
			if (!filename || seen.has(filename)) continue;
			seen.add(filename);
			try {
				const [buf, mediaType] = await withTimeout<[Buffer, string]>(
					book.getImageAsync(entry.id) as Promise<[Buffer, string]>,
					EPUB_CALL_TIMEOUT_MS,
					`getImageAsync(${entry.id})`
				);
				images.push({ filename, buffer: buf, mediaType });
			} catch {
				// Some EPUBs reference images that aren't actually packaged,
				// and some epub2-internal extraction paths can hang or throw
				// the same way the chapter path does. Skip rather than fail
				// the whole upload — a missing image is a missing image, not
				// a missing fic.
			}
		}

		return { title, author, summary, chapters, chapterCount, images, tags };
	} finally {
		await unlink(tmpPath).catch(() => {});
	}
}
