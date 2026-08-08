import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

/**
 * GET /api/auth/status
 *   Returns { passwordSet, authed } straight from locals (stamped by
 *   the gate in hooks.server.ts — zero DB work here). passwordSet is
 *   also the gate's on/off state (the switch model); authed is whether
 *   this request carried a valid session. Allowlisted through the gate
 *   so the /login and /setup loads can read it unauthenticated.
 */
export const GET: RequestHandler = async ({ locals }) => {
	return json({ passwordSet: locals.gated, authed: locals.authed });
};
