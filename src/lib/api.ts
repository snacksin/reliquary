export type LastRead = {
	chapter: number;
	scroll_y: number;
	/**
	 * Furthest real chapter read to ~95% (the reader's auto-mark high-water
	 * mark). Drives "finished" in Continue Reading: a work is finished when
	 * `max_read_chapter >= chapter_count`. Null on pre-existing rows (read as
	 * 0 — nothing confirmed read-to-end).
	 */
	max_read_chapter: number | null;
	/**
	 * Sticky Continue-Reading dismissal (the ×). Non-null = dismissed → hidden
	 * from the carousel even when new chapters arrive; cleared by reading the
	 * work again.
	 */
	dismissed_at: string | null;
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
	/**
	 * ISO 8601 timestamp of when this work last GREW its chapter count via an
	 * update-in-place re-upload. Lets the Continue Reading carousel bump a
	 * resurfaced (newly-grown) work up to its new-chapter time. Null = never
	 * grown since ingest.
	 */
	chapters_updated_at: string | null;
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
	/**
	 * Manual "read" mark (you-layer foundation): non-null = the user marked
	 * this work read at that timestamp; null/absent = unread. Set ONLY via
	 * POST/DELETE /api/works/[id]/read — fully decoupled from reading
	 * progress / Continue Reading (see migrations/0018_read_at.sql). Projected
	 * onto BOTH the library-list feed (drives the row "Read" badge + the "Hide
	 * read" filter) and the work-detail feed.
	 */
	read_at?: string | null;
	/**
	 * Personal star rating (you-layer): 1–5 when rated, null/absent = unrated.
	 * Its own dimension — decoupled from progress / Continue Reading / read /
	 * favorite. Projected onto BOTH the library-list and work-detail feeds
	 * (drives the library-row star display + the detail star control). Set
	 * only via POST/DELETE /api/works/[id]/rating.
	 */
	rating?: number | null;
	/**
	 * Per-work markdown note (you-layer): the raw markdown body, or null/absent
	 * when there's no note. Projected onto BOTH the library-list feed (drives a
	 * plain-text row snippet — Follow-up B) and the work-detail feed (rendered +
	 * sanitized full markdown). Set only via PUT /api/works/[id]/note.
	 */
	note?: string | null;
	/**
	 * Personal tags (you-layer Private tags): the user's own tags on this work,
	 * name-sorted. A SEPARATE vocabulary from the AO3 tag namespace (stored
	 * under the reserved `personal` category — never mixed into AO3 groups or
	 * counts). Projected onto the library-list + work-detail feeds (drives the
	 * row chips + seeds the detail editor); absent on leaner feeds (series).
	 * Managed only via /api/works/[id]/tags.
	 */
	personal_tags?: PersonalTag[];
	/**
	 * Author Identity Part A: the byline authors parsed from the AO3
	 * preface/summary author LINKS, in byline order (index 0 = primary).
	 * Empty/absent for non-AO3 works, Anonymous, deleted-author bylines,
	 * and leaner feeds (series) — all of which fall back to the raw
	 * `author` string for display. Ingest-owned; never user-edited.
	 */
	authors?: WorkAuthor[];
};

/** One parsed byline author: AO3 account + pseud (null when unpseuded). */
export type WorkAuthor = { account: string; pseud: string | null };

/**
 * One byline author's AO3-style display name: "pseud (account)", or just
 * the account when unpseuded / the pseud IS the account name.
 */
export function authorName(a: WorkAuthor): string {
	return a.pseud && a.pseud !== a.account ? `${a.pseud} (${a.account})` : a.account;
}

/**
 * Byline display text (Author Identity Part B). Parsed byline authors —
 * one or many — render AO3-style, comma-joined in byline order
 * ("TheDauntless (GoddessOfWriting), MiladyMacy"), each derived from the
 * stored work_authors links, NEVER dc:creator (which recorded only the
 * first co-author for most multi-author fics). No parsed authors (non-AO3,
 * Anonymous, deleted-author) → the raw `works.author` byline exactly as
 * today. Rows use this as plain text; the detail page renders each name as
 * its own link via `authorName`.
 */
export function authorDisplay(work: Pick<Work, 'author' | 'authors'>): string {
	const list = work.authors ?? [];
	if (list.length === 0) return work.author;
	return list.map(authorName).join(', ');
}

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
	/** Author Pages: scope the listing to one author (the effective key). */
	author?: string;
	/**
	 * Author Identity Part A: with `author`, narrow to works whose primary
	 * byline pseud label matches (the author page's pseud sub-filter).
	 */
	pseud?: string;
	/** Library sort key (you-layer Step 1b): 'added' (default) | 'rating'. */
	sort?: string;
	/** Star-rating filter: exact multi-select — keep works rated any of these (1–5). */
	stars?: number[];
	/** Favorites-only filter: keep only favorited works. */
	fav?: boolean;
	/** "Hide read" filter: exclude works manually marked read (read_at set). */
	hideRead?: boolean;
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
	if (opts?.author) search.set('author', opts.author);
	if (opts?.author && opts?.pseud) search.set('pseud', opts.pseud);
	// You-layer Step 1b: sort + rating/favorites filters. Dropped when at the
	// default/empty so a bare listing URL stays clean (server treats absent as
	// "no filter" / default sort).
	if (opts?.sort && opts.sort !== 'added') search.set('sort', opts.sort);
	if (opts?.stars && opts.stars.length > 0) search.set('stars', opts.stars.join(','));
	if (opts?.fav) search.set('fav', '1');
	if (opts?.hideRead) search.set('hide_read', '1');
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
	completed: boolean,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chapter, scroll_y: Math.round(scroll_y), completed })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function removeProgress(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/**
 * "Read again" — reset a finished work's resumable reading progress so it
 * restarts as a fresh read and re-enters Continue Reading at Chapter 1. Only
 * touches reading_progress (never the decoupled works.read_at "read" mark).
 */
export async function readAgain(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, { method: 'PUT' });
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
 * Manual "read" mark toggle — mirrors the favorite wrappers. `markRead` sets
 * works.read_at; `markUnread` clears it. The only client path that touches the
 * read mark; fully decoupled from reading progress / Continue Reading.
 */
export async function markRead(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/read`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function markUnread(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/read`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/**
 * Personal star rating — mirrors the favorite/read wrappers. `setRating`
 * upserts 1–5 stars; `clearRating` removes the rating (back to unrated). The
 * only client path that writes the rating; decoupled from progress / CR /
 * read / favorite.
 */
export async function setRating(workId: string, stars: number, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/rating`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ stars })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function clearRating(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/rating`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/**
 * Save a work's markdown note (you-layer). Explicit Save, doubling as clear: an
 * empty body removes the note server-side. The only client path that writes a
 * note; decoupled from progress / ratings / read / favorites.
 */
export async function saveNote(workId: string, body: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/note`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ body })
	});
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

/**
 * A filterable category: the seven AO3 categories plus `personal` (you-layer
 * Private tags). `match_all=` accepts all eight — the server's filter CTE is
 * category-generic — but `TagGroups`/`getTags` stay AO3-only (personal tags
 * have their own feed, `getPersonalTags`).
 */
export type FilterCategory = TagCategory | 'personal';

export async function getTags(
	fetch: Fetch,
	opts?: { includeHidden?: boolean; author?: string }
): Promise<TagGroups> {
	const params = new URLSearchParams();
	if (opts?.includeHidden) params.set('include_hidden', 'true');
	if (opts?.author) params.set('author', opts.author);
	const qs = params.toString();
	const res = await fetch(qs ? `/api/tags?${qs}` : '/api/tags');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

// ─── Author Pages (Part 1) ──────────────────────────────────────────

/** One author in the /authors index. */
export type Author = {
	name: string;
	work_count: number;
	is_favorite: boolean;
	favorited_at: string | null;
};

export async function getAuthors(
	fetch: Fetch,
	opts?: { authorTags?: number[] }
): Promise<Author[]> {
	// Author Pages Part 2: optional author-tag filter (intersection). Omitted
	// by default so Part 1 callers are unaffected.
	const params = new URLSearchParams();
	if (opts?.authorTags && opts.authorTags.length > 0) {
		params.set('author_tags', opts.authorTags.join(','));
	}
	const qs = params.toString();
	const res = await fetch(qs ? `/api/authors?${qs}` : '/api/authors');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * Manual favorite-author toggle — independent of fic favorites. The name
 * is URL-encoded for the route; the server keys on the exact string.
 */
export async function favoriteAuthor(name: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}/favorite`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function unfavoriteAuthor(name: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}/favorite`, {
		method: 'DELETE'
	});
	if (!res.ok) throw new Error(await extractError(res));
}

// ─── Author Pages (Part 2): notes + tags ────────────────────────────

/** A tag attached to an author (a row from the reusable vocabulary). */
export type AuthorTag = { id: number; name: string };

/** A vocabulary entry plus how many authors carry it (for filter chips). */
export type AuthorTagVocabItem = { id: number; name: string; author_count: number };

/** One "pseud seen so far" on an account, with its live-work count. */
export type AuthorPseud = { pseud: string; count: number };

/**
 * The author's saved note plus the account's pseud list (Author Identity
 * Part A) — one fetch for the author page's left column + pseud sub-filter.
 * `pseuds` is empty for authors with no parsed byline rows (non-AO3,
 * Anonymous).
 */
export async function getAuthorDetail(
	name: string,
	fetch: Fetch
): Promise<{ notes: string | null; pseuds: AuthorPseud[] }> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}`);
	if (!res.ok) throw new Error(await extractError(res));
	const body = (await res.json()) as { notes: string | null; pseuds: AuthorPseud[] };
	return { notes: body.notes, pseuds: body.pseuds ?? [] };
}

/** Save (or clear, with an empty string) the author's note. */
export async function saveAuthorNote(name: string, notes: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ notes })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

/** This author's attached tags. */
export async function getAuthorTags(name: string, fetch: Fetch): Promise<AuthorTag[]> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}/tags`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Attach a tag by name (find-or-creates in the vocabulary). Returns it. */
export async function addAuthorTag(name: string, tag: string, fetch: Fetch): Promise<AuthorTag> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}/tags`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: tag })
	});
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Detach a tag from this author (leaves it in the vocabulary). */
export async function removeAuthorTag(name: string, tagId: number, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/authors/${encodeURIComponent(name)}/tags`, {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: tagId })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

/** The full reusable author-tag vocabulary (autocomplete + filter options). */
export async function getAuthorTagVocab(fetch: Fetch): Promise<AuthorTagVocabItem[]> {
	const res = await fetch('/api/author-tags');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

// ─── Personal tags (you-layer Private tags) ─────────────────────────

/** A personal tag attached to a work (a row from the reusable vocabulary). */
export type PersonalTag = { id: number; name: string };

/** A vocabulary entry plus how many live works carry it (sidebar + combobox). */
export type PersonalTagVocabItem = { id: number; name: string; count: number };

/**
 * The full personal-tag vocabulary with live-work counts, sorted count DESC
 * then name ASC (the sidebar's display order; the combobox re-sorts by name).
 */
export async function getPersonalTags(fetch: Fetch): Promise<PersonalTagVocabItem[]> {
	const res = await fetch('/api/personal-tags');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Attach a personal tag by name (find-or-creates in the vocabulary). Returns it. */
export async function addWorkPersonalTag(
	workId: string,
	tag: string,
	fetch: Fetch
): Promise<PersonalTag> {
	const res = await fetch(`/api/works/${workId}/tags`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: tag })
	});
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Detach a personal tag from this work (leaves it in the vocabulary). */
export async function removeWorkPersonalTag(
	workId: string,
	tagId: number,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${workId}/tags`, {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: tagId })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

// ─── Series Pages (Part 1) ──────────────────────────────────────────

/** A work as a member of a series — a `Work` plus its "Part N" position. */
export type SeriesWork = Work & {
	/** Stored series position ("Part N"); sparse (Part 3, Part 7) or null. */
	position: number | null;
};

/** A series detail: its name + the parts you own, in reading order. */
export type Series = {
	id: number;
	name: string;
	ao3_series_url: string | null;
	is_favorite: boolean;
	favorited_at: string | null;
	works: SeriesWork[];
};

/** One series in the /series index (Part 2). */
export type SeriesSummary = {
	id: number;
	name: string;
	ao3_series_url: string | null;
	part_count: number;
	is_favorite: boolean;
	favorited_at: string | null;
	hidden_from_index: boolean;
};

/**
 * One series a work belongs to (preface "Part N of …" + the detail-page
 * set-series UI). `manual` = a user-assigned link (Part 4), which the detail
 * page lets you edit/remove and which the auto-paths never clobber.
 */
export type WorkSeriesLink = {
	id: number;
	name: string;
	position: number | null;
	manual: boolean;
};

/** A series + its owned parts (the /series/[id] page). */
export async function getSeries(id: number | string, fetch: Fetch): Promise<Series> {
	const res = await fetch(`/api/series/${encodeURIComponent(String(id))}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** The series a given work belongs to (preface cross-link + fic-detail section). */
export async function getWorkSeries(workId: string, fetch: Fetch): Promise<WorkSeriesLink[]> {
	const res = await fetch(`/api/works/${encodeURIComponent(workId)}/series`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** A work's adjacent owned parts in each of its series (reader continuity). */
export type SeriesNav = {
	series_id: number;
	series_name: string;
	position: number;
	prev: { id: string; title: string } | null;
	next: { id: string; title: string } | null;
};

/** Adjacent (position ± 1) owned parts for the reader's next/prev-part buttons. */
export async function getSeriesNav(workId: string, fetch: Fetch): Promise<SeriesNav[]> {
	const res = await fetch(`/api/works/${encodeURIComponent(workId)}/series-nav`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/**
 * Manually assign a work to a series (Part 4). Pick an existing series by id
 * or create/reuse one by name; optional position. Returns the new/updated link.
 */
export async function addWorkToSeries(
	workId: string,
	opts: { seriesId?: number; name?: string; position?: number | null },
	fetch: Fetch
): Promise<WorkSeriesLink> {
	const res = await fetch(`/api/works/${encodeURIComponent(workId)}/series`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			series_id: opts.seriesId,
			name: opts.name,
			position: opts.position ?? null
		})
	});
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Change a manual series link's position. */
export async function updateWorkSeriesPosition(
	workId: string,
	seriesId: number,
	position: number | null,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${encodeURIComponent(workId)}/series/${seriesId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ position })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

/** Detach a work from a series (removes the link only). */
export async function removeWorkFromSeries(
	workId: string,
	seriesId: number,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${encodeURIComponent(workId)}/series/${seriesId}`, {
		method: 'DELETE'
	});
	if (!res.ok) throw new Error(await extractError(res));
}

/** Every series you own a part of (the /series index, Part 2). */
export async function getSeriesList(fetch: Fetch): Promise<SeriesSummary[]> {
	const res = await fetch('/api/series');
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

/** Manual favorite-series toggle — mirrors favoriteAuthor. */
export async function favoriteSeries(id: number, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/series/${id}/favorite`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function unfavoriteSeries(id: number, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/series/${id}/favorite`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

/** Hide/show a series on the /series index (Part 2). Index-only declutter. */
export async function setSeriesHidden(id: number, hidden: boolean, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/series/${id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ hidden_from_index: hidden })
	});
	if (!res.ok) throw new Error(await extractError(res));
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
