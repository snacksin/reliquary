import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { ingestEpub, IngestError } from '$lib/server/ingest';

/**
 * Bulk EPUB import. Accepts multipart/form-data with N `file` parts and
 * processes them sequentially, calling the shared `ingestEpub()` helper
 * per file. Per-file try/catch isolates failures so one malformed EPUB
 * (or a SNAKES-style locked fic that hits the epub2 timeout) in a batch
 * doesn't abort the rest.
 *
 * Response is an NDJSON stream — newline-delimited JSON objects, one
 * per chunk, with two kinds of messages:
 *
 *   {"type":"progress","current":3,"total":12,"filename":"foo.epub"}
 *     — emitted BEFORE each file is processed so the client can show
 *       "Uploading 3 of 12: foo.epub" before the long-running parse.
 *
 *   {"type":"done","uploaded":[{work_id,filename},…],"skipped":[{filename,reason},…],"failed":[{filename,reason},…]}
 *     — emitted ONCE at the end. M2.3 Step 3 adds `skipped` for dedup
 *       rejects (already-in-library / library-copy-is-newer); `failed`
 *       stays for genuine ingest errors, `uploaded` for created+updated.
 *
 * Streaming was chosen over a single aggregated JSON response because
 * the AC explicitly asks for per-file progress feedback, which is only
 * achievable with either streaming or N separate POSTs. One streaming
 * POST is the cleaner pattern: single FormData parse, single connection,
 * the server controls processing order, the client gets real-time
 * updates. Falls back gracefully if the connection drops mid-batch
 * (partial uploaded[] is lost; cleanupWorkDir already ran for any
 * file that errored).
 */
export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (e) {
		if (
			e &&
			typeof e === 'object' &&
			'status' in e &&
			typeof (e as { status: unknown }).status === 'number'
		) {
			const err = e as { status: number; text?: string };
			throw error(err.status, err.text ?? 'Request error');
		}
		throw error(400, 'expected multipart/form-data body');
	}

	const files = formData.getAll('file').filter((f): f is File => f instanceof File);
	if (files.length === 0) {
		throw error(400, 'expected at least one multipart field "file"');
	}

	const uploaded: { work_id: string; filename: string }[] = [];
	const skipped: { filename: string; reason: string }[] = [];
	const failed: { filename: string; reason: string }[] = [];

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const enc = new TextEncoder();
			const send = (msg: unknown) => {
				controller.enqueue(enc.encode(JSON.stringify(msg) + '\n'));
			};

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const filename = file.name;
				// Progress emitted BEFORE ingestion so the client UI can
				// update "Uploading N of M: filename.epub" even during the
				// (potentially 10s) timeout window if epub2 hangs.
				send({
					type: 'progress',
					current: i + 1,
					total: files.length,
					filename
				});

				let buffer: Buffer;
				try {
					buffer = Buffer.from(await file.arrayBuffer());
				} catch (e) {
					console.error(
						`[bulk-upload] arrayBuffer() failed for ${filename}:`,
						e instanceof Error ? e.message : e
					);
					failed.push({ filename, reason: 'Failed to read file' });
					continue;
				}

				try {
					const r = await ingestEpub(buffer, `bulk:${i + 1}/${files.length} ${filename}`);
					// M2.3 Step 3: created/updated = real imports; duplicate/stale
					// are dedup rejects (skipped, NOT failed); genuine errors throw
					// IngestError and land in failed below.
					if (r.status === 'created' || r.status === 'updated') {
						uploaded.push({ work_id: r.work_id, filename });
					} else if (r.status === 'duplicate') {
						skipped.push({ filename, reason: 'Already in library' });
					} else {
						skipped.push({ filename, reason: 'Library copy is newer' });
					}
				} catch (e) {
					const reason =
						e instanceof IngestError
							? e.message
							: e instanceof Error
								? e.message
								: 'Unknown error';
					failed.push({ filename, reason });
					// Don't rethrow — keep processing the rest of the batch.
					// ingestEpub already logged the real error + cleaned up.
				}
			}

			send({ type: 'done', uploaded, skipped, failed });
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			// Disable any proxy/buffering middleware that might collect the
			// whole stream before forwarding it. adapter-node passes the
			// stream through verbatim; this header is belt-and-suspenders
			// for the prod path.
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no'
		}
	});
};
