<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { favoriteAuthor, unfavoriteAuthor, type Author } from '$lib/api';
	import { Heart } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const authors = $derived(data.authors);
	const favorites = $derived(authors.filter((a) => a.is_favorite));

	let actionError = $state<string | null>(null);
	let busy = $state<string | null>(null);

	async function toggleFavorite(author: Author) {
		actionError = null;
		busy = author.name;
		try {
			if (author.is_favorite) await unfavoriteAuthor(author.name, fetch);
			else await favoriteAuthor(author.name, fetch);
			await invalidateAll();
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Could not update favorite';
		} finally {
			busy = null;
		}
	}

	function countLabel(n: number): string {
		return `${n} work${n === 1 ? '' : 's'}`;
	}
</script>

<svelte:head><title>Reliquary — Authors</title></svelte:head>

{#snippet authorCard(author: Author)}
	<div class="author-card" class:busy={busy === author.name}>
		<a class="author-link" href="/authors/{encodeURIComponent(author.name)}">
			<span class="author-name">{author.name}</span>
			<span class="author-count">{countLabel(author.work_count)}</span>
		</a>
		<button
			type="button"
			class="heart"
			class:filled={author.is_favorite}
			onclick={() => toggleFavorite(author)}
			disabled={busy === author.name}
			aria-label={author.is_favorite ? `Unfavorite ${author.name}` : `Favorite ${author.name}`}
			aria-pressed={author.is_favorite}
		>
			<Heart size={16} fill={author.is_favorite ? 'currentColor' : 'none'} aria-hidden="true" />
		</button>
	</div>
{/snippet}

<main class="authors-page">
	<header>
		<h1>Authors <span class="total">· {authors.length}</span></h1>
	</header>

	{#if actionError}
		<p class="page-error" role="alert">{actionError}</p>
	{/if}

	{#if authors.length === 0}
		<p class="empty-state">No authors yet — your library is empty.</p>
	{:else}
		{#if favorites.length > 0}
			<section class="author-group">
				<h2>★ Favorites</h2>
				<div class="author-grid">
					{#each favorites as author (author.name)}
						{@render authorCard(author)}
					{/each}
				</div>
			</section>
		{/if}

		<section class="author-group">
			<h2>All authors <span class="sub">· by work count</span></h2>
			<div class="author-grid">
				{#each authors as author (author.name)}
					{@render authorCard(author)}
				{/each}
			</div>
		</section>
	{/if}
</main>

<style>
	.authors-page {
		max-width: 1280px;
		margin: 1.5rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0;
	}
	.total {
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--reader-muted);
	}
	.page-error {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid #b00;
		color: #b00;
		font-size: 0.85rem;
	}
	.empty-state {
		color: var(--reader-muted);
		padding: 2rem 0;
	}
	.author-group {
		margin-bottom: 1.75rem;
	}
	.author-group h2 {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.6rem;
	}
	.author-group h2 .sub {
		font-weight: 400;
	}
	.author-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}
	.author-card {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
	}
	.author-card.busy {
		opacity: 0.55;
	}
	.author-link {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: inherit;
		text-decoration: none;
	}
	.author-name {
		font-weight: 500;
		word-break: break-word;
	}
	.author-link:hover .author-name {
		text-decoration: underline;
	}
	.author-count {
		font-size: 0.8rem;
		color: var(--reader-muted);
	}
	.heart {
		flex: 0 0 auto;
		background: none;
		border: none;
		padding: 4px;
		color: var(--reader-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}
	.heart:hover:not(:disabled) {
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
	}
	.heart:disabled {
		cursor: progress;
	}
</style>
