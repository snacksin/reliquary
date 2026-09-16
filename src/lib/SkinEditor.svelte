<script lang="ts">
	import { getSkin, saveSkin, clearSkin } from '$lib/api';

	/**
	 * "Creator's style" paste box (WS Part 3). AO3 ships the real work skin
	 * only in the live page's #workskin style block — no download format
	 * carries it — so this box is the manual acquisition path: paste whatever
	 * you copied from view-source (bare CSS, the style tag, or the whole
	 * page) and the server feeds it through the #82 sanitize → scope → serve
	 * pipeline. One skin per work: saving replaces, Remove restores no-skin.
	 * (No literal style tags in this comment — the svelte-check preprocessor
	 * regex-matches the first one in the file as the component's style block.)
	 *
	 * NotesEditor idiom: view-with-edit toggle, explicit Save advancing a
	 * local baseline (no invalidateAll, no nav flash), inline error on a
	 * paste that yields nothing usable (server rejects; nothing stored).
	 */
	type Props = { workId: string; hasSkin: boolean };
	let { workId, hasSkin }: Props = $props();

	// svelte-ignore state_referenced_locally
	let baseline = $state(hasSkin);
	let editing = $state(false);
	let draft = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	// WS Part 4: what the last save did, in words — "12 chapters updated" is
	// the signal that the page paste worked (a CSS-only paste says 0).
	let notice = $state<string | null>(null);

	// Replace pre-fills the STORED stylesheet (the sanitized/scoped form —
	// the original paste isn't retained), NotesEditor's edit-mode precedent:
	// an empty box over an existing skin reads as "my skin got cleared".
	// Fetch-then-open so the CSS never flashes in late; a failed fetch falls
	// back to the empty box + placeholder rather than blocking the edit.
	async function startEdit() {
		error = null;
		draft = '';
		if (baseline) {
			busy = true;
			try {
				draft = await getSkin(workId, fetch);
			} catch {
				/* no stored skin reachable — empty box + placeholder */
			}
			busy = false;
		}
		editing = true;
	}

	function cancel() {
		editing = false;
		error = null;
	}

	async function save() {
		busy = true;
		error = null;
		notice = null;
		try {
			const r = await saveSkin(workId, draft, fetch);
			if (r.skin) baseline = true;
			editing = false;
			const n = r.chapters_updated;
			const lead = r.skin ? 'Style saved · ' : '';
			if (n > 0) {
				notice = `${lead}${n} chapter${n === 1 ? '' : 's'} updated with the page's original formatting.`;
			} else if (r.chapters_unchanged > 0) {
				notice = `${lead}chapters already match the page — nothing to change.`;
			} else if (r.skin) {
				notice =
					'Style saved. No chapter formatting came with it — paste the whole page source (Entire Work view) to get the hooks the style needs.';
			} else {
				notice = 'Nothing changed.';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not save the creator's style";
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		error = null;
		notice = null;
		try {
			await clearSkin(workId, fetch);
			baseline = false;
			editing = false;
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not remove the creator's style";
		} finally {
			busy = false;
		}
	}
</script>

<section class="skin">
	<h2>Creator's style</h2>
	{#if editing}
		<textarea
			class="skin-editor"
			bind:value={draft}
			spellcheck="false"
			placeholder="On AO3: open the fic, click Entire Work, then right-click → View Page Source → select all → copy, and paste the whole page here. That brings over the creator's style AND the chapter formatting it needs (EPUBs lose the formatting). Pasting just the &lt;style&gt; block works too, but only for the style."
		></textarea>
		<p class="skin-hint">
			Pasting the whole page replaces this fic's chapter text with AO3's copy. The old versions are
			kept in History. Pictures will load from AO3 rather than from your library.
		</p>
		<div class="skin-actions">
			<button type="button" class="secondary" onclick={cancel} disabled={busy}>Cancel</button>
			<button type="button" class="primary" onclick={save} disabled={busy || draft.trim() === ''}>
				{busy ? 'Saving…' : 'Save'}
			</button>
		</div>
	{:else if baseline}
		<p class="skin-status">
			This fic has a creator's style — it applies in the reader (turn all creator styles off from
			the ☰ settings panel).
		</p>
		<div class="skin-actions start">
			<button type="button" class="edit-btn" onclick={startEdit} disabled={busy}>Replace</button>
			<button type="button" class="edit-btn" onclick={remove} disabled={busy}>
				{busy ? 'Removing…' : 'Remove'}
			</button>
		</div>
	{:else}
		<button type="button" class="edit-btn" onclick={startEdit}>Add creator's style</button>
	{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.skin {
		margin-top: 2rem;
	}
	.skin h2 {
		font-size: 1.1rem;
		margin: 0 0 0.6rem;
	}
	/* Paste target for raw CSS/page source — monospace, generous height so a
	   big paste doesn't feel cramped; same field chrome as the note editor. */
	.skin-editor {
		width: 100%;
		box-sizing: border-box;
		font-family: ui-monospace, monospace;
		font-size: 0.82rem;
		line-height: 1.5;
		padding: 10px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		resize: vertical;
		min-height: 140px;
	}
	.skin-editor::placeholder {
		/* The instructional hint IS the affordance (Allie's ask) — the
		   system-ui face keeps the multi-line instructions readable where the
		   monospace paste content wouldn't be. */
		font-family: system-ui, sans-serif;
		font-size: 0.88rem;
		color: var(--reader-muted);
		opacity: 0.8;
	}
	.skin-editor:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	.skin-status {
		font-size: 0.9rem;
		color: var(--reader-muted);
		margin: 0 0 0.5rem;
	}
	.skin-hint {
		font-size: 0.8rem;
		color: var(--reader-muted);
		margin: 0.4rem 0 0;
		line-height: 1.45;
	}
	.notice {
		font-size: 0.85rem;
		color: var(--reader-fg);
		background: var(--reader-card-bg);
		border-radius: 4px;
		padding: 0.4rem 0.7rem;
		margin: 0.5rem 0 0;
	}
	.skin-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.skin-actions.start {
		justify-content: flex-start;
		margin-top: 0;
	}
	.skin-actions .primary,
	.skin-actions .secondary {
		font: inherit;
		font-size: 0.85rem;
		padding: 5px 14px;
		border-radius: 4px;
		cursor: pointer;
	}
	.skin-actions .primary {
		border: 1px solid var(--reader-fg);
		background: var(--reader-fg);
		color: var(--reader-bg);
	}
	.skin-actions .primary:hover:not(:disabled) {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
	}
	.skin-actions .secondary {
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-fg);
	}
	.skin-actions .secondary:hover:not(:disabled) {
		background: var(--reader-card-bg);
	}
	.skin-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.edit-btn {
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		cursor: pointer;
	}
	.edit-btn:hover:not(:disabled) {
		border-color: var(--reader-accent);
	}
	.edit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.error {
		color: #b00;
		font-size: 0.85rem;
		margin: 0.4rem 0 0;
	}
</style>
