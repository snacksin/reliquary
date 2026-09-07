import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		csrf: {
			// ⚠️ CSRF PROTECTION IS NOT OFF — IT MOVED. (M2.2 Step 5A)
			//
			// '*' disables Kit's BUILD-TIME origin check, which could only
			// bless origins baked into the bundle — hardcoding the laptop's
			// DHCP address into build/ (the #97 silent-403 bug on a timer).
			// The replacement is the DYNAMIC same-origin check at the top of
			// `handle` in src/hooks.server.ts: form submissions must carry an
			// Origin whose host equals the request's own host, verified
			// per-request in dev AND prod. Parity with Kit's check (methods,
			// content types, absent/null-Origin rejection) is documented
			// there and enforced by scripts/csrf-guard.mjs.
			//
			// Do NOT remove '*' without restoring an equivalent check, and do
			// not adopt Kit remote functions without revisiting this: Kit's
			// separate remote-request origin check is NOT disabled by '*'.
			trustedOrigins: ['*']
		}
	}
};

export default config;
