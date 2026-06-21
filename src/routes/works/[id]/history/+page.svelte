<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const groups = $derived(data.history.groups);

	function dateTime(iso: string): string {
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleString(undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				});
	}

	function deltaLabel(delta: number | null): string {
		if (delta === null) return '';
		if (delta === 0) return '±0 words';
		return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} words`;
	}
</script>

<svelte:head><title>Reliquary — Chapter history</title></svelte:head>

<main class="history-page">
	<header>
		<p class="back"><a href="/works/{data.work.id}">← {data.work.title}</a></p>
		<h1>Chapter history</h1>
		<p class="explainer">
			Earlier versions of chapters that were edited after they were saved. Each version is
			kept exactly as it was — newest edits first.
		</p>
	</header>

	{#if groups.length === 0}
		<p class="empty">No edited chapters yet — every chapter is on its first version.</p>
	{:else}
		{#each groups as group (group.number)}
			<section class="chapter-group">
				<h2>
					Chapter {group.number}{#if group.title} · {group.title}{/if}
				</h2>
				<ul class="versions">
					{#each group.archives as a (a.archive_id)}
						<li class="version-row">
							<div class="version-meta">
								<span class="archived">archived {dateTime(a.archived_at)}</span>
								{#if a.word_delta !== null}
									<span class="delta" class:add={a.word_delta > 0} class:cut={a.word_delta < 0}>
										{deltaLabel(a.word_delta)}
									</span>
								{/if}
								<span class="hash" title="content fingerprint">#{a.hash_short}</span>
							</div>
							<a class="view-link" href="/works/{data.work.id}/history/{a.archive_id}">
								View this version
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</main>

<style>
	.history-page {
		max-width: 760px;
		margin: 2rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		margin-bottom: 2rem;
	}
	.back {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}
	.back a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.5rem;
	}
	.explainer {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
		margin: 0;
		max-width: 60ch;
	}
	.empty {
		color: var(--reader-muted);
		font-size: 0.95rem;
	}
	.chapter-group {
		margin-bottom: 1.75rem;
	}
	.chapter-group h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--reader-border);
	}
	.versions {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.version-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--reader-border);
	}
	.version-meta {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}
	.archived {
		color: var(--reader-fg);
	}
	.delta {
		color: var(--reader-muted);
		font-variant-numeric: tabular-nums;
	}
	.delta.add {
		color: #2e7d32;
	}
	.delta.cut {
		color: #b5562f;
	}
	.hash {
		color: var(--reader-muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.78rem;
	}
	.view-link {
		flex: 0 0 auto;
		color: var(--reader-link);
		text-decoration: none;
		font-size: 0.85rem;
	}
	.view-link:hover {
		text-decoration: underline;
	}
</style>
