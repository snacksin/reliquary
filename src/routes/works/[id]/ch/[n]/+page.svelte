<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Reader from '$lib/Reader.svelte';
	import { saveProgress } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const key = $derived(`scroll:${page.params.id}:${page.params.n}`);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let suppress = false;

	function onScroll() {
		if (suppress) return;
		const k = key;
		const y = window.scrollY;
		const id = page.params.id;
		const ch = Number(page.params.n);
		clearTimeout(timer);
		timer = setTimeout(() => {
			// localStorage stays the source of truth for restore-on-reload
			// (Step 9 invariant). The server POST is purely additive — it
			// drives the library's "Continue Reading" surfacing.
			localStorage.setItem(k, String(y));
			if (Number.isInteger(ch) && ch >= 1 && id) {
				saveProgress(id, ch, y, fetch).catch(() => {
					// best-effort: don't bother the user about transient
					// network failures here
				});
			}
		}, 500);
	}

	afterNavigate((nav) => {
		// Cancel any save scheduled by the navigation's own scroll events
		// (SvelteKit's default scroll-to-top, our scrollTo below) so they
		// can't clobber the saved position with 0 / a stale value.
		clearTimeout(timer);
		suppress = true;

		// `?continue=1` is the library's signal that this link click is
		// a "resume reading" intent, not the chapter-list "start at the
		// top" intent. Treat it like a non-link nav: restore from
		// localStorage.
		const linkWithoutContinue =
			nav?.type === 'link' && page.url.searchParams.get('continue') !== '1';

		if (linkWithoutContinue) {
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
