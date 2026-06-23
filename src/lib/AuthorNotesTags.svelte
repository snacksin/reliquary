<script lang="ts">
	import {
		saveAuthorNote,
		addAuthorTag,
		removeAuthorTag,
		type AuthorTag,
		type AuthorTagVocabItem
	} from '$lib/api';

	type Props = {
		name: string;
		notes: string | null;
		tags: AuthorTag[];
		vocab: AuthorTagVocabItem[];
	};
	let { name, notes, tags, vocab }: Props = $props();

	// ─── Notes (single free-text, explicit Save) ────────────────────
	//
	// `baseline` is the last-persisted value; `draft` is what's in the box.
	// The Save button shows only while they differ. After a successful save
	// we advance the baseline locally (no invalidateAll → no page flash).
	// svelte-ignore state_referenced_locally
	let baseline = $state(notes ?? '');
	// svelte-ignore state_referenced_locally
	let draft = $state(notes ?? '');
	const noteDirty = $derived(draft !== baseline);
	let savingNote = $state(false);
	let noteError = $state<string | null>(null);

	async function saveNote() {
		savingNote = true;
		noteError = null;
		try {
			await saveAuthorNote(name, draft, fetch);
			baseline = draft;
		} catch (e) {
			noteError = e instanceof Error ? e.message : 'Could not save note';
		} finally {
			savingNote = false;
		}
	}

	// ─── Tags (reusable vocabulary, add/remove chips) ───────────────
	//
	// Local copies so add/remove reflect immediately. `vocabList` also grows
	// when a brand-new tag is created, so the autocomplete stays consistent
	// within the session. Seeded from props at mount; the parent remounts this
	// component per author (`{#key author.name}`) so the seed is always fresh.
	// svelte-ignore state_referenced_locally
	let tagList = $state<AuthorTag[]>([...tags]);
	// svelte-ignore state_referenced_locally
	let vocabList = $state<AuthorTagVocabItem[]>([...vocab]);
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
	 * Attach a tag by name. The server find-or-creates the vocabulary entry,
	 * so both "pick an existing tag" and "create a new one" route here. We
	 * await the round-trip (fast, local) and append the real row — no temp
	 * ids to reconcile, and no full reload to flash the page.
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
			const created = await addAuthorTag(name, trimmed, fetch);
			if (!tagList.some((t) => t.id === created.id)) {
				tagList = [...tagList, created].sort(byName);
			}
			if (!vocabList.some((v) => v.id === created.id)) {
				vocabList = [...vocabList, { ...created, author_count: 1 }];
			}
			resetCombobox();
		} catch (e) {
			tagError = e instanceof Error ? e.message : 'Could not add tag';
		} finally {
			attaching = false;
		}
	}

	async function detach(tag: AuthorTag) {
		const prev = tagList;
		tagList = tagList.filter((t) => t.id !== tag.id); // optimistic
		tagError = null;
		try {
			await removeAuthorTag(name, tag.id, fetch);
		} catch (e) {
			tagList = prev; // revert
			tagError = e instanceof Error ? e.message : 'Could not remove tag';
		}
	}

	// ─── Add combobox — mirrors the /tags "Group under" combobox ─────
	//
	// Text input + filtered listbox + arrow-key nav + click-outside-close,
	// following the WAI "Editable Combobox With List Autocomplete" pattern,
	// same as src/routes/tags/+page.svelte. The last row may be a "Create
	// <query>" action when the typed name isn't in the vocabulary yet.
	type CbItem = { kind: 'tag'; tag: AuthorTagVocabItem } | { kind: 'create'; name: string };

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

<div class="notes-tags">
	<section class="block">
		<p class="block-label">Notes</p>
		<textarea
			class="note-box"
			rows="5"
			placeholder="Notes about this author — slow updater, read order, content warnings…"
			bind:value={draft}
		></textarea>
		<div class="note-actions">
			{#if noteDirty}
				<button type="button" class="save-btn" onclick={saveNote} disabled={savingNote}>
					{savingNote ? 'Saving…' : 'Save'}
				</button>
			{/if}
		</div>
		{#if noteError}
			<p class="field-error" role="alert">{noteError}</p>
		{/if}
	</section>

	<section class="block">
		<p class="block-label">Tags</p>
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
				placeholder="Add a tag…"
				autocomplete="off"
				spellcheck="false"
				role="combobox"
				aria-expanded={cbOpen}
				aria-autocomplete="list"
				aria-controls="author-tag-combobox-list"
				disabled={attaching}
				bind:value={cbQuery}
				oninput={cbOnInput}
				onfocus={() => (cbOpen = true)}
				onkeydown={cbOnKeyDown}
			/>
			{#if cbOpen && cbItems.length > 0}
				<ul id="author-tag-combobox-list" bind:this={cbListEl} class="combobox-list" role="listbox">
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
								<span class="opt-count">({item.tag.author_count})</span>
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
</div>

<style>
	.notes-tags {
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	.block + .block {
		margin-top: 1.25rem;
	}
	.block-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.4rem;
	}

	/* ─── Notes ─── */
	.note-box {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.85rem;
		line-height: 1.5;
		padding: 8px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		resize: vertical;
		min-height: 72px;
	}
	.note-box::placeholder {
		color: var(--reader-muted);
		opacity: 0.7;
	}
	.note-box:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	.note-actions {
		display: flex;
		justify-content: flex-end;
		min-height: 1.6rem;
		margin-top: 0.4rem;
	}
	.save-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 4px 14px;
		border-radius: 4px;
		border: 1px solid var(--reader-fg);
		background: var(--reader-fg);
		color: var(--reader-bg);
		cursor: pointer;
	}
	.save-btn:hover:not(:disabled) {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
	}
	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.field-error {
		color: #b00;
		font-size: 0.8rem;
		margin: 0.25rem 0 0;
	}

	/* ─── Tag chips ─── */
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
		background: var(--reader-card-bg);
		border: 1px solid var(--reader-border);
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

	/* ─── Combobox (mirrors /tags) ─── */
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
