import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

function seriesExists(db: ReturnType<typeof getDb>, id: number): boolean {
	return db.prepare('SELECT 1 FROM series WHERE id = ?').get(id) !== undefined;
}

/**
 * `GET /api/series/[id]` — a series plus the parts you own, in reading order
 * (Series Pages Part 1). Trashed works are excluded from the parts list. The
 * work rows match the public `Work` shape so the page can render them with the
 * shared <WorkRow>. 404 if the series id doesn't exist.
 */
type WorkRow = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	favorited_at: string | null;
	chapters_updated_at: string | null;
	position: number | null;
	last_chapter: number | null;
	last_scroll_y: number | null;
	last_max_read_chapter: number | null;
	last_dismissed_at: string | null;
	last_updated_at: string | null;
};

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw error(404, 'series not found');

	const series = db
		.prepare('SELECT id, name, ao3_series_url, favorited_at FROM series WHERE id = ?')
		.get(id) as
		| { id: number; name: string; ao3_series_url: string | null; favorited_at: string | null }
		| undefined;
	if (!series) throw error(404, 'series not found');

	const rows = db
		.prepare(
			`SELECT w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
			        w.favorited_at, w.chapters_updated_at, sw.position,
			        rp.last_chapter, rp.last_scroll_y,
			        rp.max_read_chapter AS last_max_read_chapter,
			        rp.dismissed_at AS last_dismissed_at,
			        rp.updated_at AS last_updated_at
			   FROM series_works sw
			   JOIN works w ON w.id = sw.work_id
			   LEFT JOIN reading_progress rp ON rp.work_id = w.id
			  WHERE sw.series_id = ? AND w.trashed_at IS NULL
			  ORDER BY (sw.position IS NULL), sw.position ASC, w.title COLLATE NOCASE ASC`
		)
		.all(id) as WorkRow[];

	const works = rows.map((r) => ({
		id: r.id,
		title: r.title,
		author: r.author,
		summary: r.summary,
		chapter_count: r.chapter_count,
		word_count: r.word_count,
		is_favorite: r.favorited_at !== null,
		favorited_at: r.favorited_at,
		chapters_updated_at: r.chapters_updated_at,
		// "Part N" in the series — the stored AO3 position (can be sparse:
		// Part 3, Part 7), null for name-only series. Surfaced for the
		// series-detail page's per-part label.
		position: r.position,
		last_read:
			r.last_chapter !== null && r.last_scroll_y !== null && r.last_updated_at !== null
				? {
						chapter: r.last_chapter,
						scroll_y: r.last_scroll_y,
						max_read_chapter: r.last_max_read_chapter,
						dismissed_at: r.last_dismissed_at,
						updated_at: r.last_updated_at
					}
				: null
	}));

	return json({
		id: series.id,
		name: series.name,
		ao3_series_url: series.ao3_series_url,
		is_favorite: series.favorited_at !== null,
		favorited_at: series.favorited_at,
		works
	});
};

/**
 * `PATCH /api/series/[id]` — set the index hide flag (Series Pages Part 2).
 * Body: { hidden_from_index: boolean }. 204. Index-only: this never affects
 * whether the series' member works show in the library.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id) || !seriesExists(db, id)) throw error(404, 'series not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const hidden = (body as { hidden_from_index?: unknown })?.hidden_from_index;
	if (typeof hidden !== 'boolean') throw error(400, 'hidden_from_index must be a boolean');

	db.prepare('UPDATE series SET hidden_from_index = ? WHERE id = ?').run(hidden ? 1 : 0, id);
	return new Response(null, { status: 204 });
};
