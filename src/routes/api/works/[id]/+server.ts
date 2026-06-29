import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { purgeWork } from '$lib/server/purge';

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
			   w.favorited_at, w.trashed_at, w.read_at, w.chapters_updated_at,
			   rp.last_chapter, rp.last_scroll_y,
			   rp.max_read_chapter AS last_max_read_chapter,
			   rp.dismissed_at AS last_dismissed_at,
			   rp.updated_at AS last_updated_at
			 FROM works w
			 LEFT JOIN reading_progress rp ON rp.work_id = w.id
			 WHERE w.id = ?`
		)
		.get(params.id) as
		| {
				id: string;
				title: string;
				author: string;
				summary: string | null;
				chapter_count: number;
				word_count: number | null;
				favorited_at: string | null;
				trashed_at: string | null;
				read_at: string | null;
				chapters_updated_at: string | null;
				last_chapter: number | null;
				last_scroll_y: number | null;
				last_max_read_chapter: number | null;
				last_dismissed_at: string | null;
				last_updated_at: string | null;
		  }
		| undefined;

	if (!row) throw error(404, 'work not found');

	// Chapter History (Part 2): does this work have any archived chapter
	// versions? Drives the detail page's 📜 History button visibility.
	const hasHistory =
		(
			db
				.prepare(
					`SELECT EXISTS (
					   SELECT 1 FROM chapter_history ch
					   JOIN chapters c ON c.id = ch.chapter_id
					   WHERE c.work_id = ?
					 ) AS has_history`
				)
				.get(params.id) as { has_history: number }
		).has_history === 1;

	const work = {
		id: row.id,
		title: row.title,
		author: row.author,
		summary: row.summary,
		chapter_count: row.chapter_count,
		word_count: row.word_count,
		is_favorite: row.favorited_at !== null,
		favorited_at: row.favorited_at,
		trashed_at: row.trashed_at,
		read_at: row.read_at,
		chapters_updated_at: row.chapters_updated_at,
		has_history: hasHistory,
		last_read:
			row.last_chapter !== null && row.last_scroll_y !== null && row.last_updated_at !== null
				? {
						chapter: row.last_chapter,
						scroll_y: row.last_scroll_y,
						max_read_chapter: row.last_max_read_chapter,
						dismissed_at: row.last_dismissed_at,
						updated_at: row.last_updated_at
					}
				: null
	};

	// Order: preface, summary, real chapters by ascending number, afterword.
	// Wrappers carry fixed-negative `number` values so plain `ORDER BY number`
	// would put them in the wrong place; classify-then-order keeps the
	// list readable for the existing detail page.
	const chapters = db
		.prepare(
			`SELECT number, title, kind, last_edited_at FROM chapters
			 WHERE work_id = ?
			 ORDER BY CASE kind
			   WHEN 'preface'   THEN 0
			   WHEN 'summary'   THEN 1
			   WHEN 'chapter'   THEN 2
			   WHEN 'afterword' THEN 3
			   ELSE 4
			 END, number`
		)
		.all(params.id);

	return json({ ...work, chapters });
};

/**
 * `DELETE /api/works/[id]` — permanent delete (M2.3 Step 5).
 *
 * Hard delete is allowed ONLY from Trash: the work must already have
 * `trashed_at` set. A live work returns 409 — you can't bypass the
 * soft-trash safety window (preservation principle: removal is
 * deliberate, never accidental). 404 if the work doesn't exist.
 *
 * Delegates to the shared `purgeWork` path (DB cascade + FTS trigger +
 * on-disk dir removal), the same code Step 6's purge-on-start reuses.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = db.prepare('SELECT trashed_at FROM works WHERE id = ?').get(params.id) as
		| { trashed_at: string | null }
		| undefined;
	if (!row) throw error(404, 'work not found');
	if (row.trashed_at === null) {
		throw error(409, 'work is not in Trash — move it to Trash before deleting permanently');
	}
	purgeWork(db, params.id);
	return new Response(null, { status: 204 });
};
