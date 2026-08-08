import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { NoPasswordSetError, verifyPassword } from '$lib/server/auth';
import { createSession } from '$lib/server/session';

/**
 * POST /api/auth/login
 *   Body: { password: string }. Verifies against the stored Argon2id
 *   hash (argon2.verify recomputes with the PHC string's own params).
 *   400 on malformed body; 401 on wrong password; 409 when no password
 *   is set (nothing to log into — the app is open in that state).
 *   204 on success, with a fresh per-device session cookie (90-day
 *   sliding — see $lib/server/session). Persistence is the silent
 *   default: no remember-me choice exists by design.
 *   Note (Step 3): verifies are memory-hard (64 MiB argon2id); failed-
 *   login rate limiting / serialization lands in M2.2 Step 3.
 */
export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	if (!body || typeof body.password !== 'string') {
		throw error(400, 'expected { password: string }');
	}
	if (body.password.length > 512) {
		throw error(400, 'password too long (max 512 characters)');
	}

	let ok: boolean;
	try {
		ok = await verifyPassword(body.password);
	} catch (e) {
		if (e instanceof NoPasswordSetError) {
			throw error(409, 'no password set');
		}
		throw e;
	}
	if (!ok) {
		throw error(401, 'incorrect password');
	}

	createSession(event);
	return new Response(null, { status: 204 });
};
