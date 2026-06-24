<script lang="ts">
	import {
		favoriteSeries,
		unfavoriteSeries,
		setSeriesHidden,
		type SeriesSummary
	} from '$lib/api';
	import { Heart, Eye, EyeOff } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ─── Sort selector (Name A–Z default / Most parts) ──────────────
	// Client-side, persisted to localStorage with a one-shot $effect hydrate —
	// the /tags sort idiom. The server returns name-sorted; we re-sort here.
	const SORT_KEY = 'prefs:series:sort';
	const SORT_OPTIONS = ['name', 'parts'] as const;
	type SeriesSort = (typeof SORT_OPTIONS)[number];
	let sort = $state<SeriesSort>('name');

	$effect(() => {
		const stored = localStorage.getItem(SORT_KEY);
		if (stored && (SORT_OPTIONS as readonly string[]).includes(stored)) {
			sort = stored as SeriesSort;
		}
	});
	function persistSort() {
		localStorage.setItem(SORT_KEY, sort);
	}

	// ─── Optimistic favorite + hide overrides keyed by series id ────
	// Same pattern as the /authors index — local override maps so toggles feel
	// instant without invalidateAll (no page-load flash), reverted on failure.
	let favOverrides = $state<Record<number, boolean>>({});
	let hideOverrides = $state<Record<number, boolean>>({});

	const series = $derived(
		data.series.map((s) => ({
			...s,
			is_favorite: favOverrides[s.id] ?? s.is_favorite,
			hidden_from_index: hideOverrides[s.id] ?? s.hidden_from_index
		}))
	);

	const byName = (a: SeriesSummary, b: SeriesSummary) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
	const comparator = $derived.by(() =>
		sort === 'parts'
			? (a: SeriesSummary, b: SeriesSummary) => b.part_count - a.part_count || byName(a, b)
			: byName
	);

	let showHidden = $state(false);
	const hiddenCount = $derived(series.filter((s) => s.hidden_from_index).length);
	// Visible list respects the hide flag unless "show hidden" is on.
	const visible = $derived(
		series.filter((s) => showHidden || !s.hidden_from_index).toSorted(comparator)
	);
	const favorites = $derived(visible.filter((s) => s.is_favorite));

	let actionError = $state<string | null>(null);
	let favInFlight = $state<number | null>(null);
	let hideInFlight = $state<number | null>(null);

	async function toggleFavorite(e: MouseEvent, s: SeriesSummary) {
		e.preventDefault();
		e.stopPropagation();
		if (favInFlight === s.id) return;
		actionError = null;
		const next = !s.is_favorite;
		favOverrides = { ...favOverrides, [s.id]: next };
		favInFlight = s.id;
		try {
			if (next) await favoriteSeries(s.id, fetch);
			else await unfavoriteSeries(s.id, fetch);
		} catch (err) {
			favOverrides = { ...favOverrides, [s.id]: s.is_favorite }; // revert
			actionError = err instanceof Error ? err.message : 'Could not update favorite';
		} finally {
			favInFlight = null;
		}
	}

	async function toggleHidden(e: MouseEvent, s: SeriesSummary) {
		e.preventDefault();
		e.stopPropagation();
		if (hideInFlight === s.id) return;
		actionError = null;
		const next = !s.hidden_from_index;
		hideOverrides = { ...hideOverrides, [s.id]: next };
		hideInFlight = s.id;
		try {
			await setSeriesHidden(s.id, next, fetch);
		} catch (err) {
			hideOverrides = { ...hideOverrides, [s.id]: s.hidden_from_index }; // revert
			actionError = err instanceof Error ? err.message : 'Could not update hide';
		} finally {
			hideInFlight = null;
		}
	}

	function countLabel(n: number): string {
		return `${n} part${n === 1 ? '' : 's'}`;
	}
</script>

<svelte:head><title>Reliquary — Series</title></svelte:head>

{#snippet seriesCard(s: SeriesSummary)}
	<div class="series-card" class:muted={s.hidden_from_index}>
		<a class="series-link" href="/series/{s.id}">
			<span class="series-name">{s.name}</span>
			<span class="series-count">
				{s.hidden_from_index ? 'hidden · ' : ''}{countLabel(s.part_count)}
			</span>
		</a>
		<button
			type="button"
			class="icon-btn"
			onclick={(e) => toggleHidden(e, s)}
			aria-label={s.hidden_from_index ? `Show ${s.name} on the index` : `Hide ${s.name} from the index`}
			aria-pressed={s.hidden_from_index}
			title={s.hidden_from_index ? 'Hidden from the index — click to show' : 'Hide from the index'}
		>
			{#if s.hidden_from_index}
				<EyeOff size={16} aria-hidden="true" />
			{:else}
				<Eye size={16} aria-hidden="true" />
			{/if}
		</button>
		<button
			type="button"
			class="heart"
			class:filled={s.is_favorite}
			onclick={(e) => toggleFavorite(e, s)}
			aria-label={s.is_favorite ? `Unfavorite ${s.name}` : `Favorite ${s.name}`}
			aria-pressed={s.is_favorite}
		>
			<Heart size={16} fill={s.is_favorite ? 'currentColor' : 'none'} aria-hidden="true" />
		</button>
	</div>
{/snippet}

<main class="series-page">
	<header>
		<h1>Series <span class="total">· {series.length}</span></h1>
		{#if series.length > 0}
			<label class="sort-control">
				<span class="control-label">Sort</span>
				<select bind:value={sort} onchange={persistSort}>
					<option value="name">Name A–Z</option>
					<option value="parts">Most parts</option>
				</select>
			</label>
		{/if}
	</header>

	{#if actionError}
		<p class="page-error" role="alert">{actionError}</p>
	{/if}

	{#if series.length === 0}
		<p class="empty-state">No series yet — series are detected from your fics' metadata.</p>
	{:else}
		{#if favorites.length > 0}
			<section class="series-group">
				<h2>★ Favorites</h2>
				<div class="series-grid">
					{#each favorites as s (s.id)}
						{@render seriesCard(s)}
					{/each}
				</div>
			</section>
		{/if}

		<section class="series-group">
			<h2>All series</h2>
			<div class="series-grid">
				{#each visible as s (s.id)}
					{@render seriesCard(s)}
				{/each}
			</div>
		</section>

		{#if hiddenCount > 0}
			<button type="button" class="show-hidden" onclick={() => (showHidden = !showHidden)}>
				{#if showHidden}
					<EyeOff size={15} aria-hidden="true" /> Hide hidden
				{:else}
					<EyeOff size={15} aria-hidden="true" /> Show hidden ({hiddenCount})
				{/if}
			</button>
		{/if}
	{/if}
</main>

<style>
	.series-page {
		max-width: 1280px;
		margin: 1.5rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
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
	.sort-control {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.control-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
	}
	.sort-control select {
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 6px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-bg);
		color: var(--reader-fg);
	}
	.sort-control select:focus {
		outline: none;
		border-color: var(--reader-accent);
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
	.series-group {
		margin-bottom: 1.75rem;
	}
	.series-group h2 {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.6rem;
	}
	.series-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 10px;
	}
	.series-card {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
	}
	.series-card.muted {
		opacity: 0.6;
	}
	.series-link {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: inherit;
		text-decoration: none;
	}
	.series-name {
		font-weight: 500;
		word-break: break-word;
	}
	.series-link:hover .series-name {
		text-decoration: underline;
	}
	.series-count {
		font-size: 0.8rem;
		color: var(--reader-muted);
	}
	.icon-btn,
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
	.icon-btn:hover {
		color: var(--reader-fg);
	}
	.heart:hover {
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
	}
	.show-hidden {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 8px;
		border: none;
		background: none;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.show-hidden:hover {
		color: var(--reader-fg);
		text-decoration: underline;
	}
</style>
