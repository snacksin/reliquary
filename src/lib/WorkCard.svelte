<script lang="ts">
	import { authorDisplay, coverUrl, type Work } from '$lib/api';

	/**
	 * One tile in the library's grid view (Cover Art Part B — Allie's
	 * mockup pick, "Variant B"): the 2:3 cover (or the same initial-glyph
	 * placeholder the list rows use) with title + author byline beneath.
	 * The whole card is one link to the work's detail page — identical
	 * click semantics to a row title. Presentation only: it renders the
	 * exact same projected Work rows the list does.
	 */
	let { work }: { work: Work } = $props();

	const glyph = $derived(work.title?.[0]?.toUpperCase() ?? '?');
</script>

<a href="/works/{work.id}" class="work-card">
	<div class="card-cover" aria-hidden="true">
		{#if work.has_cover}
			<img class="card-cover-img" src={coverUrl(work)} alt="" loading="lazy" />
		{:else}
			<span class="card-glyph">{glyph}</span>
		{/if}
	</div>
	<span class="card-title">{work.title}</span>
	<span class="card-author">by {authorDisplay(work)}</span>
</a>

<style>
	.work-card {
		display: flex;
		flex-direction: column;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}
	.work-card:hover .card-title {
		text-decoration: underline;
	}
	.card-cover {
		aspect-ratio: 2 / 3;
		border-radius: 4px;
		background: var(--reader-cover-placeholder);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.card-cover-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.card-glyph {
		font-family: Georgia, serif;
		font-size: 2.4rem;
		line-height: 1;
		color: var(--reader-muted);
		opacity: 0.55;
		user-select: none;
	}
	.card-title {
		margin-top: 7px;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}
	.card-author {
		margin-top: 2px;
		font-size: 0.72rem;
		color: var(--reader-muted);
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}
</style>
