import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

/**
 * Code Health Step 2 (M2.2 step ④, pulled forward) — the DOMPurify pass
 * over fic-derived HTML, applied at the SERVE boundary.
 *
 * Strategy: stored chapter files and works.summary stay RAW on disk/DB
 * (preservation principle; dedup identity and edit detection hash the raw
 * stored bytes — nothing here touches storage, so there is no hash story
 * and no backfill). Sanitization happens once per request in the five
 * serve paths (ch/[n], preface, afterword, history/[archive_id], and the
 * detail feed's summary field). Because the universal loads fetch those
 * endpoints in-process during SSR, this one implementation covers SSR
 * (where a <script> in stored HTML would otherwise execute on first
 * paint), client navigation, and any direct consumer.
 *
 * One JSDOM window + one DOMPurify instance for the process lifetime.
 * sanitize() builds a fresh document per call — safe across requests. We
 * never call setConfig() and register no hooks, so there is no
 * cross-request config bleed.
 *
 * Config: pure DOMPurify defaults, deliberately. Defaults keep everything
 * fic HTML needs — <details>/<summary> folds, class and style attributes,
 * <img> with app-relative srcs, links — and strip <script>, on* handlers,
 * and javascript: URLs. Known accepted loss (Allie's tripwire): `target`
 * attributes are dropped, so external links in fics open in the same tab;
 * if that grates in real reading, the one-line revisit is passing
 * { ADD_ATTR: ['target'] } to every sanitize() call (per-call config —
 * never setConfig, to keep the no-bleed property).
 *
 * Skins are OUT of scope by design: creator CSS rides its own
 * sanitizer + stylesheet endpoint (src/lib/server/skin.ts), so DOMPurify
 * never has to reason about CSS — exactly the separation the skin
 * endpoint's comment promised.
 */
const purify = createDOMPurify(new JSDOM('').window);

// FAIL CLOSED at init: when DOMPurify considers its environment
// unsupported, sanitize() RETURNS THE DIRTY INPUT UNCHANGED (fail-open by
// library design). Refuse to boot in that state rather than silently
// serving raw HTML forever.
if (!purify.isSupported) {
	throw new Error(
		'DOMPurify reports this jsdom environment unsupported — refusing to serve unsanitized fic HTML'
	);
}

/**
 * Sanitize fic-derived HTML at the serve boundary. The ONLY path by which
 * fic HTML may reach a Response or JSON payload that feeds an {@html}
 * sink.
 *
 * FAIL CLOSED at runtime: this function never catches, and callers must
 * never wrap it in a try/catch that falls back to the raw input — an
 * internal failure propagates to a 500 with no fic HTML in the body.
 */
export function sanitizeFicHtml(html: string): string {
	return purify.sanitize(html);
}
