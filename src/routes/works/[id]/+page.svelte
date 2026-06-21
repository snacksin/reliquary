<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { setFavorite, unsetFavorite } from '$lib/api';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The numbered chapter list shows only real chapters; the preface
	// ("Tags & metadata") and afterword ("End notes") are surfaced as
	// dedicated links above and below the list.
	const realChapters = $derived(data.work.chapters.filter((c) => c.kind === 'chapter'));
	const hasPreface = $derived(data.work.chapters.some((c) => c.kind === 'preface'));
	const hasAfterword = $derived(data.work.chapters.some((c) => c.kind === 'afterword'));

	// Optimistic local override so the heart toggle feels instantaneous.
	// Set on click, cleared once invalidateAll re-fetches (fresh
	// data.work.is_favorite then takes over). Initial null = "no
	// override, use server data".
	let pendingFavorite: boolean | null = $state(null);
	const isFavorite = $derived(pendingFavorite ?? data.work.is_favorite);
	let favoriteError: string | null = $state(null);

	// Cover-slot placeholder glyph: first letter of the title, uppercased.
	// Mirrors the helper on the library page; v1.5 swaps in real cover art.
	const glyph = $derived(data.work.title?.[0]?.toUpperCase() ?? '?');

	// Short date for the "author edited · <date>" chapter pills (Part 2).
	function shortDate(iso: string): string {
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	async function toggleFavorite() {
		const next = !isFavorite;
		pendingFavorite = next;
		favoriteError = null;
		try {
			if (next) {
				await setFavorite(data.work.id, fetch);
			} else {
				await unsetFavorite(data.work.id, fetch);
			}
			await invalidateAll();
			pendingFavorite = null;
		} catch (e) {
			pendingFavorite = !next; // revert
			favoriteError = e instanceof Error ? e.message : 'Favorite toggle failed';
			// snap optimistic state back so the next render reflects reality
			pendingFavorite = null;
		}
	}
</script>

<svelte:head><title>Reliquary — {data.work.title}</title></svelte:head>

<main>
	<p class="back"><a href="/">← Library</a></p>
	<div class="detail-header">
		<div class="cover-slot" aria-hidden="true">
			<span class="cover-glyph">{glyph}</span>
		</div>
		<div class="detail-header-text">
			<div class="title-row">
				<h1>{data.work.title}</h1>
				{#if data.work.has_history}
					<a class="history-button" href="/works/{data.work.id}/history" title="View chapter edit history">
						<span aria-hidden="true">📜</span> History
					</a>
				{/if}
				<button
					class="heart"
					class:filled={isFavorite}
					onclick={toggleFavorite}
					aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
					aria-pressed={isFavorite}
				>
					<Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
				</button>
			</div>
			<p class="author">by {data.work.author}</p>
		</div>
	</div>
	{#if favoriteError}
		<p class="error">{favoriteError}</p>
	{/if}
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
				{#if ch.last_edited_at}
					<span class="edited-pill" title="This chapter has archived earlier versions">
						author edited · {shortDate(ch.last_edited_at)}
					</span>
				{/if}
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
		color: var(--reader-muted);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	/* Header lays out the cover slot to the left of the title block. The
	   cover is the same 140×200 placeholder used on the library page;
	   v1.5 will swap in real cover art across both surfaces. */
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}
	.detail-header-text {
		flex: 1 1 auto;
		min-width: 0;
	}
	.cover-slot {
		flex: 0 0 140px;
		width: 140px;
		height: 200px;
		background: var(--reader-cover-placeholder);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.cover-glyph {
		font-family: Georgia, serif;
		font-size: 56px;
		line-height: 1;
		color: var(--reader-muted);
		opacity: 0.55;
		user-select: none;
	}
	.title-row {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	/* 📜 History button — sits between the title and the heart, themed
	   like the other detail-page chrome. Only rendered when the work has
	   archived chapter versions (Part 2). */
	.history-button {
		flex: 0 0 auto;
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		text-decoration: none;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.history-button:hover {
		border-color: var(--reader-accent);
	}
	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.25rem;
		flex: 1 1 auto;
	}
	/* Heart-button rendering. The shape comes from lucide-svelte's
	   <Heart /> SVG — outline by default, fill="currentColor" when
	   favorited. So `color` drives both the stroke and the fill, and
	   only the SVG's `fill` attribute distinguishes states (same path,
	   identical proportions). The button chrome itself stays the same
	   38px circle with a 1px border. */
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
		transition:
			color 80ms ease,
			border-color 80ms ease,
			background 80ms ease;
	}
	.heart:hover {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
		border-color: var(--reader-heart);
	}
	.author {
		color: var(--reader-muted);
		margin-top: 0;
	}
	.error {
		color: #b00;
		font-size: 0.9rem;
		margin: 0.25rem 0 0;
	}
	.continue {
		margin: 1rem 0 0;
	}
	/* Inverted theme colors — `--reader-fg` for the bg + `--reader-bg`
	   for the text gives a high-contrast button regardless of which
	   reader theme is active. The detail page itself stays neutral
	   (system fonts / colors); only this CTA reflects the theme. */
	.continue-button {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		background: var(--reader-fg);
		color: var(--reader-bg);
		border-radius: 4px;
		text-decoration: none;
		font-size: 0.95rem;
		font-weight: 500;
	}
	.continue-button:hover {
		background: var(--reader-accent);
	}
	.summary {
		background: var(--reader-card-bg);
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin: 1rem 0;
	}
	.summary :global(p) {
		margin: 0.5rem 0;
	}
	/* Tag links inside the rendered AO3 summary HTML — picked up the
	   same theming as chapter-page links so they don't fall back to
	   the unreadable browser-default blue on dark theme. */
	.summary :global(a) {
		color: var(--reader-link);
	}
	.summary :global(a:visited) {
		color: var(--reader-link-visited);
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
	/* "author edited · <date>" pill — surfaces that a chapter has archived
	   prior versions (Part 2). Muted so it doesn't compete with the title. */
	.edited-pill {
		margin-left: 0.5rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--reader-card-bg);
		color: var(--reader-muted);
		font-size: 0.72rem;
		white-space: nowrap;
		vertical-align: middle;
	}
	.wrapper-link {
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}
	.wrapper-link a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.wrapper-link a:hover {
		text-decoration: underline;
	}
</style>
