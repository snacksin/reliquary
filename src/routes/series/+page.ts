import type { PageLoad } from './$types';
import { getSeriesList } from '$lib/api';

/** Series Pages Part 2: the /series index loads every owned series. */
export const load: PageLoad = async ({ fetch }) => {
	return { series: await getSeriesList(fetch) };
};
