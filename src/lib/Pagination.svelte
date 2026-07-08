<script lang="ts">
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';

	type Props = {
		page: number;
		totalPages: number;
	};
	let { page, totalPages }: Props = $props();

	/**
	 * AO3-bookmarks-style page-number list. Shows the first and last
	 * pages always; a window of size 2 around the current page in the
	 * middle; an `'ellipsis'` token where ranges are skipped.
	 *
	 *   total=12, current=6 → [1, '…', 4, 5, 6, 7, 8, '…', 12]
	 *   total=12, current=1 → [1, 2, 3, '…', 12]
	 *   total=12, current=12 → [1, '…', 10, 11, 12]
	 *   total=5,  current=3  → [1, 2, 3, 4, 5] (no ellipsis needed)
	 *
	 * The window-size constant `sib=2` matches AO3's own pagination.
	 */
	function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
		const sib = 2;
		if (total <= 7) {
			return Array.from({ length: total }, (_, i) => i + 1);
		}
		const result: (number | 'ellipsis')[] = [1];
		const leftBound = Math.max(2, current - sib);
		const rightBound = Math.min(total - 1, current + sib);
		if (leftBound > 2) result.push('ellipsis');
		for (let i = leftBound; i <= rightBound; i++) result.push(i);
		if (rightBound < total - 1) result.push('ellipsis');
		result.push(total);
		return result;
	}

	const pages = $derived(pageNumbers(page, totalPages));

	/**
	 * Build the href for a page link by stamping `page=N` onto the
	 * current URL params. Preserves tags / match_all / per_page so
	 * pagination + filter combine cleanly.
	 */
	function hrefFor(target: number): string {
		const params = new URLSearchParams(pageState.url.searchParams);
		if (target === 1) params.delete('page');
		else params.set('page', String(target));
		const qs = params.toString();
		return qs ? `?${qs}` : '?';
	}

	function navTo(target: number, ev: MouseEvent) {
		// Let modifier-clicks (cmd/ctrl-click, middle-click) open in a
		// new tab — only intercept plain left clicks for the in-page
		// navigation flow. `noScroll` keeps SvelteKit from managing scroll;
		// we then jump to the top of the results ourselves so a new page
		// starts at the top (logged QoL) — unlike filter/search which stay put.
		if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
		ev.preventDefault();
		goto(hrefFor(target), { keepFocus: true, noScroll: true }).then(() =>
			window.scrollTo({ top: 0 })
		);
	}
</script>

{#if totalPages > 1}
	<nav class="pagination" aria-label="Library pages">
		<a
			class="pg-arrow"
			class:disabled={page <= 1}
			href={hrefFor(page - 1)}
			aria-label="Previous page"
			tabindex={page <= 1 ? -1 : 0}
			aria-disabled={page <= 1}
			onclick={(e) => page > 1 && navTo(page - 1, e)}
		>
			◀
		</a>
		{#each pages as p, i (`${p}-${i}`)}
			{#if p === 'ellipsis'}
				<span class="pg-ellipsis" aria-hidden="true">…</span>
			{:else}
				<a
					class="pg-num"
					class:current={p === page}
					href={hrefFor(p)}
					aria-label={`Page ${p}`}
					aria-current={p === page ? 'page' : undefined}
					onclick={(e) => p !== page && navTo(p, e)}
				>
					{p}
				</a>
			{/if}
		{/each}
		<a
			class="pg-arrow"
			class:disabled={page >= totalPages}
			href={hrefFor(page + 1)}
			aria-label="Next page"
			tabindex={page >= totalPages ? -1 : 0}
			aria-disabled={page >= totalPages}
			onclick={(e) => page < totalPages && navTo(page + 1, e)}
		>
			▶
		</a>
	</nav>
{/if}

<style>
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 1.5rem 0 0.5rem;
		font-family: system-ui, sans-serif;
		font-size: 0.85rem;
	}
	.pg-num,
	.pg-arrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 28px;
		padding: 0 6px;
		border-radius: 4px;
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-fg);
		text-decoration: none;
		cursor: pointer;
		transition:
			background 80ms ease,
			border-color 80ms ease;
	}
	.pg-num:hover,
	.pg-arrow:hover {
		background: var(--reader-card-bg);
	}
	.pg-num.current {
		background: var(--reader-fg);
		color: var(--reader-bg);
		border-color: var(--reader-fg);
		cursor: default;
		pointer-events: none;
	}
	.pg-arrow.disabled {
		opacity: 0.4;
		cursor: default;
		pointer-events: none;
	}
	.pg-ellipsis {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		color: var(--reader-muted);
		user-select: none;
	}
</style>
