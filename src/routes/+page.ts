import type { PageLoad } from './$types';
import { listWorks, getTags, type TagCategory } from '$lib/api';

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

const KNOWN_CATEGORIES = new Set<TagCategory>([
	'rating',
	'warning',
	'category',
	'fandom',
	'relationship',
	'character',
	'freeform'
]);

/**
 * Parse the `match_all` query param: comma-separated category names
 * that should use AND-within (all selected tags in that category must
 * match the work). Same validation as the server: drop unknown names,
 * lowercase, dedupe.
 */
function parseMatchAll(raw: string | null): TagCategory[] {
	if (!raw) return [];
	const cats = new Set<TagCategory>();
	for (const token of raw.split(',')) {
		const c = token.trim().toLowerCase();
		if (KNOWN_CATEGORIES.has(c as TagCategory)) cats.add(c as TagCategory);
	}
	return [...cats];
}

export const load: PageLoad = async ({ fetch, url }) => {
	const selectedTagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAllCategories = parseMatchAll(url.searchParams.get('match_all'));

	// Three fetches, parallelized:
	//   - getTags(): drives the right-column filter sidebar
	//   - listWorks(): unfiltered, drives Continue Reading + Favorites
	//     (those lists must surface in-progress / favorited works
	//     regardless of the current tag filter)
	//   - listWorks({ tags, matchAll }): server-filtered, drives the
	//     middle column. Only fired when there's an actual filter;
	//     otherwise we reuse the unfiltered result. `matchAll` is
	//     forwarded even when only a subset of selected categories
	//     uses it — the server filter applies the per-category mode
	//     correctly via the required_per_cat CTE.
	const [tagGroups, allWorks, maybeFiltered] = await Promise.all([
		getTags(fetch),
		listWorks(fetch),
		selectedTagIds.length > 0
			? listWorks(fetch, { tags: selectedTagIds, matchAll: matchAllCategories })
			: Promise.resolve(null)
	]);

	const filteredWorks = maybeFiltered ?? allWorks;
	return { works: allWorks, filteredWorks, tagGroups, selectedTagIds, matchAllCategories };
};
