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

export type ParsedEpub = {
	title: string;
	author: string;
	summary: string | null;
	chapters: ParsedChapter[];
	chapterCount: number;
	images: ParsedImage[];
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
			const rawHtml = await book.getChapterAsync(f.id);
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
				const [buf, mediaType] = await book.getImageAsync(entry.id);
				images.push({ filename, buffer: buf, mediaType });
			} catch {
				// Some EPUBs reference images that aren't actually packaged.
				// Skip rather than fail the whole upload.
			}
		}

		return { title, author, summary, chapters, chapterCount, images };
	} finally {
		await unlink(tmpPath).catch(() => {});
	}
}
