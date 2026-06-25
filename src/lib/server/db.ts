import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backfillIdentity } from './identity';
import { purgeExpired } from './purge';
import { backfillSeries } from './series';
import { backfillSource, backfillSourceUrl } from './source';

let cached: Database.Database | undefined;

export function getDb(): Database.Database {
	if (cached) return cached;

	mkdirSync('data', { recursive: true });
	const db = new Database('data/reliquary.db');
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	// Wait up to 5s for a transient write lock to clear instead of
	// throwing `SQLITE_BUSY: database is locked` immediately. The common
	// case is DB Browser holding the file open during verification — a
	// write action (trash/restore, upload) should ride out that brief
	// lock rather than 500.
	db.pragma('busy_timeout = 5000');

	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);

	const migrationsDir = join(process.cwd(), 'migrations');
	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').pluck();
	const recordVersion = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

	for (const file of files) {
		const match = /^(\d+)/.exec(file);
		if (!match) throw new Error(`Migration file missing leading number: ${file}`);
		const version = Number(match[1]);

		if (isApplied.get(version)) continue;

		const sql = readFileSync(join(migrationsDir, file), 'utf8');
		db.transaction(() => {
			db.exec(sql);
			recordVersion.run(version);
		})();
	}

	cached = db;

	// M2.3 Step 2: one-shot identity backfill. Cache the handle FIRST so
	// the re-entrant getDb() inside the backfill returns immediately, and
	// guard it so a backfill failure can never stop the DB from booting.
	// Runs exactly once per process — later getDb() calls short-circuit on
	// `cached` at the top before reaching here.
	try {
		backfillIdentity(db);
	} catch (e) {
		console.error('[backfill] failed', e);
	}

	// Series Pages Part 1: one-shot series backfill from stored prefaces.
	// Same guarded-once-per-boot shape as the identity backfill above —
	// a failure here can never stop the DB from booting.
	try {
		backfillSeries(db);
	} catch (e) {
		console.error('[series-backfill] failed', e);
	}

	// Multi-Source Step 1: one-shot source classification from stored prefaces.
	// Same guarded-once-per-boot shape — a failure here can never block boot.
	try {
		backfillSource(db);
	} catch (e) {
		console.error('[source-backfill] failed', e);
	}

	// MS Step 2: recover source_url for FicHub fics (runs after backfillSource,
	// which sets `source`). Guarded — a failure here can never block boot.
	try {
		backfillSourceUrl(db);
	} catch (e) {
		console.error('[source-url-backfill] failed', e);
	}

	// M2.3 Step 6: one-shot boot-time auto-purge of works trashed more
	// than PURGE_AFTER_DAYS (30) ago, via the same purgeWork path as the
	// /trash Delete-forever action. Guarded so a purge failure can never
	// stop the DB from booting (same pattern as the backfill above).
	try {
		purgeExpired(db);
	} catch (e) {
		console.error('[purge] failed', e);
	}

	return db;
}
