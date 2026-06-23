<script lang="ts">
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { favoriteAuthor, unfavoriteAuthor, type Author } from '$lib/api';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ─── Author-tag filter (Part 2) ─────────────────────────────────
	//
	// Only tags actually carried by ≥1 author are offered as chips. The URL
	// (`?author_tags=`) is the source of truth; toggling a chip rewrites it
	// via goto (mirrors FilterSidebar.pushFilterState — keepFocus, noScroll).
	// The server returns the intersection-filtered list, so `data.authors` is
	// already narrowed when chips are active.
	const filterTags = $derived(data.tagVocab.filter((t) => t.author_count > 0));
	const selectedTagIds = $derived(new Set(data.selectedTagIds));

	function pushFilter(nextIds: number[]) {
		const params = new URLSearchParams(pageState.url.searchParams);
		if (nextIds.length > 0) params.set('author_tags', nextIds.join(','));
		else params.delete('author_tags');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}

	function toggleFilter(id: number) {
		const next = selectedTagIds.has(id)
			? data.selectedTagIds.filter((x) => x !== id)
			: [...data.selectedTagIds, id];
		pushFilter(next);
	}

	function clearFilter() {
		pushFilter([]);
	}

	// Optimistic favorite overrides keyed by author name. The heart toggle
	// updates this map locally instead of calling invalidateAll() — a full
	// reload re-fetched /api/authors and flashed a page-load spinner. The
	// override is applied over the server data and only reverted if the
	// persist call fails. (Part 1 follow-up: favorite-flash fix.)
	let overrides = $state<Record<string, boolean>>({});

	const authors = $derived(
		data.authors.map((a) => (a.name in overrides ? { ...a, is_favorite: overrides[a.name] } : a))
	);
	const favorites = $derived(authors.filter((a) => a.is_favorite));

	let actionError = $state<string | null>(null);
	// Per-author in-flight guard — prevents overlapping persist calls on the
	// same author without dimming the card (no visual flash).
	let inFlight = $state<string | null>(null);

	async function toggleFavorite(e: MouseEvent, author: Author) {
		// Heart lives next to the card's nav link; keep its click self-
		// contained so it never triggers card navigation.
		e.preventDefault();
		e.stopPropagation();
		if (inFlight === author.name) return;

		actionError = null;
		const next = !author.is_favorite;
		overrides = { ...overrides, [author.name]: next }; // optimistic
		inFlight = author.name;
		try {
			if (next) await favoriteAuthor(author.name, fetch);
			else await unfavoriteAuthor(author.name, fetch);
		} catch (err) {
			overrides = { ...overrides, [author.name]: author.is_favorite }; // revert
			actionError = err instanceof Error ? err.message : 'Could not update favorite';
		} finally {
			inFlight = null;
		}
	}

	function countLabel(n: number): string {
		return `${n} work${n === 1 ? '' : 's'}`;
	}
</script>

<svelte:head><title>Reliquary — Authors</title></svelte:head>

{#snippet authorCard(author: Author)}
	<div class="author-card">
		<a class="author-link" href="/authors/{encodeURIComponent(author.name)}">
			<span class="author-name">{author.name}</span>
			<span class="author-count">{countLabel(author.work_count)}</span>
		</a>
		<button
			type="button"
			class="heart"
			class:filled={author.is_favorite}
			onclick={(e) => toggleFavorite(e, author)}
			aria-label={author.is_favorite ? `Unfavorite ${author.name}` : `Favorite ${author.name}`}
			aria-pressed={author.is_favorite}
		>
			<Heart size={16} fill={author.is_favorite ? 'currentColor' : 'none'} aria-hidden="true" />
		</button>
	</div>
{/snippet}

<main class="authors-page">
	<header>
		<h1>Authors <span class="total">· {authors.length}</span></h1>
	</header>

	{#if filterTags.length > 0}
		<div class="filter-bar">
			<span class="filter-label">Filter by tag</span>
			{#each filterTags as tag (tag.id)}
				<button
					type="button"
					class="filter-chip"
					class:selected={selectedTagIds.has(tag.id)}
					aria-pressed={selectedTagIds.has(tag.id)}
					onclick={() => toggleFilter(tag.id)}
				>
					{tag.name} <span class="chip-count">{tag.author_count}</span>
				</button>
			{/each}
			{#if selectedTagIds.size > 0}
				<button type="button" class="filter-clear" onclick={clearFilter}>
					Clear ({selectedTagIds.size})
				</button>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<p class="page-error" role="alert">{actionError}</p>
	{/if}

	{#if authors.length === 0}
		{#if selectedTagIds.size > 0}
			<p class="empty-state">No authors match the selected tag{selectedTagIds.size === 1 ? '' : 's'}.</p>
		{:else}
			<p class="empty-state">No authors yet — your library is empty.</p>
		{/if}
	{:else}
		{#if favorites.length > 0}
			<section class="author-group">
				<h2>★ Favorites</h2>
				<div class="author-grid">
					{#each favorites as author (author.name)}
						{@render authorCard(author)}
					{/each}
				</div>
			</section>
		{/if}

		<section class="author-group">
			<h2>All authors <span class="sub">· by work count</span></h2>
			<div class="author-grid">
				{#each authors as author (author.name)}
					{@render authorCard(author)}
				{/each}
			</div>
		</section>
	{/if}
</main>

<style>
	.authors-page {
		max-width: 1280px;
		margin: 1.5rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0;
	}
	.total {
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--reader-muted);
	}
	.page-error {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid #b00;
		color: #b00;
		font-size: 0.85rem;
	}
	.empty-state {
		color: var(--reader-muted);
		padding: 2rem 0;
	}

	/* ─── Author-tag filter bar (Part 2) ─── */
	.filter-bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 12px;
		margin-bottom: 1.25rem;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
	}
	.filter-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
	}
	.filter-chip {
		font: inherit;
		font-size: 0.8rem;
		padding: 3px 11px;
		border-radius: 999px;
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.filter-chip:hover {
		border-color: var(--reader-accent);
		color: var(--reader-fg);
	}
	.filter-chip.selected {
		background: var(--reader-fg);
		border-color: var(--reader-fg);
		color: var(--reader-bg);
	}
	.filter-chip .chip-count {
		opacity: 0.7;
		margin-left: 2px;
	}
	.filter-clear {
		font: inherit;
		font-size: 0.75rem;
		margin-left: 2px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.filter-clear:hover {
		color: var(--reader-heart);
		border-color: var(--reader-heart);
	}
	.author-group {
		margin-bottom: 1.75rem;
	}
	.author-group h2 {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.6rem;
	}
	.author-group h2 .sub {
		font-weight: 400;
	}
	.author-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}
	.author-card {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
	}
	.author-link {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: inherit;
		text-decoration: none;
	}
	.author-name {
		font-weight: 500;
		word-break: break-word;
	}
	.author-link:hover .author-name {
		text-decoration: underline;
	}
	.author-count {
		font-size: 0.8rem;
		color: var(--reader-muted);
	}
	.heart {
		flex: 0 0 auto;
		background: none;
		border: none;
		padding: 4px;
		color: var(--reader-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}
	.heart:hover:not(:disabled) {
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
	}
</style>
