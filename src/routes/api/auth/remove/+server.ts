import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { NoPasswordSetError, deleteHash, verifyPassword } from '$lib/server/auth';
import { SESSION_COOKIE, destroyAllSessions } from '$lib/server/session';

/**
 * POST /api/auth/remove
 *   Body: { currentPassword: string }. Removes the LAN password —
 *   the gate's OFF switch (the credentials ARE the switch): after
 *   this, the app is open exactly as pre-M2.2. Reached only
 *   authenticated; the current password is still required.
 *   400 malformed; 401 wrong password; 409 no password set.
 *   204 on success. Session rule: ALL sessions destroyed and the
 *   cookie cleared — with the gate off they'd be meaningless rows.
 */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as {
		currentPassword?: unknown;
	} | null;
	if (!body || typeof body.currentPassword !== 'string') {
		throw error(400, 'expected { currentPassword: string }');
	}
	if (body.currentPassword.length > 512) {
		throw error(400, 'password too long (max 512 characters)');
	}

	let ok: boolean;
	try {
		ok = await verifyPassword(body.currentPassword);
	} catch (e) {
		if (e instanceof NoPasswordSetError) {
			throw error(409, 'no password set');
		}
		throw e;
	}
	if (!ok) {
		throw error(401, 'incorrect password');
	}

	deleteHash();
	destroyAllSessions();
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	return new Response(null, { status: 204 });
};
