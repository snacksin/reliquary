#!/usr/bin/env node
/**
 * Back up the library right now (Pi plan step 1). Same code as the
 * nightly backup (src/lib/server/backup.js), safe to run while the
 * server is running — the database is copied with SQLite's online backup.
 *
 * Usage (from the app root):
 *   node scripts/backup-now.mjs                 uses RELIQUARY_BACKUP_DIR
 *   node scripts/backup-now.mjs --to <folder>   an existing folder
 *   node scripts/backup-now.mjs --keep 7        newest n kept (default 7,
 *                                               or RELIQUARY_BACKUP_KEEP)
 *
 * Restore with scripts/restore.mjs.
 */
import Database from 'better-sqlite3';
import { createBackup } from '../src/lib/server/backup.js';

const args = process.argv.slice(2);
/** @param {string} flag */
const opt = (flag) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
};

const destDir = opt('--to') ?? process.env.RELIQUARY_BACKUP_DIR;
if (!destDir) {
	console.error('where to? pass --to <folder> or set RELIQUARY_BACKUP_DIR');
	process.exit(1);
}
const keep = Number(opt('--keep') ?? process.env.RELIQUARY_BACKUP_KEEP ?? 7);
if (!Number.isInteger(keep) || keep < 1) {
	console.error('--keep must be a whole number of at least 1');
	process.exit(1);
}

let db;
try {
	db = new Database('data/reliquary.db', { readonly: true, fileMustExist: true });
} catch {
	console.error('no database at data/reliquary.db — run this from the app root');
	process.exit(1);
}

try {
	const r = await createBackup({ db, destDir, keep });
	console.log(`backup saved: ${r.file}`);
	console.log(`  ${(r.bytes / 1048576).toFixed(1)} MB, ${r.works} works, ${r.seconds}s`);
	if (r.removed.length) console.log(`  removed ${r.removed.length} older: ${r.removed.join(', ')}`);
} catch (e) {
	console.error(`backup failed: ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
} finally {
	db.close();
}
