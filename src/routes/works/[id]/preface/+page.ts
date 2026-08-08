import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPrefaceHtml, getWorkSeries } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Series Pages Part 1: the preface "Part N of …" cross-link section.
		// A failed series fetch shouldn't 404 the preface, so it's tolerated.
		const [html, series] = await Promise.all([
			getPrefaceHtml(params.id, fetch),
			getWorkSeries(params.id, fetch).catch(() => [])
		]);
		return { html, workId: params.id, series };
	} catch (e) {
		// Error hygiene: re-throw SvelteKit errors/redirects untouched
		// (preserves real statuses), but never promote a caught message
		// into the rendered error page — an API-side detail would become
		// page copy. Fixed literal only.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'preface not found');
	}
};
