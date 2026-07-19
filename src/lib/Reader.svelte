<script lang="ts">
	import { skinsPref } from '$lib/prefs.svelte';

	let {
		html,
		workId,
		hasSkin = false
	}: { html: string; workId: string; hasSkin?: boolean } = $props();

	// Code Health 1.5: skins are gated by the GLOBAL "Hide creator's styles"
	// pref (supersedes the WS per-fic toggle). Skins ON by default in ALL
	// themes. During SSR the pref reads its default ('show'), so a skinned
	// work always server-renders its <link> — the common case paints styled
	// with no flash — and the gate script below covers the saved-hide case.
	const showSkin = $derived(hasSkin && skinsPref.value === 'show');

	// Pre-hydration anti-flash for a saved "hide": SSR can't read
	// localStorage, so the link above is already in the document — this gate
	// rides immediately after it and disables it BEFORE first paint (the
	// app.html boot script runs too early: the link doesn't exist yet at
	// that point in the parse). Inert on client-side navigations — {@html}
	// inserts scripts without executing them — where the reactive `showSkin`
	// already decides. Keep the key in sync with skinsPref in prefs.svelte.ts.
	// (Concatenated closer so the literal never contains "</script"— that
	// sequence would terminate this component's script block during parse.)
	const SKIN_GATE =
		`<script>try{if(localStorage.getItem('prefs:reader:skins')==='hide')` +
		`{var l=document.getElementById('skin-css');if(l)l.disabled=true}}catch(e){}</` +
		`script>`;
</script>

<svelte:head>
	{#if showSkin}
		<link id="skin-css" rel="stylesheet" href="/api/works/{workId}/skin" />
		<!-- Static gate script above — no user input involved. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html SKIN_GATE}
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
