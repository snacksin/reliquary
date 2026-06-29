<script lang="ts">
	import { Heart, Star } from 'lucide-svelte';
	import type { Work } from '$lib/api';

	/**
	 * One work row in a library-style list (library middle column +
	 * author-detail middle column). Extracted so both share one markup
	 * source. `showAuthor` keeps the "by {author}" prefix on the meta
	 * line (library); the author-detail page omits it (redundant there).
	 *
	 * `part` adds a "Part N" label inline on the left, adjacent to the cover
	 * (series-detail page only). Leave it `undefined` (the default) and no
	 * part column renders at all — so the library/author rows are unchanged.
	 * `null` reserves the column but renders blank, so covers stay aligned
	 * down a series whose positions are sparse (some parts unnumbered).
	 */
	let {
		work,
		showAuthor = false,
		part
	}: { work: Work; showAuthor?: boolean; part?: number | null } = $props();

	const glyph = $derived(work.title?.[0]?.toUpperCase() ?? '?');
	const chapterLabel = $derived(
		`${work.chapter_count} chapter${work.chapter_count === 1 ? '' : 's'}`
	);
</script>

<a href="/works/{work.id}" class="library-row">
	{#if part !== undefined}
		<span class="part-label"
			>{#if part !== null}Part {part}{/if}</span
		>
	{/if}
	<div class="cover-slot" aria-hidden="true">
		<span class="cover-glyph">{glyph}</span>
	</div>
	<div class="library-row-text">
		<strong>
			{work.title}
			{#if work.is_favorite}
				<Heart class="fav-indicator" size={14} fill="currentColor" aria-label="Favorited" />
			{/if}
		</strong>
		<span class="meta">{showAuthor ? `by ${work.author} · ` : ''}{chapterLabel}</span>
		{#if work.rating}
			<span class="row-rating" aria-label="Your rating: {work.rating} of 5 stars">
				{#each [1, 2, 3, 4, 5] as n (n)}
					<Star
						size={13}
						color={n <= work.rating ? 'var(--reader-accent)' : 'var(--reader-muted)'}
						fill={n <= work.rating ? 'var(--reader-accent)' : 'none'}
						aria-hidden="true"
					/>
				{/each}
			</span>
		{/if}
	</div>
</a>

<style>
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
	/* "Part N" label (series-detail page). Fixed min-width + right-aligned so
	   single- and double-digit positions line up and the covers below stay
	   flush down the list. Theme-aware muted; tabular figures keep the
	   numbers in a tidy column. */
	.part-label {
		flex: 0 0 auto;
		min-width: 3.75em;
		text-align: right;
		color: var(--reader-muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
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
	/* Read-only star rating on a library row (you-layer). Only rendered when
	   the work is rated, so unrated rows stay clean. Stars inherit the theme
	   via the per-icon color/fill props above. */
	.row-rating {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		margin-top: 0.25rem;
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
	/* lucide-svelte forwards `class` onto the SVG root, so this styles the
	   favorited indicator directly. */
	:global(.fav-indicator) {
		color: var(--reader-heart);
		margin-left: 0.4rem;
		vertical-align: -2px;
	}
</style>
