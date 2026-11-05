<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Reader from '$lib/Reader.svelte';
	import { saveProgress } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const key = $derived(`scroll:${page.params.id}:${page.params.n}`);
	// The permille this device last SENT for this chapter. Lets a Continue
	// Reading arrival tell "the server's spot is my own" (restore exact
	// pixels from `key`) from "another device moved it" (restore `at`).
	const pkey = $derived(`scrollp:${page.params.id}:${page.params.n}`);

	// Prev/next walk real chapters only (1..N). No "Previous" on ch 1,
	// no "Next" on ch N, neither on a single-chapter fic. Plain links
	// with NO ?continue=1 — the afterNavigate logic below scrolls a
	// no-continue link nav to the top (chapter-list-click semantics).
	const hasPrev = $derived(data.chapterNumber > 1);
	const hasNext = $derived(data.chapterNumber < data.chapterCount);

	// Series continuity (Part 3). At a part boundary — the last chapter (no
	// "Next chapter") or ch 1 (no "Previous chapter") — offer the adjacent
	// owned part instead, one button per series. A single-chapter part is both
	// first and last, so both can show. Links go to ch 1 of the adjacent part
	// (plain route → opens at the top). `series_name` is shown only when there
	// are 2+ buttons in a direction (a work in multiple series).
	const atLast = $derived(data.chapterNumber >= data.chapterCount);
	const atFirst = $derived(data.chapterNumber === 1);
	const nextParts = $derived(atLast ? data.seriesNav.filter((s) => s.next) : []);
	const prevParts = $derived(atFirst ? data.seriesNav.filter((s) => s.prev) : []);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let suppress = false;

	// Record this chapter's progress + read-to-end mark.
	//
	// `completed` = scrolled to within ~5% of the page bottom. Computed
	// client-side because only the browser knows the rendered chapter height.
	// Crucially this is ALSO evaluated on arrival (see afterNavigate): for a
	// chapter short enough to fit on screen, the bottom is already visible at
	// the top, so it's marked read on open — the only completion signal we get
	// for a chapter that never scrolls. Without this, a short final chapter
	// (e.g. a 2-chapter fic with a brief Ch 2) never auto-finishes.
	//
	// localStorage stays the source of truth for restore-on-reload (Step 9
	// invariant); the server POST is purely additive — it drives the library's
	// "Continue Reading" surfacing and the cross-device handoff.
	//
	// `handoffArrival`: this record is the arrival write right after restoring
	// ANOTHER device's spot. The read-mark is suppressed then (ROADMAP
	// non-negotiable: a restore must never auto-mark a fic read, even when the
	// spot lands near the bottom). Scrolling afterwards marks it as usual.
	function recordProgress(handoffArrival = false) {
		const id = page.params.id;
		const ch = Number(page.params.n);
		if (!(Number.isInteger(ch) && ch >= 1 && id)) return;
		const y = window.scrollY;
		const p = toPermille(y);
		const completed =
			!handoffArrival && y + window.innerHeight >= document.documentElement.scrollHeight * 0.95;
		localStorage.setItem(key, String(y));
		localStorage.setItem(pkey, String(p));
		saveProgress(id, ch, y, p, completed, fetch).catch(() => {
			// best-effort: don't bother the user about transient network failures
		});
	}

	// Cross-device position = fraction (0–1000) of the CHAPTER TEXT, not the
	// page: the header and footer differ in height per device, so measuring
	// against `article.reader` keeps them out of the ratio. Screen-level
	// accuracy by design (text reflows per device); line-level is M4.
	function textBox(): { top: number; height: number } {
		const el = document.querySelector('article.reader');
		if (el) {
			const r = el.getBoundingClientRect();
			return { top: r.top + window.scrollY, height: r.height };
		}
		return { top: 0, height: document.documentElement.scrollHeight };
	}

	function toPermille(y: number): number {
		const { top, height } = textBox();
		if (height <= 0) return 0;
		return Math.min(1000, Math.max(0, Math.round(((y - top) / height) * 1000)));
	}

	function fromPermille(p: number): number {
		const { top, height } = textBox();
		return Math.max(0, top + (p / 1000) * height);
	}

	/** `?at=` as a permille, or null when absent/malformed. */
	function parseAt(raw: string | null): number | null {
		if (raw === null) return null;
		const n = Number(raw);
		return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null;
	}

	function onScroll() {
		if (suppress) return;
		clearTimeout(timer);
		timer = setTimeout(recordProgress, 500);
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

		// Cross-device handoff ("newest spot wins", Allie 2026-11-05). A
		// Continue Reading LINK carries `at` = the server's latest spot for this
		// chapter. If it isn't the permille this device last sent, another
		// device moved it since → restore `at`. Otherwise it's our own spot →
		// fall through to the exact-pixel localStorage restore, so same-device
		// behavior is unchanged. Only on link clicks: reload and Back/Forward
		// ignore a lingering `&at=` in the URL and restore this device's spot.
		let handoff = false;

		if (linkWithoutContinue) {
			window.scrollTo(0, 0);
		} else {
			const at = nav?.type === 'link' ? parseAt(page.url.searchParams.get('at')) : null;
			if (at !== null && localStorage.getItem(pkey) !== String(at)) {
				window.scrollTo(0, fromPermille(at));
				handoff = true;
			} else {
				const saved = localStorage.getItem(key);
				if (saved !== null) {
					const y = Number(saved);
					if (Number.isFinite(y)) window.scrollTo(0, y);
				}
			}
		}

		// Re-enable the listener once scroll events from the programmatic
		// scrollTo have settled, then record progress for the chapter we landed
		// on — even if the user never scrolls it (a short chapter that fits on
		// screen is "read to end" the moment it's shown). Runs on the initial
		// load too (afterNavigate fires on type === 'enter'). The restore above
		// MUST stay before this write: recording first would overwrite the
		// other device's spot with this device's 0 (the handoff erasing itself).
		setTimeout(() => {
			suppress = false;
			recordProgress(handoff);
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

<Reader html={data.html} workId={data.workId} hasSkin={data.hasSkin} />

{#if hasPrev || hasNext || prevParts.length > 0 || nextParts.length > 0}
	<nav class="chapter-nav" aria-label="Chapter navigation">
		<div class="nav-slot prev">
			{#if hasPrev}
				<a class="chapter-nav-link prev" href="/works/{data.workId}/ch/{data.chapterNumber - 1}">
					← Previous chapter
				</a>
			{:else}
				{#each prevParts as s (s.series_id)}
					<a class="part-link prev" href="/works/{s.prev!.id}/ch/1">
						{#if prevParts.length > 1}<span class="part-series">{s.series_name}</span>{/if}
						<span>← Previous part: {s.prev!.title}</span>
					</a>
				{/each}
			{/if}
		</div>
		<div class="nav-slot next">
			{#if hasNext}
				<a class="chapter-nav-link next" href="/works/{data.workId}/ch/{data.chapterNumber + 1}">
					Next chapter →
				</a>
			{:else}
				{#each nextParts as s (s.series_id)}
					<a class="part-link next" href="/works/{s.next!.id}/ch/1">
						{#if nextParts.length > 1}<span class="part-series">{s.series_name}</span>{/if}
						<span>Next part: {s.next!.title} →</span>
					</a>
				{/each}
			{/if}
		</div>
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
		align-items: flex-start;
		gap: 1rem;
		font-family: var(--reader-font-family);
	}
	/* Each side holds either a chapter link or stacked series-part buttons.
	   The next slot right-aligns its contents so it stays in the corner. */
	.nav-slot {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.nav-slot.next {
		align-items: flex-end;
		text-align: right;
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
	/* Series-part jump — the primary action at a part boundary, so it reads
	   as a button (bordered chip) rather than a plain chapter link. */
	.part-link {
		display: inline-flex;
		flex-direction: column;
		gap: 0.1rem;
		max-width: 100%;
		padding: 0.5rem 0.85rem;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		color: var(--reader-fg);
		text-decoration: none;
		font-size: 0.95rem;
		font-weight: 500;
	}
	.part-link:hover {
		border-color: var(--reader-accent);
	}
	.part-link.next {
		align-items: flex-end;
	}
	.part-series {
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--reader-muted);
	}
</style>
