/**
 * Failed-login rate limiting — M2.2 Step 3, the gate's bouncer.
 *
 * Scope is the unauthenticated brute-force surface only: POST
 * /api/auth/login. (change/remove sit behind the gate; setup only
 * exists un-gated while no password does.)
 *
 * Shape — forgiving for Allie, hostile to scripts:
 *   - The first FREE_FAILURES failed verifies cost nothing: a user who
 *     typos twice (or five times) never notices this module exists.
 *   - After that, each failure sets an exponential cool-down per
 *     source: 2s, 4s, 8s, … capped at 60s. A script gets ~16 guesses
 *     in its first minute and one per minute after — against a 64 MiB
 *     Argon2id verify, brute force is dead on arrival.
 *   - Attempts DURING a cool-down are refused without running the
 *     verify and do NOT escalate the delay — a stuck retry loop hurts
 *     only itself, and (keyed per source) never Allie's phone.
 *   - A successful login clears the source's slate entirely.
 *
 * State is IN-MEMORY BY DESIGN, not an oversight: single user on a
 * LAN — a server restart clearing the throttle is fine (an attacker
 * who can restart the server owns the box already, and the DB stays
 * free of throttle noise: nothing here can ever touch CR).
 */

const FREE_FAILURES = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
/** Entries idle this long are pruned (lazily, on any check). */
const STALE_MS = 60 * 60 * 1000;

type SourceState = {
	failures: number;
	blockedUntil: number; // epoch ms; 0 = not blocked
	lastSeen: number;
};

const sources = new Map<string, SourceState>();

function prune(now: number): void {
	for (const [key, s] of sources) {
		if (now - s.lastSeen > STALE_MS) sources.delete(key);
	}
}

/**
 * Gate an incoming login attempt. Returns null when the attempt may
 * proceed to the verify, or the whole seconds to wait when the source
 * is cooling down.
 */
export function checkLoginAllowed(source: string): number | null {
	const now = Date.now();
	prune(now);
	const s = sources.get(source);
	if (!s || now >= s.blockedUntil) return null;
	s.lastSeen = now;
	return Math.ceil((s.blockedUntil - now) / 1000);
}

/** Record a failed verify; starts/extends the cool-down past the free tier. */
export function recordLoginFailure(source: string): void {
	const now = Date.now();
	const s = sources.get(source) ?? { failures: 0, blockedUntil: 0, lastSeen: now };
	s.failures += 1;
	s.lastSeen = now;
	if (s.failures > FREE_FAILURES) {
		const exp = s.failures - FREE_FAILURES - 1;
		const delay = Math.min(BASE_DELAY_MS * 2 ** exp, MAX_DELAY_MS);
		s.blockedUntil = now + delay;
	}
	sources.set(source, s);
}

/** A successful login wipes the source's slate. */
export function clearLoginFailures(source: string): void {
	sources.delete(source);
}
