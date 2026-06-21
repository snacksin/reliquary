<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { restoreWork, purgeWork, emptyTrash, daysUntilPurge, type TrashedWork } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const trashed = $derived(data.trashed);

	let actionError = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	function trashedDate(iso: string): string {
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function purgeLabel(iso: string): string {
		const n = daysUntilPurge(iso);
		return n === 0 ? 'purges on next restart' : `${n} day${n === 1 ? '' : 's'} until purge`;
	}

	async function handleRestore(id: string) {
		actionError = null;
		busyId = id;
		try {
			await restoreWork(id, fetch);
			await invalidateAll();
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Restore failed';
		} finally {
			busyId = null;
		}
	}

	// ─── Delete-forever confirm dialog (one shared dialog, target by id) ─
	let deleteDialog = $state<HTMLDialogElement | null>(null);
	let deleteCancelEl = $state<HTMLButtonElement | null>(null);
	let deleteTarget = $state<TrashedWork | null>(null);

	function openDelete(work: TrashedWork) {
		actionError = null;
		deleteTarget = work;
		deleteDialog?.showModal();
		queueMicrotask(() => deleteCancelEl?.focus());
	}

	function closeDelete() {
		deleteDialog?.close();
		deleteTarget = null;
	}

	function deleteKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeDelete();
		}
	}

	async function confirmDelete() {
		const work = deleteTarget;
		if (!work) return;
		busyId = work.id;
		try {
			await purgeWork(work.id, fetch);
			closeDelete();
			await invalidateAll();
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Delete failed';
		} finally {
			busyId = null;
		}
	}

	// ─── Empty-trash confirm dialog ─────────────────────────────────
	let emptyDialog = $state<HTMLDialogElement | null>(null);
	let emptyCancelEl = $state<HTMLButtonElement | null>(null);
	let emptying = $state(false);

	function openEmpty() {
		actionError = null;
		emptyDialog?.showModal();
		queueMicrotask(() => emptyCancelEl?.focus());
	}

	function closeEmpty() {
		emptyDialog?.close();
	}

	function emptyKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeEmpty();
		}
	}

	async function confirmEmpty() {
		emptying = true;
		try {
			await emptyTrash(fetch);
			closeEmpty();
			await invalidateAll();
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Empty trash failed';
		} finally {
			emptying = false;
		}
	}
</script>

<svelte:head><title>Reliquary — Trash</title></svelte:head>

<main class="trash-page">
	<header>
		<p class="back"><a href="/">← Library</a></p>
		<div class="title-row">
			<h1>Trash</h1>
			{#if trashed.length > 0}
				<button type="button" class="empty-button" onclick={openEmpty}>Empty trash now</button>
			{/if}
		</div>
		<p class="explainer">
			Trashed fics are hidden from your library but not deleted. They're permanently removed 30
			days after you trash them — restore anything you want to keep before then.
		</p>
	</header>

	{#if actionError}
		<p class="page-error" role="alert">{actionError}</p>
	{/if}

	{#if trashed.length === 0}
		<p class="empty-state">Trash is empty — nothing waiting to be deleted.</p>
	{:else}
		<ul class="trash-list">
			{#each trashed as work (work.id)}
				<li class="trash-row" class:busy={busyId === work.id}>
					<div class="work-meta">
						<a class="work-title" href="/works/{work.id}">{work.title}</a>
						<p class="work-sub">
							by {work.author} · trashed {trashedDate(work.trashed_at)} ·
							<span class="purge-clock">{purgeLabel(work.trashed_at)}</span>
						</p>
					</div>
					<div class="row-actions">
						<button
							type="button"
							class="restore"
							onclick={() => handleRestore(work.id)}
							disabled={busyId === work.id}
						>
							Restore
						</button>
						<button
							type="button"
							class="delete"
							onclick={() => openDelete(work)}
							disabled={busyId === work.id}
						>
							Delete forever
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<dialog bind:this={deleteDialog} class="confirm-dialog" onkeydown={deleteKeydown} onclose={() => (deleteTarget = null)}>
	{#if deleteTarget}
		<h2>Delete forever?</h2>
		<p>
			“{deleteTarget.title}” and all its chapters, images, and saved edit history will be
			permanently deleted. This can't be undone.
		</p>
		<div class="dialog-actions">
			<button type="button" class="secondary" bind:this={deleteCancelEl} onclick={closeDelete}>
				Cancel
			</button>
			<button type="button" class="danger" onclick={confirmDelete} disabled={busyId !== null}>
				{busyId ? 'Deleting…' : 'Delete forever'}
			</button>
		</div>
	{/if}
</dialog>

<dialog bind:this={emptyDialog} class="confirm-dialog" onkeydown={emptyKeydown}>
	<h2>Empty Trash?</h2>
	<p>
		All {trashed.length} fic{trashed.length === 1 ? '' : 's'} in Trash will be permanently deleted,
		including their saved edit history. This can't be undone.
	</p>
	<div class="dialog-actions">
		<button type="button" class="secondary" bind:this={emptyCancelEl} onclick={closeEmpty}>
			Cancel
		</button>
		<button type="button" class="danger" onclick={confirmEmpty} disabled={emptying}>
			{emptying ? 'Emptying…' : 'Empty Trash'}
		</button>
	</div>
</dialog>

<style>
	.trash-page {
		max-width: 760px;
		margin: 2rem auto;
		padding: 0 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	header {
		margin-bottom: 1.5rem;
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
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h1 {
		font-size: 1.6rem;
		margin: 0;
	}
	.explainer {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
		margin: 0.5rem 0 0;
		max-width: 62ch;
	}
	.empty-button {
		flex: 0 0 auto;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: none;
		color: var(--reader-muted);
		cursor: pointer;
	}
	.empty-button:hover,
	.empty-button:focus-visible {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}
	.page-error {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid #b00;
		color: #b00;
		font-size: 0.85rem;
	}
	.empty-state {
		color: var(--reader-muted);
		font-size: 0.95rem;
		padding: 2rem 0;
	}
	.trash-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--reader-border);
	}
	.trash-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--reader-border);
	}
	.trash-row.busy {
		opacity: 0.55;
	}
	.work-meta {
		min-width: 0;
		flex: 1 1 16rem;
	}
	.work-title {
		font-weight: 500;
		color: var(--reader-fg);
		text-decoration: none;
		word-break: break-word;
	}
	.work-title:hover {
		text-decoration: underline;
	}
	.work-sub {
		margin: 0.15rem 0 0;
		font-size: 0.82rem;
		color: var(--reader-muted);
	}
	.purge-clock {
		white-space: nowrap;
	}
	.row-actions {
		flex: 0 0 auto;
		display: flex;
		gap: 0.5rem;
	}
	.row-actions button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		border-radius: 4px;
		cursor: pointer;
		background: none;
	}
	.row-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.restore {
		border: 1px solid var(--reader-border);
		color: var(--reader-fg);
	}
	.restore:hover:not(:disabled) {
		border-color: var(--reader-accent);
	}
	.delete {
		border: 1px solid var(--reader-border);
		color: var(--reader-muted);
	}
	.delete:hover:not(:disabled) {
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}

	/* Confirm dialogs — native-<dialog> idiom shared with /tags + detail. */
	.confirm-dialog {
		max-width: 440px;
		width: 90vw;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		padding: 1.25rem 1.5rem;
		font-family: system-ui, sans-serif;
	}
	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.4);
	}
	.confirm-dialog h2 {
		font-size: 1.05rem;
		margin: 0 0 0.75rem;
		font-weight: 600;
	}
	.confirm-dialog p {
		font-size: 0.9rem;
		line-height: 1.5;
		margin: 0 0 1rem;
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
