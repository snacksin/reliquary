import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		// Code Health Step 1.6 — Allie's rule-by-rule decisions (2026-08-03).
		// From this commit forward `pnpm lint` exits clean, so ANY lint output
		// is a real problem. Don't add suppressions casually; each disable
		// below carries the reasoning that justified it.
		rules: {
			// Guards SvelteKit base-path deployments (hrefs that break when the
			// app isn't served from `/`). Reliquary runs at the domain root on
			// the laptop and will on the Pi — there is no base path anywhere on
			// the roadmap. Revisit ONLY if a base-path deploy ever materializes.
			'svelte/no-navigation-without-resolve': 'off',
			// The reader renders fic HTML via {@html} BY ARCHITECTURE — serving
			// stored chapter files into the page is the product. The rule's
			// underlying XSS concern is addressed by the sanitization layer
			// (DOMPurify pass over chapter HTML — Code Health Step 2), not by
			// avoiding {@html}.
			'svelte/no-at-html-tags': 'off',
			// Audited 2026-08-03 (Step 1.6): every flagged site is a false
			// positive for this codebase's two idioms — (1) transient
			// URLSearchParams built in event handlers, mutated, serialized into
			// goto(), and discarded (never $state); (2) Map/Set built and
			// returned inside $derived.by, rebuilt wholesale when inputs change
			// (reactivity flows through the derived, not through mutation). The
			// rule's real concern — a mutable built-in HELD IN $state — doesn't
			// occur here; if we ever store a collection in $state, use
			// svelte/reactivity's SvelteMap/SvelteSet/SvelteURLSearchParams and
			// consider re-enabling.
			'svelte/prefer-svelte-reactivity': 'off'
		}
	}
);
