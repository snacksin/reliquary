<script lang="ts">
	import { themeStore, THEMES, type Theme } from '$lib/theme.svelte';
	import {
		fontPref,
		FONT_TOKENS,
		FONT_LABELS,
		type FontToken,
		sizePref,
		SIZE_TOKENS,
		SIZE_LABELS,
		type SizeToken,
		lineHeightPref,
		LINE_HEIGHT_TOKENS,
		LINE_HEIGHT_LABELS,
		type LineHeightToken,
		widthPref,
		WIDTH_TOKENS,
		WIDTH_LABELS,
		type WidthToken
	} from '$lib/prefs.svelte';

	/**
	 * Reader settings panel. Theme + four reader-style prefs each as
	 * their own <fieldset> in a single <form> shell — the panel's
	 * structure is the M1 Step 7 shape unchanged.
	 */

	let open = $state(false);
	let panelEl: HTMLDivElement | undefined = $state();
	let buttonEl: HTMLButtonElement | undefined = $state();

	function toggle() {
		open = !open;
	}

	// Click-outside-to-close: only attach the listener while the panel
	// is open so we don't carry a permanent global handler. Use
	// `pointerdown` (not `click`) so the close fires before any click
	// handlers on the target run — feels snappier.
	$effect(() => {
		if (!open) return;
		function onPointerDown(e: PointerEvent) {
			const t = e.target as Node | null;
			if (!t) return;
			if (panelEl?.contains(t) || buttonEl?.contains(t)) return;
			open = false;
		}
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	const THEME_LABELS: Record<Theme, string> = {
		paper: 'Paper',
		sepia: 'Sepia',
		dark: 'Dark'
	};
</script>

<button
	bind:this={buttonEl}
	class="hamburger"
	type="button"
	aria-label="Reader settings"
	aria-expanded={open}
	onclick={toggle}
>
	<span aria-hidden="true">☰</span>
</button>

{#if open}
	<div bind:this={panelEl} class="panel" role="dialog" aria-label="Reader settings">
		<form>
			<fieldset>
				<legend>Theme</legend>
				{#each THEMES as t (t)}
					<label class="option">
						<input
							type="radio"
							name="reader-theme"
							value={t}
							checked={themeStore.value === t}
							onchange={() => (themeStore.value = t)}
						/>
						<span>{THEME_LABELS[t]}</span>
					</label>
				{/each}
			</fieldset>

			<fieldset class="select-row">
				<legend>Font</legend>
				<select
					value={fontPref.value}
					onchange={(e) => (fontPref.value = e.currentTarget.value as FontToken)}
				>
					{#each FONT_TOKENS as t (t)}
						<option value={t}>{FONT_LABELS[t]}</option>
					{/each}
				</select>
			</fieldset>

			<fieldset class="select-row">
				<legend>Font size</legend>
				<select
					value={sizePref.value}
					onchange={(e) => (sizePref.value = e.currentTarget.value as SizeToken)}
				>
					{#each SIZE_TOKENS as t (t)}
						<option value={t}>{SIZE_LABELS[t]}</option>
					{/each}
				</select>
			</fieldset>

			<fieldset class="select-row">
				<legend>Line height</legend>
				<select
					value={lineHeightPref.value}
					onchange={(e) =>
						(lineHeightPref.value = e.currentTarget.value as LineHeightToken)}
				>
					{#each LINE_HEIGHT_TOKENS as t (t)}
						<option value={t}>{LINE_HEIGHT_LABELS[t]}</option>
					{/each}
				</select>
			</fieldset>

			<fieldset class="select-row">
				<legend>Column width</legend>
				<select
					value={widthPref.value}
					onchange={(e) => (widthPref.value = e.currentTarget.value as WidthToken)}
				>
					{#each WIDTH_TOKENS as t (t)}
						<option value={t}>{WIDTH_LABELS[t]}</option>
					{/each}
				</select>
			</fieldset>

			<!--
				M2.1.5: link to the tag-alias management page. Sits at the
				bottom of the panel because it navigates away rather than
				flipping a per-device setting — it's a "go somewhere" action,
				not a "change something here" one.
			-->
			<nav class="panel-nav">
				<a href="/tags" onclick={() => (open = false)}>Manage tags →</a>
			</nav>
		</form>
	</div>
{/if}

<style>
	.hamburger {
		position: fixed;
		top: 16px;
		right: 16px;
		z-index: 100;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		line-height: 1;
		border: 1px solid var(--reader-border);
		background: var(--reader-bg);
		color: var(--reader-fg);
		border-radius: 6px;
		cursor: pointer;
		padding: 0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}
	.hamburger:hover {
		border-color: var(--reader-accent);
	}

	.panel {
		position: fixed;
		top: 64px;
		right: 16px;
		z-index: 99;
		min-width: 200px;
		padding: 12px 16px;
		background: var(--reader-bg);
		color: var(--reader-fg);
		border: 1px solid var(--reader-border);
		border-radius: 6px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
		font-family: system-ui, sans-serif;
		font-size: 14px;
	}

	fieldset {
		border: none;
		padding: 0;
		margin: 0 0 12px;
	}
	fieldset:last-of-type {
		margin-bottom: 0;
	}
	legend {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin-bottom: 6px;
	}
	.option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		cursor: pointer;
	}
	.option input {
		accent-color: var(--reader-fg);
	}
	.select-row select {
		width: 100%;
		padding: 4px 6px;
		font: inherit;
		color: var(--reader-fg);
		background: var(--reader-bg);
		border: 1px solid var(--reader-border);
		border-radius: 4px;
		cursor: pointer;
	}
	.panel-nav {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--reader-border);
		text-align: right;
	}
	.panel-nav a {
		color: var(--reader-link);
		text-decoration: none;
		font-size: 0.85rem;
	}
	.panel-nav a:hover {
		text-decoration: underline;
	}
</style>
