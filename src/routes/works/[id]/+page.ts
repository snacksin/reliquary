import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getWork, getWorkSeries, getSeriesList, getPersonalTags, getWorkImages } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		// Series Pages Part 2 (A) + Part 4: the work's series links (with a
		// `manual` flag) for the detail-page set-series section, plus the full
		// series list as the add-combobox vocabulary. A failed series fetch
		// shouldn't 404 the work, so those are tolerated.
		// Personal tags (you-layer Private tags): the vocabulary for the
		// "My tags" add-combobox — the work's ATTACHED tags ride getWork()'s
		// personal_tags projection. Tolerated like the series fetches.
		// Cover Art Part A.5: the extracted-image list feeds the pick-a-cover
		// gallery (empty → the Set-cover button goes straight to the file
		// picker). Loaded here so the click handler stays synchronous (a file
		// input opened after an await can lose its user-gesture context).
		const [work, series, allSeries, personalTagVocab, workImages] = await Promise.all([
			getWork(params.id, fetch),
			getWorkSeries(params.id, fetch).catch(() => []),
			getSeriesList(fetch).catch(() => []),
			getPersonalTags(fetch).catch(() => []),
			getWorkImages(params.id, fetch).catch(() => [])
		]);
		return { work, series, allSeries, personalTagVocab, workImages };
	} catch (e) {
		throw error(404, e instanceof Error ? e.message : 'work not found');
	}
};
