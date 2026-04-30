<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	onMount(() => {
		const key = `scroll:${page.params.id}:${page.params.n}`;
		const saved = localStorage.getItem(key);
		if (saved !== null) {
			const y = Number(saved);
			if (Number.isFinite(y)) window.scrollTo(0, y);
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onScroll = () => {
			clearTimeout(timer);
			timer = setTimeout(() => localStorage.setItem(key, String(window.scrollY)), 500);
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			clearTimeout(timer);
			window.removeEventListener('scroll', onScroll);
		};
	});
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
