<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		addTagAlias,
		removeTagAlias,
		setTagAliasHidden,
		type Tag,
		type TagAliasEdge,
		type TagCategory
	} from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const CATEGORY_LABELS: { key: TagCategory; label: string }[] = [
		{ key: 'rating', label: 'Rating' },
		{ key: 'warning', label: 'Archive Warning' },
		{ key: 'category', label: 'Category' },
		{ key: 'fandom', label: 'Fandom' },
		{ key: 'relationship', label: 'Relationship' },
		{ key: 'character', label: 'Character' },
		{ key: 'freeform', label: 'Additional Tags' }
	];

	/**
	 * Defensive depth cap. With API-layer cycle prevention + UNION in the
	 * filter CTE this should never trigger, but a hand-edited DB row or
	 * a future bug shouldn't blow up the renderer. Real-world fandom
	 * hierarchies rarely exceed depth 4-5.
	 */
	const MAX_RENDER_DEPTH = 12;

	// ─── Derived indexes over the load data ─────────────────────────

	/** All tags from all categories, keyed by id. */
	const tagsById = $derived.by(() => {
		const m = new Map<number, Tag & { category: TagCategory }>();
		for (const { key } of CATEGORY_LABELS) {
			for (const t of data.tagGroups[key]) m.set(t.id, { ...t, category: key });
		}
		return m;
	});

	/** Edges out of each parent (children list, sorted by child name). */
	const childEdgesByParent = $derived.by(() => {
		const m = new Map<number, TagAliasEdge[]>();
		for (const e of data.edges) {
			if (!m.has(e.parent_tag_id)) m.set(e.parent_tag_id, []);
			m.get(e.parent_tag_id)!.push(e);
		}
		for (const list of m.values()) {
			list.sort((a, b) => {
				const an = tagsById.get(a.alias_tag_id)?.name ?? '';
				const bn = tagsById.get(b.alias_tag_id)?.name ?? '';
				return an.localeCompare(bn);
			});
		}
		return m;
	});

	/** Set of tag ids that appear as an alias_tag_id somewhere. */
	const childIds = $derived.by(() => {
		const s = new Set<number>();
		for (const e of data.edges) s.add(e.alias_tag_id);
		return s;
	});

	/**
	 * Roots per category: tags with no parent-alias rows. Roots that
	 * have NO children of their own get rendered as "free" tags (no
	 * relationship). Roots WITH children are the trees.
	 */
	const rootsByCategory = $derived.by(() => {
		const m: Record<TagCategory, Tag[]> = {
			rating: [],
			warning: [],
			category: [],
			fandom: [],
			relationship: [],
			character: [],
			freeform: []
		};
		for (const { key } of CATEGORY_LABELS) {
			m[key] = data.tagGroups[key].filter((t) => !childIds.has(t.id));
		}
		return m;
	});

	/** Parents of each tag — names, for the "Child of X" subtext. */
	const parentNamesByChild = $derived.by(() => {
		const m = new Map<number, string[]>();
		for (const e of data.edges) {
			const parent = tagsById.get(e.parent_tag_id);
			if (!parent) continue;
			if (!m.has(e.alias_tag_id)) m.set(e.alias_tag_id, []);
			m.get(e.alias_tag_id)!.push(parent.name);
		}
		return m;
	});

	// ─── Expand / collapse state per row ────────────────────────────

	/**
	 * A row is keyed by `<parent_id>-<tag_id>` for non-roots, or
	 * `root-<tag_id>` for roots. A tag appearing under two parents has
	 * independent state for each appearance, which matches user intent
	 * (an expand under one parent shouldn't auto-expand the other).
	 */
	function rowKey(tagId: number, parentId: number | null): string {
		return parentId === null ? `root-${tagId}` : `${parentId}-${tagId}`;
	}

	let expanded = $state<Record<string, boolean>>({});

	function toggleRow(key: string) {
		expanded[key] = !expanded[key];
	}

	// ─── Per-row subtext (the plain-language relationship hint) ─────

	function subtextFor(tagId: number, edge: TagAliasEdge | null): string {
		const parts: string[] = [];
		const isRoot = edge === null;
		const childCount = childEdgesByParent.get(tagId)?.length ?? 0;
		const parents = parentNamesByChild.get(tagId) ?? [];

		if (isRoot) {
			if (childCount === 0) {
				parts.push('(free)');
			} else {
				parts.push(childCount === 1 ? 'Has 1 child' : `Has ${childCount} children`);
			}
		} else {
			const parentTag = tagsById.get(edge.parent_tag_id);
			if (parentTag) parts.push(`Child of ${parentTag.name}`);
			if (parents.length > 1) {
				parts.push(`${parents.length} parents total`);
			}
			if (childCount > 0) {
				parts.push(childCount === 1 ? 'Has 1 child' : `Has ${childCount} children`);
			}
			if (edge.hide_from_sidebar === 1) {
				parts.push('Hidden from sidebar');
			}
		}
		return parts.join(' · ');
	}

	// ─── Mutations + reload ─────────────────────────────────────────

	let mutationError = $state<string | null>(null);

	async function reloadAll() {
		await invalidateAll();
	}

	async function handleToggleHide(edge: TagAliasEdge) {
		mutationError = null;
		try {
			await setTagAliasHidden(
				edge.parent_tag_id,
				edge.alias_tag_id,
				edge.hide_from_sidebar === 0,
				fetch
			);
			await reloadAll();
		} catch (e) {
			mutationError = e instanceof Error ? e.message : 'Failed to update hide flag';
		}
	}

	async function handleRemove(edge: TagAliasEdge) {
		mutationError = null;
		const parent = tagsById.get(edge.parent_tag_id);
		const child = tagsById.get(edge.alias_tag_id);
		if (!confirm(`Ungroup "${child?.name}" from "${parent?.name}"?`)) return;
		try {
			await removeTagAlias(edge.parent_tag_id, edge.alias_tag_id, fetch);
			await reloadAll();
		} catch (e) {
			mutationError = e instanceof Error ? e.message : 'Failed to remove alias';
		}
	}

	// ─── "Group under" modal dialog ─────────────────────────────────

	let dialog = $state<HTMLDialogElement | null>(null);
	let dialogParent = $state<(Tag & { category: TagCategory }) | null>(null);
	let dialogChildId = $state<number | ''>('');
	let dialogHide = $state(false);
	let dialogError = $state<string | null>(null);

	function openAddDialog(tag: Tag & { category: TagCategory }) {
		dialogParent = tag;
		dialogChildId = '';
		dialogHide = false;
		dialogError = null;
		dialog?.showModal();
	}

	function closeDialog() {
		dialog?.close();
		dialogParent = null;
		dialogChildId = '';
		dialogHide = false;
		dialogError = null;
	}

	/**
	 * Eligible children for the dialog: same category, not the parent
	 * itself, not already a direct child. Sorted by usage count desc
	 * to surface the heavy-hitter tags first (matches the FilterSidebar
	 * sort).
	 */
	const dialogEligible = $derived.by(() => {
		if (!dialogParent) return [];
		const existingChildren = new Set(
			(childEdgesByParent.get(dialogParent.id) ?? []).map((e) => e.alias_tag_id)
		);
		return data.tagGroups[dialogParent.category].filter(
			(t) => t.id !== dialogParent!.id && !existingChildren.has(t.id)
		);
	});

	async function handleDialogSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!dialogParent || typeof dialogChildId !== 'number') return;
		dialogError = null;
		try {
			await addTagAlias(dialogParent.id, dialogChildId, dialogHide, fetch);
			closeDialog();
			await reloadAll();
		} catch (e) {
			dialogError = e instanceof Error ? e.message : 'Failed to group tag';
		}
	}
</script>

<svelte:head><title>Manage Tags — Reliquary</title></svelte:head>

<main class="tags-page">
	<header>
		<p class="back"><a href="/">← Library</a></p>
		<h1>Manage Tags</h1>
		<!--
			Explainer paragraph above the list. Plain-language description
			of what aliases do, so a first-time visitor doesn't have to
			reverse-engineer the UI to understand the model.
		-->
		<p class="explainer">
			Tag aliases let you group related tags into parent/child relationships. When you
			filter your library by a parent tag, you'll also see works tagged with any of its
			children. Setup is manual — you decide which tags belong together.
		</p>
	</header>

	{#if mutationError}
		<p class="page-error" role="alert">{mutationError}</p>
	{/if}

	{#snippet treeNode(
		tag: Tag & { category: TagCategory },
		edge: TagAliasEdge | null,
		depth: number,
		categoryKey: TagCategory
	)}
		{@const children = childEdgesByParent.get(tag.id) ?? []}
		{@const hasChildren = children.length > 0}
		{@const key = rowKey(tag.id, edge?.parent_tag_id ?? null)}
		{@const isExpanded = expanded[key] ?? false}
		{@const isHidden = edge?.hide_from_sidebar === 1}
		{@const isChildRow = edge !== null}

		<li class="tree-row" class:has-children={hasChildren} class:hidden-edge={isHidden}>
			<div class="row-content" style="padding-left: {depth * 1.4}rem">
				{#if hasChildren}
					<button
						type="button"
						class="caret"
						aria-expanded={isExpanded}
						aria-label={isExpanded ? 'Collapse' : 'Expand'}
						onclick={() => toggleRow(key)}
					>
						{isExpanded ? '▼' : '▶'}
					</button>
				{:else}
					<span class="caret-spacer" aria-hidden="true"></span>
				{/if}

				{#if isChildRow}
					<span class="child-glyph" aria-hidden="true">⊃</span>
				{:else}
					<span class="child-glyph-spacer" aria-hidden="true"></span>
				{/if}

				<span class="name">{tag.name}</span>
				<span class="count">({tag.count})</span>
				<span class="subtext">{subtextFor(tag.id, edge)}</span>

				<span class="row-actions">
					{#if edge}
						<button
							type="button"
							class="action-btn"
							onclick={() => handleToggleHide(edge)}
							title={isHidden
								? 'Hidden under this parent — click to show in sidebar via this edge'
								: 'Visible — click to hide under this parent (other parents may still show it)'}
							aria-label={isHidden ? 'Unhide alias' : 'Hide alias'}
						>
							{isHidden ? '🙈' : '👁'}
						</button>
						<button
							type="button"
							class="action-btn remove"
							onclick={() => handleRemove(edge)}
							title="Ungroup from {tagsById.get(edge.parent_tag_id)?.name}"
							aria-label="Ungroup"
						>
							×
						</button>
					{/if}
					<button
						type="button"
						class="action-btn add"
						onclick={() => openAddDialog(tag)}
						title="Group another {categoryKey} tag under {tag.name}"
						aria-label="Group under this tag"
					>
						＋
					</button>
				</span>
			</div>

			{#if hasChildren && isExpanded && depth < MAX_RENDER_DEPTH}
				<ul class="children">
					{#each children as childEdge (childEdge.alias_tag_id)}
						{@const childTag = tagsById.get(childEdge.alias_tag_id)}
						{#if childTag}
							{@render treeNode(childTag, childEdge, depth + 1, categoryKey)}
						{/if}
					{/each}
				</ul>
			{:else if hasChildren && isExpanded && depth >= MAX_RENDER_DEPTH}
				<p class="depth-cap" style="padding-left: {(depth + 1) * 1.4}rem">
					(maximum tree depth reached — break a cycle in the alias graph)
				</p>
			{/if}
		</li>
	{/snippet}

	{#each CATEGORY_LABELS as { key, label } (key)}
		{@const roots = rootsByCategory[key]}
		{#if roots.length > 0}
			<section class="category-section">
				<h2>{label} <span class="cat-count">{data.tagGroups[key].length}</span></h2>
				<ul class="tree">
					{#each roots as root (root.id)}
						{@const rootWithCat = tagsById.get(root.id)}
						{#if rootWithCat}
							{@render treeNode(rootWithCat, null, 0, key)}
						{/if}
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</main>

<dialog bind:this={dialog} class="group-dialog" onclose={closeDialog}>
	{#if dialogParent}
		<form onsubmit={handleDialogSubmit}>
			<h2>Group a tag under <strong>{dialogParent.name}</strong></h2>

			<label class="picker-label">
				<span>Pick a {dialogParent.category} tag</span>
				<select bind:value={dialogChildId} required>
					<option value="" disabled selected>Choose one…</option>
					{#each dialogEligible as eligible (eligible.id)}
						<option value={eligible.id}>{eligible.name} ({eligible.count})</option>
					{/each}
				</select>
			</label>

			<p class="dialog-note">
				When you filter by <strong>{dialogParent.name}</strong>, you'll also see works
				tagged with the grouped tag.
			</p>

			<label class="hide-label">
				<input type="checkbox" bind:checked={dialogHide} />
				<span>
					Hide the grouped tag from the filter sidebar (it still works via
					<strong>{dialogParent.name}</strong>)
				</span>
			</label>

			{#if dialogError}
				<p class="dialog-error" role="alert">{dialogError}</p>
			{/if}

			<div class="dialog-actions">
				<button type="button" class="secondary" onclick={closeDialog}>Cancel</button>
				<button type="submit" class="primary" disabled={dialogChildId === ''}>
					Group it
				</button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.tags-page {
		max-width: 820px;
		margin: 2rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		margin-bottom: 2rem;
	}
	.back {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}
	.back a {
		color: var(--reader-muted);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0 0 0.5rem;
	}
	.explainer {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
		margin: 0;
		max-width: 60ch;
	}

	.page-error {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid #b00;
		color: #b00;
		font-size: 0.85rem;
	}

	.category-section {
		margin-bottom: 2rem;
	}
	.category-section h2 {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0 0 0.5rem;
	}
	.cat-count {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.85em;
		margin-left: 0.4rem;
	}

	/* ─── Tree shape ─── */
	.tree,
	.children {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.tree {
		border-top: 1px solid var(--reader-border);
	}
	.tree > .tree-row {
		border-bottom: 1px solid var(--reader-border);
	}
	.tree-row.hidden-edge .name,
	.tree-row.hidden-edge .child-glyph {
		opacity: 0.6;
	}

	.row-content {
		display: grid;
		grid-template-columns: 20px 16px 1fr auto;
		align-items: center;
		gap: 4px 6px;
		padding: 6px 0;
		font-size: 0.9rem;
	}
	.caret,
	.caret-spacer {
		grid-column: 1;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 20px;
		height: 22px;
	}
	.caret {
		border: none;
		background: transparent;
		color: var(--reader-muted);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0;
		border-radius: 3px;
	}
	.caret:hover {
		background: var(--reader-card-bg);
		color: var(--reader-fg);
	}
	.child-glyph,
	.child-glyph-spacer {
		grid-column: 2;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 16px;
		color: var(--reader-muted);
		font-size: 0.85rem;
	}

	.name {
		grid-column: 3;
		grid-row: 1;
		font-weight: 500;
		word-break: break-word;
	}
	.count {
		grid-column: 4;
		grid-row: 1;
		font-size: 0.8rem;
		color: var(--reader-muted);
		padding-right: 6px;
	}
	.subtext {
		grid-column: 3 / 5;
		grid-row: 2;
		font-size: 0.78rem;
		color: var(--reader-muted);
		line-height: 1.3;
	}

	.row-actions {
		grid-column: 4;
		grid-row: 1 / 3;
		display: inline-flex;
		gap: 2px;
		align-items: center;
		opacity: 0.4;
		transition: opacity 100ms ease;
	}
	.row-content:hover .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}
	.action-btn {
		padding: 0;
		width: 26px;
		height: 26px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.action-btn:hover,
	.action-btn:focus-visible {
		background: var(--reader-card-bg);
		color: var(--reader-fg);
	}
	.action-btn.remove:hover {
		color: var(--reader-heart);
	}
	.action-btn.add {
		font-weight: 600;
	}

	.depth-cap {
		font-size: 0.8rem;
		color: var(--reader-muted);
		font-style: italic;
		margin: 0;
		padding-top: 4px;
		padding-bottom: 4px;
	}

	/* ─── "Group under" modal dialog ─── */
	.group-dialog {
		max-width: 480px;
		width: 90vw;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		padding: 1.25rem 1.5rem;
		font-family: system-ui, sans-serif;
	}
	.group-dialog::backdrop {
		background: rgba(0, 0, 0, 0.4);
	}
	.group-dialog h2 {
		font-size: 1.05rem;
		margin: 0 0 1rem;
		font-weight: 600;
	}
	.picker-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 0.75rem;
	}
	.picker-label > span {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
	}
	.picker-label select {
		font: inherit;
		font-size: 0.9rem;
		padding: 6px 8px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		cursor: pointer;
	}
	.dialog-note {
		font-size: 0.85rem;
		color: var(--reader-muted);
		margin: 0 0 0.75rem;
		line-height: 1.45;
	}
	.hide-label {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		font-size: 0.85rem;
		color: var(--reader-fg);
		margin: 0 0 1rem;
		line-height: 1.4;
	}
	.hide-label input {
		accent-color: var(--reader-fg);
		margin-top: 2px;
		flex: 0 0 auto;
	}
	.dialog-error {
		color: #b00;
		font-size: 0.85rem;
		margin: 0 0 0.75rem;
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
	.dialog-actions .primary {
		background: var(--reader-fg);
		color: var(--reader-bg);
		border: 1px solid var(--reader-fg);
	}
	.dialog-actions .primary:hover {
		background: var(--reader-accent);
	}
	.dialog-actions .primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
