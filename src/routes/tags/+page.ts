import type { PageLoad } from './$types';
import { getAllTagAliasEdges, getTags } from '$lib/api';

/**
 * The /tags management page wants:
 *   - every tag (including ones hidden from the sidebar), so the user
 *     can un-hide them — `?include_hidden=true` on getTags
 *   - every alias edge in one shot, so the tree renders without a
 *     round trip per tag — the new /api/tag-aliases endpoint
 *
 * Both fetches in parallel; the page builds parent / child maps from
 * the edges client-side and renders the tree per category.
 */
export const load: PageLoad = async ({ fetch }) => {
	const [tagGroups, edges] = await Promise.all([
		getTags(fetch, { includeHidden: true }),
		getAllTagAliasEdges(fetch)
	]);
	return { tagGroups, edges };
};
