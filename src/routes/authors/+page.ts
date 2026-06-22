import type { PageLoad } from './$types';
import { getAuthors } from '$lib/api';

/** Author Pages Part 1: the /authors index loads the author list. */
export const load: PageLoad = async ({ fetch }) => {
	return { authors: await getAuthors(fetch) };
};
