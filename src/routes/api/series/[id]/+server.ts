import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

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
	last_chapter: number | null;
	last_scroll_y: number | null;
	last_updated_at: string | null;
};

export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const id = Number.parseInt(params.id, 10);
	if (!Number.isInteger(id)) throw error(404, 'series not found');

	const series = db
		.prepare('SELECT id, name, ao3_series_url FROM series WHERE id = ?')
		.get(id) as { id: number; name: string; ao3_series_url: string | null } | undefined;
	if (!series) throw error(404, 'series not found');

	const rows = db
		.prepare(
			`SELECT w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
			        w.favorited_at,
			        rp.last_chapter, rp.last_scroll_y, rp.updated_at AS last_updated_at
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
		last_read:
			r.last_chapter !== null && r.last_scroll_y !== null && r.last_updated_at !== null
				? { chapter: r.last_chapter, scroll_y: r.last_scroll_y, updated_at: r.last_updated_at }
				: null
	}));

	return json({ id: series.id, name: series.name, ao3_series_url: series.ao3_series_url, works });
};
