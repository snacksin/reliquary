import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { detectSource } from './epub';

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
