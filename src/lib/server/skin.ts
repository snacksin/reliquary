/**
 * WS Part 2 — creator-CSS sanitizer + #workskin scoper.
 *
 * Runs ONCE at ingest over the raw stylesheet(s) parseEpub collected; the
 * result is what's stored and served. Two jobs:
 *
 *  1. SANITIZE — drop everything that could reach outside the page or the
 *     renderer: @import (remote fetch), external url() references (only
 *     data: URIs survive), IE behaviors/expressions/-moz-binding,
 *     javascript: values, and position:fixed (which would escape the
 *     reader column and overlay app chrome). Statement at-rules
 *     (@charset/@namespace/@page/…) are dropped; @media recurses;
 *     @font-face survives only with data:-embedded sources; @keyframes
 *     pass through (animation bodies get the same declaration scrub).
 *  2. SCOPE — every surviving selector is rewritten under the `#workskin`
 *     prefix (the AO3 idiom), with leading html/body tokens folded into
 *     #workskin itself — so creator CSS structurally cannot touch app
 *     chrome, theme, sidebar, or reader controls. The reader gives
 *     #workskin `position: relative` + `isolation: isolate`, which keeps
 *     absolute positioning and z-index stacked INSIDE the fic content.
 *
 * Hand-rolled block parser (brace matching, paren-aware declaration
 * splitting) — no new dependencies, and work-skin CSS is small.
 */

const MAX_SKIN_BYTES = 200 * 1024;

/** Split on `;` but never inside parentheses (data: URLs carry `;base64`). */
function splitDeclarations(body: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of body) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		if (ch === ';' && depth === 0) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	if (cur.trim()) out.push(cur);
	return out;
}

/** One declaration survives only if it can't reach out of the sandbox. */
function sanitizeDeclarations(body: string): string {
	const kept: string[] = [];
	for (const decl of splitDeclarations(body)) {
		const d = decl.trim();
		if (!d || !d.includes(':')) continue;
		if (/expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:/i.test(d)) continue;
		// url() allowed only when EVERY reference is a data: URI.
		const urls = [...d.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
		if (urls.length > 0 && !urls.every((u) => u[2].trim().toLowerCase().startsWith('data:'))) {
			continue;
		}
		// position:fixed escapes the reader column; everything else stays
		// contained by #workskin's relative+isolate context.
		if (/^position\s*:\s*fixed\b/i.test(d)) continue;
		kept.push(d);
	}
	return kept.join('; ');
}

/** Rewrite one selector list under the #workskin prefix. */
function scopeSelectors(selectorList: string): string {
	return selectorList
		.split(',')
		.map((sel) => {
			let s = sel.trim();
			if (!s) return '';
			if (/^#workskin\b/.test(s)) return s; // already the AO3 idiom
			// A leading html/body token becomes the container itself.
			s = s.replace(/^(?:html|body)(?![\w-])\s*/i, '');
			return s ? `#workskin ${s}` : '#workskin';
		})
		.filter(Boolean)
		.join(', ');
}

/**
 * Parse a flat rule list (top level or an at-rule's body), returning the
 * sanitized text. `scope` is false inside @keyframes (frame selectors like
 * `0%`/`to` must not be prefixed).
 */
function sanitizeRules(css: string, scope: boolean): string {
	const out: string[] = [];
	let i = 0;
	const n = css.length;
	while (i < n) {
		// skip whitespace
		while (i < n && /\s/.test(css[i])) i++;
		if (i >= n) break;

		// statement at-rules end at ';' — @import/@charset/@namespace: DROP.
		if (css[i] === '@') {
			const atStart = i;
			// find the earlier of '{' or ';'
			let j = i;
			while (j < n && css[j] !== '{' && css[j] !== ';') j++;
			if (j >= n) break;
			if (css[j] === ';') {
				i = j + 1; // statement at-rule dropped
				continue;
			}
			const prelude = css.slice(atStart, j).trim();
			// matched block
			let depth = 1;
			let k = j + 1;
			while (k < n && depth > 0) {
				if (css[k] === '{') depth++;
				else if (css[k] === '}') depth--;
				k++;
			}
			const body = css.slice(j + 1, k - 1);
			const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
			if (name === 'media' || name === 'supports') {
				const inner = sanitizeRules(body, scope);
				if (inner.trim()) out.push(`${prelude} {\n${inner}\n}`);
			} else if (name === 'font-face') {
				const decls = sanitizeDeclarations(body);
				// survives only when a data:-embedded src survived the scrub
				if (/src\s*:/i.test(decls)) out.push(`${prelude} { ${decls} }`);
			} else if (name === 'keyframes' || name.endsWith('-keyframes')) {
				const inner = sanitizeRules(body, false);
				if (inner.trim()) out.push(`${prelude} {\n${inner}\n}`);
			}
			// every other block at-rule (@page, @document, …): dropped
			i = k;
			continue;
		}

		// plain rule: selector { body }
		let j = i;
		while (j < n && css[j] !== '{') j++;
		if (j >= n) break;
		const selector = css.slice(i, j).trim();
		let depth = 1;
		let k = j + 1;
		while (k < n && depth > 0) {
			if (css[k] === '{') depth++;
			else if (css[k] === '}') depth--;
			k++;
		}
		const body = css.slice(j + 1, k - 1);
		const decls = sanitizeDeclarations(body);
		if (selector && decls) {
			const scoped = scope ? scopeSelectors(selector) : selector;
			if (scoped) out.push(`${scoped} { ${decls} }`);
		}
		i = k;
	}
	return out.join('\n');
}

/**
 * WS Part 3 — forgiving paste extraction. AO3 ships the real work skin only
 * in the live page's <style> block, so the paste box accepts whatever the
 * user managed to copy: bare CSS, a full <style>…</style> block, or an
 * entire view-source paste. This helper reduces any of those to a raw CSS
 * candidate for sanitizeAndScopeSkin (which stays the single gate — the
 * output here is NEVER stored directly).
 */
export function extractPastedSkin(pasted: string | null): string | null {
	if (!pasted || pasted.trim() === '') return null;
	// <style> blocks present (a copied block or a whole page source): use the
	// block bodies. Prefer the ones mentioning #workskin — that's AO3's work
	// skin — falling back to all of them (the sanitizer scopes whatever
	// survives, so a skinless page source just yields nothing usable).
	const blocks = [...pasted.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
	if (blocks.length > 0) {
		const workskin = blocks.filter((b) => b.includes('#workskin'));
		return (workskin.length > 0 ? workskin : blocks).join('\n');
	}
	// No complete block → treat as bare CSS, shedding any stray unpaired
	// <style> / </style> tag from a partial copy.
	return pasted.replace(/<\/?style\b[^>]*>/gi, '');
}

/**
 * The one public entry: raw collected CSS in, stored skin out.
 * Null when nothing survives (or input is empty/oversized).
 */
export function sanitizeAndScopeSkin(rawCss: string | null): string | null {
	if (!rawCss) return null;
	if (Buffer.byteLength(rawCss, 'utf8') > MAX_SKIN_BYTES) return null;
	// strip comments first (they can hide tokens from the scrubbers)
	const noComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
	const clean = sanitizeRules(noComments, true).trim();
	return clean.length > 0 ? clean : null;
}
