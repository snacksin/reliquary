import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { work: await getWork(params.id, fetch) };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'work not found');
	}
};
