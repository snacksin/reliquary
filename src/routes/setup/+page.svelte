<script lang="ts">
	import { goto } from '$app/navigation';
	import { setupPassword } from '$lib/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const passwordSet = $derived(data.status.passwordSet);

	let password = $state('');
	let confirm = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
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
</script>

<svelte:head><title>Reliquary — Setup</title></svelte:head>

<main class="setup-page">
	<header>
		<p class="back"><a href="/">← Library</a></p>
		<h1>Set a LAN password</h1>
		{#if passwordSet}
			<p class="explainer">
				A password is already set. To change or remove it, run
				<code>node scripts/reset-password.mjs</code> on the server and set a new one here — a settings-panel
				change flow is coming with the login gate.
			</p>
		{:else}
			<p class="explainer">
				This password will guard Reliquary once the login gate arrives: anyone on your wifi who
				opens the app will need it. Until you set one, the app simply stays open. There's no
				recovery flow — if you forget it, run <code>node scripts/reset-password.mjs</code> on the server
				to clear it and set a new one.
			</p>
		{/if}
	</header>

	{#if error}
		<p class="page-error" role="alert">{error}</p>
	{/if}

	{#if passwordSet}
		<p class="empty-state">Nothing to do here — your password is in place.</p>
	{:else}
		<form onsubmit={submit}>
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
	{/if}
</main>

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
	.explainer {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--reader-muted);
		margin: 0.5rem 0 0;
		max-width: 62ch;
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
	.empty-state {
		color: var(--reader-muted);
		font-size: 0.95rem;
		padding: 2rem 0;
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
</style>
