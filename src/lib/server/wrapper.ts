import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { getDb } from './db';
import type { ChapterKind } from '$lib/api';

/**
 * Read the on-disk HTML for a wrapper row (preface / summary /
 * afterword) of a given work. Throws a clean 404 if the work doesn't
 * exist, the wrapper of that kind doesn't exist for it, or the
 * referenced file is missing.
 *
 * Used by /api/works/[id]/preface and /api/works/[id]/afterword;
 * factored out so the two endpoint files don't copy-paste the same
 * lookup + read + error pattern.
 */
export function readWrapper(workId: string, kind: ChapterKind): string {
	const db = getDb();
	const row = db
		.prepare('SELECT content_path FROM chapters WHERE work_id = ? AND kind = ?')
		.get(workId, kind) as { content_path: string } | undefined;

	if (!row) {
		throw error(404, `${kind} not found`);
	}

	try {
		return readFileSync(row.content_path, 'utf8');
	} catch {
		throw error(404, `${kind} file missing`);
	}
}
