/**
 * Plain-text previews for library rows (Follow-up B).
 *
 * Pure string ops (no DOM), so the output is identical during SSR and after
 * hydration — no flash, unlike the detail page's client-only markdown render.
 * The results are always rendered as TEXT (Svelte-escaped), never `{@html}`,
 * so imperfect stripping can never inject markup — this is display-only
 * tidying, not a security boundary.
 */

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	'#39': "'",
	apos: "'",
	nbsp: ' '
};

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, d) => {
			const n = Number(d);
			return Number.isFinite(n) ? String.fromCodePoint(n) : _;
		})
		.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => NAMED_ENTITIES[name] ?? _);
}

function collapse(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	const slice = s.slice(0, max);
	const cut = slice.lastIndexOf(' ');
	// Prefer a nearby word boundary; fall back to a hard cut.
	return (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd() + '…';
}

/**
 * AO3 summaries are HTML — strip to readable text but KEEP paragraph/line
 * structure (Follow-up B review): show the whole summary, not a truncation, so
 * block boundaries (`</p>`, `<br>`, headings, list items…) become newlines.
 * Collapses only horizontal whitespace within each line and drops blank lines,
 * so a multi-paragraph summary reads as distinct lines instead of a run-on
 * blob. Render with `white-space: pre-line`. Pure string ops → SSR-safe.
 */
export function summaryText(html: string | null | undefined): string {
	if (!html) return '';
	const withBreaks = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
		.replace(/<[^>]*>/g, ''); // strip remaining inline tags
	return decodeEntities(withBreaks)
		.split('\n')
		.map((line) => line.replace(/[^\S\n]+/g, ' ').trim()) // collapse horizontal ws
		.filter((line) => line.length > 0) // drop blank lines
		.join('\n');
}

/**
 * Notes are markdown — light de-markdown to readable text (NOT a full render;
 * the detail page renders the real markdown). Strips link/image wrappers,
 * leading block markers (headings/quotes/list bullets), and inline
 * emphasis/code markers.
 */
export function notePreview(markdown: string | null | undefined, max = 280): string {
	if (!markdown) return '';
	const s = markdown
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) / ![alt](url) → text/alt
		.replace(/^[ \t]*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '') // leading block markers
		.replace(/(\*\*|__|\*|_|`)/g, ''); // inline emphasis / code
	return truncate(collapse(s), max);
}
