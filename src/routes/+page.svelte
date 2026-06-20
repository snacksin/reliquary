<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { uploadEpub, removeProgress, type Work } from '$lib/api';
	import BulkUploadButton from '$lib/BulkUploadButton.svelte';
	import FilterSidebar from '$lib/FilterSidebar.svelte';
	import Pagination from '$lib/Pagination.svelte';
	import SearchInput from '$lib/SearchInput.svelte';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	const PER_PAGE_OPTIONS = [10, 12, 15] as const;
	const PER_PAGE_DEFAULT = 12;
	const PER_PAGE_STORAGE_KEY = 'prefs:library:per_page';

	let { data }: PageProps = $props();
	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let errorMessage: string | null = $state(null);
	// M2.3 Step 3: a neutral (non-error) notice for dedup outcomes —
	// "already in library" / "library copy is newer" / "updated with new
	// chapters" — with an optional link to the affected work.
	let uploadNotice: { text: string; href?: string } | null = $state(null);

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
		uploadNotice = null;
		try {
			const result = await uploadEpub(file, fetch);
			// Distinct, friendly messaging per dedup outcome. `created` is
			// silent — the fic simply appears in the list (unchanged UX).
			const trashSuffix = 'restored' in result && result.restored ? ' — restored from Trash' : '';
			if (result.status === 'updated') {
				uploadNotice = {
					text: `Updated “${result.title}” with new chapters.`,
					href: `/works/${result.work_id}`
				};
			} else if (result.status === 'duplicate') {
				uploadNotice = {
					text: `“${result.title}” is already in your library${trashSuffix}.`,
					href: `/works/${result.work_id}`
				};
			} else if (result.status === 'stale') {
				uploadNotice = {
					text: `Your library copy of “${result.title}” is newer (${result.existingChapters} chapters vs ${result.incomingChapters}) — keeping it${trashSuffix}.`,
					href: `/works/${result.work_id}`
				};
			}
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

	/**
	 * Per-page picker. The URL is the runtime source of truth (so SSR
	 * renders the right slice and bookmarks are exact); localStorage
	 * records the user's most recent choice so a fresh visit to a bare
	 * URL gets auto-aligned to their preference.
	 *
	 * On change, the picker writes both stores and resets `page` to 1
	 * (a larger page size at a deep page index could leave the URL
	 * past the new total — server clamps, but starting at page 1 is
	 * the predictable UX). On initial mount, if the URL has no
	 * `per_page` and the user's stored preference is non-default, we
	 * silently `replaceState` to add the param. Brief flash from
	 * default-12 to stored-15 is acceptable at single-user scale.
	 */
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

	let perPageSyncDone = $state(false);
	$effect(() => {
		if (typeof window === 'undefined' || perPageSyncDone) return;
		perPageSyncDone = true;
		const urlPerPage = pageState.url.searchParams.get('per_page');
		if (urlPerPage) return; // URL wins — already aligned
		const stored = localStorage.getItem(PER_PAGE_STORAGE_KEY);
		if (!stored) return;
		const n = Number.parseInt(stored, 10);
		if (!PER_PAGE_OPTIONS.includes(n as (typeof PER_PAGE_OPTIONS)[number])) return;
		if (n === PER_PAGE_DEFAULT) return;
		const params = new URLSearchParams(pageState.url.searchParams);
		params.set('per_page', String(n));
		goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
	});
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
		<BulkUploadButton />
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
		{#if uploadNotice}
			<p class="notice">
				{uploadNotice.text}
				{#if uploadNotice.href}
					<a href={uploadNotice.href}>View</a>
				{/if}
				<button
					type="button"
					class="notice-dismiss"
					onclick={() => (uploadNotice = null)}
					aria-label="Dismiss"
				>
					×
				</button>
			</p>
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
								<div class="side-cover" aria-hidden="true">
									<span class="side-cover-glyph">{glyph(work)}</span>
								</div>
								<div class="side-card-text">
									<strong>{work.title}</strong>
									<span class="side-meta">{progressLabel(work)}</span>
								</div>
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
								<div class="side-cover" aria-hidden="true">
									<span class="side-cover-glyph">{glyph(work)}</span>
								</div>
								<div class="side-card-text">
									<strong>{work.title}</strong>
									<span class="side-meta">by {work.author}</span>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</aside>

	<section class="middle-col" aria-label="Library">
		<header class="middle-header">
			<h2 class="middle-heading">
				Library
				{#if data.works.length > 0}
					<span class="middle-count">
						{#if data.selectedTagIds.length > 0 || data.q.trim().length > 0}
							{data.filteredPage.total} of {data.works.length} work{data.works.length === 1
								? ''
								: 's'}
						{:else}
							{data.filteredPage.total} work{data.filteredPage.total === 1 ? '' : 's'}
						{/if}
					</span>
				{/if}
			</h2>
			{#if data.filteredPage.total > 0}
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
		{#if data.works.length === 0}
			<p class="empty">No works yet — upload an EPUB to get started.</p>
		{:else if data.filteredPage.total === 0}
			<p class="empty">
				{#if data.q.trim().length > 0 && data.selectedTagIds.length > 0}
					No works match your search and filters.
				{:else if data.q.trim().length > 0}
					No works match your search.
				{:else}
					No works match the current filters.
				{/if}
			</p>
		{:else}
			<ul class="works">
				{#each data.filteredPage.works as work (work.id)}
					<li>
						<a href="/works/{work.id}" class="library-row">
							<div class="cover-slot" aria-hidden="true">
								<span class="cover-glyph">{glyph(work)}</span>
							</div>
							<div class="library-row-text">
								<strong>
									{work.title}
									{#if work.is_favorite}
										<Heart
											class="fav-indicator"
											size={14}
											fill="currentColor"
											aria-label="Favorited"
										/>
									{/if}
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
		/* Flex so the single + bulk upload buttons sit side-by-side
		   with a small gap, and the progress / summary lines from
		   BulkUploadButton (which are full-width grid-column children)
		   wrap onto their own row below. */
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.library-header h1 {
		font-size: 1.6rem;
		margin: 0 0.75rem 0 0;
		/* Title takes a whole row above the buttons. */
		flex-basis: 100%;
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
		flex-basis: 100%;
		color: #b00;
		margin: 0.5rem 0 0;
	}
	/* Neutral dedup notice (already-in-library / newer / updated), distinct
	   from the red .error. Full-width row inside the flex header. */
	.notice {
		flex-basis: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.5rem 0 0;
		padding: 0.4rem 0.7rem;
		background: var(--reader-card-bg);
		border-radius: 4px;
		font-size: 0.9rem;
		color: var(--reader-fg);
	}
	.notice a {
		color: var(--reader-link);
	}
	.notice-dismiss {
		margin-left: auto;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.6;
	}
	.notice-dismiss:hover,
	.notice-dismiss:focus-visible {
		opacity: 1;
		color: var(--reader-heart);
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
		margin: 0;
	}
	.middle-count {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.85em;
	}
	/* Middle column header bar: title + count on the left, per-page
	   picker on the right. The picker only renders when the filter
	   result is non-empty — it'd be inert on a 0-results page. */
	.middle-header {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin: 0 0 0.75rem;
	}
	.middle-header .middle-heading {
		flex: 1 1 auto;
		margin: 0;
	}
	.per-page-picker {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		flex: 0 0 auto;
	}
	.per-page-picker select {
		font: inherit;
		text-transform: none;
		letter-spacing: normal;
		padding: 2px 4px;
		border: 1px solid var(--reader-border);
		border-radius: 3px;
		background: transparent;
		color: var(--reader-fg);
		cursor: pointer;
	}

	/* Left-column compact rows: small cover thumbnail (60×90) on the
	   left, title + meta column on the right. Matches DESIGN.md §7's
	   canonical wireframe — Continue Reading + Favorites are scanned
	   quickly, not browsed visually, so they get a denser shape than
	   the middle column's full library rows. */
	.side-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		/* Internal scrolling per the §7 spec: each sidebar section
		   caps its own height and scrolls within. Keeps the rest of
		   the page (full library, right column) from sliding off
		   screen when a user has 10+ in-progress fics. */
		max-height: 40vh;
		overflow-y: auto;
		scrollbar-width: thin;
		/* Inner padding so the absolutely-positioned × button on each
		   row doesn't touch the scrollbar. */
		padding-right: 4px;
	}
	.side-card {
		position: relative;
	}
	.side-card-link {
		display: flex;
		gap: 10px;
		color: inherit;
		text-decoration: none;
		/* Leave a little gutter for the absolutely-positioned remove
		   button so its hover/focus state never overlaps the title. */
		padding-right: 18px;
	}
	.side-card-link:hover strong {
		text-decoration: underline;
	}
	.side-card-text {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.side-card strong {
		font-size: 0.9rem;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.side-meta {
		display: block;
		font-size: 0.75rem;
		color: var(--reader-muted);
		margin-top: 3px;
	}

	/* Compact 60×90 thumbnail for the sidebar rows — same theme variable
	   as the middle-column cover slot, smaller dimensions, smaller glyph. */
	.side-cover {
		flex: 0 0 60px;
		width: 60px;
		height: 90px;
		background: var(--reader-cover-placeholder);
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.side-cover-glyph {
		font-family: Georgia, serif;
		font-size: 26px;
		line-height: 1;
		color: var(--reader-muted);
		opacity: 0.55;
		user-select: none;
	}

	/* Remove (×) button on Continue Reading rows. Theme-aware muted
	   color so it reads on Paper / Sepia / Dark equally; low default
	   opacity so it doesn't compete with the title, climbs to full on
	   hover/focus so it's discoverable. */
	.side-card .remove {
		position: absolute;
		top: 0;
		right: 0;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.5;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity 100ms ease;
	}
	.side-card .remove:hover,
	.side-card .remove:focus-visible {
		opacity: 1;
		color: var(--reader-heart);
	}

	/* Middle-column cover slot — unchanged 140×200 placeholder. */
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
	/* Favorited indicator in the middle-column library list. lucide-svelte
	   forwards `class` onto the SVG root, so this rule styles the icon
	   directly. Vertical alignment nudges it onto the title baseline. */
	:global(.fav-indicator) {
		color: var(--reader-heart);
		margin-left: 0.4rem;
		vertical-align: -2px;
	}

	/* Right column hosts the FilterSidebar component (Step 5). Top
	   padding clears the fixed hamburger button at top:16, right:16
	   on desktop; dropped at narrow viewports where the hamburger
	   doesn't share horizontal space with this column. */
	.right-col {
		padding-top: 56px;
	}

	/* Narrow viewport: collapse to a single column.
	   Order is left → right → middle, NOT document order:
	     - Continue Reading + Favorites (left) at the top
	     - Filter sidebar (right) before the library list
	     - Full library (middle) last
	   Reasoning: filters are tools that apply to the results below.
	   Putting them AFTER the results means a phone user has to scroll
	   past the entire library to reach the filters that would shrink
	   it. The right-before-middle order makes filters discoverable
	   without breaking the desktop layout. This supersedes Step 4's
	   stacked-document-order decision. */
	@media (max-width: 900px) {
		.library {
			grid-template-columns: 1fr;
			grid-template-areas:
				'header'
				'left'
				'right'
				'middle';
			gap: 1.25rem;
		}
		.right-col {
			padding-top: 0;
		}
	}
</style>
