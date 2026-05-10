<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { uploadEpub, removeProgress, type Work } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let errorMessage: string | null = $state(null);

	// Continue Reading: most-recently-read first. /api/works orders by
	// upload date (ingested_at DESC), which would surface freshly
	// uploaded fics regardless of when their reading happened — wrong
	// for a "Continue Reading" carousel. Re-sort the read subset by
	// last_read.updated_at DESC, symmetric to how Favorites sorts by
	// favorited_at DESC.
	const continueReading = $derived(
		data.works
			.filter((w) => w.last_read)
			.toSorted((a, b) =>
				(b.last_read?.updated_at ?? '').localeCompare(a.last_read?.updated_at ?? '')
			)
	);
	// Favorites carousel: most-recently-favorited first. /api/works
	// orders by ingested_at; we re-sort the favorited subset here.
	const favorites = $derived(
		data.works
			.filter((w) => w.is_favorite && w.favorited_at)
			.toSorted((a, b) => (b.favorited_at ?? '').localeCompare(a.favorited_at ?? ''))
	);

	function progressPercent(w: Work): number {
		if (!w.last_read || w.chapter_count <= 0) return 0;
		return Math.min(100, Math.round((w.last_read.chapter / w.chapter_count) * 100));
	}

	// Cover-slot placeholder glyph: first letter of the title, uppercased.
	// Real cover-art extraction is v1.5; until then this gives the slot
	// some character so it doesn't read as a broken image.
	function glyph(w: Work): string {
		return w.title?.[0]?.toUpperCase() ?? '?';
	}

	/**
	 * One-shots (chapter_count === 1) would always show "100% through"
	 * the moment the user clicks them, which is misleading. Use a
	 * neutral progress label for them instead.
	 */
	function progressLabel(w: Work): string {
		if (!w.last_read) return '';
		if (w.chapter_count === 1) return 'In progress';
		return `Chapter ${w.last_read.chapter} · ${progressPercent(w)}% through`;
	}

	/**
	 * Continue Reading carousel: always resume — the carousel only
	 * exists for works with `last_read`, and the user clicked the CR
	 * card *because* they want to pick up where they left off.
	 */
	function continueHref(w: Work): string {
		return `/works/${w.id}/ch/${w.last_read!.chapter}?continue=1`;
	}

	async function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		uploading = true;
		errorMessage = null;
		try {
			await uploadEpub(file, fetch);
			await invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			uploading = false;
			target.value = '';
		}
	}

	async function handleRemove(workId: string) {
		try {
			await removeProgress(workId, fetch);
			await invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Remove failed';
		}
	}
</script>

<svelte:head><title>Reliquary (POC)</title></svelte:head>

<main>
	<h1>Reliquary (POC)</h1>

	<button onclick={() => fileInput?.click()} disabled={uploading}>
		{uploading ? 'Uploading…' : 'Upload EPUB'}
	</button>
	<input
		bind:this={fileInput}
		type="file"
		accept=".epub,application/epub+zip"
		hidden
		onchange={handleFileChange}
	/>

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	{#if continueReading.length > 0}
		<section class="continue-reading">
			<h2>Continue Reading</h2>
			<div class="carousel">
				{#each continueReading as work (work.id)}
					<article class="cr-card">
						<a href={continueHref(work)} class="cr-card-link">
							<div class="cover-slot" aria-hidden="true">
								<span class="cover-glyph">{glyph(work)}</span>
							</div>
							<strong>{work.title}</strong>
							<span class="cr-meta">{progressLabel(work)}</span>
						</a>
						<button
							class="remove"
							onclick={() => handleRemove(work.id)}
							aria-label="Remove from Continue Reading"
						>
							×
						</button>
					</article>
				{/each}
			</div>
		</section>
	{/if}

	{#if favorites.length > 0}
		<section class="favorites">
			<h2>Favorites</h2>
			<div class="carousel">
				{#each favorites as work (work.id)}
					<article class="cr-card">
						<a href="/works/{work.id}" class="cr-card-link">
							<div class="cover-slot" aria-hidden="true">
								<span class="cover-glyph">{glyph(work)}</span>
							</div>
							<strong>{work.title}</strong>
							<span class="cr-meta">by {work.author}</span>
						</a>
					</article>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.works.length === 0}
		<p class="empty">No works yet — upload an EPUB to get started.</p>
	{:else}
		<section class="full-library">
			{#if continueReading.length > 0 || favorites.length > 0}<h2>Library</h2>{/if}
			<ul class="works">
				{#each data.works as work (work.id)}
					<li>
						<a href="/works/{work.id}" class="library-row">
							<div class="cover-slot" aria-hidden="true">
								<span class="cover-glyph">{glyph(work)}</span>
							</div>
							<div class="library-row-text">
								<strong>
									{work.title}
									{#if work.is_favorite}<span
											class="fav-indicator"
											aria-label="Favorited">♥</span
										>{/if}
								</strong>
								<span class="meta"
									>by {work.author} · {work.chapter_count} chapter{work.chapter_count === 1
										? ''
										: 's'}</span
								>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	h1 {
		font-size: 1.6rem;
		margin-bottom: 1rem;
	}
	button {
		padding: 0.4rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	button[disabled] {
		opacity: 0.6;
		cursor: progress;
	}
	.error {
		color: #b00;
		margin-top: 0.5rem;
	}
	.empty {
		color: var(--reader-muted);
		margin-top: 1.5rem;
	}

	section {
		margin: 1.75rem 0;
	}
	section h2 {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.75rem;
	}

	/* Continue Reading carousel */
	.carousel {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		scrollbar-width: thin;
	}
	.cr-card {
		flex: 0 0 140px;
		position: relative;
	}
	.cr-card-link {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.cr-card-link:hover strong {
		text-decoration: underline;
	}
	/* Cover-art placeholder. Shared by carousels (Continue Reading,
	   Favorites) and the full library list. v1.5 swaps the gray box for
	   real cover art; the glyph below is the M1 placeholder so the slot
	   doesn't read as a broken image. */
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
	/* Carousel cards stack vertically (cover above title), so the cover
	   needs bottom space. The library list lays out horizontally and
	   handles spacing via flex `gap`. */
	.cr-card .cover-slot {
		margin-bottom: 8px;
	}
	.cover-glyph {
		font-family: Georgia, serif;
		font-size: 56px;
		line-height: 1;
		color: var(--reader-muted);
		opacity: 0.55;
		user-select: none;
	}
	.cr-card strong {
		font-size: 0.95rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.cr-meta {
		display: block;
		font-size: 0.8rem;
		color: var(--reader-muted);
		margin-top: 4px;
	}
	.cr-card .remove {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--reader-bg);
		color: var(--reader-muted);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	}
	.cr-card .remove:hover {
		background: var(--reader-card-bg);
		color: #c43c4f;
	}

	/* Full library list */
	ul.works {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	ul.works li {
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--reader-border);
	}
	.library-row {
		display: flex;
		align-items: center;
		gap: 14px;
		color: inherit;
		text-decoration: none;
	}
	.library-row-text {
		flex: 1 1 auto;
		min-width: 0;
	}
	.library-row:hover strong {
		text-decoration: underline;
	}
	.meta {
		display: block;
		color: var(--reader-muted);
		font-size: 0.9rem;
		margin-top: 0.15rem;
	}
	.fav-indicator {
		color: #c43c4f;
		margin-left: 0.4rem;
		font-size: 0.85em;
	}
</style>
