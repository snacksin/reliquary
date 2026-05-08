import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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

	let parsed;
	try {
		parsed = await parseEpub(buffer);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'unknown error';
		throw error(400, `invalid EPUB: ${msg}`);
	}

	const work_id = randomUUID();
	const workDir = join('data', 'works', work_id);
	mkdirSync(workDir, { recursive: true });

	for (const ch of parsed.chapters) {
		writeFileSync(join(workDir, chapterFilename(ch)), ch.html, 'utf8');
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
	})();

	return json({ work_id });
};
