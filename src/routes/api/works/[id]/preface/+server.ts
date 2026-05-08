import type { RequestHandler } from './$types';
import { readWrapper } from '$lib/server/wrapper';

export const GET: RequestHandler = ({ params }) => {
	const html = readWrapper(params.id, 'preface');
	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
