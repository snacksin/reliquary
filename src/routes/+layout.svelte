<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import SettingsPanel from '$lib/SettingsPanel.svelte';
	import TopNav from '$lib/TopNav.svelte';
	import { themeStore } from '$lib/theme.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	// Browse-pages top nav (Author/Series Pages): only the library, author,
	// and series pages get the Library | Authors | Series header — never fic
	// detail, the reader, or the /tags & /trash management pages.
	const showTopNav = $derived(
		page.route.id === '/' ||
			(page.route.id ?? '').startsWith('/authors') ||
			(page.route.id ?? '').startsWith('/series')
	);

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

<!--
	The settings panel renders globally so the user can switch theme
	(and, after Step 8, font/size/line-height/column-width) from any
	page — library, detail, preface, afterword, chapter. The
	hamburger button is fixed-position top-right; click-outside-
	to-close logic lives inside SettingsPanel.svelte.
-->
<SettingsPanel />

{#if showTopNav}
	<TopNav />
{/if}

{@render children()}
