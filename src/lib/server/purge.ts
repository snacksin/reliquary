import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

/**
 * Soft-trash retention window. A work sits in Trash for this many days
 * before Step 6's purge-on-start hard-deletes it. Step 5's `/trash`
 * view computes "days until purge" against this same constant.
 */
export const PURGE_AFTER_DAYS = 30;

/**
 * THE single hard-delete path (M2.3 Step 5; reused verbatim by Step 6's
 * purge-on-start). Permanently removes a work — DB rows and on-disk
 * files. There is no undo; callers must have already confirmed (the
 * `/trash` Delete-forever / Empty-trash dialogs, or Step 6's 30-day
 * filter).
 *
 * With `foreign_keys = ON`, deleting the `works` row cascades to
 * `chapters` → `chapter_history`, plus `work_tags` and
 * `reading_progress`, and the `works_fts_delete` trigger drops the FTS
 * row. So one DELETE clears every DB trace; the only extra is the
 * on-disk `data/works/<id>/` directory (chapter HTML, images,
 * `_history/` archives).
 *
 * Ordering: DB row first, then the disk dir. If the disk rm fails we're
 * left with an orphaned directory (harmless — just bytes, reclaimable),
 * never a DB row pointing at missing files (which would break the
 * reader). The rm is best-effort and logged.
 *
 * Empty-series cleanup: a hard purge removes the work's `series_works`
 * links (the FK cascade), which can leave a `series` row with zero
 * members — an orphan invisible in every live-only surface. We capture
 * the work's series ids BEFORE the cascade, then delete any that are now
 * empty. Scoped to this work's own series (not a global sweep) so the
 * count is accurate. Only ALL-members-purged series go: a series with any
 * other member, live OR still-trashed, keeps its link and is untouched —
 * and since this runs only on hard purge (never soft-trash), restoring a
 * trashed work always brings its series back. Guarded so it can never
 * block the purge.
 *
 * Returns true if a `works` row was actually deleted (false if the id
 * didn't exist).
 */
export function purgeWork(db: Database, id: string): boolean {
	// Capture before the DELETE — the FK cascade wipes these links.
	const seriesIds = (
		db.prepare('SELECT series_id FROM series_works WHERE work_id = ?').all(id) as {
			series_id: number;
		}[]
	).map((r) => r.series_id);

	const result = db.prepare('DELETE FROM works WHERE id = ?').run(id);
	const deleted = result.changes > 0;

	// Author Identity Part B: authors_fts is app-maintained (no triggers, and
	// the FK cascade on work_authors can't clean a separate FTS table), so a
	// hard purge drops the work's author-search row explicitly. An orphan here
	// would be harmless (the search clause joins back to works by id) — this
	// just keeps the index tidy. Guarded like the series cleanup below.
	if (deleted) {
		try {
			db.prepare('DELETE FROM authors_fts WHERE work_id = ?').run(id);
		} catch (e) {
			console.error(`[purge] authors_fts cleanup failed for ${id}:`, e);
		}
	}

	if (deleted && seriesIds.length > 0) {
		try {
			const hasMember = db.prepare('SELECT 1 FROM series_works WHERE series_id = ? LIMIT 1');
			const deleteSeries = db.prepare('DELETE FROM series WHERE id = ?');
			let removed = 0;
			for (const seriesId of seriesIds) {
				if (hasMember.get(seriesId) === undefined) {
					deleteSeries.run(seriesId);
					removed += 1;
				}
			}
			if (removed > 0) console.log(`[purge] ${removed} empty series removed`);
		} catch (e) {
			console.error(
				`[purge] removed work ${id} but empty-series cleanup failed:`,
				e instanceof Error ? e.message : e
			);
		}
	}

	try {
		rmSync(join('data', 'works', id), { recursive: true, force: true });
	} catch (e) {
		console.error(
			`[purge] removed DB rows for ${id} but failed to remove its files:`,
			e instanceof Error ? e.message : e
		);
	}

	return deleted;
}

/**
 * Boot-time auto-purge (M2.3 Step 6). Permanently deletes every work
 * whose `trashed_at` is older than `PURGE_AFTER_DAYS`, reusing the exact
 * `purgeWork` path (no second delete path). Non-trashed works are never
 * selected. Called once per boot from getDb(), guarded so a failure
 * can't block boot — same pattern as the identity backfill.
 *
 * Boundary: `trashed_at < datetime('now', '-30 days')`. Both `trashed_at`
 * (CURRENT_TIMESTAMP) and `datetime('now')` are UTC, so the 30-day
 * comparison is consistent. Returns the count purged.
 */
export function purgeExpired(db: Database): number {
	const expired = db
		.prepare(
			`SELECT id FROM works
			  WHERE trashed_at IS NOT NULL
			    AND trashed_at < datetime('now', ?)`
		)
		.all(`-${PURGE_AFTER_DAYS} days`) as { id: string }[];

	let purged = 0;
	for (const { id } of expired) {
		if (purgeWork(db, id)) purged += 1;
	}

	console.log(`[purge] ${purged} works purged`);
	return purged;
}
