import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getAfterwordHtml } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { html: await getAfterwordHtml(params.id, fetch), workId: params.id };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'afterword not found');
	}
};
