/**
 * Reader preferences beyond theme: font, size, line-height, column
 * width. Each is a token persisted to localStorage; on read/set,
 * the resolved CSS value is written to documentElement.style so
 * the corresponding `var(--reader-*)` reference in Reader.svelte
 * picks it up.
 *
 * The boot script in src/app.html duplicates the token→CSS
 * mapping so cold loads paint with the user's saved values
 * before Svelte hydrates (anti-flash, same pattern as theme).
 * Keep the two in sync if you add tokens here.
 *
 * Theme stays in src/lib/theme.svelte.ts — different surface
 * (HTML attribute, not CSS var) and different default policy.
 */

interface PrefDef<T extends string> {
	key: string;
	defaultValue: T;
	options: readonly T[];
	/** Omit both for prefs that gate markup instead of driving a CSS var
	 *  (the global skins toggle) — persistence + hydration are identical. */
	cssVar?: string;
	toCss?: (token: T) => string;
}

function makePref<T extends string>(def: PrefDef<T>): { value: T } {
	// Hydrate EAGERLY at module init, never lazily in the getter. The lazy
	// version mutated $state on first read — and when that first read
	// happened inside a $derived (the reader's showSkin, on an SPA nav from
	// a page that never read the pref), Svelte threw state_unsafe_mutation,
	// the localStorage try/catch silently swallowed it, and the _hydrated
	// latch froze the DEFAULT for the whole session (#84's "skin renders
	// despite global hide" bug). Module init runs outside any reactive
	// context, so this read is always safe; SSR keeps the default (no
	// localStorage server-side), and the getter is now a pure $state read
	// every component can safely derive from.
	let initial = def.defaultValue;
	if (typeof window !== 'undefined') {
		try {
			const v = localStorage.getItem(def.key);
			if (v && (def.options as readonly string[]).includes(v)) {
				initial = v as T;
			}
		} catch {
			// localStorage unavailable; default stays
		}
	}
	let _value = $state<T>(initial);

	return {
		get value(): T {
			return _value;
		},
		set value(v: T) {
			_value = v;
			try {
				localStorage.setItem(def.key, v);
			} catch {
				// Persistence failed; current session still reflects the change
			}
			if (def.cssVar && def.toCss && typeof document !== 'undefined') {
				document.documentElement.style.setProperty(def.cssVar, def.toCss(v));
			}
		}
	};
}

// Font ----------------------------------------------------------------

export const FONT_TOKENS = ['georgia', 'lucida', 'atkinson', 'system-serif'] as const;
export type FontToken = (typeof FONT_TOKENS)[number];

const FONT_STACKS: Record<FontToken, string> = {
	georgia: 'Georgia, serif',
	lucida: '"Lucida Sans Unicode", "Lucida Grande", sans-serif',
	atkinson: '"Atkinson Hyperlegible", sans-serif',
	'system-serif': 'ui-serif, Cambria, "Times New Roman", serif'
};

export const FONT_LABELS: Record<FontToken, string> = {
	georgia: 'Georgia',
	lucida: 'Lucida Sans',
	atkinson: 'Atkinson Hyperlegible',
	'system-serif': 'System serif'
};

export const fontPref = makePref<FontToken>({
	key: 'prefs:reader:font',
	defaultValue: 'georgia',
	options: FONT_TOKENS,
	cssVar: '--reader-font-family',
	toCss: (t) => FONT_STACKS[t]
});

// Size ----------------------------------------------------------------

export const SIZE_TOKENS = ['16', '18', '20', '22'] as const;
export type SizeToken = (typeof SIZE_TOKENS)[number];

export const SIZE_LABELS: Record<SizeToken, string> = {
	'16': '16px',
	'18': '18px',
	'20': '20px',
	'22': '22px'
};

export const sizePref = makePref<SizeToken>({
	key: 'prefs:reader:size',
	defaultValue: '18',
	options: SIZE_TOKENS,
	cssVar: '--reader-font-size',
	toCss: (t) => `${t}px`
});

// Line height ---------------------------------------------------------

export const LINE_HEIGHT_TOKENS = ['1.4', '1.6', '1.8'] as const;
export type LineHeightToken = (typeof LINE_HEIGHT_TOKENS)[number];

export const LINE_HEIGHT_LABELS: Record<LineHeightToken, string> = {
	'1.4': '1.4',
	'1.6': '1.6',
	'1.8': '1.8'
};

export const lineHeightPref = makePref<LineHeightToken>({
	key: 'prefs:reader:lh',
	defaultValue: '1.6',
	options: LINE_HEIGHT_TOKENS,
	cssVar: '--reader-line-height',
	toCss: (t) => t
});

// Column width --------------------------------------------------------

export const WIDTH_TOKENS = ['narrow', 'medium', 'wide', 'extra-wide'] as const;
export type WidthToken = (typeof WIDTH_TOKENS)[number];

const WIDTH_VALUES: Record<WidthToken, string> = {
	narrow: '560px',
	medium: '680px',
	wide: '840px',
	'extra-wide': '1000px'
};

export const WIDTH_LABELS: Record<WidthToken, string> = {
	narrow: 'Narrow (560px)',
	medium: 'Medium (680px)',
	wide: 'Wide (840px)',
	'extra-wide': 'Extra-wide (1000px)'
};

export const widthPref = makePref<WidthToken>({
	key: 'prefs:reader:width',
	defaultValue: 'medium',
	options: WIDTH_TOKENS,
	cssVar: '--reader-max-width',
	toCss: (t) => WIDTH_VALUES[t]
});

// Creator skins (global) ----------------------------------------------

export const SKIN_TOKENS = ['show', 'hide'] as const;
export type SkinToken = (typeof SKIN_TOKENS)[number];

/**
 * Code Health 1.5 — GLOBAL "Hide creator's styles", superseding the WS
 * per-fic toggle (Allie 2026-07-12: skins-or-not is a reading-mode choice
 * like theme/font — one switch for the whole library; the per-fic-override
 * variant was declined). Default = show, preserving the skins-on-by-default
 * behavior in every theme.
 *
 * No cssVar: this pref gates the reader's skin <link> in markup, not a CSS
 * value. Pre-hydration anti-flash is handled by an inline gate script that
 * rides immediately AFTER the link in <svelte:head> (Reader.svelte) — the
 * app.html boot script can't do it, since it runs before the link exists
 * in the DOM. Keep the key in sync with that gate script.
 */
export const skinsPref = makePref<SkinToken>({
	key: 'prefs:reader:skins',
	defaultValue: 'show',
	options: SKIN_TOKENS
});

// One-time hygiene: the superseded per-fic keys (prefs:skin:hide:<id>)
// are never read again — sweep them so they don't sit in localStorage
// forever. Client-only; module-load is the natural "once per boot".
if (typeof window !== 'undefined') {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k?.startsWith('prefs:skin:hide:')) localStorage.removeItem(k);
		}
	} catch {
		/* localStorage unavailable — nothing to sweep */
	}
}
