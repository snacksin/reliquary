import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getChapterHtml } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { html: await getChapterHtml(params.id, params.n, fetch) };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'chapter not found');
	}
};
