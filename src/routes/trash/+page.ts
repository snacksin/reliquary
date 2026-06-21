import type { PageLoad } from './$types';
import { getTrash } from '$lib/api';

/** M2.3 Step 5: the Trash management view loads the trashed-works list. */
export const load: PageLoad = async ({ fetch }) => {
	return { trashed: await getTrash(fetch) };
};
