/**
 * LAN password credentials — M2.2 Step 1 (hashing + storage only).
 *
 * No sessions and no enforcement live here yet: Step 2 adds the session
 * middleware and the hooks guard. The credentials themselves are the
 * gate's on/off switch (Allie 2026-08-07) — a stored hash means the gate
 * enforces (Step 2), no stored hash means the app stays open. Deleting
 * the row (scripts/reset-password.mjs, or the Step 2 settings-panel
 * "remove" flow) IS the disable path; there is no separate flag.
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

/** Thrown by verifyPassword when no password is set, so callers can never
 *  conflate "no credentials exist" (409) with "wrong password" (401). */
export class NoPasswordSetError extends Error {
	constructor() {
		super('no password set');
	}
}

/** Hash a password with the pinned Argon2id parameters → PHC string. */
export function hashPassword(password: string): Promise<string> {
	return argon2.hash(password, ARGON2_PARAMS);
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
 * the atomic guard, no check-then-insert TOCTOU). This module has no
 * update path by design: Step 1 scoping — password change arrives in
 * Step 2's settings-panel flow (current-password-required); until then
 * change = CLI reset + re-setup.
 */
export function storeHashIfUnset(hash: string): boolean {
	const result = getDb()
		.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
		.run(KEY, hash);
	return result.changes === 1;
}

/**
 * Verify a candidate password against the stored hash.
 * Throws NoPasswordSetError when no password is set.
 */
export async function verifyPassword(password: string): Promise<boolean> {
	const hash = getStoredHash();
	if (hash === null) throw new NoPasswordSetError();
	return argon2.verify(hash, password);
}
