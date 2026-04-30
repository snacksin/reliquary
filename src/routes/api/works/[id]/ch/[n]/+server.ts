import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = ({ params }) => {
	const number = Number(params.n);
	if (!Number.isInteger(number) || number < 1) {
		throw error(404, 'chapter not found');
	}

	const db = getDb();
	const row = db
		.prepare('SELECT content_path FROM chapters WHERE work_id = ? AND number = ?')
		.get(params.id, number) as { content_path: string } | undefined;

	if (!row) {
		throw error(404, 'chapter not found');
	}

	let body: string;
	try {
		body = readFileSync(row.content_path, 'utf8');
	} catch {
		throw error(404, 'chapter file missing');
	}

	return new Response(body, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
