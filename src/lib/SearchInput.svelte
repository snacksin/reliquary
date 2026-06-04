<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	type Props = {
		q: string;
	};
	let { q }: Props = $props();

	/**
	 * Local input state. The URL is the source of truth — when `q`
	 * changes (via reload, clear button on a parent, back/forward), the
	 * effect below syncs the input. While the user is typing, the input
	 * leads and the debounce pushes the URL update later.
	 *
	 * The lint warning about capturing only the initial value of `q`
	 * is exactly the intent: we want `value` initialized from prop on
	 * mount, then `value` drives the input from there. The `$effect`
	 * below handles subsequent prop syncs.
	 */
	// svelte-ignore state_referenced_locally
	let value = $state(q);

	$effect(() => {
		// Sync from prop. The post-debounce URL update flows back through
		// here too — by the time the effect runs, value already equals q
		// (we set it before scheduling the update), so this is a no-op in
		// the typing path. Only external changes (reload, clear from a
		// parent) actually move `value`.
		value = q;
	});

	let timer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_MS = 300;

	/**
	 * Push the search state into the URL. Always drops the `page` param
	 * so a search change resets to page 1 — the previously-viewed page
	 * index almost certainly doesn't make sense against a different
	 * result set.
	 *
	 * `replaceState: true` because every keystroke shouldn't pollute the
	 * browser back stack. Filter toggles still use pushState (each toggle
	 * is a discrete user choice the user might want to undo); typing is
	 * continuous and intermediate states aren't meaningful bookmarks.
	 */
	function pushSearchState(next: string) {
		const params = new URLSearchParams(page.url.searchParams);
		const trimmed = next.trim();
		if (trimmed) params.set('q', trimmed);
		else params.delete('q');
		params.delete('page');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	function scheduleUpdate(next: string) {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			pushSearchState(next);
		}, DEBOUNCE_MS);
	}

	function handleInput(e: Event) {
		value = (e.target as HTMLInputElement).value;
		scheduleUpdate(value);
	}

	/**
	 * Enter while focused → immediate URL update, bypassing the
	 * debounce. Matches the expectation set by every other search box
	 * on the web.
	 */
	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		pushSearchState(value);
	}

	function clear() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		value = '';
		pushSearchState('');
	}
</script>

<form class="search-form" role="search" onsubmit={handleSubmit}>
	<label class="search-label" for="library-search">
		<span class="visually-hidden">Search library</span>
		<input
			id="library-search"
			class="search-input"
			class:has-value={value.length > 0}
			type="search"
			placeholder="Search title, author, summary…"
			autocomplete="off"
			spellcheck="false"
			{value}
			oninput={handleInput}
		/>
		{#if value.length > 0}
			<button
				type="button"
				class="clear"
				aria-label="Clear search"
				onclick={clear}
			>
				×
			</button>
		{/if}
	</label>
</form>

<style>
	.search-form {
		margin-bottom: 1.25rem;
	}
	.search-label {
		display: block;
		position: relative;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.search-input {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 28px 6px 10px;
		font: inherit;
		font-size: 0.85rem;
		color: var(--reader-fg);
		background: transparent;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		transition: border-color 80ms ease;
	}
	.search-input.has-value {
		/* Extra right padding when the clear button is visible so the
		   user's typing never sits underneath it. */
		padding-right: 30px;
	}
	.search-input::placeholder {
		color: var(--reader-muted);
		opacity: 0.8;
	}
	.search-input:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	/* Hide the browser's native clear button on type=search — we render
	   our own so the styling is consistent across browsers/themes. */
	.search-input::-webkit-search-cancel-button {
		appearance: none;
		display: none;
	}

	.clear {
		position: absolute;
		top: 50%;
		right: 4px;
		transform: translateY(-50%);
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.6;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity 100ms ease;
	}
	.clear:hover,
	.clear:focus-visible {
		opacity: 1;
		color: var(--reader-heart);
	}
</style>
