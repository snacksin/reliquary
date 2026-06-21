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
 * Returns true if a `works` row was actually deleted (false if the id
 * didn't exist).
 */
export function purgeWork(db: Database, id: string): boolean {
	const result = db.prepare('DELETE FROM works WHERE id = ?').run(id);
	const deleted = result.changes > 0;

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
