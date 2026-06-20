import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getChapterHtml, getWork } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Fetch the chapter HTML and the work detail in parallel. The work's
		// `chapter_count` is the real-chapter count (kind='chapter'), which
		// the prev/next footer needs to decide link visibility. No new
		// endpoint — getWork() already exists.
		const [html, work] = await Promise.all([
			getChapterHtml(params.id, params.n, fetch),
			getWork(params.id, fetch)
		]);
		return {
			html,
			workId: params.id,
			chapterNumber: Number(params.n),
			chapterCount: work.chapter_count
		};
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'chapter not found');
	}
};
