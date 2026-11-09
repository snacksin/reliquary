<script lang="ts">
	import {
		addWorkManualTag,
		getTagVocab,
		removeWorkManualTag,
		type ManualTag,
		type TagCategory,
		type TagVocabItem
	} from '$lib/api';

	/**
	 * Manual tags (2026-11-09): hand-added AO3-category tags on the work detail
	 * page, for works whose EPUB carries none (FicHub exports — FanFiction.net
	 * has no AO3-style tags — and unknown-source files). They land in the same
	 * vocabulary as parsed tags, so the fic shows up under those names in the
	 * library's filter sections; each chip links straight to that filter.
	 *
	 * `canAdd` is false on AO3 works: the editor never shows there, except to
	 * let leftover manual tags be removed (a FanFiction.net fic whose AO3 twin
	 * later took over keeps its hand-added tags).
	 *
	 * The add box is the same WAI combobox idiom as WorkPersonalTags (which
	 * mirrors /tags' "Group under"), plus a category picker. Vocabularies load
	 * one category at a time, only when the box is used (freeform alone is
	 * ~5,000 names), and the list shows the best 50 matches.
	 */
	type Props = {
		workId: string;
		tags: ManualTag[];
		canAdd: boolean;
	};
	let { workId, tags, canAdd }: Props = $props();

	const CATEGORIES: { key: TagCategory; label: string }[] = [
		{ key: 'rating', label: 'Rating' },
		{ key: 'warning', label: 'Archive Warning' },
		{ key: 'category', label: 'Category' },
		{ key: 'fandom', label: 'Fandom' },
		{ key: 'relationship', label: 'Relationship' },
		{ key: 'character', label: 'Character' },
		{ key: 'freeform', label: 'Additional Tags' }
	];
	/** AO3's fixed lists: pick-only (the server enforces it too). */
	const FIXED = new Set<TagCategory>(['rating', 'warning', 'category']);
	const MAX_SHOWN = 50;

	// Seeded at mount; the parent remounts per work ({#key data.work.id}).
	// svelte-ignore state_referenced_locally
	let tagList = $state<ManualTag[]>([...tags]);
	let category = $state<TagCategory>('fandom');
	let vocab = $state<Partial<Record<TagCategory, TagVocabItem[]>>>({});
	let vocabLoading = $state(false);
	let tagError = $state<string | null>(null);
	let attaching = $state(false);

	const byName = (a: { name: string }, b: { name: string }) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

	const grouped = $derived(
		CATEGORIES.map((c) => ({
			...c,
			tags: tagList.filter((t) => t.category === c.key).toSorted(byName)
		})).filter((g) => g.tags.length > 0)
	);

	async function ensureVocab(cat: TagCategory) {
		if (vocab[cat]) return;
		vocabLoading = true;
		try {
			const rows = await getTagVocab(cat, fetch);
			vocab = { ...vocab, [cat]: rows };
		} catch (e) {
			tagError = e instanceof Error ? e.message : 'Could not load tags';
		} finally {
			vocabLoading = false;
		}
	}

	async function attach(name: string) {
		const trimmed = name.trim();
		if (!trimmed || attaching) return;
		const lc = trimmed.toLowerCase();
		if (tagList.some((t) => t.category === category && t.name.toLowerCase() === lc)) {
			resetCombobox();
			return;
		}
		attaching = true;
		tagError = null;
		try {
			const added = await addWorkManualTag(workId, category, trimmed, fetch);
			// One rating per work: the server swapped out the old manual one.
			const rest =
				added.category === 'rating' ? tagList.filter((t) => t.category !== 'rating') : tagList;
			tagList = rest.some((t) => t.id === added.id) ? rest : [...rest, added];
			const list = vocab[added.category];
			if (list && !list.some((v) => v.id === added.id)) {
				vocab = {
					...vocab,
					[added.category]: [...list, { id: added.id, name: added.name, count: 1 }]
				};
			}
			resetCombobox();
		} catch (e) {
			tagError = e instanceof Error ? e.message : 'Could not add tag';
		} finally {
			attaching = false;
		}
	}

	async function detach(tag: ManualTag) {
		const prev = tagList;
		tagList = tagList.filter((t) => t.id !== tag.id); // optimistic
		tagError = null;
		try {
			await removeWorkManualTag(workId, tag.id, fetch);
			// The server drops a tag no fic uses any more; forget it here too
			// so "Create" is offered again rather than a dead row.
			const list = vocab[tag.category];
			const entry = list?.find((v) => v.id === tag.id);
			if (list && entry && entry.count <= 1) {
				vocab = { ...vocab, [tag.category]: list.filter((v) => v.id !== tag.id) };
			}
		} catch (e) {
			tagList = prev; // revert
			tagError = e instanceof Error ? e.message : 'Could not remove tag';
		}
	}

	// ─── Add combobox — mirrors WorkPersonalTags / the /tags combobox ──
	type CbItem = { kind: 'tag'; tag: TagVocabItem } | { kind: 'create'; name: string };

	let cbQuery = $state('');
	let cbOpen = $state(false);
	let cbActiveIndex = $state(0);
	let cbInputEl = $state<HTMLInputElement | null>(null);
	let cbListEl = $state<HTMLUListElement | null>(null);

	const cbItems = $derived.by((): CbItem[] => {
		const q = cbQuery.trim().toLowerCase();
		const list = vocab[category] ?? [];
		const attached = new Set(tagList.filter((t) => t.category === category).map((t) => t.id));
		const available = list.filter((v) => !attached.has(v.id));
		// Empty box: most-used first (the feed's order). Typing: names that
		// START with the query first, then the rest, each most-used first.
		let matches = available;
		if (q) {
			const starts: TagVocabItem[] = [];
			const contains: TagVocabItem[] = [];
			for (const v of available) {
				const n = v.name.toLowerCase();
				if (n.startsWith(q)) starts.push(v);
				else if (n.includes(q)) contains.push(v);
			}
			matches = [...starts, ...contains];
		}
		const items: CbItem[] = matches.slice(0, MAX_SHOWN).map((t) => ({ kind: 'tag', tag: t }));
		const exists = list.some((v) => v.name.toLowerCase() === q);
		if (q && !exists && !FIXED.has(category)) items.push({ kind: 'create', name: cbQuery.trim() });
		return items;
	});

	function resetCombobox() {
		cbQuery = '';
		cbOpen = false;
		cbActiveIndex = 0;
	}

	function pickItem(item: CbItem) {
		void attach(item.kind === 'tag' ? item.tag.name : item.name);
	}

	function onCategoryChange() {
		cbActiveIndex = 0;
		void ensureVocab(category);
		cbInputEl?.focus();
	}

	function cbOnFocus() {
		cbOpen = true;
		void ensureVocab(category);
	}

	function cbOnInput(e: Event) {
		cbQuery = (e.target as HTMLInputElement).value;
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
			cbOpen = false;
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

	const placeholder = $derived(
		FIXED.has(category)
			? `Pick a ${CATEGORIES.find((c) => c.key === category)?.label.toLowerCase()}…`
			: 'Find or add a tag…'
	);
</script>

<section class="work-tags-block">
	<p class="block-label">Tags</p>
	{#if grouped.length === 0 && canAdd}
		<p class="hint">
			This fic came without AO3-style tags. Add some and it shows up in the library's filters.
		</p>
	{/if}
	{#each grouped as group (group.key)}
		<div class="tag-line">
			<span class="cat-label">{group.label}</span>
			<ul class="chips">
				{#each group.tags as tag (tag.id)}
					<li class="chip">
						<a class="chip-name" href="/?tags={tag.id}" title="Library filtered to this tag"
							>{tag.name}</a
						>
						<button
							type="button"
							class="chip-remove"
							onclick={() => detach(tag)}
							aria-label={`Remove tag ${tag.name}`}
						>
							×
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/each}

	{#if canAdd}
		<div class="add-row">
			<select
				class="cat-select"
				aria-label="Kind of tag"
				bind:value={category}
				onchange={onCategoryChange}
				disabled={attaching}
			>
				{#each CATEGORIES as c (c.key)}
					<option value={c.key}>{c.label}</option>
				{/each}
			</select>
			<div class="combobox">
				<input
					bind:this={cbInputEl}
					type="text"
					class="combobox-input"
					{placeholder}
					autocomplete="off"
					spellcheck="false"
					role="combobox"
					aria-expanded={cbOpen}
					aria-autocomplete="list"
					aria-controls="work-manual-tag-combobox-list"
					disabled={attaching}
					bind:value={cbQuery}
					oninput={cbOnInput}
					onfocus={cbOnFocus}
					onkeydown={cbOnKeyDown}
				/>
				{#if cbOpen && (cbItems.length > 0 || vocabLoading)}
					<ul
						id="work-manual-tag-combobox-list"
						bind:this={cbListEl}
						class="combobox-list"
						role="listbox"
					>
						{#if vocabLoading && cbItems.length === 0}
							<li class="combobox-option loading" role="presentation">Loading tags…</li>
						{/if}
						{#each cbItems as item, i (item.kind === 'tag' ? `t${item.tag.id}` : 'create')}
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
								{#if item.kind === 'tag'}
									<span class="opt-name">{item.tag.name}</span>
									<span class="opt-count">({item.tag.count})</span>
								{:else}
									<span class="opt-name">Create “{item.name}”</span>
									<span class="opt-count">new</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
	{#if tagError}
		<p class="field-error" role="alert">{tagError}</p>
	{/if}
</section>

<style>
	.work-tags-block {
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
		margin: 1.5rem 0;
		max-width: 36rem;
	}
	.block-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.4rem;
	}
	.hint {
		font-size: 0.82rem;
		color: var(--reader-muted);
		margin: 0 0 0.5rem;
	}
	.tag-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 6px;
	}
	.cat-label {
		flex: 0 0 7.5rem;
		font-size: 0.78rem;
		color: var(--reader-muted);
	}

	/* Chips: neutral border so AO3-category tags read differently from the
	   accent-tinted "My tags" chips below. */
	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 0;
		margin: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.78rem;
		padding: 3px 4px 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--reader-border);
		background: var(--reader-card-bg);
	}
	.chip-name {
		word-break: break-word;
		color: inherit;
		text-decoration: none;
	}
	.chip-name:hover {
		color: var(--reader-accent);
		text-decoration: underline;
	}
	.chip-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
	}
	.chip-remove:hover {
		color: var(--reader-heart);
	}
	.field-error {
		color: #b00;
		font-size: 0.8rem;
		margin: 0.25rem 0 0;
	}

	.add-row {
		display: flex;
		gap: 6px;
		margin-top: 8px;
		max-width: 28rem;
	}
	.cat-select {
		flex: 0 0 auto;
		font: inherit;
		font-size: 0.85rem;
		padding: 5px 6px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-bg);
		color: var(--reader-fg);
	}

	/* ─── Combobox (mirrors WorkPersonalTags / /tags) ─── */
	.combobox {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
	}
	.combobox-input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.85rem;
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
	.cat-select:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	.combobox-input:disabled {
		opacity: 0.6;
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
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--reader-fg);
	}
	.combobox-option:hover,
	.combobox-option.active {
		background: var(--reader-card-bg);
	}
	.combobox-option.loading {
		cursor: default;
		color: var(--reader-muted);
	}
	.combobox-option .opt-count {
		flex: 0 0 auto;
		font-size: 0.78rem;
		color: var(--reader-muted);
	}
	.combobox-option.create .opt-name {
		color: var(--reader-accent);
	}

	@media (max-width: 900px) {
		.tag-line {
			flex-direction: column;
			gap: 3px;
		}
		.cat-label {
			flex-basis: auto;
		}
	}
</style>
