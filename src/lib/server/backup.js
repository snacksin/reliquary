// Library backups (Pi plan step 1, DESIGN §6.16). Plain JS + JSDoc on
// purpose: the server (nightly.ts) and the standalone scripts
// (scripts/backup-now.mjs) share this one implementation, and the .mjs
// scripts can't import TypeScript. tsconfig's checkJs type-checks it.
//
// One backup = one `reliquary-YYYY-MM-DD-HHMMSS.tar.gz` holding:
//   reliquary.db   a consistent snapshot (SQLite online backup — safe
//                  while the app is writing)
//   manifest.json  what's inside, for restore.mjs to check
//   works/         every fic's files (chapter HTML, images, skins,
//                  _history archives) — data/works as-is
//
// Ordering: the DB is snapshotted BEFORE the files are read, so the worst
// a concurrent upload can do is leave an extra works/<id>/ with no DB row
// (harmless bytes), never a DB row pointing at files the backup lacks —
// the same reasoning as purgeWork's delete order.
//
// Fail-soft (HANDOFF §4.1): every failure becomes a rejected promise the
// caller logs; nothing here can stop the library serving. The running
// `tar` is killed on SIGTERM/SIGINT so a backup never holds up shutdown;
// its `.partial` leftover is swept by a later run.
//
// The destination folder must already exist. It is NEVER created here:
// on the Pi it's a NAS mount point, and mkdir-ing it while the NAS is
// down would quietly fill the Pi's own disk with backups instead.

import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const BACKUP_NAME = /^reliquary-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;
const PARTIAL_NAME = /^reliquary-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz\.partial$/;
/** A `.partial` this old can't belong to a backup still being written. */
const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000;

/** @param {Date} d */
function stamp(d) {
	/** @param {number} n */
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Run a command, resolving on exit 0. The child is killed if the process
 * is told to stop, so shutdown never waits on a backup.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function run(cmd, args) {
	return new Promise((resolvePromise, reject) => {
		// COPYFILE_DISABLE stops macOS bsdtar adding `._` resource-fork
		// entries; GNU tar on the Pi ignores it.
		const child = spawn(cmd, args, {
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { ...process.env, COPYFILE_DISABLE: '1' }
		});
		let stderr = '';
		child.stderr.on('data', (chunk) => {
			if (stderr.length < 2000) stderr += chunk;
		});
		const stop = () => child.kill('SIGTERM');
		process.once('SIGTERM', stop);
		process.once('SIGINT', stop);
		const done = () => {
			process.removeListener('SIGTERM', stop);
			process.removeListener('SIGINT', stop);
		};
		child.on('error', (e) => {
			done();
			reject(e);
		});
		child.on('close', (code, signal) => {
			done();
			if (code === 0) resolvePromise();
			else
				reject(
					new Error(
						`${cmd} ${signal ? `killed (${signal})` : `exited ${code}`}${stderr ? `: ${stderr.trim()}` : ''}`
					)
				);
		});
	});
}

/**
 * The newest `reliquary-*.tar.gz` names in `dir`, newest first.
 * @param {string} dir
 * @returns {string[]}
 */
export function listBackups(dir) {
	return readdirSync(dir)
		.filter((f) => BACKUP_NAME.test(f))
		.sort()
		.reverse();
}

/**
 * Make one backup of the library into `destDir`, then keep only the
 * newest `keep`. Resolves with what was written; rejects with a
 * human-readable reason.
 *
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   destDir: string,
 *   keep?: number,
 *   worksDir?: string,
 *   now?: Date
 * }} opts
 * @returns {Promise<{ file: string, bytes: number, seconds: number, works: number, removed: string[] }>}
 */
export async function createBackup({
	db,
	destDir,
	keep = 7,
	worksDir = 'data/works',
	now = new Date()
}) {
	const started = Date.now();
	const dest = resolve(destDir);
	if (!existsSync(dest) || !statSync(dest).isDirectory()) {
		throw new Error(
			`backup folder ${dest} doesn't exist (not created on purpose — is the NAS mounted?)`
		);
	}
	const works = resolve(worksDir);
	if (!existsSync(works)) throw new Error(`no library files at ${works}`);

	// Sweep leftovers from a backup that was interrupted long ago.
	for (const f of readdirSync(dest)) {
		if (PARTIAL_NAME.test(f)) {
			const p = join(dest, f);
			try {
				if (Date.now() - statSync(p).mtimeMs > STALE_PARTIAL_MS) unlinkSync(p);
			} catch {
				// best-effort
			}
		}
	}

	const name = `reliquary-${stamp(now)}.tar.gz`;
	const finalPath = join(dest, name);
	const partialPath = `${finalPath}.partial`;
	const staging = mkdtempSync(join(tmpdir(), 'reliquary-backup-'));
	try {
		// 1. Consistent DB snapshot, then prove it opens clean.
		const snapshot = join(staging, 'reliquary.db');
		await db.backup(snapshot);
		const { default: Database } = await import('better-sqlite3');
		const snap = new Database(snapshot, { readonly: true, fileMustExist: true });
		let manifest;
		try {
			const check = snap.pragma('quick_check', { simple: true });
			if (check !== 'ok') throw new Error(`snapshot failed quick_check: ${check}`);
			const workCount = /** @type {{ n: number }} */ (
				snap.prepare('SELECT count(*) AS n FROM works').get()
			).n;
			const migration = /** @type {{ v: number | null }} */ (
				snap.prepare('SELECT max(version) AS v FROM schema_migrations').get()
			).v;
			let appVersion = null;
			try {
				appVersion =
					JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? null;
			} catch {
				// not fatal
			}
			manifest = {
				format: 1,
				created_at: now.toISOString(),
				works: workCount,
				migration,
				app_version: appVersion,
				node: process.version
			};
		} finally {
			snap.close();
		}
		writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

		// 2. Archive snapshot + manifest + every fic's files, then read it
		// back before it's allowed to look like a finished backup.
		await run('tar', [
			'-czf',
			partialPath,
			'-C',
			staging,
			'reliquary.db',
			'manifest.json',
			'-C',
			resolve(works, '..'),
			'works'
		]);
		await run('tar', ['-tzf', partialPath]);
		renameSync(partialPath, finalPath);

		// 3. Keep the newest `keep`.
		const removed = [];
		for (const old of listBackups(dest).slice(Math.max(1, keep))) {
			try {
				unlinkSync(join(dest, old));
				removed.push(old);
			} catch {
				// best-effort; next run tries again
			}
		}

		return {
			file: finalPath,
			bytes: statSync(finalPath).size,
			seconds: Math.round((Date.now() - started) / 100) / 10,
			works: manifest.works,
			removed
		};
	} catch (e) {
		try {
			rmSync(partialPath, { force: true });
		} catch {
			// a stale .partial is swept by a later run
		}
		throw e;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
