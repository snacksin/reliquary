import type { PageLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getAuthStatus } from '$lib/api';

/**
 * M2.2 Step 2: the login page only exists while the gate is on and the
 * device is logged out. App open (no password) or already authed →
 * straight to the library. The gate itself never redirects TO here in
 * those states; this covers direct visits.
 */
export const load: PageLoad = async ({ fetch }) => {
	const status = await getAuthStatus(fetch);
	if (!status.passwordSet || status.authed) {
		redirect(303, '/');
	}
	return {};
};
