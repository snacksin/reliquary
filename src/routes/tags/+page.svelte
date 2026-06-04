<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import {
		addTagAlias,
		getTagAliases,
		removeTagAlias,
		setTagAliasHidden,
		type Tag,
		type TagAlias,
		type TagAliasList,
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
	 * Which tag's edit panel is currently expanded. One at a time keeps
	 * the page from sprawling and matches how the FilterSidebar handles
	 * its own per-section expand state.
	 */
	let expandedTagId = $state<number | null>(null);
	/**
	 * Cached alias lists per tag id, populated lazily on expand. Keeps
	 * the initial /tags load small (a few hundred tag rows, no edges).
	 */
	let aliasLists = $state<Record<number, TagAliasList>>({});
	let loadingAlias = $state<Record<number, boolean>>({});
	let aliasError = $state<Record<number, string | null>>({});

	/**
	 * Local form state for the add-alias picker on each tag. Keyed by
	 * parent tag id so multiple tags' forms don't trample each other if
	 * the user briefly opens a second tag without dismissing the first.
	 */
	let addChildId = $state<Record<number, number | ''>>({});
	let addHideFlag = $state<Record<number, boolean>>({});

	async function toggleExpand(tagId: number) {
		if (expandedTagId === tagId) {
			expandedTagId = null;
			return;
		}
		expandedTagId = tagId;
		if (!aliasLists[tagId]) await loadAliases(tagId);
	}

	async function loadAliases(tagId: number) {
		loadingAlias[tagId] = true;
		aliasError[tagId] = null;
		try {
			aliasLists[tagId] = await getTagAliases(tagId, fetch);
		} catch (e) {
			aliasError[tagId] = e instanceof Error ? e.message : 'Failed to load aliases';
		} finally {
			loadingAlias[tagId] = false;
		}
	}

	/**
	 * Eligible-children dropdown for a parent: same category, not the
	 * parent itself, and not already a direct child. Sorted by usage
	 * count desc so the most-used tags surface first (mirrors the
	 * FilterSidebar's sort).
	 */
	function eligibleChildren(parent: Tag, category: TagCategory): Tag[] {
		const existing = new Set((aliasLists[parent.id]?.aliases ?? []).map((a) => a.id));
		return data.tagGroups[category].filter((t) => t.id !== parent.id && !existing.has(t.id));
	}

	async function handleAddAlias(parent: Tag) {
		const childId = addChildId[parent.id];
		if (typeof childId !== 'number') return;
		const hide = addHideFlag[parent.id] === true;
		try {
			await addTagAlias(parent.id, childId, hide, fetch);
			addChildId[parent.id] = '';
			addHideFlag[parent.id] = false;
			await loadAliases(parent.id);
			// Sidebar feed could have changed (hidden / un-hidden a child)
			// — refresh the whole library data so the FilterSidebar
			// reflects the new state on next navigation.
			await invalidateAll();
		} catch (e) {
			aliasError[parent.id] = e instanceof Error ? e.message : 'Failed to add alias';
		}
	}

	async function handleToggleHide(parentId: number, alias: TagAlias) {
		const newHide = alias.hide_from_sidebar === 0;
		try {
			await setTagAliasHidden(parentId, alias.id, newHide, fetch);
			await loadAliases(parentId);
			await invalidateAll();
		} catch (e) {
			aliasError[parentId] = e instanceof Error ? e.message : 'Failed to update alias';
		}
	}

	async function handleRemoveAlias(parentId: number, alias: TagAlias) {
		try {
			await removeTagAlias(parentId, alias.id, fetch);
			await loadAliases(parentId);
			await invalidateAll();
		} catch (e) {
			aliasError[parentId] = e instanceof Error ? e.message : 'Failed to remove alias';
		}
	}
</script>

<svelte:head><title>Manage Tags — Reliquary</title></svelte:head>

<main class="tags-page">
	<header>
		<p class="back"><a href="/">← Library</a></p>
		<h1>Manage Tags</h1>
		<p class="intro">
			Configure parent → child alias relationships within a category. Selecting a parent in
			the filter sidebar will also surface fics tagged with any descendant. Per-edge
			visibility lets you hide child tags from the sidebar without losing them from filter
			expansion.
		</p>
	</header>

	{#each CATEGORY_LABELS as { key, label } (key)}
		{@const tags = data.tagGroups[key]}
		{#if tags.length > 0}
			<section class="category-section">
				<h2>{label} <span class="cat-count">{tags.length}</span></h2>
				<ul class="tag-list">
					{#each tags as tag (tag.id)}
						<li
							class="tag-item"
							class:expanded={expandedTagId === tag.id}
							class:hidden-tag={tag.hidden_from_sidebar}
						>
							<button
								type="button"
								class="tag-row"
								onclick={() => toggleExpand(tag.id)}
								aria-expanded={expandedTagId === tag.id}
							>
								<span class="caret">{expandedTagId === tag.id ? '▾' : '▸'}</span>
								<span class="tag-name">{tag.name}</span>
								{#if tag.hidden_from_sidebar}
									<span class="hidden-badge" title="Hidden from filter sidebar">
										hidden
									</span>
								{/if}
								<span class="tag-count">({tag.count})</span>
							</button>

							{#if expandedTagId === tag.id}
								<div class="tag-detail">
									{#if loadingAlias[tag.id]}
										<p class="muted">Loading…</p>
									{:else if aliasLists[tag.id]}
										{@const aliases = aliasLists[tag.id].aliases}
										<div class="aliases">
											<h3>Aliases (direct children)</h3>
											{#if aliases.length === 0}
												<p class="muted">No aliases configured. Add one below.</p>
											{:else}
												<ul class="chip-row">
													{#each aliases as alias (alias.id)}
														<li
															class="alias-chip"
															class:hidden-edge={alias.hide_from_sidebar === 1}
														>
															<span class="chip-name">{alias.name}</span>
															<button
																type="button"
																class="chip-toggle"
																onclick={() => handleToggleHide(tag.id, alias)}
																title={alias.hide_from_sidebar === 1
																	? 'Currently hidden under this parent — click to show'
																	: 'Currently visible — click to hide this edge'}
															>
																{alias.hide_from_sidebar === 1 ? '🙈' : '👁'}
															</button>
															<button
																type="button"
																class="chip-remove"
																onclick={() => handleRemoveAlias(tag.id, alias)}
																aria-label="Remove alias"
															>
																×
															</button>
														</li>
													{/each}
												</ul>
											{/if}
										</div>

										<form
											class="add-alias"
											onsubmit={(e) => {
												e.preventDefault();
												handleAddAlias(tag);
											}}
										>
											<h3>Add alias</h3>
											<label>
												<span class="visually-hidden">Child tag</span>
												<select
													bind:value={addChildId[tag.id]}
													required
												>
													<option value="" disabled selected>
														Pick a {label.toLowerCase()} tag…
													</option>
													{#each eligibleChildren(tag, key) as child (child.id)}
														<option value={child.id}>
															{child.name} ({child.count})
														</option>
													{/each}
												</select>
											</label>
											<label class="hide-checkbox">
												<input
													type="checkbox"
													bind:checked={addHideFlag[tag.id]}
												/>
												Hide from filter sidebar
											</label>
											<button type="submit" class="primary">Add alias</button>
										</form>
									{/if}

									{#if aliasError[tag.id]}
										<p class="error">{aliasError[tag.id]}</p>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</main>

<style>
	.tags-page {
		max-width: 800px;
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
	.intro {
		font-size: 0.9rem;
		color: var(--reader-muted);
		margin: 0;
		max-width: 60ch;
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

	.tag-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--reader-border);
	}
	.tag-item {
		border-bottom: 1px solid var(--reader-border);
	}
	.tag-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		cursor: pointer;
	}
	.tag-row:hover .tag-name {
		text-decoration: underline;
	}
	.caret {
		display: inline-block;
		width: 12px;
		text-align: center;
		color: var(--reader-muted);
		font-size: 0.75rem;
		line-height: 1;
	}
	.tag-name {
		flex: 1 1 auto;
		word-break: break-word;
	}
	.tag-count {
		flex: 0 0 auto;
		font-size: 0.8rem;
		color: var(--reader-muted);
	}
	.hidden-badge {
		flex: 0 0 auto;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--reader-border);
		color: var(--reader-muted);
		background: var(--reader-card-bg);
	}
	.hidden-tag .tag-name {
		opacity: 0.7;
	}

	.tag-detail {
		padding: 0.5rem 0 1rem 1.5rem;
	}
	.tag-detail h3 {
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin: 0.5rem 0 0.4rem;
	}
	.muted {
		font-size: 0.85rem;
		color: var(--reader-muted);
		margin: 0;
	}

	.chip-row {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.alias-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 6px 3px 10px;
		background: var(--reader-card-bg);
		border: 1px solid var(--reader-border);
		border-radius: 999px;
		font-size: 0.85rem;
	}
	.alias-chip.hidden-edge {
		opacity: 0.65;
		border-style: dashed;
	}
	.chip-name {
		font-weight: 500;
	}
	.chip-toggle,
	.chip-remove {
		padding: 0;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		line-height: 1;
	}
	.chip-toggle:hover,
	.chip-remove:hover {
		background: var(--reader-bg);
		color: var(--reader-fg);
	}
	.chip-remove:hover {
		color: var(--reader-heart);
	}

	.add-alias {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.75rem;
		background: var(--reader-card-bg);
		border-radius: 4px;
	}
	.add-alias h3 {
		flex-basis: 100%;
		margin: 0;
	}
	.add-alias label {
		flex: 1 1 200px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.add-alias select {
		flex: 1 1 auto;
		min-width: 0;
		padding: 4px 6px;
		font: inherit;
		font-size: 0.85rem;
		background: transparent;
		color: var(--reader-fg);
		border: 1px solid var(--reader-border);
		border-radius: 3px;
	}
	.add-alias .hide-checkbox {
		flex: 0 0 auto;
		font-size: 0.8rem;
		color: var(--reader-muted);
	}
	.add-alias .hide-checkbox input {
		accent-color: var(--reader-fg);
	}
	.add-alias .primary {
		padding: 4px 12px;
		font: inherit;
		font-size: 0.85rem;
		background: var(--reader-fg);
		color: var(--reader-bg);
		border: 1px solid var(--reader-fg);
		border-radius: 3px;
		cursor: pointer;
	}
	.add-alias .primary:hover {
		background: var(--reader-accent);
	}

	.error {
		color: #b00;
		font-size: 0.85rem;
		margin: 0.5rem 0 0;
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
</style>
