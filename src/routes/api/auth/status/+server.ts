import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { isPasswordSet } from '$lib/server/auth';

/**
 * GET /api/auth/status
 *   Returns { passwordSet: boolean } — whether a LAN password exists.
 *   Drives the /setup page's form-vs-already-set branch. Deliberately
 *   carries nothing else; the credentials being set is also the gate's
 *   on/off state once Step 2 enforces.
 */
export const GET: RequestHandler = async () => {
	return json({ passwordSet: isPasswordSet() });
};
