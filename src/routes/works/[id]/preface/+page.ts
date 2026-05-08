import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPrefaceHtml } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { html: await getPrefaceHtml(params.id, fetch) };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'preface not found');
	}
};
