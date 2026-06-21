<script lang="ts">
	import Reader from '$lib/Reader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

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
</script>

<svelte:head><title>Reliquary — Archived version</title></svelte:head>

<!--
	Archived-version reader. Reuses Reader.svelte (no fork). This route
	carries NO scroll/progress logic by design — viewing an old version
	never touches reading_progress or auto-read state.
-->
<div class="archive-banner" role="status">
	<span>You're reading an archived version from {dateTime(data.archivedAt)}.</span>
	<a href="/works/{data.workId}/ch/{data.chapterNumber}">Return to current</a>
</div>

<Reader html={data.html} workId={data.workId} />

<style>
	/* Sticky so the archived-mode context stays visible while scrolling.
	   Padded clear of the fixed top-left back button + top-right hamburger
	   (each 40px at 16px inset). Themed via --reader-* for all three
	   themes. */
	.archive-banner {
		position: sticky;
		top: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding: 0.6rem 72px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		border-bottom: 1px solid var(--reader-border);
		font-family: system-ui, sans-serif;
		font-size: 0.88rem;
		text-align: center;
	}
	.archive-banner a {
		color: var(--reader-link);
		text-decoration: none;
		font-weight: 500;
	}
	.archive-banner a:hover {
		text-decoration: underline;
	}
</style>
