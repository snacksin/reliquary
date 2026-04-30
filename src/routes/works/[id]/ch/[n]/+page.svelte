<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Reliquary</title></svelte:head>

<article class="reader">
	{@html data.html}
</article>

<style>
	.reader {
		max-width: 680px;
		margin: 0 auto;
		padding: 2rem 1rem;
		font-family: Georgia, serif;
		font-size: 18px;
		line-height: 1.6;
	}
</style>
