<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { TagCategory, TagGroups } from '$lib/api';

	type Props = {
		tags: TagGroups;
		selectedIds: number[];
		matchAllCategories: TagCategory[];
		/** You-layer Step 1b: minimum star-rating threshold (1–5), or null. */
		minStars?: number | null;
		/** You-layer Step 1b: favorites-only filter. */
		favOnly?: boolean;
		/**
		 * Render the you-layer favorites + star-rating filter sections. Set by
		 * the library only — the author-detail page reuses this sidebar for AO3
		 * tag filtering and doesn't wire the personal filters, so it leaves this
		 * false (and the props default).
		 */
		personalFilters?: boolean;
	};
	let {
		tags,
		selectedIds,
		matchAllCategories,
		minStars = null,
		favOnly = false,
		personalFilters = false
	}: Props = $props();

	// How many narrowing filters are active — drives the "Clear (N)" affordance.
	const activeFilterCount = $derived(
		selectedIds.length + (minStars !== null ? 1 : 0) + (favOnly ? 1 : 0)
	);

	/**
	 * Display order (matches DESIGN.md §7's filter sidebar; mirrors AO3's
	 * own preface block order). Drives both the section sequence and the
	 * per-category labels.
	 */
	const CATEGORIES: { key: TagCategory; label: string }[] = [
		{ key: 'rating', label: 'Rating' },
		{ key: 'warning', label: 'Archive Warning' },
		{ key: 'category', label: 'Category' },
		{ key: 'fandom', label: 'Fandom' },
		{ key: 'relationship', label: 'Relationship' },
		{ key: 'character', label: 'Character' },
		{ key: 'freeform', label: 'Additional Tags' }
	];

	function expandedKey(cat: TagCategory): string {
		return `prefs:filter:expanded:${cat}`;
	}

	/**
	 * Per-category expand state. Hydrated from localStorage on first
	 * client render via the $effect below; defaults to all collapsed
	 * (seven open sections at once is visually overwhelming). Each
	 * toggle writes back to localStorage so the layout sticks across
	 * reloads.
	 */
	let expanded: Record<TagCategory, boolean> = $state({
		rating: false,
		warning: false,
		category: false,
		fandom: false,
		relationship: false,
		character: false,
		freeform: false
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const next = { ...expanded };
		let changed = false;
		for (const { key } of CATEGORIES) {
			const stored = localStorage.getItem(expandedKey(key));
			if (stored !== null) {
				const val = stored === 'true';
				if (next[key] !== val) {
					next[key] = val;
					changed = true;
				}
			}
		}
		if (changed) expanded = next;
		// Runs once on mount (no reactive deps inside) so this doesn't
		// loop; the localStorage write path is the toggle handler.
	});

	function toggleExpand(cat: TagCategory) {
		expanded[cat] = !expanded[cat];
		if (typeof window !== 'undefined') {
			localStorage.setItem(expandedKey(cat), String(expanded[cat]));
		}
	}

	function isSelected(id: number): boolean {
		return selectedIds.includes(id);
	}

	function isMatchAll(cat: TagCategory): boolean {
		return matchAllCategories.includes(cat);
	}

	/**
	 * Build the next URL from `tags` + `match_all` lists, replacing
	 * both params on `page.url`. Empty lists drop the param. All
	 * toggle handlers route through this to keep the URL the single
	 * source of truth.
	 *
	 * Filter changes ALWAYS reset pagination to page 1 — a filter that
	 * shrinks the result set could leave the user on a page that no
	 * longer exists (the server clamps but the URL would be lying),
	 * and a filter that grows it should always re-anchor at the top.
	 */
	function pushFilterState(nextTags: number[], nextMatchAll: TagCategory[]) {
		const params = new URLSearchParams(page.url.searchParams);
		if (nextTags.length > 0) params.set('tags', nextTags.join(','));
		else params.delete('tags');
		if (nextMatchAll.length > 0) params.set('match_all', nextMatchAll.join(','));
		else params.delete('match_all');
		params.delete('page');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}

	/**
	 * Toggle one tag, then push the new filter set into the URL. Each
	 * toggle is a fresh history entry (default goto behavior) so
	 * browser-back walks through filter combinations the user actually
	 * tried — matches AO3's bookmarks UX. `keepFocus` so the just-
	 * clicked checkbox stays focused, `noScroll` so the page doesn't
	 * jump back to top mid-filter-session.
	 */
	function toggleTag(id: number) {
		const next = isSelected(id)
			? selectedIds.filter((x) => x !== id)
			: [...selectedIds, id];
		pushFilterState(next, matchAllCategories);
	}

	/**
	 * Flip a category between OR-within and AND-within (match-all) mode.
	 * Independent per category — `match_all=fandom` doesn't affect
	 * Freeform's OR-within behavior, and vice versa.
	 */
	function toggleMatchAll(cat: TagCategory) {
		const next = isMatchAll(cat)
			? matchAllCategories.filter((c) => c !== cat)
			: [...matchAllCategories, cat];
		pushFilterState(selectedIds, next);
	}

	/**
	 * You-layer Step 1b: rating + favorites filters. Both mutate one URL param
	 * on top of the *current* params (copying everything else through), so they
	 * compose with tags/match-all/search and round-trip in the URL. Like the
	 * tag toggles, a filter change resets pagination to page 1.
	 */
	function pushFilterParam(mutate: (params: URLSearchParams) => void) {
		const params = new URLSearchParams(page.url.searchParams);
		mutate(params);
		params.delete('page');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}

	function setMinStars(n: number | null) {
		pushFilterParam((p) => (n ? p.set('min_stars', String(n)) : p.delete('min_stars')));
	}

	function toggleFavOnly() {
		pushFilterParam((p) => (favOnly ? p.delete('fav') : p.set('fav', '1')));
	}

	/**
	 * Clear every narrowing filter — tags, match-all, rating, favorites — in
	 * one shot. Deliberately preserves the search `q`, sort, and per_page
	 * (those aren't "filters": search has its own × and sort/per-page are view
	 * prefs).
	 */
	function clearAll() {
		pushFilterParam((p) => {
			p.delete('tags');
			p.delete('match_all');
			p.delete('min_stars');
			p.delete('fav');
		});
	}
</script>

<aside class="filter-sidebar" aria-label="Search and filters">
	<header class="filter-header">
		<h2>Filters</h2>
		{#if activeFilterCount > 0}
			<button type="button" class="clear" onclick={clearAll}>
				Clear ({activeFilterCount})
			</button>
		{/if}
	</header>

	<!-- You-layer Step 1b: favorites-only + star-rating filters (library only).
	     Sit above the AO3 tag categories; compose with everything below via the
	     URL. Hidden on the author-detail reuse of this sidebar. -->
	{#if personalFilters}
		<section class="filter-section special-filter">
			<label class="fav-toggle">
				<input type="checkbox" checked={favOnly} onchange={toggleFavOnly} />
				<span>Favorites only</span>
			</label>
		</section>

		<section class="filter-section special-filter">
			<div class="special-label">Star rating</div>
			<div class="rating-buttons" role="group" aria-label="Minimum star rating">
				{#each [1, 2, 3, 4, 5] as n (n)}
					<button
						type="button"
						class="rating-btn"
						class:active={minStars === n}
						aria-pressed={minStars === n}
						title={n === 5 ? '5 stars' : `${n}+ stars`}
						onclick={() => setMinStars(minStars === n ? null : n)}
					>
						{n === 5 ? '5' : `${n}+`}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	{#each CATEGORIES as { key, label } (key)}
		{@const tagList = tags[key] ?? []}
		{#if tagList.length > 0}
			<section class="filter-section">
				<button
					type="button"
					class="filter-section-toggle"
					aria-expanded={expanded[key]}
					onclick={() => toggleExpand(key)}
				>
					<span class="caret" aria-hidden="true">{expanded[key] ? '▾' : '▸'}</span>
					<span class="label">{label}</span>
					<span class="count">{tagList.length}</span>
				</button>
				{#if expanded[key]}
					<label
						class="match-all-row"
						title="When checked, a fic must have ALL selected {label.toLowerCase()} tags — useful for crossovers. When unchecked (default), any one matches."
					>
						<input
							type="checkbox"
							checked={isMatchAll(key)}
							onchange={() => toggleMatchAll(key)}
						/>
						<span class="match-all-label">Must match all selected</span>
					</label>
					<ul class="tag-list">
						{#each tagList as tag (tag.id)}
							<li>
								<label class="tag-row">
									<input
										type="checkbox"
										checked={isSelected(tag.id)}
										onchange={() => toggleTag(tag.id)}
									/>
									<span class="tag-name">{tag.name}</span>
									<span class="tag-count">({tag.count})</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/each}
</aside>

<style>
	.filter-sidebar {
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	.filter-header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.filter-header h2 {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0;
		flex: 1 1 auto;
	}
	.clear {
		font: inherit;
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.clear:hover {
		color: var(--reader-heart);
		border-color: var(--reader-heart);
	}

	.filter-section {
		border-bottom: 1px solid var(--reader-border);
	}
	/* You-layer Step 1b: favorites + star-rating filter sections. Same
	   bordered-row rhythm as the tag sections, with their own padding (they
	   have no expand/collapse toggle). */
	.special-filter {
		padding: 8px 0;
	}
	.fav-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.fav-toggle input[type='checkbox'] {
		accent-color: var(--reader-fg);
		flex: 0 0 auto;
	}
	.special-label {
		font-size: 0.85rem;
		font-weight: 500;
		margin-bottom: 6px;
	}
	.rating-buttons {
		display: flex;
		gap: 4px;
	}
	/* Minimum-threshold buttons (1+ … 5). Single-select: the active threshold
	   is filled with the accent (matches the star control); click it again to
	   clear back to "any rating". Theme-aware. */
	.rating-btn {
		flex: 1 1 0;
		padding: 4px 0;
		border: 1px solid var(--reader-border);
		border-radius: 3px;
		background: transparent;
		color: var(--reader-muted);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.rating-btn:hover {
		border-color: var(--reader-accent);
		color: var(--reader-fg);
	}
	.rating-btn.active {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
		color: var(--reader-bg);
		font-weight: 600;
	}
	.filter-section-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
	}
	.filter-section-toggle:hover .label {
		color: var(--reader-accent);
	}
	.caret {
		display: inline-block;
		width: 12px;
		text-align: center;
		color: var(--reader-muted);
		font-size: 0.75rem;
		line-height: 1;
	}
	.label {
		flex: 1 1 auto;
		font-weight: 500;
	}
	.count {
		font-size: 0.75rem;
		color: var(--reader-muted);
	}

	/* Per-category "Must match all selected" toggle. Sits at the top
	   of each expanded section, above the tag list. Italicized label
	   to distinguish it from tag rows. Same accent-color as the tag
	   checkboxes for visual continuity. */
	.match-all-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 0 6px;
		margin-bottom: 4px;
		border-bottom: 1px dashed var(--reader-border);
		font-size: 0.75rem;
		font-style: italic;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.match-all-row input[type='checkbox'] {
		accent-color: var(--reader-fg);
		flex: 0 0 auto;
	}
	.match-all-label {
		flex: 1 1 auto;
	}

	.tag-list {
		list-style: none;
		padding: 0;
		margin: 0 0 8px;
		max-height: 280px;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.tag-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 0;
		font-size: 0.8rem;
		line-height: 1.3;
		cursor: pointer;
	}
	.tag-row input[type='checkbox'] {
		accent-color: var(--reader-fg);
		flex: 0 0 auto;
	}
	.tag-name {
		flex: 1 1 auto;
		min-width: 0;
		word-break: break-word;
	}
	.tag-count {
		flex: 0 0 auto;
		color: var(--reader-muted);
		font-size: 0.75rem;
	}
</style>
