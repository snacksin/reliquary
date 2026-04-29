import { EPub } from 'epub2';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ParsedChapter = {
	number: number;
	title: string | null;
	html: string;
};

export type ParsedEpub = {
	title: string;
	author: string;
	summary: string | null;
	chapters: ParsedChapter[];
};

export async function parseEpub(buffer: Buffer): Promise<ParsedEpub> {
	const tmpPath = join(tmpdir(), `reliquary-epub-${randomUUID()}.epub`);
	await writeFile(tmpPath, buffer);

	try {
		const book = await EPub.createAsync(tmpPath);

		const title = book.metadata.title?.trim() || 'Untitled';
		const author = book.metadata.creator?.trim() || 'Unknown';
		const summary = book.metadata.description?.trim() || null;

		const chapters: ParsedChapter[] = [];
		for (let i = 0; i < book.flow.length; i++) {
			const ch = book.flow[i];
			if (!ch.id) continue;
			const html = await book.getChapterAsync(ch.id);
			chapters.push({
				number: chapters.length + 1,
				title: ch.title?.trim() || null,
				html
			});
		}

		if (chapters.length === 0) {
			throw new Error('EPUB has no chapters');
		}

		return { title, author, summary, chapters };
	} finally {
		await unlink(tmpPath).catch(() => {});
	}
}
