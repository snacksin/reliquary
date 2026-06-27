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
 * Content-heuristic classification (MS Step 3). A fallback used ONLY for FicHub
 * exports, and ONLY when filename + title were inconclusive — so it never
 * touches AO3-native fics (those match filename/title, and even when they fall
 * to the position fallback they're never routed here). Inspects the item's
 * HTML; returns null when nothing matches so the caller uses the position
 * fallback (current behavior).
 *
 * The load-bearing rule is "substantial prose → chapter": FicHub fics have no
 * afterword wrapper, so the position fallback's "last item → afterword" wrongly
 * demotes the real last chapter (e.g. an 8429-word chapter). The FicHub
 * metadata page ("Introduction") carries no `<dl class="tags">` — it's caught
 * by its "Original source:"/FicHub-footer marker so it stays a preface.
 */
function classifyByContent(html: string): Classification {
	if (!html) return null;
	// Preface: AO3 tag block, or the FicHub metadata page's footer/source line.
	if (
		/<dl\b[^>]*class\s*=\s*(["'])[^"']*\b(?:tags|meta)\b/i.test(html) ||
		/Exported with the assistance of[\s\S]{0,80}FicHub/i.test(html) ||
		/Original source:/i.test(html)
	) {
		return 'preface';
	}
	// Chapter: substantial prose or a "Chapter <n>" heading. Checked BEFORE the
	// afterword rule so a multi-thousand-word chapter that merely ENDS with an
	// author's note is a chapter, not an afterword — otherwise several such
	// chapters all take WRAPPER_NUMBER.afterword (-3) and collide on the
	// UNIQUE(work_id, number) insert. The afterword rule below is thereby left
	// to genuinely note-only sections (short, no chapter heading).
	const words = wordCount(html);
	if (words >= 200 || /\bchapter\s+\w+/i.test(html)) return 'chapter';
	// Afterword: an explicit end-notes / author's-notes wrapper (short item).
	if (/\bEnd Notes\b/i.test(html) || /\bAuthor['’]?s Notes\b/i.test(html)) {
		return 'afterword';
	}
	return null;
}

/** Plain-text word count of an HTML fragment (tags + entity refs stripped). */
function wordCount(html: string): number {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&[a-z#0-9]+;/gi, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

/**
 * Nav/TOC spine item (MS Step 4 Part A). FicHub exports include a navigation
 * page — an `<h1>` + a list of internal links to the other spine docs (raw
 * `/links/chapter_N/EPUB/…` paths that 404) with little/no prose — that
 * otherwise lands as chapter 1. It's "mostly links, no prose": several links
 * and far fewer words than a real chapter (WoW: 7 words / 2 links; Of Beating
 * Hearts: 73 / 14). A real chapter has words ≫ links, so the "substantial
 * prose → chapter" guard keeps incidental-link chapters safe. FicHub-gated by
 * the caller (this is a FicHub artifact; AO3 spines don't carry it).
 */
function isNavToc(html: string): boolean {
	const links = (html.match(/<a\b/gi) || []).length;
	return links >= 2 && wordCount(html) < links * 12;
}

/**
 * The title-page half of a split chapter (MS Step 4 Part B). Some EPUBs (incl.
 * AO3-native ones like "Dead Reckoning") split a chapter into a short spine
 * item whose heading is the chapter title — often ALSO carrying a brief
 * chapter note / epigraph / content warning — immediately followed by the
 * (long) content item, doubling the chapter count.
 *
 * Detection: a chapter-style heading ("Chapter N…" or "N. …") plus a small
 * word count. The cap is generous (a few hundred words) because a real chapter
 * runs thousands — the gap is huge (Dead Reckoning: title pages ≤43 words vs
 * content ≥2.4k) — so a title page with a note still matches while no full
 * chapter does. The caller adds the decisive guard that the NEXT item is an
 * *untitled* content page, so a normal (titled) chapter — even a short drabble
 * — and a genuine standalone note are never swallowed. Pattern-gated (any
 * source); normal fics never match → byte-identical.
 */
function isBareTitlePage(html: string): boolean {
	const m = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
	if (!m) return false;
	const heading = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).trim();
	if (!/\bchapter\b\s*\d+/i.test(heading) && !/^\d+\s*[.:]/.test(heading)) return false;
	return wordCount(html) < 300;
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

/** Where an imported EPUB came from (Multi-Source Step 1). */
export type WorkSource = 'ao3' | 'fichub-ao3' | 'fichub-ffn' | 'fichub-other' | 'unknown';

/**
 * Detect a work's source from its preface HTML (MS Step 1). Pure parsing, no
 * DB — so it's identical for ingest (the freshly-parsed preface) and the
 * startup backfill (the stored preface.html), the same file the AO3-URL
 * extractor already reads.
 *
 * Precedence: the FicHub export footer is the strongest, most explicit signal
 * (a couple of plain `<p>`s — `Original source: <a href>` + "Exported with the
 * assistance of <a>FicHub.net</a>" — NOT in AO3's `<dl class="tags">`, which is
 * why FicHub tags come up empty). The origin SITE comes from the "Original
 * source:" link's domain. With no FicHub footer, the AO3-native "Posted
 * originally …/works/<id>" marker (reused via `extractCanonicalAo3Url`) means
 * `ao3`; otherwise `unknown`. In the real library these signals are mutually
 * exclusive (0 prefaces carry both).
 *
 * (content.opf / spine-filename tiers are deferred — no fic needs them and
 * epub2 doesn't expose `<dc:source>`. See MS.md.)
 */
export function detectSource(prefaceHtml: string): WorkSource {
	if (!prefaceHtml) return 'unknown';
	if (
		/Exported with the assistance of[\s\S]{0,80}FicHub/i.test(prefaceHtml) ||
		/fichub\.net/i.test(prefaceHtml)
	) {
		const m = prefaceHtml.match(/Original source:[\s\S]{0,80}?<a\b[^>]*\bhref="([^"]+)"/i);
		const url = m?.[1] ?? '';
		if (/fanfiction\.net/i.test(url)) return 'fichub-ffn';
		if (/archiveofourown\.org/i.test(url)) return 'fichub-ao3';
		return 'fichub-other';
	}
	if (extractCanonicalAo3Url(prefaceHtml) !== null) return 'ao3';
	return 'unknown';
}

/**
 * Normalize an original-source href to a canonical, re-download-stable URL
 * (MS Step 2). The canonical string is rebuilt from the work's numeric id per
 * site, so a chapter index, title slug, query, or trailing slash on the source
 * href is discarded by construction (two FicHub downloads of the same fic →
 * the same key). Unrecognized sites return null → identity falls back to the
 * content hash as before.
 */
function normalizeSourceUrl(href: string): string | null {
	let m = href.match(/archiveofourown\.org\/works\/(\d+)/i);
	if (m) return `https://archiveofourown.org/works/${m[1]}`;
	m = href.match(/fanfiction\.net\/s\/(\d+)/i); // /s/<id>/<chapter>/<slug> → /s/<id>
	if (m) return `https://www.fanfiction.net/s/${m[1]}`;
	return null;
}

/**
 * Recover a work's canonical original-source URL from its preface (MS Step 2 —
 * the dedup identity key, broadened beyond AO3). AO3-native fics resolve via
 * the existing `extractCanonicalAo3Url` "Posted originally…" anchor exactly as
 * before; when that's absent (FicHub exports), fall back to FicHub's
 * "Original source:" link (the same `<a>` `detectSource` reads) and normalize
 * it per site. Stored in the existing `works.source_url` column so M2.3's
 * `findMatch` picks it up unchanged.
 */
export function extractSourceUrl(prefaceHtml: string): string | null {
	if (!prefaceHtml) return null;
	const ao3 = extractCanonicalAo3Url(prefaceHtml);
	if (ao3) return ao3;
	const m = prefaceHtml.match(/Original source:[\s\S]{0,80}?<a\b[^>]*\bhref="([^"]+)"/i);
	return m ? normalizeSourceUrl(m[1]) : null;
}

/** One series membership parsed from a preface "Series:" entry. */
export type ParsedSeries = {
	name: string;
	/** Normalized AO3 series URL, or null for a non-AO3 (name-keyed) series. */
	url: string | null;
	/** "Part N" position, or null when the entry carries no part number. */
	position: number | null;
};

/**
 * Rebuild the canonical AO3 series URL from a series href, by id, the same way
 * `extractCanonicalAo3Url` does for works — so http/https, trailing slashes,
 * and query strings all normalize to one stable key. Returns null for hrefs
 * that aren't AO3 series links (those fall back to name identity).
 */
function normalizeSeriesUrl(href: string): string | null {
	const m = href.match(/archiveofourown\.org\/series\/(\d+)/i);
	return m ? `https://archiveofourown.org/series/${m[1]}` : null;
}

/**
 * Extract series memberships from a preface's HTML (Series Pages Part 1). AO3
 * EPUB prefaces carry a `<dt>Series:</dt><dd>…</dd>` pair inside the same
 * `<dl class="tags|meta">` block that holds the tags, formatted as
 * `Part N of <a href="…/series/<id>">Name</a>`, comma-separated for a work in
 * multiple series. `extractPrefaceTags` skips this heading; we read it here.
 *
 * Same resilience choices as the tag extractor: anchored on the `<dl>` shell
 * (so it can't catch a stray `<dt>` elsewhere), regex rather than a full HTML
 * parser, `decodeEntities` on the captured name. Deduped by url (or lowercased
 * name when URL-less). Returns [] when there's no Series line.
 */
export function extractSeriesEntries(html: string): ParsedSeries[] {
	if (!html) return [];

	const dlMatch = html.match(
		/<dl\b[^>]*class\s*=\s*(["'])[^"']*\b(?:tags|meta)\b[^"']*\1[^>]*>([\s\S]*?)<\/dl>/i
	);
	if (!dlMatch) return [];
	const dlInner = dlMatch[2];

	// Find the Series <dd>.
	const pairRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
	let ddInner: string | null = null;
	let m: RegExpExecArray | null;
	while ((m = pairRe.exec(dlInner)) !== null) {
		const heading = decodeEntities(m[1].replace(/<[^>]+>/g, ''))
			.replace(/[:\s]+$/u, '')
			.trim()
			.toLowerCase();
		if (heading === 'series') {
			ddInner = m[2];
			break;
		}
	}
	if (ddInner === null) return [];

	// Each membership: "Part <N> of <a href="…">Name</a>".
	const entryRe = /Part\s+(\d+)\s+of\s*<a\b[^>]*\bhref=(["'])([^"']+)\2[^>]*>([\s\S]*?)<\/a>/gi;
	const out: ParsedSeries[] = [];
	const seen = new Set<string>();
	let e: RegExpExecArray | null;
	while ((e = entryRe.exec(ddInner)) !== null) {
		const position = Number.parseInt(e[1], 10);
		const url = normalizeSeriesUrl(e[3]);
		const name = decodeEntities(e[4].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
		if (!name) continue;
		const key = url ?? `name::${name.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name, url, position: Number.isFinite(position) ? position : null });
	}
	return out;
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

		// Fetch pass: pull each spine item's HTML up front (MS Step 3) so the
		// content heuristic below can inspect it. `null` for id-less items
		// (which never become chapters). Same epub2 calls + timeout + image
		// rewrite as before — just hoisted ahead of classification.
		const htmls: (string | null)[] = [];
		for (let i = 0; i < flow.length; i++) {
			const f = flow[i];
			if (!f.id) {
				htmls.push(null);
				continue;
			}
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
			htmls.push(rewriteImageSrcs(rawHtml, workId));
		}

		// MS Step 3: a FicHub export stamps "Exported with the assistance of
		// FicHub.net" into its metadata page. Detect it from raw HTML —
		// independent of classification — so the content heuristic routes
		// FicHub fics only. AO3-native fics never reach `classifyByContent`,
		// so their classification + chapter_count stay byte-identical.
		const isFicHub = htmls.some(
			(h) => h !== null && /Exported with the assistance of[\s\S]{0,80}FicHub/i.test(h)
		);

		// Pass 2: resolve nulls — content heuristic for FicHub (fallback to
		// position when inconclusive), plain position fallback otherwise.
		// `'skip'` (MS Step 4 Part A) drops a FicHub nav/TOC page entirely.
		const kinds: (ChapterKind | 'skip')[] = flow.map((_: SpineItem, i: number) => {
			if (provisional[i]) return provisional[i] as ChapterKind;
			if (isFicHub && htmls[i] !== null) {
				const byContent = classifyByContent(htmls[i] as string);
				// The FicHub metadata page carries link(s) too, so resolve a
				// preface signal (footer / <dl tags>) BEFORE nav detection — a
				// preface is never a nav/TOC.
				if (byContent === 'preface') return 'preface';
				if (isNavToc(htmls[i] as string)) return 'skip';
				if (byContent) return byContent;
			}
			return classify(flow, i, provisional);
		});

		// Pass 3: build chapters in spine order from the already-fetched HTML.
		// `'skip'` items (nav/TOC, Part A) are dropped — no row, no file, not
		// counted. Chapter numbers are assigned in the finalize pass below
		// (after the Part B merge), so we leave a placeholder here.
		const built: ParsedChapter[] = [];
		for (let i = 0; i < flow.length; i++) {
			const f = flow[i];
			if (!f.id || htmls[i] === null) continue;
			const kind = kinds[i];
			if (kind === 'skip') continue;

			built.push({
				number: kind === 'chapter' ? 0 : WRAPPER_NUMBER[kind],
				kind,
				// Decode HTML entities so chapter titles read "Stitches &
				// Witches", not the raw "Stitches &amp; Witches".
				title: f.title ? decodeEntities(f.title).trim() || null : null,
				html: htmls[i] as string
			});
		}

		// Finalize (MS Step 4 Part B): merge title-page splits, then number the
		// real chapters 1..N. A short chapter-title page immediately followed by
		// an *untitled* content chapter is a split half — concat the two into one
		// logical chapter, keeping the title page's title. The untitled-next
		// guard means a normal (titled) chapter, even a short one, never merges,
		// so normal fics stay byte-identical.
		const chapters: ParsedChapter[] = [];
		for (let i = 0; i < built.length; i++) {
			const c = built[i];
			const next = built[i + 1];
			if (
				c.kind === 'chapter' &&
				next?.kind === 'chapter' &&
				!next.title &&
				isBareTitlePage(c.html)
			) {
				chapters.push({ ...next, title: c.title ?? next.title, html: c.html + next.html });
				i += 1; // the content item was merged in
			} else {
				chapters.push(c);
			}
		}
		// Defense-in-depth: a wrapper kind maps to a single fixed negative
		// number (WRAPPER_NUMBER), so two items of the same wrapper kind would
		// collide on the UNIQUE(work_id, number) insert. Keep the first of each
		// wrapper kind and demote any later duplicate to a chapter, which the
		// renumber pass then gives a clean 1..N number. This makes the insert
		// structurally safe regardless of how classification turns out.
		const seenWrapper = new Set<ChapterKind>();
		for (const c of chapters) {
			if (c.kind === 'chapter') continue;
			if (seenWrapper.has(c.kind)) c.kind = 'chapter';
			else seenWrapper.add(c.kind);
		}

		let chapterIndex = 0;
		for (const c of chapters) {
			if (c.kind === 'chapter') c.number = (chapterIndex += 1);
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
