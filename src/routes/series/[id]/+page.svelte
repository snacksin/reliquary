<script lang="ts">
	import WorkRow from '$lib/WorkRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const series = $derived(data.series);
	const count = $derived(series.works.length);
</script>

<svelte:head><title>Reliquary — {series.name}</title></svelte:head>

<main class="series-page">
	<p class="back"><a href="/">← Library</a></p>
	<header class="series-header">
		<h1>{series.name}</h1>
		<span class="part-count">
			{count} part{count === 1 ? '' : 's'} in your library
		</span>
	</header>

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
		align-items: baseline;
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
