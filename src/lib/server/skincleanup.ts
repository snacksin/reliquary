import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { stripCalibreBoilerplate } from './skin';

/**
 * One-shot (idempotent) boot backfill: strip Calibre boilerplate from the
 * skins WS Part 2 auto-extracted before the filter existed (2026-09-15).
 * Companion to `stripCalibreBoilerplate` at ingest (ingest.ts), same idiom
 * as backfillDecodeText: no skip-marker column, because a second boot
 * finds no `.calibre` rules and rewrites 0 files.
 *
 * Scope: `skin_source = 'epub'` only. Pasted ('manual') skins are the
 * user's and come from AO3 pages, which never carry Calibre rules.
 *
 * Per work: read skin.css, filter; unchanged → skip; filtered to nothing →
 * delete the file and null BOTH columns (the work is back to skin-less and
 * extractable); filtered but non-empty → rewrite the file in place.
 * Per-work failures are logged and skipped. Guarded by the caller.
 *
 * CR-invisible: touches works.skin_path / skin_source and files only —
 * nothing the Continue Reading projection derives from.
 */
export function backfillStripCalibreSkins(db: Database): void {
	const rows = db
		.prepare(`SELECT id, skin_path FROM works WHERE skin_source = 'epub' AND skin_path IS NOT NULL`)
		.all() as { id: string; skin_path: string }[];

	const clear = db.prepare(`UPDATE works SET skin_path = NULL, skin_source = NULL WHERE id = ?`);
	let cleared = 0;
	let trimmed = 0;
	for (const r of rows) {
		try {
			let css: string;
			try {
				css = readFileSync(r.skin_path, 'utf8');
			} catch {
				// File already gone: the row is stale either way.
				clear.run(r.id);
				cleared += 1;
				continue;
			}
			const kept = stripCalibreBoilerplate(css);
			if (kept === css) continue;
			if (kept === null) {
				try {
					unlinkSync(r.skin_path);
				} catch {
					/* already gone — fine */
				}
				clear.run(r.id);
				cleared += 1;
			} else {
				writeFileSync(r.skin_path, kept, 'utf8');
				trimmed += 1;
			}
		} catch (e) {
			console.error(`[skin-cleanup] skip ${r.id}:`, e instanceof Error ? e.message : e);
		}
	}
	if (cleared > 0 || trimmed > 0) {
		console.log(`[skin-cleanup] ${cleared} boilerplate skins removed, ${trimmed} trimmed`);
	}
}
