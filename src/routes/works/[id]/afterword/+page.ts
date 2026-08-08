import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getAfterwordHtml } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { html: await getAfterwordHtml(params.id, fetch), workId: params.id };
	} catch (e) {
		// Error hygiene: re-throw SvelteKit errors/redirects untouched
		// (preserves real statuses), but never promote a caught message
		// into the rendered error page — an API-side detail would become
		// page copy. Fixed literal only.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'afterword not found');
	}
};
