<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { favoriteAuthor, unfavoriteAuthor } from '$lib/api';
	import AuthorNotesTags from '$lib/AuthorNotesTags.svelte';
	import FilterSidebar from '$lib/FilterSidebar.svelte';
	import Pagination from '$lib/Pagination.svelte';
	import SearchInput from '$lib/SearchInput.svelte';
	import WorkRow from '$lib/WorkRow.svelte';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const PER_PAGE_OPTIONS = [10, 12, 15] as const;
	const PER_PAGE_DEFAULT = 12;
	const PER_PAGE_STORAGE_KEY = 'prefs:library:per_page';

	const author = $derived(data.author);
	const filtered = $derived(
		data.selectedTagIds.length > 0 || data.q.trim().length > 0
	);

	// Optimistic favorite toggle, reverted by invalidateAll on settle.
	let pendingFav = $state<boolean | null>(null);
	const isFavorite = $derived(pendingFav ?? author.is_favorite);
	let favError = $state<string | null>(null);

	async function toggleFavorite() {
		const next = !isFavorite;
		pendingFav = next;
		favError = null;
		try {
			if (next) await favoriteAuthor(author.name, fetch);
			else await unfavoriteAuthor(author.name, fetch);
			await invalidateAll();
		} catch (e) {
			favError = e instanceof Error ? e.message : 'Favorite toggle failed';
		} finally {
			pendingFav = null;
		}
	}

	// Per-page picker — same URL/localStorage behavior as the library;
	// `goto('?…')` is relative so it stays on /authors/[name].
	function pushPerPage(next: number) {
		if (typeof window !== 'undefined') {
			localStorage.setItem(PER_PAGE_STORAGE_KEY, String(next));
		}
		const params = new URLSearchParams(pageState.url.searchParams);
		if (next === PER_PAGE_DEFAULT) params.delete('per_page');
		else params.set('per_page', String(next));
		params.delete('page');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head><title>Reliquary — {author.name}</title></svelte:head>

<main class="author-detail">
	<p class="back"><a href="/authors">← Authors</a></p>
	<header class="author-header">
		<h1>{author.name}</h1>
		<span class="work-count">{author.work_count} work{author.work_count === 1 ? '' : 's'}</span>
		<button
			class="heart"
			class:filled={isFavorite}
			onclick={toggleFavorite}
			aria-label={isFavorite ? 'Remove from favorite authors' : 'Add to favorite authors'}
			aria-pressed={isFavorite}
		>
			<Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
		</button>
	</header>
	{#if favError}
		<p class="error">{favError}</p>
	{/if}

	<div class="cols">
		<!-- Left: Part 2 notes + tags (was the "coming soon" stub). The {#key}
		     remounts the component per author so its prop-seeded local state
		     (note draft, tag chips) resets cleanly when SvelteKit reuses this
		     route for a different [name]. -->
		<aside class="left-col" aria-label="Author notes and tags">
			{#key author.name}
				<AuthorNotesTags
					name={author.name}
					notes={data.notes}
					tags={data.authorTags}
					vocab={data.tagVocab}
				/>
			{/key}
		</aside>

		<section class="middle-col" aria-label="Works by this author">
			<header class="middle-header">
				<h2 class="middle-heading">
					Works
					<span class="middle-count">
						{#if filtered}
							{data.filteredPage.total} of {author.work_count}
						{:else}
							{author.work_count} work{author.work_count === 1 ? '' : 's'}
						{/if}
					</span>
				</h2>
				{#if author.work_count > 0}
					<label class="per-page-picker">
						<span class="per-page-label">Per page</span>
						<select
							value={data.perPage}
							onchange={(e) => pushPerPage(Number((e.target as HTMLSelectElement).value))}
						>
							{#each PER_PAGE_OPTIONS as opt (opt)}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
					</label>
				{/if}
			</header>

			{#if data.filteredPage.total === 0}
				<p class="empty">
					{#if filtered}
						No works by this author match the current search and filters.
					{:else}
						No works by this author.
					{/if}
				</p>
			{:else}
				<ul class="works">
					{#each data.filteredPage.works as work (work.id)}
						<li><WorkRow {work} /></li>
					{/each}
				</ul>
				<Pagination page={data.filteredPage.page} totalPages={data.filteredPage.total_pages} />
			{/if}
		</section>

		<div class="right-col">
			<SearchInput q={data.q} />
			<FilterSidebar
				tags={data.tagGroups}
				selectedIds={data.selectedTagIds}
				matchAllCategories={data.matchAllCategories}
			/>
		</div>
	</div>
</main>

<style>
	.author-detail {
		max-width: 1280px;
		margin: 1.5rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	.back {
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
	}
	.back a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	.author-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0;
		word-break: break-word;
	}
	.work-count {
		font-size: 0.9rem;
		color: var(--reader-muted);
	}
	.heart {
		flex: 0 0 auto;
		background: none;
		border: 1px solid var(--reader-border);
		border-radius: 50%;
		width: 38px;
		height: 38px;
		color: var(--reader-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.heart:hover {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
		border-color: var(--reader-heart);
	}
	.error {
		color: #b00;
		font-size: 0.9rem;
		margin: 0 0 0.75rem;
	}

	/*
	 * Three-column shell, mirroring the library (DESIGN §7): left 200px,
	 * middle 1fr, right 240px. Narrow viewport (<900px) collapses to one
	 * column reordered left → right → middle so filters stay reachable
	 * without scrolling past every work — same as the library.
	 */
	.cols {
		display: grid;
		grid-template-columns: 200px 1fr 240px;
		grid-template-areas: 'left middle right';
		gap: 1.5rem 1.75rem;
	}
	.left-col {
		grid-area: left;
		min-width: 0;
	}
	.middle-col {
		grid-area: middle;
		min-width: 0;
	}
	.right-col {
		grid-area: right;
		min-width: 0;
	}
	.middle-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}
	.middle-heading {
		font-size: 1.1rem;
		margin: 0;
	}
	.middle-count {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--reader-muted);
		margin-left: 0.4rem;
	}
	.per-page-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--reader-muted);
		white-space: nowrap;
	}
	.per-page-picker select {
		font: inherit;
		font-size: 0.85rem;
		padding: 2px 4px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-bg);
		color: var(--reader-fg);
	}
	.empty {
		color: var(--reader-muted);
		padding: 1.5rem 0;
	}
	ul.works {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	ul.works li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--reader-border);
	}

	@media (max-width: 900px) {
		.cols {
			grid-template-columns: 1fr;
			grid-template-areas:
				'left'
				'right'
				'middle';
			gap: 1.25rem;
		}
	}
</style>
