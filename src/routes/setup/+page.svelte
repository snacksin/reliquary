<script lang="ts">
	import { goto } from '$app/navigation';
	import { changePassword, removePassword, setupPassword } from '$lib/api';
	import type { PageProps } from './$types';

	/**
	 * The LAN password management page (M2.2). No password → first-run
	 * set form (the server auto-logs-in the setting device). Password
	 * set → change (current-password-required, rotates other devices
	 * out) and remove (current-password-required, gate off). The gate
	 * guards this page once a password exists, so the set/unset branch
	 * doubles as an auth statement: whoever sees the second branch is
	 * logged in.
	 */

	let { data }: PageProps = $props();
	const passwordSet = $derived(data.status.passwordSet);

	// ─── First-run set form ──────────────────────────────────────────
	let password = $state('');
	let confirm = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submitSet(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (password.length === 0) {
			error = 'Password must not be empty.';
			return;
		}
		if (password !== confirm) {
			error = "Passwords don't match.";
			return;
		}
		busy = true;
		try {
			await setupPassword(password, fetch);
			await goto('/');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not set password';
		} finally {
			busy = false;
		}
	}

	// ─── Change form ─────────────────────────────────────────────────
	let currentPw = $state('');
	let newPw = $state('');
	let confirmNew = $state('');
	let changeError = $state<string | null>(null);
	let changeDone = $state(false);
	let changing = $state(false);

	async function submitChange(e: SubmitEvent) {
		e.preventDefault();
		changeError = null;
		changeDone = false;
		if (newPw.length === 0) {
			changeError = 'New password must not be empty.';
			return;
		}
		if (newPw !== confirmNew) {
			changeError = "New passwords don't match.";
			return;
		}
		changing = true;
		try {
			await changePassword(currentPw, newPw, fetch);
			currentPw = '';
			newPw = '';
			confirmNew = '';
			changeDone = true;
		} catch (err) {
			changeError = err instanceof Error ? err.message : 'Could not change password';
		} finally {
			changing = false;
		}
	}

	// ─── Remove section (dialog-confirmed) ───────────────────────────
	let removePw = $state('');
	let removeError = $state<string | null>(null);
	let removing = $state(false);
	let removeDialog = $state<HTMLDialogElement | null>(null);
	let removeCancelEl = $state<HTMLButtonElement | null>(null);

	function openRemove() {
		removeError = null;
		removeDialog?.showModal();
		queueMicrotask(() => removeCancelEl?.focus());
	}

	function closeRemove() {
		removeDialog?.close();
	}

	function removeKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeRemove();
		}
	}

	async function confirmRemove() {
		removing = true;
		removeError = null;
		try {
			await removePassword(removePw, fetch);
			closeRemove();
			await goto('/');
		} catch (err) {
			closeRemove();
			removeError = err instanceof Error ? err.message : 'Could not remove password';
		} finally {
			removing = false;
		}
	}
</script>

<svelte:head><title>Reliquary — LAN password</title></svelte:head>

<main class="setup-page">
	<header>
		<p class="back"><a href="/">← Library</a></p>
		<h1>LAN password</h1>
		{#if passwordSet}
			<p class="explainer">
				Your library is behind the login gate. Change the password here, or remove it to turn the
				gate off entirely — both need the current password. Forgot it? Run
				<code>node scripts/reset-password.mjs</code> on the server: that clears it (and signs out every
				device), and this page will accept a new one.
			</p>
		{:else}
			<p class="explainer">
				Set a password and the login gate turns on: anyone on your wifi who opens Reliquary will
				need it. Until you set one, the app simply stays open. There's no recovery flow — if you
				forget it, run <code>node scripts/reset-password.mjs</code> on the server to clear it and set
				a new one.
			</p>
		{/if}
	</header>

	{#if !passwordSet}
		{#if error}
			<p class="page-error" role="alert">{error}</p>
		{/if}
		<form onsubmit={submitSet}>
			<label>
				Password
				<input type="password" autocomplete="new-password" bind:value={password} disabled={busy} />
			</label>
			<label>
				Confirm password
				<input type="password" autocomplete="new-password" bind:value={confirm} disabled={busy} />
			</label>
			<button type="submit" disabled={busy}>
				{busy ? 'Setting…' : 'Set password'}
			</button>
		</form>
	{:else}
		<section>
			<h2>Change password</h2>
			{#if changeError}
				<p class="page-error" role="alert">{changeError}</p>
			{/if}
			{#if changeDone}
				<p class="page-success" role="status">
					Password changed — every other device was signed out; this one stays in.
				</p>
			{/if}
			<form onsubmit={submitChange}>
				<label>
					Current password
					<input
						type="password"
						autocomplete="current-password"
						bind:value={currentPw}
						disabled={changing}
					/>
				</label>
				<label>
					New password
					<input
						type="password"
						autocomplete="new-password"
						bind:value={newPw}
						disabled={changing}
					/>
				</label>
				<label>
					Confirm new password
					<input
						type="password"
						autocomplete="new-password"
						bind:value={confirmNew}
						disabled={changing}
					/>
				</label>
				<button type="submit" disabled={changing}>
					{changing ? 'Changing…' : 'Change password'}
				</button>
			</form>
		</section>

		<section class="remove-section">
			<h2>Remove password</h2>
			<p class="explainer">
				Removing the password turns the gate off — the library opens to anyone on your wifi again,
				and every device is signed out.
			</p>
			{#if removeError}
				<p class="page-error" role="alert">{removeError}</p>
			{/if}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					openRemove();
				}}
			>
				<label>
					Current password
					<input
						type="password"
						autocomplete="current-password"
						bind:value={removePw}
						disabled={removing}
					/>
				</label>
				<button type="submit" class="danger" disabled={removing || removePw.length === 0}>
					Remove password…
				</button>
			</form>
		</section>
	{/if}
</main>

<dialog bind:this={removeDialog} class="confirm-dialog" onkeydown={removeKeydown}>
	<h2>Turn the gate off?</h2>
	<p>
		The LAN password will be removed. Reliquary opens to anyone on your wifi, and every logged-in
		device is signed out. You can set a new password here any time.
	</p>
	<div class="dialog-actions">
		<button type="button" class="secondary" bind:this={removeCancelEl} onclick={closeRemove}>
			Cancel
		</button>
		<button type="button" class="dialog-danger" onclick={confirmRemove} disabled={removing}>
			{removing ? 'Removing…' : 'Remove password'}
		</button>
	</div>
</dialog>

<style>
	.setup-page {
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
	h1 {
		font-size: 1.6rem;
		margin: 0;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	section {
		margin-bottom: 2.5rem;
	}
	.remove-section {
		padding-top: 1.5rem;
		border-top: 1px solid var(--reader-border);
	}
	.explainer {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
		margin: 0.5rem 0 0;
		max-width: 62ch;
	}
	section .explainer {
		margin: 0 0 0.75rem;
	}
	.explainer code {
		font-size: 0.85em;
	}
	.page-error {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid #b00;
		color: #b00;
		font-size: 0.85rem;
	}
	.page-success {
		margin: 0 0 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--reader-card-bg);
		border-left: 3px solid var(--reader-accent);
		color: var(--reader-fg);
		font-size: 0.85rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 320px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--reader-muted);
	}
	input {
		font: inherit;
		font-size: 1rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		background: var(--reader-card-bg);
		color: var(--reader-fg);
	}
	input:focus {
		outline: none;
		border-color: var(--reader-accent);
	}
	button {
		font: inherit;
		font-size: 0.95rem;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--reader-accent);
		border-radius: 4px;
		background: var(--reader-accent);
		color: var(--reader-bg);
		cursor: pointer;
		align-self: flex-start;
	}
	button:hover:not(:disabled) {
		opacity: 0.9;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	button.danger {
		background: transparent;
		border-color: var(--reader-heart);
		color: var(--reader-heart);
	}

	.confirm-dialog {
		max-width: 26rem;
		padding: 1.25rem 1.5rem;
		border: 1px solid var(--reader-border);
		border-radius: 8px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		font-family: system-ui, sans-serif;
	}
	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.35);
	}
	.confirm-dialog h2 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
	}
	.confirm-dialog p {
		margin: 0 0 1rem;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.dialog-actions button {
		align-self: auto;
	}
	.dialog-actions .secondary {
		background: transparent;
		color: var(--reader-fg);
		border: 1px solid var(--reader-border);
	}
	.dialog-actions .secondary:hover {
		background: var(--reader-card-bg);
	}
	.dialog-actions .dialog-danger {
		background: var(--reader-heart);
		color: #fff;
		border: 1px solid var(--reader-heart);
	}
</style>
