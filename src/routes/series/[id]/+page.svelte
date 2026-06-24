<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { favoriteSeries, unfavoriteSeries } from '$lib/api';
	import WorkRow from '$lib/WorkRow.svelte';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const series = $derived(data.series);
	const count = $derived(series.works.length);

	// History-aware back (Part 2 fix C): return to the fic you came from, not
	// Library. afterNavigate captures the previous page on every entry; if it
	// was a /works/ page, back goes there, otherwise /series (also the cold-
	// load fallback). Recomputed each navigation so it never goes stale.
	let backHref = $state('/series');
	const backLabel = $derived(backHref.startsWith('/works/') ? '← Back to fic' : '← Series');
	afterNavigate((nav) => {
		const from = nav.from?.url;
		backHref = from && from.pathname.startsWith('/works/') ? from.pathname + from.search : '/series';
	});

	// Optimistic favorite (mirrors the author index/detail heart): pendingFav
	// holds the toggled value until/unless the persist call fails — no
	// invalidateAll, so no page-load flash.
	let pendingFav = $state<boolean | null>(null);
	const isFavorite = $derived(pendingFav ?? series.is_favorite);
	let favError = $state<string | null>(null);
	let favInFlight = $state(false);

	async function toggleFavorite() {
		if (favInFlight) return;
		const next = !isFavorite;
		pendingFav = next;
		favError = null;
		favInFlight = true;
		try {
			if (next) await favoriteSeries(series.id, fetch);
			else await unfavoriteSeries(series.id, fetch);
		} catch (e) {
			pendingFav = !next; // revert
			favError = e instanceof Error ? e.message : 'Favorite toggle failed';
		} finally {
			favInFlight = false;
		}
	}
</script>

<svelte:head><title>Reliquary — {series.name}</title></svelte:head>

<main class="series-page">
	<p class="back"><a href={backHref}>{backLabel}</a></p>
	<header class="series-header">
		<h1>{series.name}</h1>
		<span class="part-count">
			{count} part{count === 1 ? '' : 's'} in your library
		</span>
		<button
			class="heart"
			class:filled={isFavorite}
			onclick={toggleFavorite}
			aria-label={isFavorite ? 'Remove from favorite series' : 'Add to favorite series'}
			aria-pressed={isFavorite}
		>
			<Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
		</button>
	</header>
	{#if favError}
		<p class="error">{favError}</p>
	{/if}

	{#if count === 0}
		<p class="empty">No works from this series in your library.</p>
	{:else}
		<ul class="works">
			{#each series.works as work (work.id)}
				<li><WorkRow {work} showAuthor /></li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.series-page {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem 4rem;
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
	.series-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0;
		word-break: break-word;
	}
	.part-count {
		font-size: 0.9rem;
		color: var(--reader-muted);
	}
	/* Favorite heart — mirrors the author-detail header heart. */
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
</style>
