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
		throw error(404, e instanceof Error ? e.message : 'preface not found');
	}
};
