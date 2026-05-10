<script lang="ts">
	import { themeStore, THEMES, type Theme } from '$lib/theme.svelte';

	/**
	 * Reader settings panel. Step 7 has only the Theme fieldset; Step 8
	 * adds Font / Size / Line-height / Column-width fieldsets to the
	 * same `<form>` shell. Keep the structure (button + panel + fieldsets)
	 * stable so step 8's diff is just additive.
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
		margin: 0;
	}
	legend {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--reader-muted);
		margin-bottom: 8px;
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
</style>
