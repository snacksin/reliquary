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
	cssVar: string;
	toCss: (token: T) => string;
}

function makePref<T extends string>(def: PrefDef<T>): { value: T } {
	let _value = $state<T>(def.defaultValue);
	let _hydrated = false;

	function ensureHydrated() {
		if (_hydrated || typeof window === 'undefined') return;
		try {
			const v = localStorage.getItem(def.key);
			if (v && (def.options as readonly string[]).includes(v)) {
				_value = v as T;
			}
		} catch {
			// localStorage unavailable; default stays
		}
		_hydrated = true;
	}

	return {
		get value(): T {
			ensureHydrated();
			return _value;
		},
		set value(v: T) {
			_value = v;
			_hydrated = true;
			try {
				localStorage.setItem(def.key, v);
			} catch {
				// Persistence failed; current session still reflects the change
			}
			if (typeof document !== 'undefined') {
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
