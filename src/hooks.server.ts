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
import '$lib/server/auth';

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
