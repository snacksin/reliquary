/**
 * Per-device login sessions — M2.2 Step 2.
 *
 * The cookie carries a random 256-bit token (base64url); the DB stores
 * only its SHA-256 hex, so the sessions table never contains anything a
 * reader of the DB file could replay. Single user: a row is "a device
 * is logged in", nothing more.
 *
 * Lifetime is sliding: 90 days from issue, renewed (row + cookie)
 * whenever a validated request finds less than 45 days remaining — the
 * "log in once per device" promise. Expired rows are swept at boot as
 * housekeeping; the real boundary is the expires_at predicate in the
 * lookup.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { getDb } from './db';

export const SESSION_COOKIE = 'reliquary_session';
const SESSION_DAYS = 90;
const RENEW_BELOW_DAYS = 45;

/**
 * Cookie options live in one place. secure:false is DELIBERATE and
 * explicit: Reliquary serves plain HTTP on the LAN until the Pi move,
 * and SvelteKit's default infers `secure` from the hostname — on a LAN
 * IP it would default true and the browser would silently drop the
 * cookie. ⚠️ RETIREMENT BREADCRUMB — HTTPS era (Pi/Caddy, M2.2 Step 5
 * → PI.md): flip this to secure:true alongside the ORIGIN env change;
 * the two retire together.
 */
const COOKIE_OPTS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: false,
	maxAge: SESSION_DAYS * 86400
} as const;

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Issue a fresh session for this device and set its cookie. */
export function createSession(event: RequestEvent): void {
	const token = randomBytes(32).toString('base64url');
	// Headers are attacker-controlled; cap what we store.
	const userAgent = (event.request.headers.get('user-agent') ?? '').slice(0, 256) || null;
	getDb()
		.prepare(
			`INSERT INTO sessions (id, expires_at, user_agent)
			 VALUES (?, datetime('now', '+${SESSION_DAYS} days'), ?)`
		)
		.run(hashToken(token), userAgent);
	event.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS);
}

/**
 * Validate the request's session cookie. On success, slides the
 * expiry forward (row + re-set cookie) when under the renewal
 * threshold and touches last_seen_at at most hourly. Fully sync —
 * this runs inside the handle hook on every gated request.
 */
export function validateSession(event: RequestEvent): boolean {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return false;
	const id = hashToken(token);
	const db = getDb();
	const row = db
		.prepare(`SELECT 1 FROM sessions WHERE id = ? AND expires_at > datetime('now')`)
		.get(id);
	if (!row) return false;

	const renewed = db
		.prepare(
			`UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days')
			 WHERE id = ? AND expires_at < datetime('now', '+${RENEW_BELOW_DAYS} days')`
		)
		.run(id);
	if (renewed.changes === 1) {
		event.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS);
	}

	db.prepare(
		`UPDATE sessions SET last_seen_at = datetime('now')
		 WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour'))`
	).run(id);

	return true;
}

/** Log out this device: delete its row (if any) and clear the cookie. */
export function destroySession(event: RequestEvent): void {
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
	}
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Log out every device. Password change/remove and the CLI reset use this. */
export function destroyAllSessions(): void {
	getDb().prepare('DELETE FROM sessions').run();
}

/**
 * Boot-time sweep of expired rows. Housekeeping only — the lookup
 * predicate is the real boundary. CR-invisible by the same contract as
 * purgeExpired: sessions are not in the CR projection.
 */
export function purgeExpiredSessions(db: Database.Database): number {
	const result = db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
	if (result.changes > 0) console.log(`[session-purge] ${result.changes} expired sessions removed`);
	return result.changes;
}
