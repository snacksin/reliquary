/**
 * Reader-theme state, shared across components and persisted to
 * localStorage under `prefs:reader:theme`. Per DESIGN.md §6.9
 * (per-device preferences); cross-device sync is M2/M6 work.
 *
 * The data-theme attribute on <html> is the single source of truth
 * for visual theming — CSS custom properties (`--reader-bg`,
 * `--reader-fg`, etc., defined in src/app.css) cascade from there.
 * An inline <script> in app.html seeds the attribute synchronously
 * BEFORE Svelte hydrates so cold loads don't flash the default
 * theme then snap to the user's saved choice.
 */

export type Theme = 'paper' | 'sepia' | 'dark';
export const THEMES: readonly Theme[] = ['paper', 'sepia', 'dark'];
export const DEFAULT_THEME: Theme = 'sepia';
const STORAGE_KEY = 'prefs:reader:theme';

function isTheme(v: unknown): v is Theme {
	return v === 'paper' || v === 'sepia' || v === 'dark';
}

function readPersistedTheme(): Theme {
	if (typeof localStorage === 'undefined') return DEFAULT_THEME;
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return isTheme(v) ? v : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

let _theme = $state<Theme>(DEFAULT_THEME);
let _hydrated = false;

/**
 * Lazy-hydrate from localStorage on first read in the browser. SSR
 * keeps the default; the inline app.html script handles the visual
 * side before paint.
 */
function ensureHydrated() {
	if (_hydrated || typeof window === 'undefined') return;
	_theme = readPersistedTheme();
	_hydrated = true;
}

export const themeStore = {
	get value(): Theme {
		ensureHydrated();
		return _theme;
	},
	set value(t: Theme) {
		_theme = t;
		_hydrated = true;
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem(STORAGE_KEY, t);
			} catch {
				// localStorage write failed (private mode, quota); the
				// in-memory state still updates so the current session
				// reflects the change.
			}
		}
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', t);
		}
	}
};
