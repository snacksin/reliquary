<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { browser } from '$app/environment';
	import { saveNote } from '$lib/api';

	/**
	 * Per-work markdown note (you-layer Step 2). View-with-edit toggle: the
	 * saved note renders by default with an Edit button; Edit reveals a
	 * full-width textarea with Save / Cancel. Explicit Save (mirrors the
	 * author-notes idiom) advances the local baseline — no invalidateAll, no
	 * page flash. An empty Save clears the note (server DELETEs the row).
	 *
	 * The note is parsed (marked) and SANITIZED (DOMPurify) before `{@html}` —
	 * it's user input rendered as HTML. DOMPurify needs a DOM, so the render
	 * runs only in the browser; SSR shows the raw markdown as escaped text
	 * (never unsanitized HTML) until hydration swaps in the sanitized render.
	 */
	type Props = { workId: string; note: string | null };
	let { workId, note }: Props = $props();

	// svelte-ignore state_referenced_locally
	let baseline = $state(note ?? '');
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	const hasNote = $derived(baseline.trim() !== '');
	const rendered = $derived(
		browser && hasNote ? DOMPurify.sanitize(marked.parse(baseline, { async: false })) : ''
	);

	function startEdit() {
		draft = baseline;
		error = null;
		editing = true;
	}

	function cancel() {
		editing = false;
		error = null;
	}

	async function save() {
		saving = true;
		error = null;
		try {
			await saveNote(workId, draft, fetch);
			// Empty body clears server-side; mirror that locally.
			baseline = draft.trim() === '' ? '' : draft;
			editing = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not save note';
		} finally {
			saving = false;
		}
	}
</script>

<section class="notes">
	<h2>Notes</h2>
	{#if editing}
		<textarea
			class="note-editor"
			bind:value={draft}
			placeholder="Write a note in markdown — your thoughts, content notes, where to pick up…"
		></textarea>
		<div class="note-actions">
			<button type="button" class="secondary" onclick={cancel} disabled={saving}>Cancel</button>
			<button type="button" class="primary" onclick={save} disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
		{#if error}<p class="error">{error}</p>{/if}
	{:else if hasNote}
		<div class="note-rendered">
			{#if rendered}{@html rendered}{:else}<p class="note-raw">{baseline}</p>{/if}
		</div>
		<button type="button" class="edit-btn" onclick={startEdit}>Edit</button>
	{:else}
		<button type="button" class="edit-btn" onclick={startEdit}>Add note</button>
	{/if}
</section>

<style>
	.notes {
		margin-top: 2rem;
	}
	.notes h2 {
		font-size: 1.1rem;
		margin: 0 0 0.6rem;
	}
	/* Full-width editor; taller on desktop, compact on small windows. */
	.note-editor {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.55;
		padding: 10px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		resize: vertical;
		min-height: 140px;
	}
	@media (max-width: 600px) {
		.note-editor {
			min-height: 96px;
			padding: 8px;
		}
	}
	.note-editor::placeholder {
		color: var(--reader-muted);
		opacity: 0.7;
	}
	.note-editor:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	.note-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.note-actions button {
		font: inherit;
		font-size: 0.85rem;
		padding: 5px 14px;
		border-radius: 4px;
		cursor: pointer;
	}
	.note-actions .primary {
		border: 1px solid var(--reader-fg);
		background: var(--reader-fg);
		color: var(--reader-bg);
	}
	.note-actions .primary:hover:not(:disabled) {
		background: var(--reader-accent);
		border-color: var(--reader-accent);
	}
	.note-actions .secondary {
		border: 1px solid var(--reader-border);
		background: transparent;
		color: var(--reader-fg);
	}
	.note-actions .secondary:hover:not(:disabled) {
		background: var(--reader-card-bg);
	}
	.note-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Rendered (sanitized) note. Card-framed; theme-aware element styles. */
	.note-rendered {
		background: var(--reader-card-bg);
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.95rem;
		line-height: 1.6;
	}
	.note-rendered :global(p) {
		margin: 0.5rem 0;
	}
	.note-rendered :global(h1),
	.note-rendered :global(h2),
	.note-rendered :global(h3) {
		font-size: 1.05rem;
		margin: 0.75rem 0 0.4rem;
	}
	.note-rendered :global(ul),
	.note-rendered :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.4rem;
	}
	.note-rendered :global(a) {
		color: var(--reader-link);
	}
	.note-rendered :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.88em;
		background: var(--reader-bg);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
	.note-rendered :global(blockquote) {
		margin: 0.5rem 0;
		padding-left: 0.8rem;
		border-left: 3px solid var(--reader-border);
		color: var(--reader-muted);
	}
	/* Pre-hydration / SSR fallback: raw markdown shown as escaped text. */
	.note-raw {
		white-space: pre-wrap;
		margin: 0;
		color: var(--reader-muted);
	}
	.edit-btn {
		margin-top: 0.5rem;
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 12px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		cursor: pointer;
	}
	.edit-btn:hover {
		border-color: var(--reader-accent);
	}
	.error {
		color: #b00;
		font-size: 0.85rem;
		margin: 0.4rem 0 0;
	}
</style>
