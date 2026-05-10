<script lang="ts">
	import SettingsPanel from '$lib/SettingsPanel.svelte';

	let { html }: { html: string } = $props();
</script>

<SettingsPanel />

<article class="reader">
	{@html html}
</article>

<style>
	.reader {
		max-width: 680px;
		margin: 0 auto;
		padding: 80px 40px;
		font-family: Georgia, serif;
		font-size: 18px;
		line-height: 1.6;
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
</style>
