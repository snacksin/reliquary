import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork, getWorkSeries, getSeriesList, getPersonalTags } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Series Pages Part 2 (A) + Part 4: the work's series links (with a
		// `manual` flag) for the detail-page set-series section, plus the full
		// series list as the add-combobox vocabulary. A failed series fetch
		// shouldn't 404 the work, so those are tolerated.
		// Personal tags (you-layer Private tags): the vocabulary for the
		// "My tags" add-combobox — the work's ATTACHED tags ride getWork()'s
		// personal_tags projection. Tolerated like the series fetches.
		const [work, series, allSeries, personalTagVocab] = await Promise.all([
			getWork(params.id, fetch),
			getWorkSeries(params.id, fetch).catch(() => []),
			getSeriesList(fetch).catch(() => []),
			getPersonalTags(fetch).catch(() => [])
		]);
		return { work, series, allSeries, personalTagVocab };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'work not found');
	}
};
