<script lang="ts">
	import SettingsPanel from '$lib/SettingsPanel.svelte';

	let { html }: { html: string } = $props();
</script>

<svelte:head>
	<style>
		body {
			margin: 0;
			background: var(--reader-bg);
		}
	</style>
</svelte:head>

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
</style>
