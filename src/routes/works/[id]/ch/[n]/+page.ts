import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getChapterHtml, getWork, getSeriesNav } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Fetch the chapter HTML, work detail, and series adjacency in parallel.
		// `chapter_count` (real chapters) gates the prev/next chapter links;
		// seriesNav drives the "next/previous part" buttons at part boundaries.
		// A failed series-nav fetch must never break the reader, so it's
		// tolerated (→ no part buttons).
		const [html, work, seriesNav] = await Promise.all([
			getChapterHtml(params.id, params.n, fetch),
			getWork(params.id, fetch),
			getSeriesNav(params.id, fetch).catch(() => [])
		]);
		return {
			html,
			workId: params.id,
			chapterNumber: Number(params.n),
			chapterCount: work.chapter_count,
			// WS Part 2: creator-skin presence for the reader's #workskin link.
			hasSkin: work.has_skin ?? false,
			seriesNav
		};
	} catch (e) {
		// Error hygiene: re-throw SvelteKit errors/redirects untouched
		// (preserves real statuses), but never promote a caught message
		// into the rendered error page — an API-side detail would become
		// page copy. Fixed literal only.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'chapter not found');
	}
};
