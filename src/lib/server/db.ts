import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backfillIdentity } from './identity';

let cached: Database.Database | undefined;

export function getDb(): Database.Database {
	if (cached) return cached;

	mkdirSync('data', { recursive: true });
	const db = new Database('data/reliquary.db');
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

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

	return db;
}
