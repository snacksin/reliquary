<script lang="ts">
	import { tick } from 'svelte';
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

	// ─── Formatting toolbar (edit mode) ──────────────────────────────
	// Inserts markdown so you don't have to remember the syntax. Each command
	// wraps the current selection (or drops the markers at the cursor when
	// nothing is selected). `draft` is bound to the textarea, so we mutate it
	// then restore the caret/selection after the DOM updates (tick). The
	// textarea keeps its selectionStart/End across the button click (blur
	// doesn't clear them), so reading them here is safe.
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	async function surround(before: string, after: string) {
		const ta = textareaEl;
		if (!ta) return;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const sel = draft.slice(start, end);
		draft = draft.slice(0, start) + before + sel + after + draft.slice(end);
		await tick();
		ta.focus();
		// Re-select the wrapped text, or place the caret between the markers.
		const inner = start + before.length;
		ta.setSelectionRange(inner, inner + sel.length);
	}

	async function prefixLines(prefix: string) {
		const ta = textareaEl;
		if (!ta) return;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		// Expand to the start of the first selected line, then prefix each line.
		const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
		const prefixed = draft
			.slice(lineStart, end)
			.split('\n')
			.map((line) => prefix + line)
			.join('\n');
		draft = draft.slice(0, lineStart) + prefixed + draft.slice(end);
		await tick();
		ta.focus();
		ta.setSelectionRange(lineStart, lineStart + prefixed.length);
	}

	async function insertLink() {
		const ta = textareaEl;
		if (!ta) return;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const text = draft.slice(start, end) || 'text';
		const snippet = `[${text}](url)`;
		draft = draft.slice(0, start) + snippet + draft.slice(end);
		await tick();
		ta.focus();
		// Select the `url` placeholder so you can type the address next.
		const urlStart = start + snippet.length - 4;
		ta.setSelectionRange(urlStart, urlStart + 3);
	}
</script>

<section class="notes">
	<h2>Notes</h2>
	{#if editing}
		<div class="md-toolbar" role="toolbar" aria-label="Formatting">
			<button type="button" class="tb-btn bold" onclick={() => surround('**', '**')} title="Bold" aria-label="Bold">B</button>
			<button type="button" class="tb-btn italic" onclick={() => surround('_', '_')} title="Italic" aria-label="Italic">I</button>
			<button type="button" class="tb-btn" onclick={() => prefixLines('## ')} title="Heading" aria-label="Heading">H</button>
			<button type="button" class="tb-btn" onclick={() => prefixLines('- ')} title="Bulleted list" aria-label="Bulleted list">• List</button>
			<button type="button" class="tb-btn" onclick={() => prefixLines('1. ')} title="Numbered list" aria-label="Numbered list">1. List</button>
			<button type="button" class="tb-btn" onclick={insertLink} title="Link" aria-label="Link">Link</button>
		</div>
		<textarea
			class="note-editor"
			bind:this={textareaEl}
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
	/* Formatting toolbar — a compact button row above the textarea. Theme-aware
	   chips; sits flush on top of the editor. */
	.md-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 6px;
	}
	.tb-btn {
		font: inherit;
		font-size: 0.8rem;
		line-height: 1;
		padding: 5px 9px;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
		cursor: pointer;
	}
	.tb-btn:hover {
		border-color: var(--reader-accent);
	}
	.tb-btn.bold {
		font-weight: 700;
	}
	.tb-btn.italic {
		font-style: italic;
		font-family: Georgia, serif;
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
