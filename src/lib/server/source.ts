import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { detectSource, extractSourceUrl, isWebToEpubInfoPage } from './epub';

/**
 * Multi-Source Step 1 — one-shot startup backfill of `works.source`.
 *
 * Same shape as backfillIdentity / backfillSeries: reads the stored preface
 * for every work not yet classified, runs the shared `detectSource` helper,
 * and stamps the result. `source IS NULL` is the skip-marker, so a clean
 * second boot scans 0 rows. Per-work failures are logged and skipped so one
 * bad row can't abort the pass. Called once per boot from getDb() after the
 * other backfills; guarded there so it never blocks boot.
 */
export function backfillSource(db: Database): void {
	const works = db.prepare(`SELECT id FROM works WHERE source IS NULL`).all() as { id: string }[];

	if (works.length === 0) {
		console.log('[source-backfill] 0 works');
		return;
	}

	const prefaceStmt = db.prepare(
		`SELECT content_path FROM chapters WHERE work_id = ? AND kind = 'preface' LIMIT 1`
	);
	const update = db.prepare(`UPDATE works SET source = ? WHERE id = ?`);

	const counts: Record<string, number> = {};
	for (const work of works) {
		try {
			const row = prefaceStmt.get(work.id) as { content_path: string } | undefined;
			const html = row ? readFileSync(row.content_path, 'utf8') : '';
			const source = detectSource(html);
			update.run(source, work.id);
			counts[source] = (counts[source] ?? 0) + 1;
		} catch (e) {
			console.error(`[source-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
	}

	console.log(`[source-backfill] ${works.length} works: ${JSON.stringify(counts)}`);
}

/**
 * Multi-Source Step 2 — one-shot backfill of `works.source_url` for FicHub
 * fics from the stored preface (the dedup identity key recovery). Targets only
 * `fichub-ffn` / `fichub-ao3` rows missing a URL: by Step 1's classification
 * those have a recognized, recoverable origin domain, so every targeted row
 * resolves and a clean second boot finds 0. AO3-native fics already have a
 * `source_url`; `fichub-other` / `unknown` have no recoverable URL and stay on
 * the content-hash fallback (so they're skipped). Reuses the shared preface
 * helper; same guarded one-shot shape as backfillSource. Runs after
 * backfillSource (which sets `source` earlier the same boot).
 */
export function backfillSourceUrl(db: Database): void {
	const works = db
		.prepare(
			`SELECT id FROM works WHERE source_url IS NULL AND source IN ('fichub-ffn', 'fichub-ao3')`
		)
		.all() as { id: string }[];

	if (works.length === 0) {
		console.log('[source-url-backfill] 0 works');
		return;
	}

	const prefaceStmt = db.prepare(
		`SELECT content_path FROM chapters WHERE work_id = ? AND kind = 'preface' LIMIT 1`
	);
	const update = db.prepare(`UPDATE works SET source_url = ? WHERE id = ?`);

	let recovered = 0;
	let none = 0;
	for (const work of works) {
		try {
			const row = prefaceStmt.get(work.id) as { content_path: string } | undefined;
			const html = row ? readFileSync(row.content_path, 'utf8') : '';
			const url = extractSourceUrl(html);
			if (url) {
				update.run(url, work.id);
				recovered += 1;
			} else {
				none += 1;
			}
		} catch (e) {
			console.error(`[source-url-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
	}

	console.log(
		`[source-url-backfill] ${recovered} recovered` + (none > 0 ? `, ${none} no URL` : '')
	);
}

/**
 * Webnovel links (2026-11-27) — one-shot backfill for Webnovel books imported
 * before ingest understood WebToEpub's layout. Those were stored as source
 * `unknown` with no `source_url`, and the position fallback filed WebToEpub's
 * "Information" page as chapter 1 — so that's where the book URL sits. Stamps
 * `source = 'webnovel'` + the canonical book URL so a later WebToEpub download
 * of the same book matches by URL and updates in place (re-uploading the
 * same file re-files the Information page as the preface). Writes only those
 * two columns — invisible to Continue Reading. Trashed rows are left alone
 * (a trashed copy must not claim the link). Rows it can't place stay
 * `unknown`; a clean second boot scans only the leftover `unknown` rows.
 */
export function backfillWebnovelSourceUrl(db: Database): void {
	const works = db
		.prepare(
			`SELECT id FROM works WHERE source = 'unknown' AND source_url IS NULL AND trashed_at IS NULL`
		)
		.all() as { id: string }[];
	if (works.length === 0) {
		console.log('[webnovel-backfill] 0 works');
		return;
	}
	const pagesStmt = db.prepare(
		`SELECT content_path FROM chapters
		  WHERE work_id = ? AND (kind = 'preface' OR (kind = 'chapter' AND number = 1))
		  ORDER BY number DESC`
	);
	const update = db.prepare(`UPDATE works SET source = 'webnovel', source_url = ? WHERE id = ?`);
	let linked = 0;
	for (const work of works) {
		try {
			const pages = pagesStmt.all(work.id) as { content_path: string }[];
			for (const { content_path } of pages) {
				const html = readFileSync(content_path, 'utf8');
				if (!isWebToEpubInfoPage(html) || detectSource(html) !== 'webnovel') continue;
				const url = extractSourceUrl(html);
				if (url) {
					update.run(url, work.id);
					linked += 1;
				}
				break;
			}
		} catch (e) {
			console.error(`[webnovel-backfill] skip ${work.id}:`, e instanceof Error ? e.message : e);
		}
	}
	console.log(`[webnovel-backfill] ${linked} of ${works.length} unknown works linked`);
}
