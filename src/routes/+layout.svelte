<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { themeStore } from '$lib/theme.svelte';

	let { children } = $props();

	// Mirror the themeStore reactively onto <html data-theme="..." />.
	// The inline boot script in app.html sets the attribute synchronously
	// before paint on cold loads (anti-flash); this $effect keeps it in
	// sync as the user toggles themes from the settings panel and also
	// triggers themeStore's lazy hydration from localStorage on the
	// first client render.
	$effect(() => {
		const t = themeStore.value;
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', t);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
