<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The numbered chapter list shows only real chapters; the preface
	// ("Tags & metadata") and afterword ("End notes") are surfaced as
	// dedicated links above and below the list.
	const realChapters = $derived(data.work.chapters.filter((c) => c.kind === 'chapter'));
	const hasPreface = $derived(data.work.chapters.some((c) => c.kind === 'preface'));
	const hasAfterword = $derived(data.work.chapters.some((c) => c.kind === 'afterword'));
</script>

<svelte:head><title>Reliquary — {data.work.title}</title></svelte:head>

<main>
	<p class="back"><a href="/">← Library</a></p>
	<h1>{data.work.title}</h1>
	<p class="author">by {data.work.author}</p>
	{#if data.work.last_read}
		<p class="continue">
			<a
				class="continue-button"
				href="/works/{data.work.id}/ch/{data.work.last_read.chapter}?continue=1"
			>
				Continue from Chapter {data.work.last_read.chapter}
			</a>
		</p>
	{/if}
	{#if data.work.summary}
		<div class="summary">{@html data.work.summary}</div>
	{/if}
	{#if hasPreface}
		<p class="wrapper-link">
			<a href="/works/{data.work.id}/preface">Tags &amp; metadata</a>
		</p>
	{/if}
	<h2>Chapters</h2>
	<ol class="chapters">
		{#each realChapters as ch (ch.number)}
			<li>
				<a href="/works/{data.work.id}/ch/{ch.number}">
					{#if ch.title}{ch.title}{:else}<em>untitled</em>{/if}
				</a>
			</li>
		{/each}
	</ol>
	{#if hasAfterword}
		<p class="wrapper-link">
			<a href="/works/{data.work.id}/afterword">End notes</a>
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	.back {
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}
	.back a {
		color: #555;
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.25rem;
	}
	.author {
		color: #666;
		margin-top: 0;
	}
	.continue {
		margin: 1rem 0 0;
	}
	.continue-button {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		background: #3b2328;
		color: #f6f2e4;
		border-radius: 4px;
		text-decoration: none;
		font-size: 0.95rem;
		font-weight: 500;
	}
	.continue-button:hover {
		background: #5a3640;
	}
	.summary {
		background: #f7f7f7;
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin: 1rem 0;
	}
	.summary :global(p) {
		margin: 0.5rem 0;
	}
	h2 {
		font-size: 1.1rem;
		margin-top: 2rem;
	}
	ol.chapters {
		padding-left: 1.5rem;
	}
	ol.chapters li {
		padding: 0.25rem 0;
	}
	ol.chapters a {
		color: inherit;
		text-decoration: none;
	}
	ol.chapters a:hover {
		text-decoration: underline;
	}
	.wrapper-link {
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}
	.wrapper-link a {
		color: #555;
		text-decoration: none;
	}
	.wrapper-link a:hover {
		text-decoration: underline;
	}
</style>
