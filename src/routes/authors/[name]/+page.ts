import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	listWorks,
	getTags,
	getAuthors,
	getAuthorDetail,
	getAuthorTags,
	getAuthorTagVocab,
	type TagCategory
} from '$lib/api';

// Param parsing mirrors src/routes/+page.ts (the library load). Values
// are re-validated server-side, so this is belt-and-suspenders; kept
// local rather than refactoring the library load (zero-regression).
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

/**
 * Author detail (Part 1). Reuses the library's listing + tag pipeline,
 * scoped to one author via the `author` param. The middle column and
 * right sidebar read the same tags/match_all/q/page/per_page URL params
 * as the library. 404 if the name isn't a current author (no non-trashed
 * works) — `getAuthors` is the source of truth for membership + the
 * header's work count and favorite state.
 */
export const load: PageLoad = async ({ params, fetch, url }) => {
	const author = params.name;
	const selectedTagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAllCategories = parseMatchAll(url.searchParams.get('match_all'));
	const page = parsePage(url.searchParams.get('page'));
	const perPage = parsePerPage(url.searchParams.get('per_page'));
	const q = url.searchParams.get('q') ?? '';
	// Author Identity Part A: optional pseud sub-filter (URL param, so it's
	// bookmarkable and back-button-friendly like every other filter). The
	// server matches it against the primary byline pseud label.
	const pseud = url.searchParams.get('pseud') ?? '';

	const [authors, filteredPage, tagGroups, detail, authorTags, tagVocab] = await Promise.all([
		getAuthors(fetch),
		listWorks(fetch, {
			author,
			pseud: pseud || undefined,
			tags: selectedTagIds,
			matchAll: matchAllCategories,
			q,
			page,
			perPage
		}),
		getTags(fetch, { author }),
		getAuthorDetail(author, fetch),
		getAuthorTags(author, fetch),
		getAuthorTagVocab(fetch)
	]);

	const authorRecord = authors.find((a) => a.name === author);
	if (!authorRecord) throw error(404, 'author not found');

	return {
		author: authorRecord,
		filteredPage,
		tagGroups,
		selectedTagIds,
		matchAllCategories,
		q,
		pseud,
		page: filteredPage.page,
		perPage: filteredPage.per_page,
		// Author Pages Part 2: left-column notes + tags.
		notes: detail.notes,
		// Author Identity Part A: "pseuds seen so far" with live-work counts —
		// drives the pseud sub-filter pills (shown only when ≥2 labels).
		pseuds: detail.pseuds,
		authorTags,
		tagVocab
	};
};
