<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { favoriteSeries, unfavoriteSeries } from '$lib/api';
	import WorkRow from '$lib/WorkRow.svelte';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const series = $derived(data.series);
	const count = $derived(series.works.length);

	// Show the "Part N" column only when this series actually carries positions
	// (AO3 series do; a name-only series may not). When it does, pass each
	// part's position to every row — null included — so unnumbered parts
	// reserve a blank slot and the covers stay aligned.
	const hasParts = $derived(series.works.some((w) => w.position != null));

	// "Read next" (Part 3): the first part you haven't finished, in position
	// order (the list is already position-sorted). A part counts as finished
	// once reading_progress reached its last chapter. Null when every part is
	// finished (or none has progress beyond completion).
	function isFinished(w: (typeof series.works)[number]): boolean {
		return w.last_read != null && w.last_read.chapter >= w.chapter_count;
	}
	const readNextId = $derived(series.works.find((w) => !isFinished(w))?.id ?? null);

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
				<li class:read-next={work.id === readNextId}>
					{#if work.id === readNextId}
						<span class="read-next-badge"><span aria-hidden="true">▶</span> Read next</span>
					{/if}
					<WorkRow {work} showAuthor part={hasParts ? work.position : undefined} />
				</li>
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
	/* "Read next" highlight (Part 3) — a quiet card around the first
	   unfinished part, with a small badge above the row. The card's inner
	   padding is cancelled by an equal NEGATIVE horizontal margin so the
	   highlight bleeds outward into the page gutter (.series-page has 1rem of
	   side padding to absorb it) instead of insetting its content — the Part
	   label + cover stay flush-aligned with the plain rows above/below. */
	ul.works li.read-next {
		border-bottom-color: transparent;
		background: var(--reader-card-bg);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		margin: 0.25rem -0.75rem;
	}
	.read-next-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.4rem;
		padding: 2px 10px;
		border-radius: 999px;
		border: 1px solid var(--reader-accent);
		background: var(--reader-bg);
		color: var(--reader-accent);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
</style>
