import type { RequestHandler } from './$types';
import { destroySession } from '$lib/server/session';

/**
 * POST /api/auth/logout
 *   Logs out THIS device: deletes its session row (if any) and clears
 *   the cookie. Allowlisted through the gate and fully idempotent —
 *   no cookie, a stale cookie, or gate-off all just 204. Other
 *   devices' sessions are untouched (change/remove/reset are the
 *   everything-out paths).
 */
export const POST: RequestHandler = async (event) => {
	destroySession(event);
	return new Response(null, { status: 204 });
};
