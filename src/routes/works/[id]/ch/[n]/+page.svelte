<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Reader from '$lib/Reader.svelte';
	import { saveProgress } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const key = $derived(`scroll:${page.params.id}:${page.params.n}`);

	// Prev/next walk real chapters only (1..N). No "Previous" on ch 1,
	// no "Next" on ch N, neither on a single-chapter fic. Plain links
	// with NO ?continue=1 — the afterNavigate logic below scrolls a
	// no-continue link nav to the top (chapter-list-click semantics).
	const hasPrev = $derived(data.chapterNumber > 1);
	const hasNext = $derived(data.chapterNumber < data.chapterCount);

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

<Reader html={data.html} workId={data.workId} />

{#if hasPrev || hasNext}
	<nav class="chapter-nav" aria-label="Chapter navigation">
		{#if hasPrev}
			<a class="chapter-nav-link prev" href="/works/{data.workId}/ch/{data.chapterNumber - 1}">
				← Previous chapter
			</a>
		{:else}
			<span></span>
		{/if}
		{#if hasNext}
			<a class="chapter-nav-link next" href="/works/{data.workId}/ch/{data.chapterNumber + 1}">
				Next chapter →
			</a>
		{/if}
	</nav>
{/if}

<style>
	/* Chapter-boundary footer. Constrained to the reading column, with a
	   divider rule above the links so it reads as a clean end-of-chapter
	   boundary rather than crowding the last paragraph (the .reader's own
	   80px bottom padding sits above this divider). Prev sits left, next
	   right (an empty <span> holds the left slot when there's no prev, so
	   next stays right-aligned). Theme-aware via --reader-*. */
	.chapter-nav {
		max-width: var(--reader-max-width);
		margin: 0 auto;
		padding: 24px 40px 80px;
		border-top: 1px solid var(--reader-border);
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--reader-font-family);
	}
	.chapter-nav-link {
		color: var(--reader-link);
		text-decoration: none;
		font-size: 1rem;
		padding: 0.5rem 0;
	}
	.chapter-nav-link:hover {
		text-decoration: underline;
	}
	.chapter-nav-link.next {
		margin-left: auto;
		text-align: right;
	}
</style>
