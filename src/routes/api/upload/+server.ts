import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ingestEpub, IngestError, publicIngestMessage } from '$lib/server/ingest';

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (e) {
		// SvelteKit's body-size-limit error carries { status, text }. Keep the
		// status but replace the text — Kit's message spells out the exact
		// configured byte limit (error hygiene: config detail stays inward).
		if (
			e &&
			typeof e === 'object' &&
			'status' in e &&
			typeof (e as { status: unknown }).status === 'number'
		) {
			const status = (e as { status: number }).status;
			throw error(status, status === 413 ? 'upload too large (max 50 MB)' : 'request error');
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
			// problem (out of disk, broken DB connection, etc.). The outward
			// text comes from publicIngestMessage's fixed-literal switch —
			// never .message — so the safety is provable here, not a
			// convention in another file. The real error is logged inside
			// ingestEpub against the source filename.
			const status = e.code === 'parse' ? 400 : 500;
			throw error(status, publicIngestMessage(e));
		}
		throw e;
	}
};
