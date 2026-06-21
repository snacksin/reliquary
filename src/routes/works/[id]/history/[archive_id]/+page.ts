import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getArchivedHtml, getWorkHistory } from '$lib/api';

/**
 * Read-only archived-version reader (Part 2). Fetches the archived HTML
 * plus the work's history (to find this archive's archived_at + chapter
 * number for the banner / "Return to current" link). 404 if the id
 * isn't a real archive of this work — keeps the banner honest and
 * mirrors the endpoint's own ownership check.
 *
 * Deliberately loads NOTHING about reading progress: this route never
 * tracks scroll, marks read, or writes reading_progress.
 */
export const load: PageLoad = async ({ params, fetch }) => {
	const archiveId = Number(params.archive_id);
	try {
		const [html, history] = await Promise.all([
			getArchivedHtml(params.id, params.archive_id, fetch),
			getWorkHistory(params.id, fetch)
		]);

		let meta: { number: number; archivedAt: string } | null = null;
		for (const group of history.groups) {
			const found = group.archives.find((a) => a.archive_id === archiveId);
			if (found) {
				meta = { number: group.number, archivedAt: found.archived_at };
				break;
			}
		}
		if (!meta) throw error(404, 'archived version not found');

		return { workId: params.id, html, chapterNumber: meta.number, archivedAt: meta.archivedAt };
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		throw error(404, e instanceof Error ? e.message : 'archived version not found');
	}
};
