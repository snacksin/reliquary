import type { PageLoad } from './$types';
import { getAuthors, getAuthorTagVocab } from '$lib/api';

/** Parse the `?author_tags=1,2` filter param into a clean id list. */
function parseTagIds(raw: string | null): number[] {
	if (!raw) return [];
	const ids = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isInteger(n) && n > 0) ids.add(n);
	}
	return [...ids];
}

/**
 * The /authors index loads the author list (optionally filtered to authors
 * carrying ALL selected author-tags) plus the full tag vocabulary for the
 * filter chips. (Author Pages Part 1 + Part 2.)
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const selectedTagIds = parseTagIds(url.searchParams.get('author_tags'));
	const [authors, tagVocab] = await Promise.all([
		getAuthors(fetch, { authorTags: selectedTagIds }),
		getAuthorTagVocab(fetch)
	]);
	return { authors, tagVocab, selectedTagIds };
};
