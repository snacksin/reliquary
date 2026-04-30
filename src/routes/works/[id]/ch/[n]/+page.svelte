<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Reliquary</title>
	<style>
		body {
			margin: 0;
			background: #f6f2e4;
		}
	</style>
</svelte:head>

<article class="reader">
	{@html data.html}
</article>

<style>
	.reader {
		max-width: 680px;
		margin: 0 auto;
		padding: 80px 40px;
		font-family: Georgia, serif;
		font-size: 18px;
		line-height: 1.6;
		color: #3b2328;
	}
</style>
