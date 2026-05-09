import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

type Row = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	last_chapter: number | null;
	last_scroll_y: number | null;
};

export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT
			   w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
			   rp.last_chapter, rp.last_scroll_y
			 FROM works w
			 LEFT JOIN reading_progress rp ON rp.work_id = w.id
			 ORDER BY w.ingested_at DESC`
		)
		.all() as Row[];

	return json(
		rows.map((r) => ({
			id: r.id,
			title: r.title,
			author: r.author,
			summary: r.summary,
			chapter_count: r.chapter_count,
			word_count: r.word_count,
			last_read:
				r.last_chapter !== null && r.last_scroll_y !== null
					? { chapter: r.last_chapter, scroll_y: r.last_scroll_y }
					: null
		}))
	);
};
