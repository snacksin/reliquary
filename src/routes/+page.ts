import type { PageLoad } from './$types';
import { listWorks } from '$lib/api';

export const load: PageLoad = async ({ fetch }) => {
	const works = await listWorks(fetch);
	return { works };
};
