<script lang="ts">
	import {
		addWorkToSeries,
		updateWorkSeriesPosition,
		removeWorkFromSeries,
		type WorkSeriesLink,
		type SeriesSummary
	} from '$lib/api';

	type Props = {
		workId: string;
		links: WorkSeriesLink[];
		allSeries: SeriesSummary[];
	};
	let { workId, links, allSeries }: Props = $props();

	// Seeded at mount; the parent remounts per work via {#key work.id} so these
	// reset cleanly when SvelteKit reuses /works/[id] for a different work.
	// svelte-ignore state_referenced_locally
	let linkList = $state<WorkSeriesLink[]>([...links]);
	const linkedIds = $derived(new Set(linkList.map((l) => l.id)));

	function posText(position: number | null): string {
		return position != null ? `Part ${position} of ` : '';
	}

	// ─── Edit an existing manual link's position ────────────────────
	let editingId = $state<number | null>(null);
	// `bind:value` on a type="number" input yields number | null, so the
	// position state is numeric (null = empty), not a string.
	let editPos = $state<number | null>(null);
	let rowError = $state<string | null>(null);

	function startEdit(link: WorkSeriesLink) {
		editingId = link.id;
		editPos = link.position;
		rowError = null;
	}
	function cancelEdit() {
		editingId = null;
	}
	async function saveEdit(link: WorkSeriesLink) {
		const pos = editPos;
		if (pos !== null && (!Number.isInteger(pos) || pos < 1)) {
			rowError = 'Part must be a positive number';
			return;
		}
		const prev = linkList;
		linkList = linkList.map((l) => (l.id === link.id ? { ...l, position: pos } : l));
		editingId = null;
		rowError = null;
		try {
			await updateWorkSeriesPosition(workId, link.id, pos, fetch);
		} catch (e) {
			linkList = prev; // revert
			rowError = e instanceof Error ? e.message : 'Could not update part';
		}
	}

	async function detach(link: WorkSeriesLink) {
		const prev = linkList;
		linkList = linkList.filter((l) => l.id !== link.id); // optimistic
		rowError = null;
		try {
			await removeWorkFromSeries(workId, link.id, fetch);
		} catch (e) {
			linkList = prev; // revert
			rowError = e instanceof Error ? e.message : 'Could not detach';
		}
	}

	// ─── "Set series" add form ──────────────────────────────────────
	let addOpen = $state(false);
	let addPosition = $state<number | null>(null);
	let addError = $state<string | null>(null);
	let adding = $state(false);

	// A confirmed choice: an existing series (by id) or a new name. Cleared
	// while the user is re-typing, so Add can't fire on an ambiguous query —
	// this is what guarantees picking an existing AO3 series links to its row
	// (via id) and only the explicit Create path makes a new one.
	type Pick = { kind: 'existing'; id: number; name: string } | { kind: 'create'; name: string };
	let pick = $state<Pick | null>(null);

	function openAdd() {
		addOpen = true;
		addError = null;
		addPosition = null;
		pick = null;
		cbQuery = '';
		cbOpen = false;
		cbActiveIndex = 0;
		queueMicrotask(() => cbInputEl?.focus());
	}
	function closeAdd() {
		addOpen = false;
		cbOpen = false;
	}

	async function commitAdd() {
		if (!pick || adding) return;
		const pos = addPosition;
		if (pos !== null && (!Number.isInteger(pos) || pos < 1)) {
			addError = 'Part must be a positive number';
			return;
		}
		adding = true;
		addError = null;
		try {
			const created = await addWorkToSeries(
				workId,
				pick.kind === 'existing'
					? { seriesId: pick.id, position: pos }
					: { name: pick.name, position: pos },
				fetch
			);
			// Replace any existing link to this series (position override) or append.
			linkList = [...linkList.filter((l) => l.id !== created.id), created];
			closeAdd();
		} catch (e) {
			addError = e instanceof Error ? e.message : 'Could not add to series';
		} finally {
			adding = false;
		}
	}

	// ─── Combobox (mirrors AuthorNotesTags) ─────────────────────────
	type CbItem = { kind: 'series'; series: SeriesSummary } | { kind: 'create'; name: string };
	let cbQuery = $state('');
	let cbOpen = $state(false);
	let cbActiveIndex = $state(0);
	let cbInputEl = $state<HTMLInputElement | null>(null);
	let cbListEl = $state<HTMLUListElement | null>(null);

	const cbItems = $derived.by((): CbItem[] => {
		const q = cbQuery.trim().toLowerCase();
		const available = allSeries
			.filter((s) => !linkedIds.has(s.id))
			.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
		const filtered = q ? available.filter((s) => s.name.toLowerCase().includes(q)) : available;
		const items: CbItem[] = filtered.map((s) => ({ kind: 'series', series: s }));
		const existsInVocab = allSeries.some((s) => s.name.toLowerCase() === q);
		if (q.length > 0 && !existsInVocab) items.push({ kind: 'create', name: cbQuery.trim() });
		return items;
	});

	function pickItem(item: CbItem) {
		if (item.kind === 'series') {
			pick = { kind: 'existing', id: item.series.id, name: item.series.name };
			cbQuery = item.series.name;
		} else {
			pick = { kind: 'create', name: item.name };
			cbQuery = item.name;
		}
		cbOpen = false;
		cbActiveIndex = 0;
	}

	function cbOnInput(e: Event) {
		cbQuery = (e.target as HTMLInputElement).value;
		pick = null; // typing invalidates a prior choice
		cbActiveIndex = 0;
		cbOpen = true;
	}

	function cbOnKeyDown(e: KeyboardEvent) {
		const items = cbItems;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			cbOpen = true;
			cbActiveIndex = Math.min(cbActiveIndex + 1, items.length - 1);
			scrollActiveIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			cbOpen = true;
			cbActiveIndex = Math.max(cbActiveIndex - 1, 0);
			scrollActiveIntoView();
		} else if (e.key === 'Enter') {
			if (cbOpen && items[cbActiveIndex]) {
				e.preventDefault();
				pickItem(items[cbActiveIndex]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (cbOpen) cbOpen = false;
			else closeAdd();
		} else if (e.key === 'Home') {
			if (cbOpen) {
				e.preventDefault();
				cbActiveIndex = 0;
				scrollActiveIntoView();
			}
		} else if (e.key === 'End') {
			if (cbOpen) {
				e.preventDefault();
				cbActiveIndex = items.length - 1;
				scrollActiveIntoView();
			}
		}
	}

	function scrollActiveIntoView() {
		if (typeof window === 'undefined') return;
		queueMicrotask(() => {
			const li = cbListEl?.querySelector<HTMLLIElement>(`li[data-index="${cbActiveIndex}"]`);
			li?.scrollIntoView({ block: 'nearest' });
		});
	}

	function cbOnWindowMouseDown(e: MouseEvent) {
		if (!cbOpen) return;
		const target = e.target as Node | null;
		if (!target) return;
		const wrapper = cbInputEl?.closest('.combobox');
		if (wrapper && wrapper.contains(target)) return;
		cbOpen = false;
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		window.addEventListener('mousedown', cbOnWindowMouseDown);
		return () => window.removeEventListener('mousedown', cbOnWindowMouseDown);
	});
</script>

<div class="series-assign">
	{#if linkList.length > 0}
		<ul class="links">
			{#each linkList as link (link.id)}
				<li class="link-row">
					{#if editingId === link.id}
						<span class="link-text">
							Part
							<input
								type="number"
								min="1"
								class="pos-input"
								bind:value={editPos}
								aria-label="Part number"
							/>
							of <a href="/series/{link.id}">{link.name}</a>
						</span>
						<button type="button" class="row-action" onclick={() => saveEdit(link)}>Save</button>
						<button type="button" class="row-action" onclick={cancelEdit}>Cancel</button>
					{:else}
						<span class="link-text">{posText(link.position)}<a href="/series/{link.id}">{link.name}</a></span>
						{#if link.manual}
							<button type="button" class="row-action" onclick={() => startEdit(link)}>edit</button>
							<button
								type="button"
								class="row-action remove"
								onclick={() => detach(link)}
								aria-label={`Detach from ${link.name}`}>×</button
							>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if rowError}
		<p class="error" role="alert">{rowError}</p>
	{/if}

	{#if addOpen}
		<div class="add-form">
			<div class="combobox">
				<input
					bind:this={cbInputEl}
					type="text"
					class="combobox-input"
					placeholder="Search series or type a new name…"
					autocomplete="off"
					spellcheck="false"
					role="combobox"
					aria-expanded={cbOpen}
					aria-autocomplete="list"
					aria-controls="series-combobox-list"
					bind:value={cbQuery}
					oninput={cbOnInput}
					onfocus={() => (cbOpen = true)}
					onkeydown={cbOnKeyDown}
				/>
				{#if cbOpen && cbItems.length > 0}
					<ul id="series-combobox-list" bind:this={cbListEl} class="combobox-list" role="listbox">
						{#each cbItems as item, i (item.kind === 'series' ? `s${item.series.id}` : 'create')}
							<li
								class="combobox-option"
								class:active={i === cbActiveIndex}
								class:create={item.kind === 'create'}
								role="option"
								aria-selected={i === cbActiveIndex}
								data-index={i}
								onmousedown={(e) => {
									e.preventDefault();
									pickItem(item);
								}}
							>
								{#if item.kind === 'series'}
									<span class="opt-name">{item.series.name}</span>
									<span class="opt-count">{item.series.part_count} parts</span>
								{:else}
									<span class="opt-name">Create “{item.name}”</span>
									<span class="opt-count">new</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<label class="part-field">
				<span>Part</span>
				<input
					type="number"
					min="1"
					class="pos-input"
					bind:value={addPosition}
					placeholder="—"
					aria-label="Part number (optional)"
				/>
			</label>
			<button type="button" class="primary" onclick={commitAdd} disabled={!pick || adding}>
				{adding ? 'Adding…' : 'Add'}
			</button>
			<button type="button" class="secondary" onclick={closeAdd}>Cancel</button>
		</div>
		{#if addError}
			<p class="error" role="alert">{addError}</p>
		{/if}
	{:else}
		<button type="button" class="set-series-btn" onclick={openAdd}>+ Set series</button>
	{/if}
</div>

<style>
	.series-assign {
		margin-top: 0.4rem;
		font-family: system-ui, sans-serif;
	}
	.links {
		list-style: none;
		padding: 0;
		margin: 0 0 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.link-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		color: var(--reader-muted);
	}
	.link-text a {
		color: var(--reader-link);
		text-decoration: none;
	}
	.link-text a:hover {
		text-decoration: underline;
	}
	.row-action {
		background: none;
		border: none;
		padding: 0 2px;
		font: inherit;
		font-size: 0.8rem;
		color: var(--reader-muted);
		cursor: pointer;
		text-decoration: underline;
	}
	.row-action:hover {
		color: var(--reader-fg);
	}
	.row-action.remove {
		text-decoration: none;
		font-size: 1rem;
		line-height: 1;
	}
	.row-action.remove:hover {
		color: var(--reader-heart);
	}
	.set-series-btn {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.85rem;
		color: var(--reader-link);
		cursor: pointer;
	}
	.set-series-btn:hover {
		text-decoration: underline;
	}

	/* ─── Add form ─── */
	.add-form {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex-wrap: wrap;
		padding: 10px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-card-bg);
	}
	.combobox {
		position: relative;
		flex: 1 1 220px;
		min-width: 180px;
	}
	.combobox-input,
	.pos-input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.9rem;
		padding: 6px 8px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-bg);
		color: var(--reader-fg);
	}
	.combobox-input::placeholder {
		color: var(--reader-muted);
		opacity: 0.7;
	}
	.combobox-input:focus,
	.pos-input:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	.combobox-list {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 2px);
		max-height: 220px;
		overflow-y: auto;
		margin: 0;
		padding: 4px 0;
		list-style: none;
		background: var(--reader-bg);
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 10;
		scrollbar-width: thin;
	}
	.combobox-option {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		padding: 5px 10px;
		font-size: 0.88rem;
		cursor: pointer;
		color: var(--reader-fg);
	}
	.combobox-option:hover,
	.combobox-option.active {
		background: var(--reader-card-bg);
	}
	.combobox-option .opt-count {
		flex: 0 0 auto;
		font-size: 0.78rem;
		color: var(--reader-muted);
	}
	.combobox-option.create .opt-name {
		color: var(--reader-accent);
	}
	.part-field {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.85rem;
		color: var(--reader-muted);
	}
	.part-field .pos-input {
		width: 64px;
	}
	.pos-input {
		width: 64px;
		display: inline-block;
	}
	.add-form .primary,
	.add-form .secondary {
		font: inherit;
		font-size: 0.85rem;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
	}
	.add-form .primary {
		background: var(--reader-fg);
		color: var(--reader-bg);
		border: 1px solid var(--reader-fg);
	}
	.add-form .primary:hover:not(:disabled) {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
	}
	.add-form .primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.add-form .secondary {
		background: transparent;
		color: var(--reader-fg);
		border: 1px solid var(--reader-border);
	}
	.add-form .secondary:hover {
		background: var(--reader-bg);
	}
	.error {
		color: #b00;
		font-size: 0.85rem;
		margin: 0.3rem 0 0;
	}
</style>
