<script lang="ts">
	import Reader from '$lib/Reader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Reliquary — Tags & metadata</title></svelte:head>

<Reader html={data.html} workId={data.workId} />
