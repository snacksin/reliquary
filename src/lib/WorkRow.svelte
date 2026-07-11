<script lang="ts">
	import { Heart, Star } from 'lucide-svelte';
	import { summaryText, notePreview } from '$lib/rowText';
	import { authorDisplay, type Work } from '$lib/api';

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
	// Plain-text row content (Follow-up B). Both stripped to text (SSR-safe),
	// never {@html}. The summary shows in FULL (paragraph breaks preserved); the
	// note is a truncated + CSS-clamped snippet (full note lives on the detail).
	const summaryFull = $derived(summaryText(work.summary));
	const noteSnippet = $derived(notePreview(work.note));
	// Personal tags (you-layer Private tags). Optional on Work — leaner feeds
	// (series rows) don't project them, so those rows simply show no chips.
	const personalTags = $derived(work.personal_tags ?? []);
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
			{#if work.read_at}
				<span class="read-badge">Read</span>
			{/if}
		</strong>
		<!-- Author Identity Part A: AO3-style "pseud (account)" byline text.
	     Unpseuded / non-AO3 / multi-author render byte-identical to today
	     (authorDisplay falls back to the raw works.author). Text only — the
	     whole row is already one <a> to the work, so no nested anchor. -->
	<span class="meta">{showAuthor ? `by ${authorDisplay(work)} · ` : ''}{chapterLabel}</span>
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
		{#if personalTags.length > 0}
			<ul class="my-tags" aria-label="Your tags">
				{#each personalTags as tag (tag.id)}
					<li class="my-tag">{tag.name}</li>
				{/each}
			</ul>
		{/if}
		{#if summaryFull}
			<p class="row-summary">{summaryFull}</p>
		{/if}
		{#if noteSnippet}
			<div class="row-note">
				<span class="row-note-label">Note</span>
				<span class="row-note-text">{noteSnippet}</span>
			</div>
		{/if}
	</div>
</a>

<style>
	.library-row {
		display: flex;
		/* Top-align so titles line up down the list now that rows can carry a
		   summary preview + note block of varying height (Follow-up B). */
		align-items: flex-start;
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
		margin-top: 0.25rem;
	}
	/* Read-only star rating on a library row (you-layer). Only rendered when
	   the work is rated, so unrated rows stay clean. Stars inherit the theme
	   via the per-icon color/fill props above. */
	.row-rating {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		margin-top: 0.35rem;
	}
	/* Personal-tag chips (you-layer Private tags) — deliberately distinct from
	   anything AO3: small accent-bordered/tinted pills so they read as YOURS
	   (AO3 tags never render on rows at all). color-mix keeps the tint
	   theme-aware in light/dark/sepia. */
	.my-tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 0;
		margin: 0.45rem 0 0;
	}
	.my-tag {
		font-size: 0.72rem;
		line-height: 1.3;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--reader-accent);
		background: color-mix(in srgb, var(--reader-accent) 12%, transparent);
		color: var(--reader-fg);
		word-break: break-word;
	}

	/* Summary (Follow-up B, review) — the FULL summary, plain text (HTML
	   stripped), muted. `pre-line` honors the paragraph/line breaks that
	   summaryText() converts from block/<br> boundaries, so a multi-paragraph
	   summary reads with structure instead of as a run-on blob. Roomy
	   line-height so it's not cramped. */
	.row-summary {
		margin: 0.45rem 0 0;
		color: var(--reader-muted);
		font-size: 0.85rem;
		line-height: 1.55;
		white-space: pre-line;
	}
	/* Personal note on the row — AO3-bookmark-note style: a distinct bordered,
	   card-tinted block. Plain-text snippet (markdown NOT rendered here; the
	   detail page renders it), clamped to three lines. */
	.row-note {
		margin-top: 0.65rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
	}
	.row-note-label {
		display: block;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin-bottom: 0.1rem;
	}
	.row-note-text {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--reader-fg);
		font-size: 0.85rem;
		line-height: 1.5;
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
	/* Manual "Read" mark badge (you-layer, #66) — a subtle, theme-aware pill next
	   to the title on read fics. Reset font-weight (it sits inside the bold
	   title) so it reads as a quiet marker, not part of the title. Keys off the
	   manual read_at flag, independent of Continue-Reading finished state. */
	.read-badge {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 1px 6px;
		border: 1px solid var(--reader-border);
		border-radius: 999px;
		background: var(--reader-card-bg);
		color: var(--reader-muted);
		font-size: 0.62rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		vertical-align: middle;
	}
</style>
