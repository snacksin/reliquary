import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork, getWorkSeries } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Series Pages Part 2 (A): the "Part N of …" section on the detail
		// page. A failed series fetch shouldn't 404 the work, so it's tolerated.
		const [work, series] = await Promise.all([
			getWork(params.id, fetch),
			getWorkSeries(params.id, fetch).catch(() => [])
		]);
		return { work, series };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'work not found');
	}
};
