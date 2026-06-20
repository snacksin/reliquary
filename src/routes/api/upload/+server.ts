import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ingestEpub, IngestError } from '$lib/server/ingest';

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (e) {
		// SvelteKit's body-size-limit error carries { status, text } — surface it as-is.
		if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
			const err = e as { status: number; text?: string };
			throw error(err.status, err.text ?? 'Request error');
		}
		throw error(400, 'expected multipart/form-data body');
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		throw error(400, 'expected multipart field "file"');
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	try {
		// M2.3 Step 3: the result is a discriminated outcome (created /
		// updated / duplicate / stale). All four are 200s — duplicate and
		// stale aren't HTTP errors (the client renders a friendly notice
		// and needs the existing work_id to link). Genuine parse/write/db
		// failures still throw IngestError below.
		const result = await ingestEpub(buffer, file.name);
		return json(result);
	} catch (e) {
		if (e instanceof IngestError) {
			// `parse` → bad input from the client; everything else → server-side
			// problem (out of disk, broken DB connection, etc.). Same generic
			// message hygiene as before — the real error is logged inside
			// ingestEpub against the source filename.
			const status = e.code === 'parse' ? 400 : 500;
			throw error(status, e.message);
		}
		throw e;
	}
};
