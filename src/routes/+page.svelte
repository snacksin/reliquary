<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { uploadEpub, removeProgress, type Work } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let errorMessage: string | null = $state(null);

	const continueReading = $derived(data.works.filter((w) => w.last_read));

	function progressPercent(w: Work): number {
		if (!w.last_read || w.chapter_count <= 0) return 0;
		return Math.min(100, Math.round((w.last_read.chapter / w.chapter_count) * 100));
	}

	/**
	 * Where the work's title link goes:
	 *  - has saved progress → reader at last-read chapter, with
	 *    `?continue=1` so the reader restores scroll instead of
	 *    starting at the top
	 *  - no progress → detail page (existing POC behavior)
	 */
	function workHref(w: Work): string {
		return w.last_read
			? `/works/${w.id}/ch/${w.last_read.chapter}?continue=1`
			: `/works/${w.id}`;
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
						<a href={workHref(work)} class="cr-card-link">
							<div class="cover-slot" aria-hidden="true"></div>
							<strong>{work.title}</strong>
							<span class="cr-meta"
								>Chapter {work.last_read!.chapter} · {progressPercent(work)}% through</span
							>
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

	{#if data.works.length === 0}
		<p class="empty">No works yet — upload an EPUB to get started.</p>
	{:else}
		<section class="full-library">
			{#if continueReading.length > 0}<h2>Library</h2>{/if}
			<ul class="works">
				{#each data.works as work (work.id)}
					<li>
						<a href={workHref(work)}>
							<strong>{work.title}</strong>
							<span class="meta"
								>by {work.author} · {work.chapter_count} chapter{work.chapter_count === 1
									? ''
									: 's'}</span
							>
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
		color: #666;
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
		color: #555;
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
	/* Cover-art placeholder. Step 9 in M1 promotes this to real cover
	   art; keeping the dimensions stable now means that change is
	   purely about replacing the inner content. */
	.cover-slot {
		width: 140px;
		height: 200px;
		background: #d8d3c4;
		border-radius: 4px;
		margin-bottom: 8px;
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
		color: #666;
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
		background: rgba(255, 255, 255, 0.92);
		color: #555;
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.cr-card .remove:hover {
		background: white;
		color: #c00;
	}

	/* Full library list */
	ul.works {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	ul.works li {
		padding: 0.6rem 0;
		border-bottom: 1px solid #eee;
	}
	ul.works a {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	ul.works a:hover strong {
		text-decoration: underline;
	}
	.meta {
		display: block;
		color: #666;
		font-size: 0.9rem;
		margin-top: 0.15rem;
	}
</style>
