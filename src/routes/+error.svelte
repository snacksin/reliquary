<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Themed error boundary (first in the repo — added with the M2.2
	 * gate so failures near the auth boundary don't fall to Kit's
	 * unstyled fallback outside the layout). Copy stays generic: a
	 * mid-session 401 reaches here already wrapped as a load failure,
	 * so there's no reliable status to branch on.
	 */
</script>

<svelte:head><title>Reliquary — {page.status}</title></svelte:head>

<main class="error-page">
	<h1>{page.status}</h1>
	<p class="message">{page.error?.message ?? 'Something went wrong.'}</p>
	<p class="back"><a href="/">← Library</a></p>
</main>

<style>
	.error-page {
		max-width: 760px;
		margin: 4rem auto;
		padding: 0 1.25rem;
		font-family: system-ui, sans-serif;
		color: var(--reader-fg);
	}
	h1 {
		font-size: 2.4rem;
		margin: 0 0 0.5rem;
		color: var(--reader-muted);
	}
	.message {
		margin: 0 0 1.5rem;
		font-size: 1rem;
		line-height: 1.5;
	}
	.back a {
		color: var(--reader-link);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
</style>
