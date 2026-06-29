import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

/**
 * Upsert this work's reading_progress row. Body: { chapter, scroll_y,
 * completed? }.
 *
 * - Validates the work exists (404 otherwise) so we don't silently
 *   drop progress writes that point at nothing.
 * - 400 on malformed body / negative or non-integer chapter / negative
 *   scroll_y. The reader page rounds scroll_y client-side; we round
 *   again here defensively (DB column is INTEGER).
 * - The localStorage-side write on the reader stays the source of
 *   truth for restore-on-reload (see M1.md gotchas + Step 9 logic);
 *   this row is for the library's "Continue Reading" surfacing and
 *   future cross-device hand-off.
 * - `completed` (the reader's ~95%-scroll auto-mark) raises the
 *   `max_read_chapter` high-water mark, which is what makes a work
 *   "finished" (max_read_chapter >= chapter_count) and lets it
 *   resurface for free when new chapters arrive. The mark is monotonic
 *   (MAX with the existing value) so scrolling back up never lowers it.
 * - Any write clears `dismissed_at`: reading a work again undoes a
 *   sticky Continue-Reading dismissal so it can return to the carousel.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as
		| { chapter?: unknown; scroll_y?: unknown; completed?: unknown }
		| null;

	if (
		!body ||
		typeof body.chapter !== 'number' ||
		typeof body.scroll_y !== 'number'
	) {
		throw error(400, 'expected { chapter, scroll_y }');
	}
	if (!Number.isInteger(body.chapter) || body.chapter < 1) {
		throw error(400, 'invalid chapter');
	}
	if (!Number.isFinite(body.scroll_y) || body.scroll_y < 0) {
		throw error(400, 'invalid scroll_y');
	}
	if (body.completed !== undefined && typeof body.completed !== 'boolean') {
		throw error(400, 'invalid completed');
	}

	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}

	// `completedChapter` carries the chapter number into the MAX() only when
	// the reader reports this chapter read-to-end; otherwise 0, a no-op for
	// the monotonic high-water mark.
	const completedChapter = body.completed ? body.chapter : 0;

	db.prepare(
		`INSERT INTO reading_progress
		   (work_id, last_chapter, last_scroll_y, max_read_chapter, dismissed_at, updated_at)
		 VALUES (?, ?, ?, NULLIF(?, 0), NULL, CURRENT_TIMESTAMP)
		 ON CONFLICT(work_id) DO UPDATE SET
		   last_chapter = excluded.last_chapter,
		   last_scroll_y = excluded.last_scroll_y,
		   max_read_chapter = MAX(COALESCE(max_read_chapter, 0), ?),
		   dismissed_at = NULL,
		   updated_at = CURRENT_TIMESTAMP`
	).run(params.id, body.chapter, Math.round(body.scroll_y), completedChapter, completedChapter);

	return new Response(null, { status: 204 });
};

/**
 * "Read again" — reset this work's RESUMABLE reading progress to a fresh
 * start so a finished fic restarts as a new read. Sets the row to
 * last_chapter = 1, last_scroll_y = 0, max_read_chapter = 0 and clears
 * dismissed_at, with a fresh updated_at. After this the work is plain
 * "in-progress" (max_read_chapter 0 < chapter_count), so all the existing
 * Continue Reading logic takes over unchanged: it re-enters the carousel at
 * Chapter 1, tracks the whole re-read (last chapter included), and leaves
 * again when finished. The updated_at bump sorts it to the top of CR.
 *
 * Idempotent upsert (a finished work always has a row, but INSERT-on-conflict
 * keeps it safe either way). 404 if the work doesn't exist, mirroring POST.
 *
 * Scope: this touches ONLY reading_progress columns — it does NOT write the
 * `works` table, so the decoupled "read" mark (works.read_at, you-layer) is
 * never cleared. Re-reading a fic must never un-mark it as read; that read
 * state is owned elsewhere and is intentionally independent of resumable
 * progress.
 */
export const PUT: RequestHandler = ({ params }) => {
	const db = getDb();
	const exists = db.prepare('SELECT 1 FROM works WHERE id = ?').get(params.id);
	if (!exists) {
		throw error(404, 'work not found');
	}

	db.prepare(
		`INSERT INTO reading_progress
		   (work_id, last_chapter, last_scroll_y, max_read_chapter, dismissed_at, updated_at)
		 VALUES (?, 1, 0, 0, NULL, CURRENT_TIMESTAMP)
		 ON CONFLICT(work_id) DO UPDATE SET
		   last_chapter = 1,
		   last_scroll_y = 0,
		   max_read_chapter = 0,
		   dismissed_at = NULL,
		   updated_at = CURRENT_TIMESTAMP`
	).run(params.id);

	return new Response(null, { status: 204 });
};

/**
 * The Continue Reading × — a STICKY dismiss, not a delete. Sets
 * `dismissed_at` so the work leaves the carousel and stays out even when
 * new chapters arrive (a finished work resurfaces; a dismissed one does
 * not). The reading_progress row is preserved, so the work stays "marked
 * read" in the library and a later read (POST, which clears `dismissed_at`)
 * brings it back to Continue Reading normally.
 *
 * Idempotent — a no-op on a missing row, returns 204 either way; we don't
 * reveal whether the work exists.
 */
export const DELETE: RequestHandler = ({ params }) => {
	getDb()
		.prepare(`UPDATE reading_progress SET dismissed_at = CURRENT_TIMESTAMP WHERE work_id = ?`)
		.run(params.id);
	return new Response(null, { status: 204 });
};
