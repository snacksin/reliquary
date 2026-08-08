import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getSeries } from '$lib/api';

/** Series Pages Part 1: the bare series page loads the series + its parts. */
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { series: await getSeries(params.id, fetch) };
	} catch (e) {
		// Error hygiene: re-throw SvelteKit errors/redirects untouched
		// (preserves real statuses), but never promote a caught message
		// into the rendered error page — an API-side detail would become
		// page copy. Fixed literal only.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'series not found');
	}
};
