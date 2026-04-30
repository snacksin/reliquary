import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = () => {
	const db = getDb();
	const works = db
		.prepare(
			`SELECT id, title, author, summary, chapter_count, word_count
			 FROM works
			 ORDER BY ingested_at DESC`
		)
		.all();
	return json(works);
};
