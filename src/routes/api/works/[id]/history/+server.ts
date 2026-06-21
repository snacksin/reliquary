import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { getDb } from '$lib/server/db';
import { countWords } from '$lib/server/identity';

/**
 * `GET /api/works/[id]/history` — Chapter History viewer (Part 2) list.
 *
 * Every archived prior version of every chapter of this work (the rows
 * Part 1's archive-on-update created), grouped by chapter number and
 * sorted newest-archived-first within each group.
 *
 * `word_delta` is "+/- N words vs the version that replaced it": for the
 * NEWEST archive of a chapter that's the current active chapter (read
 * its on-disk file + countWords); for an older archive it's the
 * next-newer archive's stored word_count. Positive = the replacing edit
 * added words.
 *
 * Read-only. No schema changes; archiving logic is untouched.
 */

type Row = {
	archive_id: number;
	number: number;
	title: string | null;
	content_path: string;
	archived_at: string;
	previous_hash: string;
	word_count: number | null;
};

type ArchiveOut = {
	archive_id: number;
	archived_at: string;
	word_count: number | null;
	word_delta: number | null;
	hash_short: string;
};

type Group = {
	number: number;
	title: string | null;
	archives: ArchiveOut[];
};

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();

	// Join history → its live chapter so we get the chapter number/title
	// and the active file path. Newest first within a chapter; chapters
	// in ascending order overall.
	const rows = db
		.prepare(
			`SELECT ch.id AS archive_id, c.number AS number, c.title AS title,
			        c.content_path AS content_path, ch.archived_at AS archived_at,
			        ch.previous_hash AS previous_hash, ch.word_count AS word_count
			   FROM chapter_history ch
			   JOIN chapters c ON c.id = ch.chapter_id
			  WHERE c.work_id = ?
			  ORDER BY c.number ASC, ch.archived_at DESC, ch.id DESC`
		)
		.all(params.id) as Row[];

	// Bucket by chapter number, preserving the newest-first row order.
	const byNumber = new Map<number, Row[]>();
	for (const r of rows) {
		if (!byNumber.has(r.number)) byNumber.set(r.number, []);
		byNumber.get(r.number)!.push(r);
	}

	const groups: Group[] = [];
	for (const [number, chapterRows] of byNumber) {
		// The current active chapter's word count is what replaced the
		// newest archive. Read it once per chapter from the active file.
		let activeWordCount: number | null = null;
		try {
			activeWordCount = countWords(readFileSync(chapterRows[0].content_path, 'utf8'));
		} catch {
			activeWordCount = null; // missing active file → delta unavailable
		}

		const archives: ArchiveOut[] = chapterRows.map((r, i) => {
			// Newest archive (i === 0) was replaced by the active chapter;
			// each older archive was replaced by the next-newer archive.
			const replacedByWordCount = i === 0 ? activeWordCount : chapterRows[i - 1].word_count;
			const word_delta =
				replacedByWordCount !== null && r.word_count !== null
					? replacedByWordCount - r.word_count
					: null;
			return {
				archive_id: r.archive_id,
				archived_at: r.archived_at,
				word_count: r.word_count,
				word_delta,
				hash_short: r.previous_hash.slice(0, 8)
			};
		});

		groups.push({ number, title: chapterRows[0].title, archives });
	}

	return json({ groups });
};
