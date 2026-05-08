<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const key = $derived(`scroll:${page.params.id}:${page.params.n}`);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let suppress = false;

	function onScroll() {
		if (suppress) return;
		const k = key;
		const y = window.scrollY;
		clearTimeout(timer);
		timer = setTimeout(() => localStorage.setItem(k, String(y)), 500);
	}

	afterNavigate((nav) => {
		// Cancel any save scheduled by the navigation's own scroll events
		// (SvelteKit's default scroll-to-top, our scrollTo below) so they
		// can't clobber the saved position with 0 / a stale value.
		clearTimeout(timer);
		suppress = true;

		if (nav?.type === 'link') {
			window.scrollTo(0, 0);
		} else {
			const saved = localStorage.getItem(key);
			if (saved !== null) {
				const y = Number(saved);
				if (Number.isFinite(y)) window.scrollTo(0, y);
			}
		}

		// Re-enable the listener once scroll events from the programmatic
		// scrollTo have settled.
		setTimeout(() => {
			suppress = false;
		}, 100);
	});

	onMount(() => {
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			clearTimeout(timer);
			window.removeEventListener('scroll', onScroll);
		};
	});
</script>

<svelte:head>
	<title>Reliquary</title>
	<style>
		body {
			margin: 0;
			background: #f6f2e4;
		}
	</style>
</svelte:head>

<article class="reader">
	{@html data.html}
</article>

<style>
	.reader {
		max-width: 680px;
		margin: 0 auto;
		padding: 80px 40px;
		font-family: Georgia, serif;
		font-size: 18px;
		line-height: 1.6;
		color: #3b2328;
	}
	/* Constrain embedded images (header banners, chapter art) to the
	   reading column width so wide ones don't force horizontal page
	   scroll. height: auto preserves aspect ratio. */
	.reader :global(img) {
		max-width: 100%;
		height: auto;
	}
</style>
