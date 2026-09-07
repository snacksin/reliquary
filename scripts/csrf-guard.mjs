#!/usr/bin/env node
/**
 * CSRF-contract guard — the standing harness for the dynamic
 * same-origin check in src/hooks.server.ts (M2.2 Step 5A).
 *
 * Contract under test: form-content-type POST/PUT/PATCH/DELETE must
 * carry an Origin header whose host equals the request's own host;
 * everything else (JSON in particular) is untouched. Kit's build-time
 * check is disabled (svelte.config.js trustedOrigins: ['*']), so THIS
 * script is what makes a regression in our replacement loud.
 *
 * Usage:
 *   node scripts/csrf-guard.mjs [base-url]     default http://localhost:3000
 *
 * Run it against any live server — prod build, `pnpm dev`
 * (http://localhost:5173 — the check runs in dev too, by design), a
 * LAN address, reliquary.local (5B), or the Pi. Exits 1 on ANY
 * deviation.
 *
 * STATE-INDEPENDENT + SIDE-EFFECT-FREE by construction, so it is safe
 * against a server running over the real library:
 *  - reject cases expect exactly our 403 {message, id} and never reach
 *    an endpoint;
 *  - the blessed probe posts a garbage "EPUB" that passes the CSRF
 *    layer and then dies harmlessly — 401 when the auth gate is on,
 *    400 'Invalid EPUB file' when it's off (either proves passage;
 *    nothing ingests, per the #97-verified cleanup path);
 *  - the JSON-exemption probe is POST /api/auth/logout with no cookie:
 *    a documented no-op 204. No probe touches /api/auth/login (no
 *    rate-limit pollution) or writes library data.
 */

const base = process.argv[2] ?? 'http://localhost:3000';
const { host } = new URL(base);

let fails = 0;
function report(name, ok, detail) {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) fails += 1;
}

/** POST multipart garbage to /api/upload with the given Origin header
 *  (undefined = omit). Returns { status, body }. */
async function formProbe(origin) {
	const fd = new FormData();
	fd.set('file', new File(['not an epub'], 'csrf-guard-probe.epub'));
	const headers = origin === undefined ? {} : { origin };
	const res = await fetch(`${base}/api/upload`, { method: 'POST', body: fd, headers });
	const body = await res.text();
	return { status: res.status, body };
}

function isOurCsrf403({ status, body }) {
	if (status !== 403) return false;
	try {
		const parsed = JSON.parse(body);
		return parsed.message === 'cross-site form submissions are forbidden' && !!parsed.id;
	} catch {
		return false;
	}
}

const blessed = await formProbe(`http://${host}`);
report(
	'blessed origin passes CSRF (form reaches the app)',
	blessed.status !== 403,
	`got ${blessed.status} (401 = gate on, 400 = gate off — both prove passage)`
);

const evil = await formProbe('http://evil.example');
report('evil origin refused', isOurCsrf403(evil), `got ${evil.status} ${evil.body.slice(0, 80)}`);

const mismatch = await formProbe('http://reliquary.invalid:9999');
report('host-mismatched origin refused', isOurCsrf403(mismatch), `got ${mismatch.status}`);

const absent = await formProbe(undefined);
report('absent Origin refused (kit parity)', isOurCsrf403(absent), `got ${absent.status}`);

const nullOrigin = await formProbe('null');
report(
	'Origin: null (sandboxed iframe) refused',
	isOurCsrf403(nullOrigin),
	`got ${nullOrigin.status}`
);

const malformed = await formProbe('not a url');
report('malformed Origin refused', isOurCsrf403(malformed), `got ${malformed.status}`);

// JSON exemption: an evil Origin on a JSON-shaped request must NOT be
// caught by the CSRF layer (kit parity — form content types only).
// Logout with no cookie is a documented idempotent no-op.
const jsonRes = await fetch(`${base}/api/auth/logout`, {
	method: 'POST',
	headers: { origin: 'http://evil.example', 'content-type': 'application/json' }
});
report('JSON request exempt (kit parity)', jsonRes.status === 204, `got ${jsonRes.status}`);

console.log(fails === 0 ? `csrf-guard OK against ${base}` : `csrf-guard: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
