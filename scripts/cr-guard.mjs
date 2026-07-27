#!/usr/bin/env node
/**
 * CR-invisibility guard — the standing harness for backfill boots.
 *
 * Contract (see getDb() in src/lib/server/db.ts): boot-time backfills are
 * normalization/identity passes and must be INVISIBLE to Continue Reading —
 * they may never write reading_progress, works.chapters_updated_at, or
 * anything else the CR carousel's inclusion/ordering derives from. This
 * script makes that assertable: it snapshots the exact projection CR is
 * computed from, in the exact order the carousel sorts by (the later of
 * reading-recency and new-chapter time — crSortKey in src/lib/reading.ts),
 * and digests it.
 *
 * Usage:
 *   node scripts/cr-guard.mjs                  print projection + digest
 *   node scripts/cr-guard.mjs --save FILE      also write the snapshot
 *   node scripts/cr-guard.mjs --check FILE     compare against a snapshot;
 *                                              exit 1 on ANY difference
 *                                              (set OR ordering)
 *
 * Standing procedure for any PR that adds/changes a backfill: run with
 * --save before the boot, boot the server (backfills run in getDb()),
 * run with --check after. The digests must match byte-for-byte.
 *
 * (Boot-time purge of >30-day trashed works is outside the contract: it
 * removes whole works. Trashed works are already excluded from CR — and
 * from this projection — so a legitimate purge still passes the guard.)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const db = new Database('data/reliquary.db', { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

// The CR-relevant projection: every non-trashed work's reading_progress row
// plus the chapters_updated_at bump source, ordered by the carousel's own
// sort key (ISO strings compare lexicographically; id tiebreak for
// determinism).
const rows = db
	.prepare(
		`SELECT rp.work_id,
		        rp.last_chapter,
		        rp.last_scroll_y,
		        COALESCE(rp.max_read_chapter, -1) AS max_read_chapter,
		        COALESCE(rp.dismissed_at, '')     AS dismissed_at,
		        rp.updated_at,
		        COALESCE(w.chapters_updated_at, '') AS chapters_updated_at
		   FROM reading_progress rp
		   JOIN works w ON w.id = rp.work_id
		  WHERE w.trashed_at IS NULL
		  ORDER BY MAX(rp.updated_at, COALESCE(w.chapters_updated_at, '')) DESC,
		           rp.work_id ASC`
	)
	.all();

const lines = rows.map((r) =>
	[
		r.work_id,
		r.last_chapter,
		r.last_scroll_y,
		r.max_read_chapter,
		r.dismissed_at,
		r.updated_at,
		r.chapters_updated_at
	].join('|')
);
const snapshot = lines.join('\n') + '\n';
const digest = createHash('sha256').update(snapshot).digest('hex');

const mode = process.argv[2];
const file = process.argv[3];

if (mode === '--check') {
	const prev = readFileSync(file, 'utf8');
	if (prev === snapshot) {
		console.log(`cr-guard OK — ${rows.length} rows, digest ${digest.slice(0, 16)}… unchanged`);
		process.exit(0);
	}
	console.error('cr-guard FAILED — the CR projection changed across the boot:');
	const prevLines = prev.split('\n').filter(Boolean);
	const seen = new Set(prevLines);
	const now = new Set(lines);
	for (const l of prevLines) if (!now.has(l)) console.error(`  - ${l}`);
	for (const l of lines) if (!seen.has(l)) console.error(`  + ${l}`);
	if (prevLines.length === lines.length && prevLines.every((l) => now.has(l))) {
		console.error('  (same rows, different ORDER)');
	}
	process.exit(1);
}

process.stdout.write(snapshot);
console.log(`# ${rows.length} rows, sha256 ${digest}`);
if (mode === '--save') {
	writeFileSync(file, snapshot, 'utf8');
	console.log(`# snapshot saved to ${file}`);
}
