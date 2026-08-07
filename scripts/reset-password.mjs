#!/usr/bin/env node
/**
 * LAN password reset — the documented forgot-password path (M2.2 Step 1).
 *
 * There is deliberately no in-app recovery flow (DESIGN §6.15, single
 * user): if the password is forgotten, run this on the server from the
 * app root. It deletes app_config.'lan_password_hash', after which the
 * first-run /setup page accepts a new password again.
 *
 * Under the credentials-are-the-switch model (Allie 2026-08-07) this is
 * also the CLI form of "remove = gate off": with no stored hash, Step 2's
 * gate does not enforce and the app is open — same as pre-M2.2.
 *
 * Usage:
 *   node scripts/reset-password.mjs
 *
 * Safe against a running server: nothing caches the hash — the next
 * /api/auth/status or login reads the table fresh.
 *
 * Step 2 TODO: once sessions exist, this script must ALSO invalidate
 * every session (a reset that leaves live sessions valid would be a
 * hole). The same invalidation applies to the settings-panel
 * change/remove flows Step 2 adds.
 */
import Database from 'better-sqlite3';

const DB_PATH = 'data/reliquary.db';

let db;
try {
	db = new Database(DB_PATH, { fileMustExist: true });
} catch {
	console.error(`no database at ${DB_PATH} — run this from the app root`);
	process.exit(1);
}
db.pragma('busy_timeout = 5000');

const hasTable = db
	.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_config'")
	.get();
if (!hasTable) {
	console.log('no app_config table (database pre-dates migration 0027) — nothing to reset');
	process.exit(0);
}

const result = db.prepare("DELETE FROM app_config WHERE key = 'lan_password_hash'").run();
if (result.changes === 1) {
	console.log('password cleared — visit /setup to set a new one');
} else {
	console.log('no password was set — nothing to reset');
}
