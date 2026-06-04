import type { PageLoad } from './$types';
import { getTags } from '$lib/api';

/**
 * The /tags management page wants to see hidden tags so the user can
 * un-hide them — `include_hidden=true` plus the boolean each tag carries.
 * Two parallel fetches aren't needed here; the alias-edge lists for each
 * tag are loaded on demand when the user expands a tag card (keeps the
 * initial payload small even for libraries with a few hundred tags).
 */
export const load: PageLoad = async ({ fetch }) => {
	const tagGroups = await getTags(fetch, { includeHidden: true });
	return { tagGroups };
};
