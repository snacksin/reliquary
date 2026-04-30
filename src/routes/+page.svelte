<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { uploadEpub } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let errorMessage: string | null = $state(null);

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

	{#if data.works.length === 0}
		<p class="empty">No works yet — upload an EPUB to get started.</p>
	{:else}
		<ul class="works">
			{#each data.works as work (work.id)}
				<li>
					<a href="/works/{work.id}">
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
	ul.works {
		list-style: none;
		padding: 0;
		margin-top: 1.5rem;
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
