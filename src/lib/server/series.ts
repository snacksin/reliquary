import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { extractSeriesEntries, type ParsedSeries } from './epub';

/**
 * Series Pages Part 1 — series extraction + backfill.
 *
 * Parallels identity.ts: parsing lives in epub.ts (`extractSeriesEntries`);
 * the DB write path + the one-shot startup backfill live here. The source
 * data is the "Series:" line in each work's stored preface.html, so existing
 * works are recovered from disk without re-downloading anything.
 */

/**
 * Resolve a parsed series to a `series.id`, creating the row if needed.
 * Identity is the normalized AO3 URL; URL-less series fall back to name
 * (case-insensitive). The partial unique index on ao3_series_url backs the
 * URL path; the name path is matched app-layer (no DB uniqueness on name).
 */
function resolveSeriesId(db: Database, entry: ParsedSeries): number {
	if (entry.url) {
		const existing = db.prepare('SELECT id FROM series WHERE ao3_series_url = ?').get(entry.url) as
			| { id: number }
			| undefined;
		if (existing) return existing.id;
		return Number(
			db.prepare('INSERT INTO series (ao3_series_url, name) VALUES (?, ?)').run(entry.url, entry.name)
				.lastInsertRowid
		);
	}
	const existing = db
		.prepare('SELECT id FROM series WHERE ao3_series_url IS NULL AND name = ? COLLATE NOCASE')
		.get(entry.name) as { id: number } | undefined;
	if (existing) return existing.id;
	return Number(
		db.prepare('INSERT INTO series (ao3_series_url, name) VALUES (NULL, ?)').run(entry.name)
			.lastInsertRowid
	);
}

/**
 * Replace one work's series links with `entries`, and stamp it scanned.
 * Shared by ingest (inside its transaction) and the backfill (per work). The
 * leading DELETE makes it a clean refresh — idempotent re-runs and partial/
 * retried backfills converge — mirroring how the ingest update path rewrites
 * `work_tags`. Runs plain statements so an enclosing transaction (ingest)
 * wraps it; the backfill calls it directly per work.
 *
 * Always stamps `series_scanned_at`, even with an empty `entries`, so a
 * no-series work won't be re-scanned on the next boot.
 */
export function syncWorkSeries(db: Database, workId: string, entries: ParsedSeries[]): void {
	db.prepare('DELETE FROM series_works WHERE work_id = ?').run(workId);
	const link = db.prepare(
		`INSERT OR IGNORE INTO series_works (series_id, work_id, position) VALUES (?, ?, ?)`
	);
	for (const entry of entries) {
		const seriesId = resolveSeriesId(db, entry);
		link.run(seriesId, workId, entry.position);
	}
	db.prepare('UPDATE works SET series_scanned_at = CURRENT_TIMESTAMP WHERE id = ?').run(workId);
}

/**
 * One-shot startup backfill (same shape as `backfillIdentity`). Re-reads the
 * stored preface for every work not yet scanned, populating series/series_works.
 * `series_scanned_at IS NULL` is the skip-marker, so a clean second boot scans
 * 0 rows. Per-work failures are logged and skipped so one bad work can't abort
 * the pass. Called once per boot from getDb() after migrations; guarded there
 * so it never blocks boot.
 */
export function backfillSeries(db: Database): void {
	const works = db
		.prepare(`SELECT id FROM works WHERE series_scanned_at IS NULL`)
		.all() as { id: string }[];

	if (works.length === 0) {
		console.log('[series-backfill] 0 works scanned');
		return;
	}

	const prefaceStmt = db.prepare(
		`SELECT content_path FROM chapters WHERE work_id = ? AND kind = 'preface' LIMIT 1`
	);

	let scanned = 0;
	let links = 0;
	for (const work of works) {
		try {
			const row = prefaceStmt.get(work.id) as { content_path: string } | undefined;
			const html = row ? readFileSync(row.content_path, 'utf8') : '';
			const entries = extractSeriesEntries(html);
			syncWorkSeries(db, work.id, entries);
			scanned += 1;
			links += entries.length;
		} catch (e) {
			console.error(`[series-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
	}

	console.log(`[series-backfill] ${scanned} works scanned, ${links} links`);
}
