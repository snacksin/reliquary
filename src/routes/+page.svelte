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
	// for a "Continue Reading" list. Re-sort the read subset by
	// last_read.updated_at DESC, symmetric to how Favorites sorts by
	// favorited_at DESC.
	const continueReading = $derived(
		data.works
			.filter((w) => w.last_read)
			.toSorted((a, b) =>
				(b.last_read?.updated_at ?? '').localeCompare(a.last_read?.updated_at ?? '')
			)
	);
	// Favorites list: most-recently-favorited first.
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
		return `Ch ${w.last_read.chapter} · ${progressPercent(w)}%`;
	}

	/**
	 * Continue Reading entry click: always resume — the section only
	 * exists for works with `last_read`, and the user clicked it
	 * *because* they want to pick up where they left off.
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

<main class="library">
	<header class="library-header">
		<h1>Reliquary (POC)</h1>
		<button class="upload" onclick={() => fileInput?.click()} disabled={uploading}>
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
	</header>

	<aside class="left-col" aria-label="Reading lists">
		{#if continueReading.length > 0}
			<section class="side-section">
				<h2>Continue Reading</h2>
				<ul class="side-list">
					{#each continueReading as work (work.id)}
						<li class="side-card">
							<a href={continueHref(work)} class="side-card-link">
								<div class="cover-slot" aria-hidden="true">
									<span class="cover-glyph">{glyph(work)}</span>
								</div>
								<strong>{work.title}</strong>
								<span class="side-meta">{progressLabel(work)}</span>
							</a>
							<button
								class="remove"
								onclick={() => handleRemove(work.id)}
								aria-label="Remove from Continue Reading"
							>
								×
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if favorites.length > 0}
			<section class="side-section">
				<h2>Favorites</h2>
				<ul class="side-list">
					{#each favorites as work (work.id)}
						<li class="side-card">
							<a href="/works/{work.id}" class="side-card-link">
								<div class="cover-slot" aria-hidden="true">
									<span class="cover-glyph">{glyph(work)}</span>
								</div>
								<strong>{work.title}</strong>
								<span class="side-meta">by {work.author}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</aside>

	<section class="middle-col" aria-label="Library">
		<h2 class="middle-heading">
			Library
			{#if data.works.length > 0}
				<span class="middle-count">{data.works.length} work{data.works.length === 1 ? '' : 's'}</span>
			{/if}
		</h2>
		{#if data.works.length === 0}
			<p class="empty">No works yet — upload an EPUB to get started.</p>
		{:else}
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
		{/if}
	</section>

	<aside class="right-col" aria-label="Search and filters">
		<!--
			Right-column placeholder. Step 5 (tag-filter sidebar) renders
			here above the search box from Step 7. The placeholder is
			intentional foreshadowing so the layout doesn't shift when
			filters land — keep the same grid track width.
		-->
		<section class="side-section right-placeholder">
			<h2>Filters</h2>
			<p class="placeholder-hint">Search and tag filters coming soon.</p>
		</section>
	</aside>
</main>

<style>
	/*
	 * Three-column library layout per DESIGN.md §7 canonical wireframe.
	 *
	 * Grid template:
	 *   [header spans all 3]
	 *   [left 200px] [middle 1fr] [right 240px]
	 *
	 * Narrow-viewport behavior (<900px): collapse to a single column,
	 * sections stack in document order. Chosen over a drawer pattern
	 * because the right column is an empty placeholder for M2.1 Step 4 —
	 * a drawer toggle for empty content is more annoying than a scroll-
	 * past-it stack. Steps 5/7 may revisit this once the right column
	 * has real content the user might want to hide.
	 */
	.library {
		max-width: 1280px;
		margin: 2rem auto;
		padding: 0 1.25rem;
		font-family: system-ui, sans-serif;
		display: grid;
		grid-template-columns: 200px 1fr 240px;
		grid-template-areas:
			'header header header'
			'left   middle right';
		gap: 1.5rem 1.75rem;
	}

	.library-header {
		grid-area: header;
		/* Right-pad past the fixed hamburger button (40px wide + 16px
		   right edge + a bit of breathing room) so the upload button
		   never sits under it. */
		padding-right: 72px;
	}
	.library-header h1 {
		font-size: 1.6rem;
		margin: 0 0 0.75rem;
	}
	.library-header .upload {
		padding: 0.4rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	.library-header .upload[disabled] {
		opacity: 0.6;
		cursor: progress;
	}
	.error {
		color: #b00;
		margin: 0.5rem 0 0;
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

	/*
	 * Section header style shared between the sidebars and the middle
	 * column heading. Small uppercase muted label; the same shape as
	 * the M1 carousel headings so the visual rhythm carries over.
	 */
	.side-section {
		margin-bottom: 1.5rem;
	}
	.side-section > h2,
	.middle-heading {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.75rem;
	}
	.middle-heading {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.middle-count {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.85em;
	}

	/* Left-column compact cards: cover on top, title + meta below.
	   Same visual language as the M1 carousel card, just stacked
	   vertically in a list. */
	.side-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.side-card {
		position: relative;
	}
	.side-card-link {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.side-card-link:hover strong {
		text-decoration: underline;
	}
	.side-card strong {
		font-size: 0.95rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.side-meta {
		display: block;
		font-size: 0.8rem;
		color: var(--reader-muted);
		margin-top: 4px;
	}
	.side-card .remove {
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
	.side-card .remove:hover {
		background: var(--reader-card-bg);
		color: #c43c4f;
	}

	/* Cover-slot placeholder. Shared by the left-column compact cards
	   and the middle-column library rows. v1.5 swaps the gray box for
	   real cover art; the glyph is the M1 placeholder so the slot
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
	/* Vertical stacking in the left-column cards: cover sits above
	   the title, with a small gap. Middle-column rows lay out
	   horizontally and handle spacing via flex `gap`. */
	.side-card-link .cover-slot {
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

	/* Middle-column library list — unchanged from M1 Step 9. */
	.empty {
		color: var(--reader-muted);
	}
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

	/* Right-column placeholder. Sized to keep the grid track width
	   stable for when Step 5 + 7 populate it. */
	.right-placeholder {
		/* Top padding clears the fixed hamburger button at top:16, right:16. */
		padding-top: 56px;
	}
	.placeholder-hint {
		font-size: 0.85rem;
		color: var(--reader-muted);
		margin: 0;
	}

	/* Narrow viewport: stack the three areas top-to-bottom in document
	   order (left → middle → right). Drops the sidebar track widths
	   so each section uses the full content width. Hamburger stays
	   fixed top-right and remains accessible. */
	@media (max-width: 900px) {
		.library {
			grid-template-columns: 1fr;
			grid-template-areas:
				'header'
				'left'
				'middle'
				'right';
			gap: 1.25rem;
		}
		.right-placeholder {
			padding-top: 0;
		}
	}
</style>
