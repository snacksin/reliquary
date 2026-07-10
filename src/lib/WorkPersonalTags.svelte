<script lang="ts">
	import {
		addWorkPersonalTag,
		removeWorkPersonalTag,
		type PersonalTag,
		type PersonalTagVocabItem
	} from '$lib/api';

	/**
	 * "My tags" block on the work detail page (you-layer Private tags):
	 * attached-tag chips + an add combobox with autocomplete and
	 * create-on-the-fly. Self-contained copy of the AuthorNotesTags tag-block
	 * idiom (which itself mirrors the /tags "Group under" combobox) — the
	 * codebase precedent is duplicating that WAI combobox per surface rather
	 * than extracting it, so the author page carries zero regression risk.
	 *
	 * Removing a chip detaches the tag from THIS work only; the vocabulary
	 * entry survives for reuse (and for the sidebar filter).
	 */
	type Props = {
		workId: string;
		tags: PersonalTag[];
		vocab: PersonalTagVocabItem[];
	};
	let { workId, tags, vocab }: Props = $props();

	// Local copies so add/remove reflect immediately. `vocabList` also grows
	// when a brand-new tag is created, so the autocomplete stays consistent
	// within the session. Seeded from props at mount; the parent remounts this
	// component per work (`{#key data.work.id}`) so the seed is always fresh.
	// svelte-ignore state_referenced_locally
	let tagList = $state<PersonalTag[]>([...tags]);
	// svelte-ignore state_referenced_locally
	let vocabList = $state<PersonalTagVocabItem[]>([...vocab]);
	let tagError = $state<string | null>(null);
	let attaching = $state(false);

	const attachedIds = $derived(new Set(tagList.map((t) => t.id)));
	const byName = (a: { name: string }, b: { name: string }) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

	function alreadyAttached(tagName: string): boolean {
		const lc = tagName.toLowerCase();
		return tagList.some((t) => t.name.toLowerCase() === lc);
	}

	/**
	 * Attach a tag by name. The server find-or-creates the vocabulary entry
	 * (case-insensitively), so both "pick an existing tag" and "create a new
	 * one" route here. We await the round-trip (fast, local) and append the
	 * real row — no temp ids to reconcile, and no full reload to flash the
	 * page.
	 */
	async function attach(tagName: string) {
		const trimmed = tagName.trim();
		if (!trimmed || attaching) return;
		if (alreadyAttached(trimmed)) {
			resetCombobox();
			return;
		}
		attaching = true;
		tagError = null;
		try {
			const created = await addWorkPersonalTag(workId, trimmed, fetch);
			if (!tagList.some((t) => t.id === created.id)) {
				tagList = [...tagList, created].sort(byName);
			}
			if (!vocabList.some((v) => v.id === created.id)) {
				vocabList = [...vocabList, { ...created, count: 1 }];
			}
			resetCombobox();
		} catch (e) {
			tagError = e instanceof Error ? e.message : 'Could not add tag';
		} finally {
			attaching = false;
		}
	}

	async function detach(tag: PersonalTag) {
		const prev = tagList;
		tagList = tagList.filter((t) => t.id !== tag.id); // optimistic
		tagError = null;
		try {
			await removeWorkPersonalTag(workId, tag.id, fetch);
		} catch (e) {
			tagList = prev; // revert
			tagError = e instanceof Error ? e.message : 'Could not remove tag';
		}
	}

	// ─── Add combobox — mirrors AuthorNotesTags / the /tags combobox ──
	//
	// Text input + filtered listbox + arrow-key nav + click-outside-close,
	// following the WAI "Editable Combobox With List Autocomplete" pattern.
	// The last row may be a "Create <query>" action when the typed name isn't
	// in the vocabulary yet.
	type CbItem = { kind: 'tag'; tag: PersonalTagVocabItem } | { kind: 'create'; name: string };

	let cbQuery = $state('');
	let cbOpen = $state(false);
	let cbActiveIndex = $state(0);
	let cbInputEl = $state<HTMLInputElement | null>(null);
	let cbListEl = $state<HTMLUListElement | null>(null);

	const cbItems = $derived.by((): CbItem[] => {
		const q = cbQuery.trim().toLowerCase();
		const available = vocabList.filter((v) => !attachedIds.has(v.id)).toSorted(byName);
		const filtered = q ? available.filter((v) => v.name.toLowerCase().includes(q)) : available;
		const items: CbItem[] = filtered.map((t) => ({ kind: 'tag', tag: t }));
		const existsInVocab = vocabList.some((v) => v.name.toLowerCase() === q);
		if (q.length > 0 && !existsInVocab) items.push({ kind: 'create', name: cbQuery.trim() });
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
</script>

<section class="my-tags-block">
	<p class="block-label">My tags</p>
	{#if tagList.length > 0}
		<ul class="chips">
			{#each tagList as tag (tag.id)}
				<li class="chip">
					<span class="chip-name">{tag.name}</span>
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
	{/if}

	<div class="combobox">
		<input
			bind:this={cbInputEl}
			type="text"
			class="combobox-input"
			placeholder="Add a tag… (reread, comfort fic, wing-fic…)"
			autocomplete="off"
			spellcheck="false"
			role="combobox"
			aria-expanded={cbOpen}
			aria-autocomplete="list"
			aria-controls="work-personal-tag-combobox-list"
			disabled={attaching}
			bind:value={cbQuery}
			oninput={cbOnInput}
			onfocus={() => (cbOpen = true)}
			onkeydown={cbOnKeyDown}
		/>
		{#if cbOpen && cbItems.length > 0}
			<ul
				id="work-personal-tag-combobox-list"
				bind:this={cbListEl}
				class="combobox-list"
				role="listbox"
			>
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
	{#if tagError}
		<p class="field-error" role="alert">{tagError}</p>
	{/if}
</section>

<style>
	.my-tags-block {
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
		margin: 1.5rem 0;
		/* Keep the combobox from spanning the whole reading column on desktop —
		   it's an input for short tag names, not an editor. */
		max-width: 28rem;
	}
	.block-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.4rem;
	}

	/* ─── Tag chips — same accent-tinted pill language as the library-row
	   chips (WorkRow.svelte) so "your tags" read consistently everywhere,
	   plus the × remove affordance. ─── */
	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 0;
		margin: 0 0 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.78rem;
		padding: 3px 4px 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--reader-accent);
		background: color-mix(in srgb, var(--reader-accent) 12%, transparent);
	}
	.chip-name {
		word-break: break-word;
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

	/* ─── Combobox (mirrors AuthorNotesTags / /tags) ─── */
	.combobox {
		position: relative;
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
	.combobox-input:focus {
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
	.combobox-option .opt-count {
		flex: 0 0 auto;
		font-size: 0.78rem;
		color: var(--reader-muted);
	}
	.combobox-option.create .opt-name {
		color: var(--reader-accent);
	}
</style>
