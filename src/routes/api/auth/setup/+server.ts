import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { hashPassword, storeHashIfUnset } from '$lib/server/auth';

/**
 * POST /api/auth/setup
 *   Body: { password: string }. First-run only: hashes with Argon2id and
 *   stores the LAN password — REFUSES to overwrite an existing one.
 *   400 on malformed body / empty password / password over 512 chars;
 *   409 when a password is already set (atomic — a double-submit race
 *   cannot overwrite; the losing insert reports 409).
 *   204 on success. Password change is deliberately impossible here:
 *   Step 2 adds the settings-panel set/change/remove flow
 *   (current-password-required); until then, change = CLI reset
 *   (scripts/reset-password.mjs) + re-setup.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	if (!body || typeof body.password !== 'string') {
		throw error(400, 'expected { password: string }');
	}
	if (body.password.length === 0) {
		throw error(400, 'password must not be empty');
	}
	// Cheap DoS guard: argon2 is memory-hard by design — don't feed it
	// megabytes. Stored verbatim otherwise (no trim, no normalization).
	if (body.password.length > 512) {
		throw error(400, 'password too long (max 512 characters)');
	}

	const hash = await hashPassword(body.password);
	if (!storeHashIfUnset(hash)) {
		throw error(409, 'password already set');
	}

	return new Response(null, { status: 204 });
};
