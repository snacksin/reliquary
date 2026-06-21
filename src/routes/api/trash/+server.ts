import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { purgeWork } from '$lib/server/purge';

/**
 * `GET /api/trash` — works currently in Trash, newest-trashed first.
 * Drives the `/trash` management view. days-until-purge is computed
 * client-side from `trashed_at`.
 */
export const GET: RequestHandler = () => {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT id, title, author, trashed_at
			   FROM works
			  WHERE trashed_at IS NOT NULL
			  ORDER BY trashed_at DESC`
		)
		.all() as { id: string; title: string; author: string; trashed_at: string }[];
	return json(rows);
};

/**
 * `DELETE /api/trash` — "Empty trash now". Permanently deletes every
 * trashed work via the shared `purgeWork` path. Returns the count.
 * Destructive + irreversible — the UI gates this behind a confirm
 * dialog.
 */
export const DELETE: RequestHandler = () => {
	const db = getDb();
	const ids = (
		db.prepare(`SELECT id FROM works WHERE trashed_at IS NOT NULL`).all() as { id: string }[]
	).map((r) => r.id);

	let purged = 0;
	for (const id of ids) {
		if (purgeWork(db, id)) purged += 1;
	}
	return json({ purged });
};
