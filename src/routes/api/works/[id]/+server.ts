import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
			   w.favorited_at,
			   rp.last_chapter, rp.last_scroll_y,
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
				last_chapter: number | null;
				last_scroll_y: number | null;
				last_updated_at: string | null;
		  }
		| undefined;

	if (!row) throw error(404, 'work not found');

	const work = {
		id: row.id,
		title: row.title,
		author: row.author,
		summary: row.summary,
		chapter_count: row.chapter_count,
		word_count: row.word_count,
		is_favorite: row.favorited_at !== null,
		favorited_at: row.favorited_at,
		last_read:
			row.last_chapter !== null && row.last_scroll_y !== null && row.last_updated_at !== null
				? {
						chapter: row.last_chapter,
						scroll_y: row.last_scroll_y,
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
			`SELECT number, title, kind FROM chapters
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
