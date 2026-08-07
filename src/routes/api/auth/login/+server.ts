import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { NoPasswordSetError, verifyPassword } from '$lib/server/auth';

/**
 * POST /api/auth/login
 *   Body: { password: string }. Verifies against the stored Argon2id
 *   hash (argon2.verify recomputes with the PHC string's own params).
 *   400 on malformed body; 401 on wrong password; 409 when no password
 *   is set (nothing to log into — the app is open in that state).
 *   204 on success — NO session yet: Step 1 scope is verify-only.
 *   Step 2 upgrades this same endpoint to issue the session cookie
 *   (remember-me lifetimes) on the 204 path.
 */
export const POST: RequestHandler = async ({ request }) => {
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

	return new Response(null, { status: 204 });
};
