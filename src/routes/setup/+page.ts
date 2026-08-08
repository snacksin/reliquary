import type { PageLoad } from './$types';
import { getAuthStatus } from '$lib/api';

/**
 * M2.2: the LAN password management page loads whether a password
 * exists (first-run set form vs change/remove management). Gated once
 * a password is set; reachable ungated first-run because the gate is
 * off without credentials (the switch model).
 */
export const load: PageLoad = async ({ fetch }) => {
	return { status: await getAuthStatus(fetch) };
};
