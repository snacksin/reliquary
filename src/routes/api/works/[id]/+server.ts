import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const work = db
		.prepare(
			`SELECT id, title, author, summary, chapter_count, word_count
			 FROM works WHERE id = ?`
		)
		.get(params.id) as Record<string, unknown> | undefined;

	if (!work) throw error(404, 'work not found');

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
