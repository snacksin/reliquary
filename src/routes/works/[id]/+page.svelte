<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import {
		setFavorite,
		unsetFavorite,
		trashWork,
		restoreWork,
		removeProgress,
		readAgain,
		markRead,
		markUnread,
		setRating,
		clearRating,
		daysUntilPurge,
		authorName,
		uploadCover,
		removeCover,
		setCoverFromImage,
		type LastRead
	} from '$lib/api';
	import { inContinueReading, isFinished, resumeChapter, continueHref } from '$lib/reading';
	import SeriesAssign from '$lib/SeriesAssign.svelte';
	import NotesEditor from '$lib/NotesEditor.svelte';
	import WorkPersonalTags from '$lib/WorkPersonalTags.svelte';
	import { Heart, Star } from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// History-aware "← Library" back (Step 1c; mirrors the series back button).
	// When you arrived from the library, return to that exact URL — preserving
	// its sort + filter query params — so in-app back matches browser-back
	// instead of dropping to a bare `/` (which reset the sort/filters). Any
	// other origin (author/series/search, or a cold load) falls back to `/`.
	let backHref = $state('/');
	afterNavigate((nav) => {
		const from = nav.from?.url;
		backHref = from && from.pathname === '/' ? from.pathname + from.search : '/';
		// Reset the cover override when navigating between works — the next
		// work's cover comes from its own load data.
		pendingCover = undefined;
		pickerOpen = false;
		coverError = null;
	});

	// ─── Cover Art Part A: manual upload / remove ────────────────────
	// `pendingCover` is the optimistic override (undefined = defer to load
	// data; null = removed; string = the new cache-bust token) — the same
	// pending-then-derived idiom as the star rating below. No invalidateAll:
	// the server row changed, the local override covers the gap.
	let pendingCover = $state<string | null | undefined>(undefined);
	let coverBusy = $state(false);
	let coverError = $state<string | null>(null);
	let coverInputEl = $state<HTMLInputElement | null>(null);
	const coverV = $derived(
		pendingCover !== undefined ? pendingCover : (data.work.cover_v ?? null)
	);

	async function handleCoverPicked(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file later
		if (!file) return;
		coverBusy = true;
		coverError = null;
		try {
			const res = await uploadCover(data.work.id, file, fetch);
			pendingCover = res.cover_v;
		} catch (err) {
			coverError = err instanceof Error ? err.message : 'Could not upload cover';
		} finally {
			coverBusy = false;
		}
	}

	async function handleCoverRemove() {
		coverBusy = true;
		coverError = null;
		try {
			await removeCover(data.work.id, fetch);
			pendingCover = null;
		} catch (err) {
			coverError = err instanceof Error ? err.message : 'Could not remove cover';
		} finally {
			coverBusy = false;
		}
	}

	// ─── Cover Art Part A.5: pick a cover from the fic's own images ──
	// AO3's EPUB generator declares no covers even on illustrated fics, but
	// the body images are already extracted — the Set-cover button opens a
	// thumbnail gallery of them (plus the upload fallback) whenever the work
	// has ≥1 extracted image; with none it goes straight to the file picker,
	// exactly as before. Picking COPIES server-side to the manual location
	// (never a reference into images/ — ingest rewrites that dir per upload).
	let pickerOpen = $state(false);

	function handleSetCoverClick() {
		if (data.workImages.length > 0) {
			pickerOpen = !pickerOpen;
		} else {
			coverInputEl?.click();
		}
	}

	async function handlePickImage(image: string) {
		coverBusy = true;
		coverError = null;
		try {
			const res = await setCoverFromImage(data.work.id, image, fetch);
			pendingCover = res.cover_v;
			pickerOpen = false;
		} catch (err) {
			coverError = err instanceof Error ? err.message : 'Could not set cover';
		} finally {
			coverBusy = false;
		}
	}

	// Soft-trash state (M2.3 Step 5). When trashed, the page shows a
	// banner with a Restore action instead of the Move-to-Trash button.
	const isTrashed = $derived(data.work.trashed_at != null);
	let restoring = $state(false);
	let restoreError = $state<string | null>(null);

	async function handleRestore() {
		restoring = true;
		restoreError = null;
		try {
			await restoreWork(data.work.id, fetch);
			await invalidateAll();
		} catch (e) {
			restoreError = e instanceof Error ? e.message : 'Restore failed';
		} finally {
			restoring = false;
		}
	}

	// The numbered chapter list shows only real chapters; the preface
	// ("Tags & metadata") and afterword ("End notes") are surfaced as
	// dedicated links above and below the list.
	const realChapters = $derived(data.work.chapters.filter((c) => c.kind === 'chapter'));
	const hasPreface = $derived(data.work.chapters.some((c) => c.kind === 'preface'));
	const hasAfterword = $derived(data.work.chapters.some((c) => c.kind === 'afterword'));

	// Optimistic "Read again" override (set by handleReadAgain below). When
	// non-null it overlays a fresh-start last_read onto the work locally, so the
	// Continue / Read-again UI flips instantly WITHOUT invalidateAll() — which
	// would re-run the page load and flash the nav spinner (the PR #48
	// favorite-flash symptom). `crWork` is the work the Continue-Reading-state
	// UI reads from; null override → plain server data.
	let readAgainProgress: LastRead | null = $state(null);
	const crWork = $derived(
		readAgainProgress ? { ...data.work, last_read: readAgainProgress } : data.work
	);

	// Optimistic local override so the heart toggle feels instantaneous.
	// Set on click, cleared once invalidateAll re-fetches (fresh
	// data.work.is_favorite then takes over). Initial null = "no
	// override, use server data".
	let pendingFavorite: boolean | null = $state(null);
	const isFavorite = $derived(pendingFavorite ?? data.work.is_favorite);
	let favoriteError: string | null = $state(null);

	// Cover-slot placeholder glyph: first letter of the title, uppercased.
	// Mirrors the helper on the library page; v1.5 swaps in real cover art.
	const glyph = $derived(data.work.title?.[0]?.toUpperCase() ?? '?');

	// ─── Remove from Continue Reading (sticky dismiss) ───────────────
	// Same endpoint as the carousel × (DELETE /progress → sets dismissed_at);
	// the work leaves Continue Reading but its read state is preserved, and a
	// later read brings it back. `crRemoved` is an optimistic local override so
	// the button hides instantly before invalidateAll re-fetches the dismissal.
	let crRemoved = $state(false);
	let crRemoveError: string | null = $state(null);
	const showRemoveFromCR = $derived(inContinueReading(crWork) && !crRemoved);

	async function handleRemoveFromCR() {
		crRemoved = true;
		crRemoveError = null;
		try {
			await removeProgress(data.work.id, fetch);
			await invalidateAll();
		} catch (e) {
			crRemoved = false; // revert
			crRemoveError = e instanceof Error ? e.message : 'Could not remove from Continue Reading';
		}
	}

	// ─── Read again (restart a finished fic) ─────────────────────────
	// Resets resumable progress server-side so the fic re-enters Continue
	// Reading at Chapter 1 and tracks the whole re-read (the existing #62
	// in-progress logic does the rest). The UI flips OPTIMISTICALLY via
	// `readAgainProgress`/`crWork` above — no invalidateAll(), so no nav-spinner
	// flash (the PR #48 favorite-flash fix); the PUT persists in the background
	// and we revert the override only on failure. On success we also clear this
	// work's per-chapter saved scroll in localStorage — the reader restores
	// scroll from localStorage, not the server row, so without this the
	// post-reset "Continue from Chapter 1" would jump to the stale near-bottom
	// position from the prior read instead of starting at the top. Cleared keys
	// re-populate naturally as the re-read progresses, so resumability is
	// unaffected. Does NOT touch any "read" mark — that's the you-layer's.
	let readingAgain = $state(false);
	let readAgainError: string | null = $state(null);

	async function handleReadAgain() {
		if (readingAgain) return;
		readingAgain = true;
		readAgainError = null;
		const previous = readAgainProgress;
		// Optimistic flip: a fresh in-progress read starting at Chapter 1.
		readAgainProgress = {
			chapter: 1,
			scroll_y: 0,
			max_read_chapter: 0,
			dismissed_at: null,
			updated_at: new Date().toISOString()
		};
		try {
			await readAgain(data.work.id, fetch);
			for (const ch of realChapters) {
				localStorage.removeItem(`scroll:${data.work.id}:${ch.number}`);
			}
		} catch (e) {
			readAgainProgress = previous; // revert the optimistic flip
			readAgainError = e instanceof Error ? e.message : 'Could not restart this fic';
		} finally {
			readingAgain = false;
		}
	}

	// ─── Move to Trash (M2.3 Step 4) ────────────────────────────────
	// Confirm via a native <dialog> (the M2.1.6 idiom: Cancel default-
	// focused, explicit close(), Esc closes without acting). On confirm
	// the work is trashed and vanishes from the library, so we navigate
	// back to it. Restore is API-only until Step 5's /trash view.
	let trashDialog = $state<HTMLDialogElement | null>(null);
	let trashCancelEl = $state<HTMLButtonElement | null>(null);
	let trashError = $state<string | null>(null);
	let trashing = $state(false);

	function openTrashDialog() {
		trashError = null;
		trashDialog?.showModal();
		queueMicrotask(() => trashCancelEl?.focus());
	}

	function closeTrashDialog() {
		trashDialog?.close();
	}

	function trashDialogKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeTrashDialog();
		}
	}

	async function confirmTrash() {
		trashing = true;
		trashError = null;
		try {
			await trashWork(data.work.id, fetch);
			closeTrashDialog();
			await goto('/');
		} catch (e) {
			trashError = e instanceof Error ? e.message : 'Failed to move to Trash';
		} finally {
			trashing = false;
		}
	}

	// Short date for the "Updated · <date>" chapter pills (Part 2/3). The
	// date is when the edit was detected on re-upload, not the author's
	// real AO3 edit date — hence "Updated" rather than "author edited".
	function shortDate(iso: string): string {
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	async function toggleFavorite() {
		const next = !isFavorite;
		pendingFavorite = next;
		favoriteError = null;
		try {
			if (next) {
				await setFavorite(data.work.id, fetch);
			} else {
				await unsetFavorite(data.work.id, fetch);
			}
			await invalidateAll();
			pendingFavorite = null;
		} catch (e) {
			pendingFavorite = !next; // revert
			favoriteError = e instanceof Error ? e.message : 'Favorite toggle failed';
			// snap optimistic state back so the next render reflects reality
			pendingFavorite = null;
		}
	}

	// ─── Manual "read" mark (you-layer foundation) ───────────────────
	// A purely user-toggled flag (works.read_at), set ONLY via POST/DELETE
	// /api/works/[id]/read. It is FULLY DECOUPLED from reading progress: it does
	// not read or write reading_progress, Continue Reading inclusion, the
	// re-read flow, or any percent/finish logic. Mirrors the favorite heart:
	// optimistic local override (`pendingRead`) with revert-on-failure. Unlike
	// toggleFavorite there's no invalidateAll() — the mark is decoupled, so
	// nothing else needs re-fetching, and skipping it avoids the nav re-render
	// flash (cf. the PR #65 / #48 favorite-flash fix). The override holds the
	// new state until the next navigation/reload re-reads data.work.read_at.
	let pendingRead: boolean | null = $state(null);
	const isRead = $derived(pendingRead ?? data.work.read_at != null);
	let readError: string | null = $state(null);

	async function toggleRead() {
		const next = !isRead;
		pendingRead = next; // optimistic
		readError = null;
		try {
			if (next) {
				await markRead(data.work.id, fetch);
			} else {
				await markUnread(data.work.id, fetch);
			}
			// success: keep the override (no invalidateAll → data.work is stale;
			// the override is the new truth until the next load).
		} catch (e) {
			pendingRead = null; // revert to server truth (unchanged)
			readError = e instanceof Error ? e.message : 'Could not update read status';
		}
	}

	// ─── Personal star rating (you-layer) ────────────────────────────
	// Its own dimension — no interaction with reading progress, Continue
	// Reading, the read flag, or favorites. Optimistic local override
	// (`pendingRating`) mirroring the favorite heart; revert-on-failure; NO
	// invalidateAll (decoupled → nothing to re-fetch, and skipping it avoids
	// the nav flash, per #65/#48). `pendingRating`: null = no override, 0 =
	// optimistically cleared, 1–5 = optimistically set. `hoverRating` previews
	// the fill under the cursor. Effective rating falls back to the server
	// value, then 0 (unrated).
	let pendingRating: number | null = $state(null);
	let hoverRating = $state(0);
	let ratingError: string | null = $state(null);
	const rating = $derived(pendingRating ?? data.work.rating ?? 0);
	const ratingDisplay = $derived(hoverRating || rating);

	async function setStars(n: number) {
		// Click a star to set it; click your current rating to clear (→ 0).
		const next = n === rating ? 0 : n;
		const prev = pendingRating;
		pendingRating = next; // optimistic
		ratingError = null;
		try {
			if (next === 0) {
				await clearRating(data.work.id, fetch);
			} else {
				await setRating(data.work.id, next, fetch);
			}
			// success: keep the override (no invalidateAll → data.work is stale).
		} catch (e) {
			pendingRating = prev; // revert the optimistic change
			ratingError = e instanceof Error ? e.message : 'Could not update rating';
		}
	}
</script>

<svelte:head><title>Reliquary — {data.work.title}</title></svelte:head>

<main>
	<p class="back"><a href={backHref}>← Library</a></p>
	{#if isTrashed}
		<div class="trash-banner" role="status">
			<span>
				This fic is in Trash — will be permanently deleted in {daysUntilPurge(
					data.work.trashed_at!
				)} days.
			</span>
			<button type="button" class="restore-button" onclick={handleRestore} disabled={restoring}>
				{restoring ? 'Restoring…' : 'Restore'}
			</button>
		</div>
		{#if restoreError}
			<p class="error">{restoreError}</p>
		{/if}
	{/if}
	<div class="detail-header">
		<!-- Cover Art Part A: the reserved slot renders the real cover
		     (manual or extracted, CSS 2:3 auto-crop) with Set/Remove controls
		     beneath — hidden on trashed works (read-only surface). Local
		     state (coverV) updates optimistically, favorite-heart idiom. -->
		<div class="cover-col">
			<div class="cover-slot" aria-hidden="true">
				{#if coverV !== null}
					<img class="cover-img" src="/api/works/{data.work.id}/cover?v={coverV}" alt="" />
				{:else}
					<span class="cover-glyph">{glyph}</span>
				{/if}
			</div>
			{#if !isTrashed}
				<div class="cover-actions">
					<input
						bind:this={coverInputEl}
						type="file"
						accept="image/png,image/jpeg"
						class="cover-file"
						onchange={handleCoverPicked}
					/>
					<button
						type="button"
						class="cover-btn"
						disabled={coverBusy}
						aria-expanded={data.workImages.length > 0 ? pickerOpen : undefined}
						onclick={handleSetCoverClick}
					>
						{coverBusy ? 'Saving…' : coverV !== null ? 'Replace cover' : 'Set cover'}
					</button>
					{#if coverV !== null}
						<button type="button" class="cover-btn" disabled={coverBusy} onclick={handleCoverRemove}>
							Remove
						</button>
					{/if}
				</div>
				<!-- Part A.5: pick-a-cover gallery — the fic's own extracted images
				     as 2:3 thumbnails, plus the upload fallback. Rendered only when
				     the work has extracted images (otherwise Set cover opened the
				     file picker directly above). -->
				{#if pickerOpen && data.workImages.length > 0}
					<div class="cover-picker" role="group" aria-label="Pick a cover from this fic's images">
						<div class="cover-picker-grid">
							{#each data.workImages as image (image)}
								<button
									type="button"
									class="cover-thumb"
									disabled={coverBusy}
									title={image}
									onclick={() => handlePickImage(image)}
								>
									<img src="/api/works/{data.work.id}/images/{image}" alt={image} loading="lazy" />
								</button>
							{/each}
						</div>
						<div class="cover-picker-foot">
							<button
								type="button"
								class="cover-btn"
								disabled={coverBusy}
								onclick={() => coverInputEl?.click()}
							>
								Upload image…
							</button>
							<button type="button" class="cover-btn" onclick={() => (pickerOpen = false)}>
								Cancel
							</button>
						</div>
					</div>
				{/if}
				{#if coverError}
					<p class="cover-error" role="alert">{coverError}</p>
				{/if}
			{/if}
		</div>
		<div class="detail-header-text">
			<div class="title-row">
				<h1>{data.work.title}</h1>
				{#if data.work.has_history}
					<a class="history-button" href="/works/{data.work.id}/history" title="View chapter edit history">
						<span aria-hidden="true">📜</span> History
					</a>
				{/if}
				<button
					type="button"
					class="read-toggle"
					class:is-read={isRead}
					onclick={toggleRead}
					aria-pressed={isRead}
				>
					{isRead ? 'Mark as unread' : 'Mark as read'}
				</button>
				<button
					class="heart"
					class:filled={isFavorite}
					onclick={toggleFavorite}
					aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
					aria-pressed={isFavorite}
				>
					<Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
				</button>
			</div>
			<!-- Author Identity Part B: AO3-style byline with EVERY co-author its
			     own link to that account's page ("A, B (acct)"), in byline order
			     from the stored work_authors links (never dc:creator). Works with
			     no parsed authors (non-AO3, Anonymous) keep the raw works.author
			     text linking to its fallback author page, exactly as before. -->
			<p class="author">
				by
				{#if data.work.authors?.length}
					{#each data.work.authors as a, i (a.account + '\0' + (a.pseud ?? ''))}
						{#if i > 0}{', '}{/if}<a href="/authors/{encodeURIComponent(a.account)}"
							>{authorName(a)}</a
						>
					{/each}
				{:else}
					<a href="/authors/{encodeURIComponent(data.work.author)}">{data.work.author}</a>
				{/if}
			</p>
			<div
				class="rating-control"
				role="group"
				aria-label="Your rating"
				onmouseleave={() => (hoverRating = 0)}
			>
				<span class="rating-label">Your rating</span>
				{#each [1, 2, 3, 4, 5] as n (n)}
					<button
						type="button"
						class="star-button"
						onclick={() => setStars(n)}
						onmouseenter={() => (hoverRating = n)}
						onfocus={() => (hoverRating = n)}
						onblur={() => (hoverRating = 0)}
						aria-pressed={n <= rating}
						aria-label={n === rating
							? `${n} star${n === 1 ? '' : 's'} — your current rating; activate to clear`
							: `Rate ${n} star${n === 1 ? '' : 's'}`}
						title="Click a star to rate; click your current rating to clear"
					>
						<Star
							size={22}
							color={n <= ratingDisplay ? 'var(--reader-accent)' : 'var(--reader-muted)'}
							fill={n <= ratingDisplay ? 'var(--reader-accent)' : 'none'}
							aria-hidden="true"
						/>
					</button>
				{/each}
			</div>
			{#key data.work.id}
				<SeriesAssign workId={data.work.id} links={data.series} allSeries={data.allSeries} />
			{/key}
		</div>
	</div>
	{#if favoriteError}
		<p class="error">{favoriteError}</p>
	{/if}
	{#if readError}
		<p class="error">{readError}</p>
	{/if}
	{#if ratingError}
		<p class="error">{ratingError}</p>
	{/if}
	{#if crWork.last_read && !isFinished(crWork)}
		<p class="continue">
			<a class="continue-button" href={continueHref(crWork)}>
				Continue from Chapter {resumeChapter(crWork)}
			</a>
			{#if showRemoveFromCR}
				<button type="button" class="cr-remove" onclick={handleRemoveFromCR}>
					Remove from Continue Reading
				</button>
			{/if}
		</p>
	{/if}
	{#if crRemoveError}
		<p class="error">{crRemoveError}</p>
	{/if}
	{#if isFinished(crWork)}
		<p class="continue">
			<button
				type="button"
				class="continue-button read-again"
				onclick={handleReadAgain}
				disabled={readingAgain}
			>
				{readingAgain ? 'Restarting…' : 'Read again'}
			</button>
		</p>
	{/if}
	{#if readAgainError}
		<p class="error">{readAgainError}</p>
	{/if}
	{#if data.work.summary}
		<div class="summary">{@html data.work.summary}</div>
	{/if}

	<!-- Per-work markdown note (you-layer Step 2). Sits right under the summary
	     (order: summary → Notes → Tags&metadata → Chapters). Keyed on the work
	     id so it remounts (re-seeds its baseline) when navigating between fics. -->
	{#key data.work.id}
		<NotesEditor workId={data.work.id} note={data.work.note ?? null} />
	{/key}

	<!-- Personal tags (you-layer Private tags) — "My tags" chips + add
	     combobox, between Notes and the Tags & metadata link. Keyed like the
	     notes editor so the seed refreshes when navigating between fics. -->
	{#key data.work.id}
		<WorkPersonalTags
			workId={data.work.id}
			tags={data.work.personal_tags ?? []}
			vocab={data.personalTagVocab}
		/>
	{/key}

	{#if hasPreface}
		<p class="wrapper-link">
			<a href="/works/{data.work.id}/preface">Tags &amp; metadata</a>
		</p>
	{/if}
	<h2>Chapters</h2>
	<ol class="chapters">
		{#each realChapters as ch (ch.number)}
			<li>
				<a href="/works/{data.work.id}/ch/{ch.number}">
					{#if ch.title}{ch.title}{:else}<em>untitled</em>{/if}
				</a>
				{#if ch.last_edited_at}
					<span class="edited-pill" title="This chapter has been updated since it was first saved — earlier versions are kept">
						Updated · {shortDate(ch.last_edited_at)}
					</span>
				{/if}
			</li>
		{/each}
	</ol>
	{#if hasAfterword}
		<p class="wrapper-link">
			<a href="/works/{data.work.id}/afterword">End notes</a>
		</p>
	{/if}

	{#if !isTrashed}
		<div class="danger-zone">
			<button type="button" class="trash-button" onclick={openTrashDialog}>
				Move to Trash
			</button>
		</div>
	{/if}
</main>

<dialog
	bind:this={trashDialog}
	class="trash-dialog"
	onkeydown={trashDialogKeydown}
	onclose={() => (trashError = null)}
>
	<h2>Move to Trash?</h2>
	<p>
		“{data.work.title}” will be hidden from your library, search, and filters. Nothing is
		deleted — you can restore it.
	</p>
	{#if trashError}
		<p class="dialog-error" role="alert">{trashError}</p>
	{/if}
	<div class="dialog-actions">
		<button type="button" class="secondary" bind:this={trashCancelEl} onclick={closeTrashDialog}>
			Cancel
		</button>
		<button type="button" class="danger" onclick={confirmTrash} disabled={trashing}>
			{trashing ? 'Moving…' : 'Move to Trash'}
		</button>
	</div>
</dialog>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	.back {
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}
	.back a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	/* Header lays out the cover slot to the left of the title block. The
	   cover is the same 140×200 placeholder used on the library page;
	   v1.5 will swap in real cover art across both surfaces. */
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}
	.detail-header-text {
		flex: 1 1 auto;
		min-width: 0;
	}
	.cover-slot {
		flex: 0 0 140px;
		width: 140px;
		height: 200px;
		background: var(--reader-cover-placeholder);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.cover-glyph {
		font-family: Georgia, serif;
		font-size: 56px;
		line-height: 1;
		color: var(--reader-muted);
		opacity: 0.55;
		user-select: none;
	}
	/* Cover Art Part A — the cover column wraps the existing slot plus the
	   Set/Replace/Remove controls beneath it; the slot itself is unchanged
	   (no layout shift). The img is the CSS 2:3 auto-crop. */
	.cover-col {
		flex: 0 0 140px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cover-col .cover-slot {
		flex: 0 0 auto;
	}
	.cover-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 4px;
		display: block;
	}
	.cover-file {
		display: none;
	}
	.cover-actions {
		display: flex;
		gap: 6px;
	}
	.cover-btn {
		flex: 1 1 0;
		font: inherit;
		font-size: 0.72rem;
		padding: 3px 0;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.cover-btn:hover:not(:disabled) {
		border-color: var(--reader-accent);
		color: var(--reader-fg);
	}
	.cover-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cover-error {
		color: #b00;
		font-size: 0.72rem;
		margin: 0;
		max-width: 140px;
	}
	/* Part A.5: pick-a-cover gallery. Lives in the cover column beneath the
	   action buttons; 2:3 thumbs matching the slot language, theme-aware. */
	.cover-picker {
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-card-bg);
		padding: 6px;
	}
	.cover-picker-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 6px;
		max-height: 320px;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.cover-thumb {
		padding: 0;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-cover-placeholder);
		cursor: pointer;
		aspect-ratio: 2 / 3;
		overflow: hidden;
	}
	.cover-thumb:hover:not(:disabled) {
		border-color: var(--reader-accent);
	}
	.cover-thumb:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cover-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.cover-picker-foot {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.title-row {
		display: flex;
		/* Action buttons top-align to the title's first line so they don't
		   drift to the vertical middle of a wrapped (two-line) title. */
		align-items: flex-start;
		gap: 0.75rem;
	}
	/* 📜 History button — sits between the title and the heart, themed
	   like the other detail-page chrome. Only rendered when the work has
	   archived chapter versions (Part 2). Fixed 38px height matches the
	   heart so the two read as one inline action row; top-aligned (no
	   align-self override) so both sit against the title's first line. */
	.history-button {
		flex: 0 0 auto;
		height: 38px;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0 0.7rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		text-decoration: none;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.history-button:hover {
		border-color: var(--reader-accent);
	}
	/* "Mark as read / unread" toggle — a text chip mirroring the History
	   button's chrome and the heart's height, sitting in the same action
	   cluster. The label is the action to take; the marked-read state is shown
	   by an accent border + accent text (the same "accent when active" idea as
	   the filled heart), legible on card-bg across all three themes. */
	.read-toggle {
		flex: 0 0 auto;
		height: 38px;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		padding: 0 0.7rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		font: inherit;
		font-size: 0.85rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.read-toggle:hover {
		border-color: var(--reader-accent);
	}
	.read-toggle.is-read {
		border-color: var(--reader-accent);
		color: var(--reader-accent);
		font-weight: 600;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.25rem;
		flex: 1 1 auto;
	}
	/* Heart-button rendering. The shape comes from lucide-svelte's
	   <Heart /> SVG — outline by default, fill="currentColor" when
	   favorited. So `color` drives both the stroke and the fill, and
	   only the SVG's `fill` attribute distinguishes states (same path,
	   identical proportions). The button chrome itself stays the same
	   38px circle with a 1px border. */
	.heart {
		flex: 0 0 auto;
		background: none;
		border: 1px solid var(--reader-border);
		border-radius: 50%;
		width: 38px;
		height: 38px;
		color: var(--reader-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition:
			color 80ms ease,
			border-color 80ms ease,
			background 80ms ease;
	}
	.heart:hover {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}
	.heart.filled {
		color: var(--reader-heart);
		border-color: var(--reader-heart);
	}
	.author {
		color: var(--reader-muted);
		margin-top: 0;
	}
	/* Author name links to that author's page (Part 1 follow-up) — kept in
	   the foreground color so it reads as the clickable element next to the
	   muted "by", underlining on hover like the page's other chrome links. */
	.author a {
		color: var(--reader-fg);
		text-decoration: none;
	}
	.author a:hover {
		text-decoration: underline;
	}
	/* Personal star rating control — a labeled row of five clickable stars
	   under the author line. Stars are borderless icon buttons (chrome reset);
	   fill/outline + accent/muted color are driven per-icon in the markup, so
	   hover-preview + set state read clearly across all three themes. */
	.rating-control {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0.5rem 0 0.25rem;
	}
	.rating-label {
		font-size: 0.8rem;
		color: var(--reader-muted);
		margin-right: 0.4rem;
	}
	.star-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1px;
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
		line-height: 0;
	}
	.error {
		color: #b00;
		font-size: 0.9rem;
		margin: 0.25rem 0 0;
	}
	.continue {
		margin: 1rem 0 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	/* Secondary, low-emphasis action next to the Continue CTA — a plain
	   theme-aware text button so it reads as a quiet "stop surfacing this"
	   rather than competing with the primary Continue button. Mirrors the
	   carousel × semantics (sticky dismiss). */
	.cr-remove {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.85rem;
		color: var(--reader-muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.cr-remove:hover,
	.cr-remove:focus-visible {
		color: var(--reader-heart);
	}
	/* Inverted theme colors — `--reader-fg` for the bg + `--reader-bg`
	   for the text gives a high-contrast button regardless of which
	   reader theme is active. The detail page itself stays neutral
	   (system fonts / colors); only this CTA reflects the theme. */
	.continue-button {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		background: var(--reader-fg);
		color: var(--reader-bg);
		border-radius: 4px;
		text-decoration: none;
		font-size: 0.95rem;
		font-weight: 500;
	}
	.continue-button:hover {
		background: var(--reader-accent);
	}
	/* "Read again" reuses the Continue CTA's look but is a <button>, so reset
	   the native button chrome (border/font/cursor) the <a> didn't carry. */
	.read-again {
		border: none;
		font: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		cursor: pointer;
	}
	.read-again:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.summary {
		background: var(--reader-card-bg);
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin: 1rem 0;
	}
	.summary :global(p) {
		margin: 0.5rem 0;
	}
	/* Tag links inside the rendered AO3 summary HTML — picked up the
	   same theming as chapter-page links so they don't fall back to
	   the unreadable browser-default blue on dark theme. */
	.summary :global(a) {
		color: var(--reader-link);
	}
	.summary :global(a:visited) {
		color: var(--reader-link-visited);
	}
	h2 {
		font-size: 1.1rem;
		margin-top: 2rem;
	}
	ol.chapters {
		padding-left: 1.5rem;
	}
	ol.chapters li {
		padding: 0.25rem 0;
	}
	ol.chapters a {
		color: inherit;
		text-decoration: none;
	}
	ol.chapters a:hover {
		text-decoration: underline;
	}
	/* "Updated · <date>" label — surfaces that a chapter has archived
	   prior versions (Part 2/3). Borderless and muted so it reads as quiet
	   metadata beside the title rather than a competing chip. */
	.edited-pill {
		margin-left: 0.55rem;
		color: var(--reader-muted);
		font-size: 0.74rem;
		white-space: nowrap;
		vertical-align: middle;
	}
	.wrapper-link {
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}
	.wrapper-link a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.wrapper-link a:hover {
		text-decoration: underline;
	}

	/* Trashed-state banner (M2.3 Step 5). Sits at the top of the detail
	   page; the Restore button is the in-place undo. Themed via
	   --reader-* so it reads on all three themes. */
	.trash-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin: 0 0 1rem;
		padding: 0.6rem 0.9rem;
		background: var(--reader-card-bg);
		border: 1px solid var(--reader-heart);
		border-radius: 6px;
		font-size: 0.9rem;
	}
	.restore-button {
		flex: 0 0 auto;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--reader-fg);
		border-radius: 4px;
		background: var(--reader-fg);
		color: var(--reader-bg);
		cursor: pointer;
	}
	.restore-button:hover:not(:disabled) {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
	}
	.restore-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Destructive action, set apart at the bottom of the page and kept
	   quiet until hovered so it never competes with the reading actions. */
	.danger-zone {
		margin-top: 2.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--reader-border);
	}
	.trash-button {
		background: none;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		color: var(--reader-muted);
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		cursor: pointer;
	}
	.trash-button:hover,
	.trash-button:focus-visible {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}

	/* Confirm dialog — same native-<dialog> chrome as the /tags
	   group/hide dialogs. */
	.trash-dialog {
		max-width: 420px;
		width: 90vw;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		padding: 1.25rem 1.5rem;
		font-family: system-ui, sans-serif;
	}
	.trash-dialog::backdrop {
		background: rgba(0, 0, 0, 0.4);
	}
	.trash-dialog h2 {
		font-size: 1.05rem;
		margin: 0 0 0.75rem;
		font-weight: 600;
	}
	.trash-dialog p {
		font-size: 0.9rem;
		line-height: 1.5;
		margin: 0 0 1rem;
	}
	.dialog-error {
		color: #b00;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.dialog-actions button {
		font: inherit;
		font-size: 0.9rem;
		padding: 6px 14px;
		border-radius: 4px;
		cursor: pointer;
	}
	.dialog-actions .secondary {
		background: transparent;
		color: var(--reader-fg);
		border: 1px solid var(--reader-border);
	}
	.dialog-actions .secondary:hover {
		background: var(--reader-card-bg);
	}
	.dialog-actions .danger {
		background: var(--reader-heart);
		color: #fff;
		border: 1px solid var(--reader-heart);
	}
	.dialog-actions .danger:hover {
		opacity: 0.9;
	}
	.dialog-actions .danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
