<script lang="ts">
	import Reader from '$lib/Reader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Reliquary — Tags & metadata</title></svelte:head>

{#if data.series.length > 0}
	<nav class="series-section" aria-label="Series">
		{#each data.series as s (s.id)}
			<p class="series-line">
				{#if s.position != null}Part {s.position} of{/if}{' '}<a href="/series/{s.id}">{s.name}</a>
			</p>
		{/each}
	</nav>
{/if}

<Reader html={data.html} workId={data.workId} />

<style>
	/* Series cross-links sit above the rendered preface, centered to the
	   same column width as the reader article and themed with --reader-*. */
	.series-section {
		max-width: var(--reader-max-width);
		margin: 1.5rem auto 0;
		padding: 0 1.5rem;
		box-sizing: border-box;
		font-family: system-ui, sans-serif;
	}
	.series-line {
		margin: 0.25rem 0;
		color: var(--reader-muted);
		font-size: 0.95rem;
	}
	.series-line a {
		color: var(--reader-link);
		text-decoration: none;
	}
	.series-line a:hover {
		text-decoration: underline;
	}
</style>
