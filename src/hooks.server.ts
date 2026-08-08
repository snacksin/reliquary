/**
 * Server-side hooks. Top-level side effects in this file run once when
 * the SvelteKit server boots — both `pnpm dev` and `pnpm start` (the
 * adapter-node bundle imports this module on startup).
 *
 * The handlers here are a defense-in-depth safety net for third-party
 * libs that emit asynchronous errors without giving us a chance to
 * catch them at the call site. Specifically: `epub2` is built on
 * EventEmitter under the hood, and its `createAsync` wrapper attaches
 * `once('error', reject)` to the EPub instance. If a SECOND 'error'
 * event fires later (or a setImmediate / process.nextTick callback in
 * its internal pipeline throws), the unhandled-error pathway crashes
 * the Node process.
 *
 * Primary mitigation lives in `src/lib/server/epub.ts` — we pin a
 * persistent `on('error', ...)` listener to each EPub instance to
 * swallow the deferred events. This file catches anything that
 * slipped through. Log it, keep the server up.
 *
 * Intentionally narrow: we don't try to recover or restart — these
 * handlers just prevent process termination. The upload endpoint's
 * try/catch still produces the 400; the request that triggered the
 * error already failed cleanly from the client's perspective.
 */

// Code Health Step 2: warm the fic-HTML sanitizer at boot. The import's
// module init builds the jsdom window and ASSERTS DOMPurify support —
// a broken jsdom install crashes the server at startup (visible,
// diagnosable) instead of 500ing on the first chapter read. Fail closed,
// early.
import '$lib/server/sanitize';

// M2.2 Step 1: warm the argon2 auth module at boot. Module init runs a
// minimal-cost hash/verify roundtrip via top-level await — a broken
// native binding (wrong arch, missing prebuild, failed compile) crashes
// the server at startup instead of 500ing the first login. Fail closed,
// early. (Same contract as sanitize above, generalized to async init.)
import { isPasswordSet } from '$lib/server/auth';
import { validateSession } from '$lib/server/session';
import { json, redirect, type Handle } from '@sveltejs/kit';

/**
 * M2.2 Step 2 — THE GATE. Enforced ONLY when a password is set (the
 * credentials ARE the on/off switch, Allie 2026-08-07): no password →
 * every request passes untouched, exactly pre-M2.2 behavior. No forced
 * redirects of any kind in the open state.
 *
 * isPasswordSet() is deliberately re-read per request — the CLI reset
 * script flips it from another process (contract in auth.ts).
 *
 * Unauthed + gated:
 *  - /api/** → 401 JSON. NEVER a redirect: client-side fetch follows
 *    redirects silently and would hand JSON.parse the login page.
 *  - everything else (pages AND unmatched routes) → 303 to /login with
 *    a ?from= return pointer. NEVER 404: the dev server's 404 fallback
 *    re-tries static file serving, and unmatched must not leak route
 *    existence either.
 *
 * ⚠️ The gate's contract exists ONLY in prod (pnpm build && pnpm
 * start). `vite dev` serves raw project files — data/reliquary.db
 * included — before hooks run. NEVER run the dev server with --host or
 * any LAN exposure; dev is laptop-localhost-only, forever.
 */
const ALLOWED_ROUTES = new Set([
	'/login', // the login page itself
	'/api/auth/login', // how you get in
	'/api/auth/status', // one boolean pair, drives /login + /setup loads
	'/api/auth/logout' // no-op friendly; never worth a 401
]);

export const handle: Handle = async ({ event, resolve }) => {
	if (!isPasswordSet()) {
		event.locals.gated = false;
		event.locals.authed = false;
		return resolve(event);
	}

	event.locals.gated = true;
	// Validate BEFORE the allowlist check: /api/auth/status needs a
	// truthful `authed` and /login's load bounces already-authed users.
	event.locals.authed = validateSession(event);
	if (event.locals.authed) return resolve(event);

	if (event.route.id !== null && ALLOWED_ROUTES.has(event.route.id)) {
		return resolve(event);
	}

	const p = event.url.pathname;
	if (p === '/api' || p.startsWith('/api/')) {
		return json({ message: 'authentication required' }, { status: 401 });
	}
	// event.url is pre-normalized by Kit (__data.json suffix stripped),
	// so `from` is clean for data requests too; Kit converts the thrown
	// redirect into a redirect JSON response for those.
	redirect(303, `/login?from=${encodeURIComponent(p + event.url.search)}`);
};

if (typeof process !== 'undefined' && process.on) {
	process.on('unhandledRejection', (reason) => {
		console.error(
			'[unhandledRejection]',
			reason instanceof Error ? `${reason.message}\n${reason.stack}` : reason
		);
	});

	process.on('uncaughtException', (err) => {
		console.error('[uncaughtException]', err.message, '\n', err.stack);
	});
}
