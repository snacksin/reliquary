/**
 * LAN password credentials — hashing + storage (M2.2 Steps 1–2).
 *
 * Sessions live in ./session.ts; the gate lives in hooks.server.ts.
 * The credentials themselves are the gate's on/off switch (Allie
 * 2026-08-07) — a stored hash means the gate enforces, no stored hash
 * means the app stays open. Deleting the row (/api/auth/remove, or
 * scripts/reset-password.mjs) IS the disable path; there is no
 * separate flag. isPasswordSet() is re-read per request BY CONTRACT:
 * the reset script mutates the DB from another process, so nothing may
 * cache the answer.
 *
 * Passwords are stored and compared VERBATIM — no trimming, no Unicode
 * normalization. Do not "helpfully" add NFC/trim later: it would lock
 * out any existing password containing the affected bytes.
 */
import argon2 from 'argon2';
import { getDb } from './db';

const KEY = 'lan_password_hash';

/**
 * Pinned Argon2id parameters — RFC 9106's second recommendation
 * (64 MiB, t=3, p=4). These match the library's current defaults, but
 * defaults have drifted across argon2 releases before, so we pin.
 * Sized with the Pi 4 in mind: ~0.5–1.5 s per hash there, fine for a
 * single user's rare logins. verify() reads params from the stored PHC
 * string, so re-tuning here never invalidates existing hashes.
 */
const ARGON2_PARAMS = {
	type: argon2.argon2id,
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 4
} as const;

// FAIL LOUDLY at boot: argon2 is a native module whose binding resolves
// from shipped prebuilds at require time (node-gyp-build) — a broken /
// missing / wrong-arch binding must crash startup (visible, diagnosable)
// instead of 500ing the first login. Same contract as sanitize.ts, made
// async via top-level await: a rejection here propagates through the
// hooks.server.ts side-effect import and refuses boot. Minimal-cost
// roundtrip (the library's enforced floors: memoryCost 2048 KiB,
// timeCost 2) — the probe proves the machinery works; hash strength is
// a login-time property of ARGON2_PARAMS, not the probe's business.
const probe = await argon2.hash('reliquary-binding-probe', {
	type: argon2.argon2id,
	memoryCost: 2048,
	timeCost: 2,
	parallelism: 1
});
if (!(await argon2.verify(probe, 'reliquary-binding-probe'))) {
	throw new Error(
		'argon2 self-test failed: hash/verify roundtrip did not verify — refusing to boot'
	);
}

/**
 * M2.2 Step 3: serialize every argon2 operation through one queue.
 * Each hash/verify holds 64 MiB while it runs — a burst of parallel
 * login attempts could multiply that into real memory pressure on a
 * Pi 4. Concurrency 1 closes the amplification angle outright, and a
 * single user never notices the queue. Failures propagate to their own
 * caller; the chain itself always advances (the .catch keeps one
 * rejection from wedging every later operation).
 */
let argon2Queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
	const result = argon2Queue.then(op);
	argon2Queue = result.catch(() => undefined);
	return result;
}

/** Thrown by verifyPassword when no password is set, so callers can never
 *  conflate "no credentials exist" (409) with "wrong password" (401). */
export class NoPasswordSetError extends Error {
	constructor() {
		super('no password set');
	}
}

/** Hash a password with the pinned Argon2id parameters → PHC string. */
export function hashPassword(password: string): Promise<string> {
	return enqueue(() => argon2.hash(password, ARGON2_PARAMS));
}

/** The stored PHC hash string, or null when no password is set. */
export function getStoredHash(): string | null {
	const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').pluck().get(KEY) as
		| string
		| undefined;
	return row ?? null;
}

export function isPasswordSet(): boolean {
	return getStoredHash() !== null;
}

/**
 * Store the hash ONLY if no password exists yet. Returns false when a
 * hash was already stored (including a lost race — the ON CONFLICT is
 * the atomic guard, no check-then-insert TOCTOU). Password CHANGE goes
 * through updateHash below (current-password-verified at the
 * /api/auth/change endpoint), never through this function.
 */
export function storeHashIfUnset(hash: string): boolean {
	const result = getDb()
		.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
		.run(KEY, hash);
	return result.changes === 1;
}

/**
 * Replace the stored hash (password change). Callers MUST have
 * verified the current password first (/api/auth/change does) and must
 * rotate sessions afterwards. Returns false when no password was set.
 */
export function updateHash(hash: string): boolean {
	const result = getDb()
		.prepare('UPDATE app_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
		.run(hash, KEY);
	return result.changes === 1;
}

/**
 * Delete the stored hash — the gate's off switch (password remove).
 * Callers MUST have verified the current password first and must
 * destroy all sessions afterwards. Returns false when none was set.
 */
export function deleteHash(): boolean {
	const result = getDb().prepare('DELETE FROM app_config WHERE key = ?').run(KEY);
	return result.changes === 1;
}

/**
 * Verify a candidate password against the stored hash.
 * Throws NoPasswordSetError when no password is set.
 */
export async function verifyPassword(password: string): Promise<boolean> {
	const hash = getStoredHash();
	if (hash === null) throw new NoPasswordSetError();
	return enqueue(() => argon2.verify(hash, password));
}
