import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { NoPasswordSetError, verifyPassword } from '$lib/server/auth';
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from '$lib/server/ratelimit';
import { createSession } from '$lib/server/session';

/**
 * POST /api/auth/login
 *   Body: { password: string }. Verifies against the stored Argon2id
 *   hash (argon2.verify recomputes with the PHC string's own params;
 *   verifies are serialized — one 64 MiB hash at a time, see auth.ts).
 *   400 on malformed body; 401 on wrong password; 409 when no password
 *   is set (nothing to log into — the app is open in that state);
 *   429 while the source is cooling down after repeated failures
 *   (message carries the wait: 'too many attempts — try again in Ns';
 *   the login page renders it in the design's voice). Failed verifies
 *   feed the per-source backoff in $lib/server/ratelimit; success
 *   clears it — someone who typos twice never meets the bouncer.
 *   204 on success, with a fresh per-device session cookie (90-day
 *   sliding — see $lib/server/session). Persistence is the silent
 *   default: no remember-me choice exists by design.
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

	// The bouncer: refused attempts never reach the memory-hard verify.
	const source = event.getClientAddress();
	const wait = checkLoginAllowed(source);
	if (wait !== null) {
		throw error(429, `too many attempts — try again in ${wait}s`);
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
		recordLoginFailure(source);
		throw error(401, 'incorrect password');
	}

	clearLoginFailures(source);
	createSession(event);
	return new Response(null, { status: 204 });
};
