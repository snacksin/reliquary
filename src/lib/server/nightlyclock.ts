/**
 * When the nightly jobs run (nightly.ts), as pure functions of the wall
 * clock — no imports, no timers, so they're testable with fake times.
 *
 * Why the wall clock and not one long setTimeout: timers count elapsed
 * time, and the Pi has no clock battery. It boots with a stale time and
 * jumps when NTP syncs, so a timer armed at boot would fire at the wrong
 * hour. nightly.ts asks `decide` once a minute instead, which also
 * absorbs laptop sleep and DST.
 */

/** Overdue by up to this (woke from sleep, a short outage): still run. */
export const CATCH_UP_MS = 6 * 60 * 60 * 1000;
/** Due further ahead than this means the clock jumped backwards. */
export const REPLAN_AHEAD_MS = 25 * 60 * 60 * 1000;

export type At = { h: number; m: number };

/** The next local h:m strictly after `from`. */
export function nextRun(at: At, from: Date = new Date()): Date {
	const next = new Date(from);
	next.setHours(at.h, at.m, 0, 0);
	if (next <= from) next.setDate(next.getDate() + 1);
	return next;
}

/**
 * - `wait`: not due yet.
 * - `run`: due, or overdue by up to CATCH_UP_MS.
 * - `skip`: overdue by more (a reboot after a long outage, a boot-time
 *   clock jump). Plan the next night rather than back up at a random hour.
 * - `replan`: due implausibly far ahead (the clock jumped backwards).
 */
export function decide(nowMs: number, dueMs: number): 'wait' | 'run' | 'skip' | 'replan' {
	const late = nowMs - dueMs;
	if (late < 0) return -late > REPLAN_AHEAD_MS ? 'replan' : 'wait';
	return late > CATCH_UP_MS ? 'skip' : 'run';
}
