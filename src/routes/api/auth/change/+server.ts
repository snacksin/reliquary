import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { NoPasswordSetError, hashPassword, updateHash, verifyPassword } from '$lib/server/auth';
import { createSession, destroyAllSessions } from '$lib/server/session';

/**
 * POST /api/auth/change
 *   Body: { currentPassword: string, newPassword: string }. Replaces
 *   the LAN password. Reached only authenticated (the gate guards it),
 *   but the current password is required anyway — a borrowed unlocked
 *   device must not be enough to take over the library.
 *   400 malformed / empty new password / either over 512 chars;
 *   401 wrong current password; 409 no password set (nothing to
 *   change — use /api/auth/setup).
 *   204 on success. Session rule: ROTATE — every session is destroyed,
 *   then a fresh one is issued to this device. The changing device
 *   stays logged in; every other device is signed out.
 */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as {
		currentPassword?: unknown;
		newPassword?: unknown;
	} | null;
	if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
		throw error(400, 'expected { currentPassword: string, newPassword: string }');
	}
	if (body.newPassword.length === 0) {
		throw error(400, 'new password must not be empty');
	}
	if (body.currentPassword.length > 512 || body.newPassword.length > 512) {
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

	updateHash(await hashPassword(body.newPassword));
	destroyAllSessions();
	createSession(event);
	return new Response(null, { status: 204 });
};
