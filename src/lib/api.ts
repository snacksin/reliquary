export type LastRead = {
	chapter: number;
	scroll_y: number;
	/**
	 * ISO 8601 timestamp of the last write to `reading_progress.updated_at`
	 * for this work — used by the library to sort the Continue Reading
	 * carousel by reading recency, not by upload order.
	 */
	updated_at: string;
};

export type Work = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	last_read: LastRead | null;
	is_favorite: boolean;
	/**
	 * ISO 8601 timestamp set by POST /api/works/[id]/favorite. Used
	 * client-side to sort the Favorites carousel most-recent-first.
	 * Null when `is_favorite` is false.
	 */
	favorited_at: string | null;
	/**
	 * Chapter History (Part 2): true when ≥1 chapter of this work has an
	 * archived prior version. Only present on the work-detail response;
	 * drives the detail page's 📜 History button visibility.
	 */
	has_history?: boolean;
	/**
	 * Soft-trash (M2.3): non-null = in Trash (the timestamp it was
	 * trashed). Only present on the work-detail response; drives the
	 * detail page's trashed banner. Trashed works are excluded from all
	 * listing endpoints, so it's effectively always null elsewhere.
	 */
	trashed_at?: string | null;
};

type Fetch = typeof fetch;

/**
 * Paginated response shape from `GET /api/works` when the
 * `paginate=false` flag is absent (the default).
 */
export type WorksPage = {
	works: Work[];
	page: number;
	per_page: number;
	total: number;
	total_pages: number;
};

type ListOpts = {
	tags?: number[];
	matchAll?: string[];
	page?: number;
	perPage?: number;
	q?: string;
};

function buildListParams(opts: ListOpts | undefined): URLSearchParams {
	const search = new URLSearchParams();
	if (opts?.tags && opts.tags.length > 0) search.set('tags', opts.tags.join(','));
	if (opts?.matchAll && opts.matchAll.length > 0) {
		search.set('match_all', opts.matchAll.join(','));
	}
	if (opts?.page && opts.page > 1) search.set('page', String(opts.page));
	if (opts?.perPage) search.set('per_page', String(opts.perPage));
	// `q` is forwarded raw — the server sanitizes for FTS5. Empty
	// string means "no search filter" (same as omitting the param).
	if (opts?.q && opts.q.trim()) search.set('q', opts.q);
	return search;
}

/**
 * Fetch the library as a paginated page. See `/api/works` for the full
 * filter + pagination semantics.
 *
 * - `tags` / `matchAll`: filter narrowing per Step 5 / 5.5.
 * - `q`: full-text search across title/author/summary. Server
 *   sanitizes the input for FTS5 (strips reserved characters,
 *   prefix-matches each token). ANDs with the tag filter.
 * - `page` (default 1) and `perPage` (default 12) drive the slice.
 *   Server clamps `page` to the actual range, so a stale URL after a
 *   delete falls back to the last page instead of 404'ing.
 */
export async function listWorks(fetch: Fetch, opts?: ListOpts): Promise<WorksPage> {
	const search = buildListParams(opts);
	const query = search.toString();
	const res = await fetch(`/api/works${query ? '?' + query : ''}`);
	if (!res.ok) throw new Error(`GET /api/works failed: ${res.status}`);
	return res.json();
}

/**
 * Fetch the full library as a flat array (no pagination). Used by the
 * library page's Continue Reading + Favorites sections, which derive
 * their subsets from the full set client-side and can't be sliced to
 * a single page. Pass `tags` / `matchAll` to filter at the source if
 * needed — but the library page deliberately fetches this unfiltered
 * so CR + Favs surface in-progress / favorited fics regardless of
 * the current tag filter.
 */
export async function listAllWorks(fetch: Fetch, opts?: ListOpts): Promise<Work[]> {
	const search = buildListParams(opts);
	search.set('paginate', 'false');
	const res = await fetch(`/api/works?${search.toString()}`);
	if (!res.ok) throw new Error(`GET /api/works failed: ${res.status}`);
	return res.json();
}

/**
 * Outcome of a single upload after M2.3 Step 3 dedup. `created`/`updated`
 * changed the library; `duplicate`/`stale` were rejected (no new row) and
 * carry the existing work's id+title so the UI can link to it. Mirrors
 * the server's IngestResult.
 */
export type UploadOutcome =
	| { status: 'created' | 'updated'; work_id: string; title: string }
	| { status: 'duplicate'; work_id: string; title: string; restored: boolean }
	| {
			status: 'stale';
			work_id: string;
			title: string;
			existingChapters: number;
			incomingChapters: number;
			restored: boolean;
	  };

export async function uploadEpub(file: File, fetch: Fetch): Promise<UploadOutcome> {
	const fd = new FormData();
	fd.append('file', file);
	const res = await fetch('/api/upload', { method: 'POST', body: fd });
	if (!res.ok) {
		throw new Error(await extractError(res));
	}
	return res.json();
}

export type ChapterKind = 'preface' | 'summary' | 'chapter' | 'afterword';

export type WorkDetail = Work & {
	chapters: {
		number: number;
		title: string | null;
		kind: ChapterKind;
		/** Chapter History (Part 2): set when this chapter has been edited
		 *  (≥1 archived version). Drives the "author edited · date" pill. */
		last_edited_at: string | null;
	}[];
};

export async function getWork(id: string, fetch: Fetch): Promise<WorkDetail> {
	const res = await fetch(`/api/works/${id}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

// ─── Chapter History (Part 2) ───────────────────────────────────────

/** One archived prior version of a chapter (from GET /api/works/[id]/history). */
export type ChapterArchive = {
	archive_id: number;
	archived_at: string;
	word_count: number | null;
	/** +/- words vs the version that replaced this one (null if unknown). */
	word_delta: number | null;
	hash_short: string;
};

/** Archived versions of one chapter, newest-first. */
export type ChapterHistoryGroup = {
	number: number;
	title: string | null;
	archives: ChapterArchive[];
};

export type WorkHistory = { groups: ChapterHistoryGroup[] };

export async function getWorkHistory(id: string, fetch: Fetch): Promise<WorkHistory> {
	const res = await fetch(`/api/works/${id}/history`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

export async function getArchivedHtml(
	id: string,
	archiveId: number | string,
	fetch: Fetch
): Promise<string> {
	const res = await fetch(`/api/works/${id}/history/${archiveId}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function getChapterHtml(
	workId: string,
	n: number | string,
	fetch: Fetch
): Promise<string> {
	const res = await fetch(`/api/works/${workId}/ch/${n}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function getPrefaceHtml(workId: string, fetch: Fetch): Promise<string> {
	const res = await fetch(`/api/works/${workId}/preface`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function getAfterwordHtml(workId: string, fetch: Fetch): Promise<string> {
	const res = await fetch(`/api/works/${workId}/afterword`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function saveProgress(
	workId: string,
	chapter: number,
	scroll_y: number,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chapter, scroll_y: Math.round(scroll_y) })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function removeProgress(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function setFavorite(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/favorite`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function unsetFavorite(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/favorite`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/**
 * Soft-trash (M2.3 Step 4). `trashWork` hides a work from every
 * discovery surface; `restoreWork` brings it back non-destructively.
 * The `/trash` view is Step 5, so restore is currently only reachable
 * programmatically.
 */
export async function trashWork(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/trash`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function restoreWork(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/trash`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/** One trashed work, as listed by `GET /api/trash` (M2.3 Step 5). */
export type TrashedWork = {
	id: string;
	title: string;
	author: string;
	trashed_at: string;
};

export async function getTrash(fetch: Fetch): Promise<TrashedWork[]> {
	const res = await fetch('/api/trash');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * Permanent delete of a single work (M2.3 Step 5). Irreversible — the
 * server only allows it on works already in Trash (409 otherwise).
 */
export async function purgeWork(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/** Empty Trash — permanently delete every trashed work. Returns the count. */
export async function emptyTrash(fetch: Fetch): Promise<{ purged: number }> {
	const res = await fetch('/api/trash', { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * Whole days remaining before a trashed work is purged. Mirrors the
 * server's `PURGE_AFTER_DAYS` (30, in src/lib/server/purge.ts) — kept as
 * a literal here so this client util doesn't import the server module.
 * Clamped at 0 (an over-30-day work is due for purge on next boot).
 */
export function daysUntilPurge(trashedAtIso: string): number {
	const PURGE_AFTER_DAYS = 30;
	const trashedAt = new Date(
		trashedAtIso.includes('T') ? trashedAtIso : trashedAtIso.replace(' ', 'T') + 'Z'
	).getTime();
	if (Number.isNaN(trashedAt)) return PURGE_AFTER_DAYS;
	const daysSince = (Date.now() - trashedAt) / 86_400_000;
	return Math.max(0, Math.ceil(PURGE_AFTER_DAYS - daysSince));
}

/**
 * Client-side mirror of the server's `TagCategory` (kept duplicated
 * because anything under `$lib/server/` is server-only). The seven AO3
 * categories Step 2's parser populates. `personal` is deliberately
 * absent — see HANDOFF.md §9 for the structural-exclusion rationale.
 */
export type TagCategory =
	| 'rating'
	| 'warning'
	| 'category'
	| 'fandom'
	| 'relationship'
	| 'character'
	| 'freeform';

export type Tag = {
	id: number;
	name: string;
	count: number;
	/**
	 * Only present when `getTags({ includeHidden: true })` — the
	 * default sidebar feed (without `include_hidden=true`) already
	 * filters hidden tags out, so the flag isn't carried. Effective
	 * state: the tag's own `tags.hide_from_sidebar` flag (M2.1.6) OR
	 * the per-edge show-wins rule (M2.1.5). For root tags (no parent
	 * edges) it equals the own flag exactly.
	 */
	hidden_from_sidebar?: boolean;
	/**
	 * SQLite DATETIME string (`YYYY-MM-DD HH:MM:SS`, UTC). Only present
	 * when `getTags({ includeHidden: true })` — carried for the /tags
	 * management page's "Recently added" sort (M2.1.6); the sidebar
	 * feed doesn't need it.
	 */
	created_at?: string;
};

/**
 * Shape of `GET /api/tags`. All seven keys are always present, even if
 * a given category has zero tags in the DB — the filter sidebar (Step 5)
 * renders all seven sections without conditional checks.
 */
export type TagGroups = Record<TagCategory, Tag[]>;

export async function getTags(
	fetch: Fetch,
	opts?: { includeHidden?: boolean }
): Promise<TagGroups> {
	const url = opts?.includeHidden ? '/api/tags?include_hidden=true' : '/api/tags';
	const res = await fetch(url);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * Per-edge alias info, returned by `GET /api/tags/<parent_id>/aliases`
 * alongside the parent metadata.
 */
export type TagAlias = {
	id: number;
	name: string;
	category: TagCategory;
	hide_from_sidebar: number;
};

export type TagAliasList = {
	parent: { id: number; category: TagCategory; name: string };
	aliases: TagAlias[];
};

export async function getTagAliases(parentId: number, fetch: Fetch): Promise<TagAliasList> {
	const res = await fetch(`/api/tags/${parentId}/aliases`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * One flat list of every alias edge in the DB. Used by the /tags page
 * to render the whole tree in one fetch instead of one round trip per
 * tag.
 */
export type TagAliasEdge = {
	parent_tag_id: number;
	alias_tag_id: number;
	hide_from_sidebar: number;
};

export async function getAllTagAliasEdges(fetch: Fetch): Promise<TagAliasEdge[]> {
	const res = await fetch('/api/tag-aliases');
	if (!res.ok) throw new Error(await extractError(res));
	const body = (await res.json()) as { edges: TagAliasEdge[] };
	return body.edges;
}

export async function addTagAlias(
	parentId: number,
	aliasId: number,
	hideFromSidebar: boolean,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/tags/${parentId}/aliases`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ alias_tag_id: aliasId, hide_from_sidebar: hideFromSidebar })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

/**
 * Per-TAG sidebar hide (M2.1.6) — flips `tags.hide_from_sidebar` for
 * one tag. Independent of the per-edge alias flag below: this affects
 * only the tag's own row in the FilterSidebar feed; children remain
 * governed by show-wins through their parent edges.
 */
export async function setTagHidden(tagId: number, hide: boolean, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/tags/${tagId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ hide_from_sidebar: hide })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function setTagAliasHidden(
	parentId: number,
	aliasId: number,
	hide: boolean,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/tags/${parentId}/aliases/${aliasId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ hide_from_sidebar: hide })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function removeTagAlias(
	parentId: number,
	aliasId: number,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/tags/${parentId}/aliases/${aliasId}`, { method: 'DELETE' });
	if (!res.ok && res.status !== 204) throw new Error(await extractError(res));
}

async function extractError(res: Response): Promise<string> {
	const body = await res.text();
	try {
		const parsed = JSON.parse(body) as { message?: unknown };
		if (typeof parsed.message === 'string') return parsed.message;
	} catch {
		// not JSON — fall through
	}
	return body || `request failed: ${res.status}`;
}
