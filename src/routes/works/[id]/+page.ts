import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork, getWorkSeries, getSeriesList } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Series Pages Part 2 (A) + Part 4: the work's series links (with a
		// `manual` flag) for the detail-page set-series section, plus the full
		// series list as the add-combobox vocabulary. A failed series fetch
		// shouldn't 404 the work, so those are tolerated.
		const [work, series, allSeries] = await Promise.all([
			getWork(params.id, fetch),
			getWorkSeries(params.id, fetch).catch(() => []),
			getSeriesList(fetch).catch(() => [])
		]);
		return { work, series, allSeries };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'work not found');
	}
};
