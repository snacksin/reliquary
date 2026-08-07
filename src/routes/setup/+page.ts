import type { PageLoad } from './$types';
import { getAuthStatus } from '$lib/api';

/**
 * M2.2 Step 1: the first-run set-password page loads whether a password
 * already exists (form vs already-set branch). Reached by manual URL
 * only for now — no banner, no redirect; a passwordless app just stays
 * open (the credentials are the gate's switch).
 */
export const load: PageLoad = async ({ fetch }) => {
	return { status: await getAuthStatus(fetch) };
};
