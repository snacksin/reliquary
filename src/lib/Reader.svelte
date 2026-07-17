<script lang="ts">
	import { skinPref } from '$lib/prefs.svelte';

	let {
		html,
		workId,
		hasSkin = false
	}: { html: string; workId: string; hasSkin?: boolean } = $props();

	// WS Part 2: register the current work with the global settings panel
	// (client-only — SSR never mutates the module store) so it can offer the
	// per-fic "Hide creator's style" toggle. Cleared on unmount/navigation.
	$effect(() => {
		skinPref.register(workId, hasSkin);
		return () => skinPref.clear();
	});

	// Skins are ON by default in ALL themes; the toggle is the escape hatch.
	// SSR renders the link whenever the work has a skin (default state); a
	// saved per-fic "hidden" pref applies at hydration via the store.
	const showSkin = $derived(hasSkin && !(skinPref.ctx?.workId === workId && skinPref.ctx.hidden));
</script>

<svelte:head>
	{#if showSkin}
		<link rel="stylesheet" href="/api/works/{workId}/skin" />
	{/if}
</svelte:head>

<!--
	Back-to-detail button: fixed top-left on every reader surface
	(chapter / preface / afterword, all of which render through this
	component). Mirrors the detail page's top-left "← Library" back
	idiom and pairs symmetrically with the global hamburger fixed
	top-right (SettingsPanel.svelte) — same box chrome, opposite corner.
-->
<a class="back-to-detail" href="/works/{workId}" aria-label="Back to work details">
	<span aria-hidden="true">←</span>
</a>

<article class="reader">
	<!-- WS Part 2: the #workskin container — the AO3 idiom. Every stored
	     skin selector is prefixed with #workskin at ingest, so creator CSS
	     can only ever style THIS subtree; relative+isolate keep absolute
	     positioning and z-index stacked inside the fic content. Native
	     <details> folds work here with or without a skin (#81). -->
	<div id="workskin">
		{@html html}
	</div>
</article>

<style>
	/* Fixed top-left, matching the hamburger's box chrome
	   (SettingsPanel.svelte) so the two read as a symmetric pair:
	   back top-left, settings top-right. Reuses the --reader-* vars so
	   it stays legible across paper / sepia / dark. */
	.back-to-detail {
		position: fixed;
		top: 16px;
		left: 16px;
		z-index: 100;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		line-height: 1;
		text-decoration: none;
		border: 1px solid var(--reader-border);
		background: var(--reader-bg);
		color: var(--reader-fg);
		border-radius: 6px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}
	.back-to-detail:hover {
		border-color: var(--reader-accent);
	}
	.reader {
		max-width: var(--reader-max-width);
		margin: 0 auto;
		padding: 80px 40px;
		font-family: var(--reader-font-family);
		font-size: var(--reader-font-size);
		line-height: var(--reader-line-height);
		color: var(--reader-fg);
	}
	/* Constrain embedded images (header banners, chapter art) to the
	   reading column width so wide ones don't force horizontal page
	   scroll. height: auto preserves aspect ratio. */
	.reader :global(img) {
		max-width: 100%;
		height: auto;
	}
	/* AO3 chapter HTML is full of links (tag lists in the preface,
	   inline references in chapter text). Theme them so dark mode
	   doesn't render them in the unreadable browser-default blue. */
	.reader :global(a) {
		color: var(--reader-link);
	}
	.reader :global(a:visited) {
		color: var(--reader-link-visited);
	}
	#workskin {
		position: relative;
		isolation: isolate;
	}
</style>
