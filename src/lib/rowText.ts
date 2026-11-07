/**
 * Plain-text previews for library rows (Follow-up B).
 *
 * Pure string ops (no DOM), so the output is identical during SSR and after
 * hydration — no flash, unlike the detail page's client-only markdown render.
 * The results are always rendered as TEXT (Svelte-escaped), never `{@html}`,
 * so imperfect stripping can never inject markup — this is display-only
 * tidying, not a security boundary.
 */

// The basics plus the typographic set. AO3 summaries are mostly literal
// characters, but FicHub writes curly quotes, dashes and accents as named
// entities (&rsquo; &ldquo; &hellip; …), which showed raw in list rows
// (2026-11-07, "Dārio Idaña"). Unknown names are left as written.
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	lsquo: '‘',
	rsquo: '’',
	sbquo: '‚',
	ldquo: '“',
	rdquo: '”',
	bdquo: '„',
	laquo: '«',
	raquo: '»',
	lsaquo: '‹',
	rsaquo: '›',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	bull: '•',
	middot: '·',
	prime: '′',
	Prime: '″',
	dagger: '†',
	Dagger: '‡',
	deg: '°',
	copy: '©',
	reg: '®',
	trade: '™',
	sect: '§',
	para: '¶',
	times: '×',
	divide: '÷',
	frac12: '½',
	frac14: '¼',
	frac34: '¾',
	hearts: '♥',
	iexcl: '¡',
	iquest: '¿',
	shy: '',
	zwj: '‍',
	zwnj: '‌',
	ensp: ' ',
	emsp: ' ',
	thinsp: ' ',
	aacute: 'á',
	Aacute: 'Á',
	agrave: 'à',
	acirc: 'â',
	auml: 'ä',
	atilde: 'ã',
	aring: 'å',
	aelig: 'æ',
	ccedil: 'ç',
	eacute: 'é',
	Eacute: 'É',
	egrave: 'è',
	ecirc: 'ê',
	euml: 'ë',
	iacute: 'í',
	igrave: 'ì',
	icirc: 'î',
	iuml: 'ï',
	ntilde: 'ñ',
	Ntilde: 'Ñ',
	oacute: 'ó',
	ograve: 'ò',
	ocirc: 'ô',
	ouml: 'ö',
	otilde: 'õ',
	oslash: 'ø',
	szlig: 'ß',
	uacute: 'ú',
	ugrave: 'ù',
	ucirc: 'û',
	uuml: 'ü',
	yacute: 'ý',
	yuml: 'ÿ'
};

function codePoint(n: number, raw: string): string {
	return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
}

// One pass, so "&amp;rsquo;" decodes once to the literal text "&rsquo;"
// (the escaped form the author wrote) instead of on to ’.
function decodeEntities(s: string): string {
	return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (raw, body: string) => {
		if (body[0] === '#') {
			const hex = body[1] === 'x' || body[1] === 'X';
			return codePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), raw);
		}
		return NAMED_ENTITIES[body] ?? raw;
	});
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
