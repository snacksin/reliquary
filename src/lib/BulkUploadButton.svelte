<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	/**
	 * State machine for the bulk-upload flow:
	 *   idle      — just the "Import EPUBs" button visible
	 *   uploading — request in flight; progress line below the button
	 *   done      — summary line; failure details expandable
	 *
	 * `errorMsg` is separate so a network failure (NDJSON stream
	 * aborted, server unreachable) doesn't get conflated with per-file
	 * ingest errors (which arrive in the structured `done` message).
	 */
	type Progress = { current: number; total: number; filename: string };
	type BulkResult = {
		uploaded: { work_id: string; filename: string }[];
		failed: { filename: string; reason: string }[];
	};

	let fileInput: HTMLInputElement | undefined = $state();
	let uploadState = $state<'idle' | 'uploading' | 'done'>('idle');
	let progress = $state<Progress | null>(null);
	let result = $state<BulkResult | null>(null);
	let errorMsg = $state<string | null>(null);
	let showFailures = $state(false);

	/**
	 * Stream the NDJSON response, accumulating messages into UI state.
	 * Each chunk may contain partial lines, so we buffer until newlines
	 * to keep JSON.parse happy. The `{ stream: true }` decode handles
	 * multi-byte UTF-8 sequences that span chunk boundaries.
	 */
	async function consumeStream(body: ReadableStream<Uint8Array>) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					let msg: unknown;
					try {
						msg = JSON.parse(line);
					} catch {
						console.error('[bulk-upload] bad NDJSON line:', line);
						continue;
					}
					if (
						msg &&
						typeof msg === 'object' &&
						'type' in msg &&
						(msg as { type: string }).type === 'progress'
					) {
						progress = msg as unknown as Progress;
					} else if (
						msg &&
						typeof msg === 'object' &&
						'type' in msg &&
						(msg as { type: string }).type === 'done'
					) {
						result = msg as unknown as BulkResult;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async function handleFiles(files: File[]) {
		if (files.length === 0) return;
		uploadState = 'uploading';
		progress = { current: 0, total: files.length, filename: '' };
		result = null;
		errorMsg = null;
		showFailures = false;

		const fd = new FormData();
		for (const f of files) fd.append('file', f);

		try {
			const res = await fetch('/api/bulk-upload', { method: 'POST', body: fd });
			if (!res.ok) {
				let detail = '';
				try {
					const body = await res.json();
					if (typeof body?.message === 'string') detail = body.message;
				} catch {
					// non-JSON response (network error page, etc.)
				}
				throw new Error(detail || `Server returned ${res.status}`);
			}
			if (!res.body) {
				throw new Error('Empty response from server');
			}
			await consumeStream(res.body);
			uploadState = 'done';
		} catch (e) {
			uploadState = 'done';
			errorMsg = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			// Refresh the library no matter how we got here — any successful
			// uploads in the batch should appear, even if the stream broke
			// mid-way or one file errored.
			await invalidateAll();
		}
	}

	function handleChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = ''; // reset so picking the same files again triggers change
		handleFiles(files);
	}

	function dismiss() {
		uploadState = 'idle';
		progress = null;
		result = null;
		errorMsg = null;
		showFailures = false;
	}
</script>

<div class="bulk-upload">
	<button
		class="bulk-button"
		onclick={() => fileInput?.click()}
		disabled={uploadState === 'uploading'}
	>
		{uploadState === 'uploading' ? 'Importing…' : 'Import EPUBs'}
	</button>
	<input
		bind:this={fileInput}
		type="file"
		accept=".epub,application/epub+zip"
		multiple
		hidden
		onchange={handleChange}
	/>

	{#if uploadState === 'uploading' && progress}
		<p class="progress" aria-live="polite">
			Uploading {progress.current} of {progress.total}{#if progress.filename}:
				<span class="filename">{progress.filename}</span>{/if}
		</p>
	{/if}

	{#if uploadState === 'done' && result}
		<div class="summary" aria-live="polite">
			<p class="summary-line">
				<strong>{result.uploaded.length}</strong> uploaded
				{#if result.failed.length > 0}
					· <strong>{result.failed.length}</strong> failed
					<button
						type="button"
						class="link"
						onclick={() => (showFailures = !showFailures)}
					>
						{showFailures ? 'Hide' : 'Show'} details
					</button>
				{/if}
				<button
					type="button"
					class="dismiss"
					onclick={dismiss}
					aria-label="Dismiss summary"
				>
					×
				</button>
			</p>
			{#if showFailures && result.failed.length > 0}
				<ul class="failures">
					{#each result.failed as f (f.filename)}
						<li>
							<code>{f.filename}</code> — {f.reason}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if errorMsg}
		<p class="error">{errorMsg}</p>
	{/if}
</div>

<style>
	.bulk-upload {
		display: contents;
	}
	.bulk-button {
		padding: 0.4rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	.bulk-button[disabled] {
		opacity: 0.6;
		cursor: progress;
	}
	.progress {
		/* Full-width row inside the flex parent (.library-header). */
		flex-basis: 100%;
		font-size: 0.85rem;
		color: var(--reader-muted);
		margin: 0.25rem 0 0;
	}
	.progress .filename {
		color: var(--reader-fg);
		font-weight: 500;
		word-break: break-all;
	}
	.summary {
		flex-basis: 100%;
		margin: 0.5rem 0 0;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.summary-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0;
	}
	.summary-line strong {
		font-weight: 600;
	}
	.link {
		font: inherit;
		font-size: 0.8rem;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--reader-link);
		cursor: pointer;
		text-decoration: underline;
	}
	.dismiss {
		margin-left: auto;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--reader-muted);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.6;
		transition: opacity 100ms ease;
	}
	.dismiss:hover,
	.dismiss:focus-visible {
		opacity: 1;
		color: var(--reader-heart);
	}
	.failures {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		max-height: 200px;
		overflow-y: auto;
	}
	.failures li {
		padding: 2px 0;
		color: var(--reader-muted);
	}
	.failures code {
		color: var(--reader-fg);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85em;
	}
	.error {
		flex-basis: 100%;
		color: #b00;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
</style>
