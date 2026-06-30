import type { PageLoad } from './$types';
import { listWorks, listAllWorks, getTags, type TagCategory } from '$lib/api';

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

const ALLOWED_PER_PAGE = new Set([10, 12, 15]);
const DEFAULT_PER_PAGE = 12;

function parsePage(raw: string | null): number {
	if (!raw) return 1;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePerPage(raw: string | null): number {
	if (!raw) return DEFAULT_PER_PAGE;
	const n = Number.parseInt(raw, 10);
	return ALLOWED_PER_PAGE.has(n) ? n : DEFAULT_PER_PAGE;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const selectedTagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAllCategories = parseMatchAll(url.searchParams.get('match_all'));
	const page = parsePage(url.searchParams.get('page'));
	const perPage = parsePerPage(url.searchParams.get('per_page'));
	// Forward `q` verbatim — server sanitizes for FTS5. We keep the
	// raw value here so the SearchInput renders what the user typed.
	const q = url.searchParams.get('q') ?? '';
	// You-layer Step 1b: sort key + rating/favorites filters from the URL
	// (the single source of truth — bookmarkable, survives pagination). The
	// server re-validates all three before SQL.
	const sort = url.searchParams.get('sort') === 'rating' ? 'rating' : 'added';
	const rawMinStars = Number.parseInt(url.searchParams.get('min_stars') ?? '', 10);
	const minStars = Number.isInteger(rawMinStars) && rawMinStars >= 1 && rawMinStars <= 5 ? rawMinStars : null;
	const favOnly = url.searchParams.get('fav') === '1';

	// Three fetches, parallelized:
	//   - getTags(): drives the right-column filter sidebar
	//   - listAllWorks(): unfiltered, drives Continue Reading + Favorites
	//     (those lists must surface in-progress / favorited works
	//     regardless of the current tag filter or search query, and
	//     the *full* set must be available client-side to derive the
	//     subsets).
	//   - listWorks({ tags, matchAll, q, page, perPage }): server-
	//     filtered + searched + paginated, drives the middle column.
	const [tagGroups, allWorks, filteredPage] = await Promise.all([
		getTags(fetch),
		listAllWorks(fetch),
		listWorks(fetch, {
			tags: selectedTagIds,
			matchAll: matchAllCategories,
			q,
			page,
			perPage,
			sort,
			minStars,
			fav: favOnly
		})
	]);

	return {
		works: allWorks,
		filteredPage,
		tagGroups,
		selectedTagIds,
		matchAllCategories,
		q,
		sort,
		minStars,
		favOnly,
		page: filteredPage.page,
		perPage: filteredPage.per_page
	};
};
