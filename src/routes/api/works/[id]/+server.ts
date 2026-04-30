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

	const chapters = db
		.prepare(
			`SELECT number, title FROM chapters
			 WHERE work_id = ? ORDER BY number ASC`
		)
		.all(params.id);

	return json({ ...work, chapters });
};
