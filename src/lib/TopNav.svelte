<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Browse-pages top nav (Author Pages Part 1). Rendered only on the
	 * library + author pages (see +layout.svelte), never on fic detail or
	 * the reader. "Series" is stubbed/hidden until that feature exists.
	 */
	const routeId = $derived(page.route.id ?? '');
	const onLibrary = $derived(routeId === '/');
	const onAuthors = $derived(routeId === '/authors' || routeId.startsWith('/authors/'));
</script>

<nav class="top-nav" aria-label="Browse">
	<a href="/" class:active={onLibrary} aria-current={onLibrary ? 'page' : undefined}>Library</a>
	<a href="/authors" class:active={onAuthors} aria-current={onAuthors ? 'page' : undefined}>
		Authors
	</a>
</nav>

<style>
	.top-nav {
		max-width: 1280px;
		margin: 0 auto;
		/* Right padding clears the fixed hamburger (40px @ right:16). */
		padding: 0.75rem 72px 0.75rem 1.25rem;
		display: flex;
		gap: 1.25rem;
		align-items: center;
		font-family: system-ui, sans-serif;
		font-size: 0.95rem;
		border-bottom: 1px solid var(--reader-border);
	}
	.top-nav a {
		color: var(--reader-muted);
		text-decoration: none;
		padding-bottom: 2px;
	}
	.top-nav a:hover {
		color: var(--reader-fg);
	}
	.top-nav a.active {
		color: var(--reader-fg);
		font-weight: 500;
		border-bottom: 2px solid var(--reader-accent);
	}
</style>
