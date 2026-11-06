import type Database from 'better-sqlite3';
import { createBackup } from './backup.js';
import { decide, nextRun } from './nightlyclock';
import { purgeExpired } from './purge';
import { purgeExpiredSessions } from './session';

/**
 * Nightly housekeeping + backup (Pi plan step 1, 2026-11-05).
 *
 * On the Pi the server runs for months, but two jobs only ever ran at
 * boot (getDb in db.ts): the 30-day trash purge and the expired-login
 * sweep. This runs both once a night as well (boot still runs them too),
 * then a library backup when RELIQUARY_BACKUP_DIR is set.
 *
 * Settings (all optional):
 *   RELIQUARY_NIGHTLY=off       kill switch (HANDOFF §4.1: every ambient
 *                               feature ships one)
 *   RELIQUARY_NIGHTLY_AT=HH:MM  local time, default 03:30
 *   RELIQUARY_BACKUP_DIR=path   an EXISTING folder (on the Pi, the NAS
 *                               mount); unset = no backups
 *   RELIQUARY_BACKUP_KEEP=n     newest n kept, default 7
 *
 * A convenience must never stop the library serving or exiting (HANDOFF
 * §4.1): each job is caught on its own, the timer is unref'd, the
 * backup's tar is killed on SIGTERM (backup.js), and the call site in
 * hooks.server.ts wraps this in an outer try/catch like the mDNS
 * responder. CR contract: purge + sweep are the same functions boot
 * runs, already documented as outside it; the backup only reads.
 */

const DEFAULT_AT = '03:30';

function parseAt(raw: string | undefined): { h: number; m: number } {
	const match = /^(\d{1,2}):(\d{2})$/.exec((raw ?? DEFAULT_AT).trim());
	const h = match ? Number(match[1]) : NaN;
	const m = match ? Number(match[2]) : NaN;
	if (Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60) {
		return { h, m };
	}
	console.error(`[nightly] RELIQUARY_NIGHTLY_AT="${raw}" isn't HH:MM — using ${DEFAULT_AT}`);
	return { h: 3, m: 30 };
}

export function startNightly(getDb: () => Database.Database): void {
	if ((process.env.RELIQUARY_NIGHTLY ?? '').trim().toLowerCase() === 'off') {
		console.log('[nightly] disabled (RELIQUARY_NIGHTLY off)');
		return;
	}
	const at = parseAt(process.env.RELIQUARY_NIGHTLY_AT);
	const backupDir = process.env.RELIQUARY_BACKUP_DIR?.trim() || null;
	const keepRaw = Number(process.env.RELIQUARY_BACKUP_KEEP ?? 7);
	const keep = Number.isInteger(keepRaw) && keepRaw >= 1 ? keepRaw : 7;

	console.log(
		`[nightly] housekeeping daily at ${String(at.h).padStart(2, '0')}:${String(at.m).padStart(2, '0')}; ` +
			(backupDir
				? `backups to ${backupDir} (keep ${keep})`
				: 'backups off (RELIQUARY_BACKUP_DIR not set)')
	);

	// Once a minute, ask the wall clock whether it's time (nightlyclock.ts
	// says why this isn't one long setTimeout).
	const TICK_MS = 60_000;
	let due = nextRun(at);
	let running = false;

	const plan = () => {
		due = nextRun(at);
		console.log(`[nightly] next run ${due.toString()}`);
	};

	const tick = () => {
		if (running) return;
		const verdict = decide(Date.now(), due.getTime());
		if (verdict === 'wait') return;
		if (verdict === 'replan') return plan();
		if (verdict === 'skip') {
			console.log(`[nightly] missed ${due.toString()} by hours — skipping to the next one`);
			return plan();
		}
		running = true;
		void runOnce().finally(() => {
			running = false;
			plan();
		});
	};

	const runOnce = async () => {
		try {
			const db = getDb();
			try {
				purgeExpired(db);
			} catch (e) {
				console.error('[nightly] purge failed', e);
			}
			try {
				purgeExpiredSessions(db);
			} catch (e) {
				console.error('[nightly] session sweep failed', e);
			}
			if (backupDir) {
				try {
					const r = await createBackup({ db, destDir: backupDir, keep });
					console.log(
						`[backup] ok ${r.file} (${(r.bytes / 1048576).toFixed(1)} MB, ${r.works} works, ${r.seconds}s)` +
							(r.removed.length ? `; removed ${r.removed.length} older` : '')
					);
				} catch (e) {
					console.error(`[backup] failed: ${e instanceof Error ? e.message : e}`);
				}
			}
		} catch (e) {
			console.error('[nightly] run failed', e);
		}
	};

	console.log(`[nightly] next run ${due.toString()}`);
	setInterval(tick, TICK_MS).unref();
}
