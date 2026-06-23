import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getSeries } from '$lib/api';

/** Series Pages Part 1: the bare series page loads the series + its parts. */
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { series: await getSeries(params.id, fetch) };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'series not found');
	}
};
