import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork, getWorkHistory } from '$lib/api';

/**
 * Chapter History viewer (Part 2). Loads the work (title + id for the
 * heading and back link) and its grouped archive list in parallel.
 */
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		const [work, history] = await Promise.all([
			getWork(params.id, fetch),
			getWorkHistory(params.id, fetch)
		]);
		return { work, history };
	} catch (e) {
		// Error hygiene: re-throw SvelteKit errors/redirects untouched
		// (preserves real statuses), but never promote a caught message
		// into the rendered error page — an API-side detail would become
		// page copy. Fixed literal only.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'work not found');
	}
};
