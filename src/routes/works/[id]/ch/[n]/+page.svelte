<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Reader from '$lib/Reader.svelte';
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

<svelte:head><title>Reliquary</title></svelte:head>

<Reader html={data.html} />
