import type { PageLoad } from './$types';
import { listWorks, getTags } from '$lib/api';

/**
 * Parse the `tags` query param (comma-separated tag IDs). Same shape as
 * the server-side parser in `/api/works` — coerce to positive integers,
 * drop anything that doesn't parse. Belt-and-suspenders: the server
 * validates again before SQL, so a malformed URL never reaches the DB.
 */
function parseTagIds(raw: string | null): number[] {
	if (!raw) return [];
	const ids = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isFinite(n) && n > 0) ids.add(n);
	}
	return [...ids];
}

export const load: PageLoad = async ({ fetch, url }) => {
	const selectedTagIds = parseTagIds(url.searchParams.get('tags'));

	// Three fetches, parallelized:
	//   - getTags(): drives the right-column filter sidebar
	//   - listWorks(): unfiltered, drives Continue Reading + Favorites
	//     (those lists must surface in-progress / favorited works
	//     regardless of the current tag filter)
	//   - listWorks(tags): server-filtered, drives the middle column.
	//     Only fired when there's an actual filter; otherwise we
	//     reuse the unfiltered result.
	const [tagGroups, allWorks, maybeFiltered] = await Promise.all([
		getTags(fetch),
		listWorks(fetch),
		selectedTagIds.length > 0 ? listWorks(fetch, { tags: selectedTagIds }) : Promise.resolve(null)
	]);

	const filteredWorks = maybeFiltered ?? allWorks;
	return { works: allWorks, filteredWorks, tagGroups, selectedTagIds };
};
