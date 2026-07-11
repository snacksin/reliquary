import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

type Row = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	favorited_at: string | null;
	read_at: string | null;
	chapters_updated_at: string | null;
	last_chapter: number | null;
	last_scroll_y: number | null;
	last_max_read_chapter: number | null;
	last_dismissed_at: string | null;
	last_updated_at: string | null;
	rating: number | null;
	note: string | null;
	personal_tags: string;
	authors: string;
};

/**
 * Parse the `tags` query param: a comma-separated list of tag IDs.
 * Untrusted client input — coerce to positive integers and drop
 * anything that doesn't parse. Returns [] for missing/empty/all-bogus
 * inputs, which the caller treats as "no tag filter".
 */
function parseTagIds(raw: string | null): number[] {
	if (!raw) return [];
	const ids = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isFinite(n) && n > 0) ids.add(n);
	}
	return [...ids];
}

/**
 * Recognized tag categories. Mirrors the TagCategory type in
 * src/lib/server/epub.ts; kept duplicated as a `Set` lookup here so
 * the endpoint can reject unknown category names from the query
 * param without importing the server-only epub module.
 *
 * `personal` (you-layer Private tags) is a first-class filter category:
 * personal tag ids ride the same `tags=` param through the same CTE (which
 * is category-generic), and listing it here lets `match_all=personal` opt
 * the "My Tags" section into AND-within like any AO3 category.
 */
const KNOWN_CATEGORIES = new Set<string>([
	'rating',
	'warning',
	'category',
	'fandom',
	'relationship',
	'character',
	'freeform',
	'personal'
]);

/**
 * Parse the `match_all` query param: comma-separated category names
 * that should use AND-within semantics (all selected tags in that
 * category must be present) instead of the default OR-within. Drops
 * unknown names, lowercases, dedupes.
 */
function parseMatchAll(raw: string | null): string[] {
	if (!raw) return [];
	const cats = new Set<string>();
	for (const token of raw.split(',')) {
		const c = token.trim().toLowerCase();
		if (KNOWN_CATEGORIES.has(c)) cats.add(c);
	}
	return [...cats];
}

/** Allowed per-page values. Anything else clamps to the default. */
const ALLOWED_PER_PAGE = new Set([10, 12, 15]);
const DEFAULT_PER_PAGE = 12;

function parsePage(raw: string | null): number {
	if (!raw) return 1;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePerPage(raw: string | null): number {
	if (!raw) return DEFAULT_PER_PAGE;
	const n = Number.parseInt(raw, 10);
	return ALLOWED_PER_PAGE.has(n) ? n : DEFAULT_PER_PAGE;
}

/**
 * Star-rating filter (you-layer Step 1c): exact multi-select. `stars=3,5` is a
 * comma-separated list of rating values; a work matches if its rating is any
 * one of them (`rt.stars IN (…)`, OR-within — the same idiom as the tag
 * filter). Coerces to the valid 1–5 set, dedupes, drops anything else; []
 * means "no rating filter". Unrated works (no ratings row → NULL via the LEFT
 * JOIN) are never IN the list, so they're excluded whenever a value is picked.
 */
function parseStars(raw: string | null): number[] {
	if (!raw) return [];
	const set = new Set<number>();
	for (const token of raw.split(',')) {
		const n = Number.parseInt(token.trim(), 10);
		if (Number.isInteger(n) && n >= 1 && n <= 5) set.add(n);
	}
	return [...set];
}

/** Allowed library sort keys. Default `added` = today's behavior. */
const ALLOWED_SORT = new Set(['added', 'rating']);
function parseSort(raw: string | null): string {
	return raw && ALLOWED_SORT.has(raw) ? raw : 'added';
}

/**
 * ORDER BY for the paginated middle-column query. `added` (default) is the
 * historical `w.ingested_at DESC` — byte-identical when `sort` is unset.
 *
 * `rating` sorts your rating high→low, but the leading `(rt.stars IS NULL)`
 * key forces UNRATED works (NULL via the LEFT JOIN) into a bucket AFTER every
 * rated work — so unrated never masquerades as 0/best; it sinks last. A
 * stable `w.ingested_at DESC` tiebreak orders works of equal rating. No user
 * input reaches this string (sort is validated to a fixed allow-list).
 */
function buildOrderBy(sort: string): string {
	if (sort === 'rating') {
		return 'ORDER BY (rt.stars IS NULL) ASC, rt.stars DESC, w.ingested_at DESC';
	}
	return 'ORDER BY w.ingested_at DESC';
}

/**
 * Sanitize the user's `q` into a safe FTS5 MATCH expression.
 *
 * Raw input goes through the works_fts virtual table, which has the
 * `porter unicode61 remove_diacritics 2` tokenizer. FTS5 reserves a
 * handful of characters as syntax (`*`, `+`, `-`, `:`, `"`, `(`, `)`,
 * etc.), and passing user typing directly would either throw on parse
 * or silently change meaning (a stray `-` becomes NOT, a `"` opens a
 * phrase). We collapse anything that isn't a Unicode letter or digit
 * to whitespace, then prefix-match each term (`term*`) so partial
 * words match as the user is still typing.
 *
 * Multiple terms separated by whitespace are implicit AND in FTS5.
 * Returns '' when nothing usable is left — the caller treats that as
 * "no search filter".
 */
function sanitizeFtsQuery(raw: string | null): string {
	if (!raw) return '';
	const tokens = raw
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return '';
	return tokens.map((t) => `${t}*`).join(' ');
}

/** Map a DB row into the public-API work shape. */
function rowToWork(r: Row) {
	return {
		id: r.id,
		title: r.title,
		author: r.author,
		summary: r.summary,
		chapter_count: r.chapter_count,
		word_count: r.word_count,
		is_favorite: r.favorited_at !== null,
		favorited_at: r.favorited_at,
		// Manual "read" mark (you-layer, #66) — projected onto library rows so a
		// read fic shows a "Read" badge, and to keep the shape symmetric with the
		// detail feed. Independent of Continue-Reading finished state.
		read_at: r.read_at,
		// Personal star rating (you-layer): 1–5 when rated, null = unrated.
		// Drives the library-row star display; the deferred sort/filter
		// fast-follow reads the same projected value.
		rating: r.rating,
		// Per-work note (you-layer) — projected onto library rows so the row
		// can show a plain-text snippet (Follow-up B). The full markdown note
		// is rendered on the detail page.
		note: r.note,
		// Personal tags (you-layer Private tags) — name-sorted {id,name} list,
		// aggregated to JSON in SQL (ordered inner select: json_group_array
		// alone doesn't guarantee order). Drives the row's my-tag chips.
		personal_tags: JSON.parse(r.personal_tags) as { id: number; name: string }[],
		// Author Identity Part A: the parsed byline authors in byline order
		// (position 0 = primary). Empty for non-AO3 works and Anonymous — the
		// client falls back to the raw works.author byline for those (and,
		// per the Part A interim decision, for multi-author works too).
		authors: JSON.parse(r.authors) as { account: string; pseud: string | null }[],
		// When this work last GREW its chapter count (update-in-place). The
		// Continue Reading carousel sorts a resurfaced work by the later of
		// this and its reading recency, so fresh chapters bump it up.
		chapters_updated_at: r.chapters_updated_at,
		// `updated_at` ships with last_read so the Continue Reading
		// carousel can sort by reading recency (not upload order)
		// without an extra round-trip — symmetric to how Favorites
		// uses works.favorited_at. `max_read_chapter` (the ~95% read
		// high-water mark) drives "finished"; `dismissed_at` is the
		// sticky × dismiss. Both are read by the CR filter client-side.
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
	};
}

/**
 * The SELECT columns shared by all variants of the works listing —
 * keeps the page/total query symmetric so a future refactor doesn't
 * accidentally drift their projections apart.
 */
const SELECT_COLUMNS = `
  w.id, w.title, w.author, w.summary, w.chapter_count, w.word_count,
  w.favorited_at, w.read_at, w.chapters_updated_at,
  rp.last_chapter, rp.last_scroll_y,
  rp.max_read_chapter AS last_max_read_chapter,
  rp.dismissed_at AS last_dismissed_at,
  rp.updated_at AS last_updated_at,
  rt.stars AS rating,
  n.body AS note,
  (SELECT json_group_array(json_object('id', pt.id, 'name', pt.name))
     FROM (SELECT t.id, t.name
             FROM work_tags wt
             JOIN tags t ON t.id = wt.tag_id
            WHERE wt.work_id = w.id AND t.category = 'personal'
            ORDER BY t.name COLLATE NOCASE ASC) pt
  ) AS personal_tags,
  (SELECT json_group_array(json_object('account', a.account, 'pseud', a.pseud))
     FROM (SELECT wa.account, wa.pseud
             FROM work_authors wa
            WHERE wa.work_id = w.id
            ORDER BY wa.position ASC) a
  ) AS authors
`;

/**
 * SQL fragment for the tag filter, written as a `w.id IN (…)` clause
 * so it AND-composes with other clauses (e.g., the FTS search) without
 * special handling. Extends the Step 5.5 CTE pipeline (OR-within /
 * AND-within per category, AND-across categories) with M2.1.5's
 * **transitive alias expansion via WITH RECURSIVE**.
 *
 * Mental model: each user-selected tag is a "slot". Each slot expands
 * via the alias tree into a set of acceptable matches. A work satisfies
 * a slot iff it has at least one tag in that slot's expansion.
 *
 *   selected_tags     — base set of user-picked IDs, with `key` from
 *                       json_each used as the slot id (deduped at the
 *                       URL-parsing layer so slots are 1:1 with picks).
 *   filter_tags       — recursive expansion: a slot's set is the slot
 *                       itself plus every descendant via tag_aliases.
 *                       `UNION` (not `UNION ALL`) deduplicates and
 *                       short-circuits if a cycle ever slips past the
 *                       API-layer cycle check.
 *   match_all_cats    — categories where the user opted into AND-within
 *                       semantics.
 *   required_per_cat  — derived from the *original* selection (not the
 *                       expansion): "how many distinct slots in this
 *                       category must be satisfied". AND-within →
 *                       count distinct slots in that category; OR-
 *                       within → 1.
 *   work_matches      — per (work, category), how many distinct SLOTS
 *                       does the work satisfy. A work tag satisfies a
 *                       slot iff the tag's id is in that slot's
 *                       expansion. Counting slots (not raw tag ids)
 *                       is what makes "all slots filled" work correctly
 *                       under match_all: a work tagged with Batman +
 *                       Robin under user-pick {Batman, Superman}
 *                       satisfies only slot 1, not both.
 *
 * Without any aliases configured, the expansion is a no-op and the
 * slot count equals the original tag count — so this reduces exactly
 * to Step 5.5's pipeline.
 */
const TAG_FILTER_CLAUSE = `w.id IN (
  WITH RECURSIVE
    selected_tags(slot_id, tag_id) AS (
      SELECT key, value FROM json_each(?)
    ),
    filter_tags(slot_id, tag_id) AS (
      SELECT slot_id, tag_id FROM selected_tags
      UNION
      SELECT ft.slot_id, ta.alias_tag_id
      FROM tag_aliases ta
      JOIN filter_tags ft ON ta.parent_tag_id = ft.tag_id
    ),
    match_all_cats AS (SELECT value AS category FROM json_each(?)),
    required_per_cat AS (
      SELECT t.category,
        CASE WHEN t.category IN (SELECT category FROM match_all_cats)
          THEN COUNT(DISTINCT st.slot_id)
          ELSE 1
        END AS required
      FROM selected_tags st
      JOIN tags t ON t.id = st.tag_id
      GROUP BY t.category
    ),
    work_matches AS (
      SELECT wt.work_id, t.category,
             COUNT(DISTINCT ft.slot_id) AS matched
      FROM work_tags wt
      JOIN tags t ON t.id = wt.tag_id
      JOIN filter_tags ft ON ft.tag_id = wt.tag_id
      GROUP BY wt.work_id, t.category
    )
  SELECT wm.work_id
  FROM work_matches wm
  JOIN required_per_cat r ON r.category = wm.category
  WHERE wm.matched >= r.required
  GROUP BY wm.work_id
  HAVING COUNT(DISTINCT wm.category) = (SELECT COUNT(*) FROM required_per_cat)
)`;

/**
 * SQL fragment for the search filter. FTS5 MATCH against the works_fts
 * (title/author/summary) AND notes_fts (note body) virtual tables, UNION-ed by
 * work_id and rejoined to works on id — so a query matches a fic's metadata OR
 * its note (you-layer Step 2). The two FTS tables stay separate (works_fts is
 * untouched); the sanitized query expression (with `*` prefix markers + implicit
 * AND) is bound once per MATCH.
 */
/**
 * The effective author key (Author Identity Part A): the parsed primary
 * account when the work has byline author rows (AO3 works), else the raw
 * `works.author` string (non-AO3 sources, Anonymous, deleted-author
 * bylines). Author pages group by this key; the same expression appears in
 * /api/tags' author scope and /api/authors' grouping so the three surfaces
 * can never disagree.
 */
const AUTHOR_KEY = `COALESCE(
  (SELECT wa.account FROM work_authors wa WHERE wa.work_id = w.id AND wa.position = 0),
  w.author
)`;

const SEARCH_CLAUSE = `w.id IN (
  SELECT work_id FROM works_fts WHERE works_fts MATCH ?
  UNION
  SELECT work_id FROM notes_fts WHERE notes_fts MATCH ?
)`;

export const GET: RequestHandler = ({ url }) => {
	const db = getDb();
	const tagIds = parseTagIds(url.searchParams.get('tags'));
	const matchAll = parseMatchAll(url.searchParams.get('match_all'));
	const ftsQuery = sanitizeFtsQuery(url.searchParams.get('q'));
	const stars = parseStars(url.searchParams.get('stars'));
	const favOnly = url.searchParams.get('fav') === '1';
	const hideRead = url.searchParams.get('hide_read') === '1';
	const sort = parseSort(url.searchParams.get('sort'));
	const paginate = url.searchParams.get('paginate') !== 'false';
	const page = parsePage(url.searchParams.get('page'));
	const perPage = parsePerPage(url.searchParams.get('per_page'));

	// Build the WHERE additively. Both tag and search clauses are
	// `w.id IN (…)` subqueries, so they AND together without special
	// casing. When neither is present, no WHERE — every bare
	// /api/works call hits that path.
	const whereParts: string[] = [];
	const whereParams: unknown[] = [];

	// M2.3 Step 4: trashed works vanish from every discovery surface.
	// This sits in the shared `baseSql`, so it covers the paginated rows,
	// the COUNT(*) total, the `paginate=false` flat array (Continue
	// Reading + Favorites derive from it), AND the FTS-search path (which
	// AND-composes here). No param needed.
	whereParts.push('w.trashed_at IS NULL');

	// Author Pages Part 1 → Author Identity Part A: optional author scope,
	// now keyed on the EFFECTIVE author key — the parsed primary account
	// when the work has byline author rows, else the raw works.author
	// string (non-AO3 / Anonymous). Additive — ANDs with the trashed/tag/
	// search clauses, so the author-detail middle column reuses this
	// endpoint unchanged.
	const author = url.searchParams.get('author');
	if (author) {
		whereParts.push(`${AUTHOR_KEY} = ?`);
		whereParams.push(author);
		// Per-pseud sub-filter (author page only — meaningless without the
		// account scope, so it's gated on `author`). Matches the PRIMARY
		// author's pseud; NULL-pseud rows are addressed by the account name
		// itself (the client sends the label it displayed).
		const pseud = url.searchParams.get('pseud');
		if (pseud) {
			whereParts.push(
				`EXISTS (SELECT 1 FROM work_authors wa
				          WHERE wa.work_id = w.id AND wa.position = 0
				            AND COALESCE(wa.pseud, wa.account) = ?)`
			);
			whereParams.push(pseud);
		}
	}

	if (tagIds.length > 0) {
		whereParts.push(TAG_FILTER_CLAUSE);
		whereParams.push(JSON.stringify(tagIds), JSON.stringify(matchAll));
	}

	if (ftsQuery) {
		whereParts.push(SEARCH_CLAUSE);
		// Bound twice — once per MATCH in the works_fts ∪ notes_fts clause.
		whereParams.push(ftsQuery, ftsQuery);
	}

	// You-layer rating/favorites filters — plain WHERE entries on aliases
	// already in `baseSql`, so they AND-compose with the trashed/author/tag-CTE/
	// search clauses (one pipeline, no fork) and flow into the COUNT(*) total.
	// Both reference rows that exist only for rated/favorited works:
	//   stars → rt.stars IN (…) — exact multi-select, OR-within (Step 1c);
	//           unrated rt.stars is NULL → never in the list, so it's excluded
	//   fav   → w.favorited_at IS NOT NULL (favorites-only)
	//   hide_read → w.read_at IS NULL (exclude works manually marked read, #66 —
	//               keys off the manual flag, NOT the CR-finished state)
	if (stars.length > 0) {
		whereParts.push(`rt.stars IN (${stars.map(() => '?').join(', ')})`);
		whereParams.push(...stars);
	}
	if (favOnly) {
		whereParts.push('w.favorited_at IS NOT NULL');
	}
	if (hideRead) {
		whereParts.push('w.read_at IS NULL');
	}

	const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
	const baseSql = `
		FROM works w
		LEFT JOIN reading_progress rp ON rp.work_id = w.id
		LEFT JOIN ratings rt ON rt.work_id = w.id
		LEFT JOIN notes n ON n.work_id = w.id
		${whereClause}
	`;
	const baseParams = whereParams;

	// `paginate=false` returns the flat array — used by the library
	// page's Continue Reading + Favorites lists, which derive their
	// subsets from the full unfiltered set client-side and can't be
	// sliced to a page. Default path returns the new paginated shape
	// with metadata.
	if (!paginate) {
		const rows = db
			.prepare(`SELECT ${SELECT_COLUMNS} ${baseSql} ORDER BY w.ingested_at DESC`)
			.all(...baseParams) as Row[];
		return json(rows.map(rowToWork));
	}

	// Total first (cheap with the same WHERE), then the LIMIT/OFFSET
	// slice. Two prepared statements share `baseParams`. Clamp the
	// requested page to the actual page range so a stale URL after a
	// delete doesn't 404 — instead it returns the last page.
	const totalRow = db
		.prepare(`SELECT COUNT(*) AS n ${baseSql}`)
		.get(...baseParams) as { n: number };
	const total = totalRow.n;
	const totalPages = Math.max(1, Math.ceil(total / perPage));
	const clampedPage = Math.min(page, totalPages);
	const offset = (clampedPage - 1) * perPage;

	const rows = db
		.prepare(
			`SELECT ${SELECT_COLUMNS} ${baseSql} ${buildOrderBy(sort)} LIMIT ? OFFSET ?`
		)
		.all(...baseParams, perPage, offset) as Row[];

	return json({
		works: rows.map(rowToWork),
		page: clampedPage,
		per_page: perPage,
		total,
		total_pages: totalPages
	});
};
