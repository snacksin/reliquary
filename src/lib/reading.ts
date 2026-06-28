import type { Work } from './api';

/**
 * Continue Reading state + resume helpers, shared by the library carousel
 * ([+page.svelte]) and the work-detail page so the two never disagree about
 * what "finished" / "resume here" means.
 *
 * "Finished" is computed DYNAMICALLY off the reader's ~95%-scroll high-water
 * mark (`max_read_chapter`) vs the REAL chapter count (`chapter_count` is real
 * chapters only — preface/summary/afterword wrappers are excluded at ingest),
 * never a stored flag — so when a work gains chapters its new final chapter is
 * unread and it un-finishes for free.
 */

/** Furthest real chapter read to ~95%. NULL (pre-feature rows) reads as 0. */
export function maxRead(w: Work): number {
	return w.last_read?.max_read_chapter ?? 0;
}

/** Read to the end of the last real chapter. */
export function isFinished(w: Work): boolean {
	return !!w.last_read && maxRead(w) >= w.chapter_count;
}

/** Manually removed from Continue Reading (sticky × dismiss). */
export function isDismissed(w: Work): boolean {
	return w.last_read?.dismissed_at != null;
}

/** Shown in the Continue Reading carousel: started, not finished, not dismissed. */
export function inContinueReading(w: Work): boolean {
	return !!w.last_read && !isFinished(w) && !isDismissed(w);
}

/**
 * Where to resume. If you're partway through a chapter you haven't read to the
 * end (`last_read.chapter` is past your high-water mark), resume there — with
 * scroll restored. Once a chapter is finished, the target is the FIRST UNREAD
 * chapter (`maxRead + 1`), which opens a resurfaced work at its new chapters.
 * Clamped to a real chapter. NULL-`max_read` rows always take the first branch
 * → identical to pre-feature behavior.
 */
export function resumeChapter(w: Work): number {
	if (!w.last_read) return 1;
	if (w.last_read.chapter > maxRead(w)) return w.last_read.chapter;
	return Math.min(maxRead(w) + 1, w.chapter_count);
}

/** Restore scroll only when resuming the in-progress chapter (not a first-unread jump). */
export function resumeAtSavedScroll(w: Work): boolean {
	return !!w.last_read && w.last_read.chapter > maxRead(w);
}

/**
 * Resume link. `?continue=1` tells the reader to restore the saved scroll
 * position; added only for the in-progress chapter. A first-unread jump
 * (resurfaced work) is a plain link so the reader opens it at the top.
 */
export function continueHref(w: Work): string {
	const ch = resumeChapter(w);
	return resumeAtSavedScroll(w) ? `/works/${w.id}/ch/${ch}?continue=1` : `/works/${w.id}/ch/${ch}`;
}

/**
 * Continue Reading sort key: the later of reading-recency and new-chapter time,
 * so a resurfaced (freshly-grown) work bumps up to when its new chapters
 * arrived rather than staying buried at its old reading position. ISO 8601
 * strings compare lexicographically.
 */
export function crSortKey(w: Work): string {
	const read = w.last_read?.updated_at ?? '';
	const grew = w.chapters_updated_at ?? '';
	return read > grew ? read : grew;
}
