import type { RequestHandler } from './$types';
import { readWrapper } from '$lib/server/wrapper';
import { sanitizeFicHtml } from '$lib/server/sanitize';

export const GET: RequestHandler = ({ params }) => {
	const html = readWrapper(params.id, 'preface');
	// Serve-boundary sanitize (Code Health Step 2) — stored file stays raw;
	// never wrap in a try/catch with a raw fallback (fail closed → 500).
	return new Response(sanitizeFicHtml(html), {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
