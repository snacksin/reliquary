import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { getDb } from '$lib/server/db';

/**
 * `GET /api/works/[id]/history/[archive_id]` — serve one archived chapter
 * version's HTML for the Chapter History viewer (Part 2).
 *
 * Hardening (mirrors the images endpoint's posture):
 *   1. The archive row must belong to THIS work (JOIN chapters on
 *      work_id) — you can't read another work's archive by guessing ids.
 *   2. `previous_path` comes from our own DB, but we never trust a stored
 *      path blindly: the resolved real path must sit inside this work's
 *      `data/works/<id>/_history/` dir, else 404.
 *
 * Read-only; serves text/html like the live chapter endpoint.
 */
export const GET: RequestHandler = ({ params }) => {
	const archiveId = Number(params.archive_id);
	if (!Number.isInteger(archiveId) || archiveId < 1) {
		throw error(404, 'archived version not found');
	}

	const db = getDb();
	const row = db
		.prepare(
			`SELECT ch.previous_path AS previous_path
			   FROM chapter_history ch
			   JOIN chapters c ON c.id = ch.chapter_id
			  WHERE ch.id = ? AND c.work_id = ?`
		)
		.get(archiveId, params.id) as { previous_path: string } | undefined;

	if (!row) throw error(404, 'archived version not found');

	// Confine to this work's _history dir. resolve() collapses any `..`;
	// the prefix check (with a trailing separator) rejects anything that
	// resolves outside the intended directory.
	const historyDir = resolve('data', 'works', params.id, '_history');
	const target = resolve(row.previous_path);
	if (target !== historyDir && !target.startsWith(historyDir + sep)) {
		throw error(404, 'archived version not found');
	}

	let body: string;
	try {
		body = readFileSync(target, 'utf8');
	} catch {
		throw error(404, 'archived version not found');
	}

	return new Response(body, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
