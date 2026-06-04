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

export async function uploadEpub(file: File, fetch: Fetch): Promise<{ work_id: string }> {
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
	chapters: { number: number; title: string | null; kind: ChapterKind }[];
};

export async function getWork(id: string, fetch: Fetch): Promise<WorkDetail> {
	const res = await fetch(`/api/works/${id}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
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
	 * filters hidden tags out, so the flag isn't carried.
	 */
	hidden_from_sidebar?: boolean;
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
