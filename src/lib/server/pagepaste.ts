/**
 * WS Part 4 — chapter HTML from a pasted AO3 page (2026-09-15).
 *
 * WHY THIS EXISTS. Every EPUB Reliquary can ingest — AO3's own download
 * included — is built by Calibre, which renames the author's class names
 * (`.envelope-visual` → `calibre13`) when it flattens CSS. A work skin
 * pasted through the WS Part 3 box therefore had nothing to attach to:
 * the sanitizer kept ~100% of the rules, but the stored chapter HTML
 * carried none of the hooks (verified on the test fic: 316 distinct
 * classes on the live page, 3 in the stored chapters). The ONLY source
 * that keeps the original markup is the live AO3 page.
 *
 * The paste box already accepts a whole page source to find the skin's
 * <style> block. This module reads the SAME paste for the chapter
 * bodies inside `<div id="workskin">` and hands them to the endpoint,
 * which swaps them in for the Calibre chapters — archiving the old
 * versions through the existing chapter-history path so nothing is lost.
 *
 * What is kept per chapter: the inner HTML of AO3's `<div class="chapter"
 * id="chapter-N">` container — the `.chapter.preface` block (title,
 * chapter summary/notes), the `.userstuff` body, and any end-notes block
 * — because skins are written against exactly that structure. Dropped:
 * HTML comments, `.landmark` headings ("Chapter Text", hidden by AO3's
 * site CSS which Reliquary doesn't have), and the `<a>` around the
 * chapter title (it points back at AO3). Images keep AO3's absolute
 * URLs — a known tradeoff, noted in the room manual.
 *
 * Hash contract: works.content_hash (the dedup key) is NEVER touched —
 * a re-drop of the same EPUB still matches as a duplicate and leaves the
 * pasted chapters alone. chapters.content_hash IS restamped (it's the
 * per-chapter edit-detection baseline and must match the stored bytes).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { countWords, hashChapterContent } from './identity';

export type PastedChapter = { number: number; title: string | null; html: string };

/**
 * Index of the `</div>` that closes the `<div` opening at `openIdx`,
 * counting nested divs. Returns -1 when unbalanced. Tags are matched
 * case-insensitively; AO3 markup is well-formed so this is enough.
 */
function findClosingDiv(html: string, openIdx: number): number {
	const re = /<\/?div\b[^>]*>/gi;
	re.lastIndex = openIdx;
	let depth = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		if (m[0][1] === '/') {
			depth -= 1;
			if (depth === 0) return m.index;
		} else if (!m[0].endsWith('/>')) {
			depth += 1;
		}
	}
	return -1;
}

/** Inner HTML of the first `<div ...ATTR...>` matching `attrRe`, or null. */
function innerOfDiv(html: string, attrRe: RegExp): string | null {
	const open = new RegExp(`<div\\b[^>]*${attrRe.source}[^>]*>`, 'i').exec(html);
	if (!open) return null;
	const start = open.index;
	const close = findClosingDiv(html, start);
	if (close === -1) return null;
	return html.slice(start + open[0].length, close);
}

function stripComments(html: string): string {
	return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Remove whole elements carrying the `landmark` class (AO3 hides them). */
function stripLandmarks(html: string): string {
	return html.replace(
		/<(h[1-6]|p|div|span)\b[^>]*\bclass="[^"]*\blandmark\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
		''
	);
}

/** "Chapter 3: Ministry" → { number: 3, title: 'Ministry' } (title null if none). */
function parseTitle(h3Inner: string): { number: number | null; title: string | null } {
	const text = h3Inner
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const m = /^Chapter\s+(\d+)\s*(?::\s*(.*))?$/i.exec(text);
	if (!m) return { number: null, title: text || null };
	return { number: Number(m[1]), title: m[2]?.trim() || null };
}

/**
 * Chapters found in a pasted AO3 page, in page order, or null when the
 * paste carries no AO3 work body at all (bare CSS, a <style> block, or an
 * unrelated page) — the caller then treats it as a skin-only paste.
 *
 * Handles both page shapes:
 *  - multi-chapter "Entire Work" view: `<div class="chapter" id="chapter-N">`
 *    containers inside `#chapters`;
 *  - single-chapter work: `#chapters` holds the `.userstuff` body directly.
 * A chapter-by-chapter view of a multi-chapter work yields ONE chapter;
 * the endpoint's count check turns that into a "use Entire Work" message.
 */
export function extractAo3PageChapters(pasted: string): PastedChapter[] | null {
	const workskin = innerOfDiv(pasted, /id="workskin"/);
	if (workskin === null) return null;
	const chaptersBlock = innerOfDiv(workskin, /id="chapters"/);
	if (chaptersBlock === null) return null;

	const out: PastedChapter[] = [];
	const openRe = /<div\b[^>]*\bclass="chapter"[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = openRe.exec(chaptersBlock)) !== null) {
		const close = findClosingDiv(chaptersBlock, m.index);
		if (close === -1) break;
		let inner = stripLandmarks(stripComments(chaptersBlock.slice(m.index + m[0].length, close)));
		openRe.lastIndex = close;

		// Title: <h3 class="title"><a href=…>Chapter N</a>: Title</h3> — keep
		// the heading, drop the AO3-pointing anchor.
		let number: number | null = null;
		let title: string | null = null;
		inner = inner.replace(
			/(<h3\b[^>]*\bclass="title"[^>]*>)([\s\S]*?)(<\/h3>)/i,
			(_all, o, body, c) => {
				const parsed = parseTitle(body);
				number = parsed.number;
				title = parsed.title;
				const text = body.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1').trim();
				return `${o}${text}${c}`;
			}
		);
		out.push({ number: number ?? out.length + 1, title, html: inner.trim() });
	}

	if (out.length === 0) {
		// Single-chapter shape: the body sits directly in #chapters.
		const body = stripLandmarks(stripComments(chaptersBlock)).trim();
		if (!body) return null;
		out.push({ number: 1, title: null, html: body });
	}
	return out;
}

export type ApplyResult = { updated: number; unchanged: number };

/**
 * Swap the stored real-chapter files for the pasted bodies, one per
 * chapter number, archiving any changed original into `_history` with a
 * chapter_history row (Chapter History Part 1's exact shape, so the
 * viewer and the "Updated ·" pill work unchanged). Unchanged chapters
 * (byte-identical after hashing) are skipped — a re-paste is a no-op.
 *
 * Callers verify the chapter count matches BEFORE calling; here a
 * pasted number with no stored row is simply skipped.
 *
 * Ordering mirrors ingest: archive files are written first, then the DB
 * transaction, then the new chapter bytes. A crash between the last two
 * leaves the old bytes on disk with a fresh hash in the DB — the next
 * paste detects the mismatch and archives again; nothing is lost.
 */
export function applyPastedChapters(
	db: Database,
	workId: string,
	chapters: PastedChapter[]
): ApplyResult {
	type Row = { id: string; number: number; content_path: string };
	const rows = db
		.prepare(`SELECT id, number, content_path FROM chapters WHERE work_id = ? AND kind = 'chapter'`)
		.all(workId) as Row[];
	const byNumber = new Map(rows.map((r) => [r.number, r]));

	const archiveTs = new Date().toISOString().replace(/[:.]/g, '-');
	type Plan = {
		row: Row;
		html: string;
		newHash: string;
		archive: { path: string; hash: string; words: number } | null;
	};
	const plans: Plan[] = [];

	let unchanged = 0;
	for (const ch of chapters) {
		const row = byNumber.get(ch.number);
		if (!row) continue;
		const newHash = hashChapterContent(ch.html, workId);
		let old: string | null;
		try {
			old = readFileSync(row.content_path, 'utf8');
		} catch {
			old = null; // missing file: nothing to archive, just write
		}
		if (old !== null && hashChapterContent(old, workId) === newHash) {
			unchanged += 1;
			continue;
		}
		let archive: Plan['archive'] = null;
		if (old !== null) {
			const workDir = dirname(row.content_path);
			const historyDir = join(workDir, '_history');
			mkdirSync(historyDir, { recursive: true });
			const path = join(historyDir, `ch-${row.number}-${archiveTs}.html`);
			writeFileSync(path, old, 'utf8');
			archive = { path, hash: hashChapterContent(old, workId), words: countWords(old) };
		}
		plans.push({ row, html: ch.html, newHash, archive });
	}

	const insertHistory = db.prepare(
		`INSERT INTO chapter_history (chapter_id, previous_hash, previous_path, word_count)
		 VALUES (?, ?, ?, ?)`
	);
	const restamp = db.prepare(
		`UPDATE chapters SET content_hash = ?, last_edited_at = CURRENT_TIMESTAMP WHERE id = ?`
	);
	db.transaction(() => {
		for (const p of plans) {
			if (p.archive) insertHistory.run(p.row.id, p.archive.hash, p.archive.path, p.archive.words);
			restamp.run(p.newHash, p.row.id);
		}
	})();

	for (const p of plans) {
		const dir = dirname(p.row.content_path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, basename(p.row.content_path)), p.html, 'utf8');
	}

	return { updated: plans.length, unchanged };
}
