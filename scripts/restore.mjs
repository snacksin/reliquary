#!/usr/bin/env node
/**
 * Unpack a library backup into a NEW folder and check it (Pi plan
 * step 1). It never touches the live library: the target must not exist
 * or must be empty. Swapping it in is a separate, deliberate step (the
 * instructions are printed at the end).
 *
 * Usage (from the app root):
 *   node scripts/restore.mjs <reliquary-….tar.gz> --to <new folder>
 *
 * Checks: the archive holds only reliquary.db, manifest.json and works/
 * (no absolute or ../ paths); the DB passes SQLite's integrity_check;
 * its works count matches the manifest; every work has its files folder;
 * the backup's newest migration isn't newer than this code knows (older
 * is fine: the app migrates forward on boot).
 */
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--to');
const toIdx = args.indexOf('--to');
const target = toIdx >= 0 ? args[toIdx + 1] : undefined;

/** @param {string} msg */
function die(msg) {
	console.error(`restore refused: ${msg}`);
	process.exit(1);
}

if (!file || !target) die('usage: node scripts/restore.mjs <backup.tar.gz> --to <new folder>');
const archive = resolve(file);
const dest = resolve(target);
if (!existsSync(archive) || !statSync(archive).isFile()) die(`no backup file at ${archive}`);
if (existsSync(dest) && readdirSync(dest).length > 0) {
	die(`${dest} already has files in it — restore only ever goes into a new or empty folder`);
}

// 1. Look before unpacking.
const list = spawnSync('tar', ['-tzf', archive], {
	encoding: 'utf8',
	maxBuffer: 256 * 1024 * 1024
});
if (list.status !== 0) die(`can't read the archive: ${(list.stderr || '').trim()}`);
const entries = list.stdout.split('\n').filter(Boolean);
const bad = entries.filter(
	(e) =>
		e.startsWith('/') ||
		e.split('/').includes('..') ||
		!(e === 'reliquary.db' || e === 'manifest.json' || e === 'works' || e.startsWith('works/'))
);
if (bad.length) die(`unexpected paths in the archive, e.g. ${bad.slice(0, 3).join(', ')}`);
for (const need of ['reliquary.db', 'manifest.json']) {
	if (!entries.includes(need)) die(`the archive has no ${need}`);
}

// 2. Unpack.
mkdirSync(dest, { recursive: true });
const x = spawnSync('tar', ['-xzf', archive, '-C', dest], { encoding: 'utf8' });
if (x.status !== 0) die(`unpacking failed: ${(x.stderr || '').trim()}`);

// 3. Check what came out.
const manifest = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8'));
const db = new Database(join(dest, 'reliquary.db'), { readonly: true, fileMustExist: true });
const integrity = db.pragma('integrity_check', { simple: true });
const works = /** @type {{ id: string }[]} */ (db.prepare('SELECT id FROM works').all());
const migration = /** @type {{ v: number | null }} */ (
	db.prepare('SELECT max(version) AS v FROM schema_migrations').get()
).v;
db.close();
const missingDirs = works.filter((w) => !existsSync(join(dest, 'works', w.id))).length;

let codeMigration = null;
try {
	codeMigration = Math.max(
		...readdirSync('migrations')
			.map((f) => /^(\d+)/.exec(f)?.[1])
			.filter(Boolean)
			.map(Number)
	);
} catch {
	// not run from the app root; skip the comparison
}

const problems = [];
if (integrity !== 'ok') problems.push(`database integrity_check: ${integrity}`);
if (works.length !== manifest.works)
	problems.push(`manifest says ${manifest.works} works, database has ${works.length}`);
if (missingDirs > 0) problems.push(`${missingDirs} works have no files folder`);

console.log(`restored ${archive}`);
console.log(`  into   ${dest}`);
console.log(
	`  made   ${manifest.created_at}  (app ${manifest.app_version ?? '?'}, ${manifest.node ?? '?'})`
);
console.log(
	`  works  ${works.length}, newest migration ${migration}${codeMigration !== null ? ` (this code knows up to ${codeMigration})` : ''}`
);
if (codeMigration !== null && migration !== null && migration > codeMigration) {
	problems.push(
		`backup is from NEWER code (migration ${migration} > ${codeMigration}) — update the code before using it`
	);
}

if (problems.length) {
	console.error('\nPROBLEMS:');
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}

console.log('\nAll checks passed. To use it as the live library:');
console.log('  1. stop the server');
console.log('  2. move the current data/ aside (e.g. mv data data.bak-before-restore)');
console.log(`  3. mv "${dest}" data`);
console.log('  4. start the server (it migrates forward if the backup is older)');
