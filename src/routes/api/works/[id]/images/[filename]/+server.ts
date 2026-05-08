import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

/**
 * Reject the filename param if it looks anything like a traversal
 * attempt or contains a path separator. SvelteKit's `[filename]` slot
 * already only matches a single URL segment, but defensive validation
 * here means a malformed request can't reach the filesystem read.
 */
function isSafeFilename(name: string): boolean {
	if (!name || name === '.' || name === '..') return false;
	if (name.includes('..')) return false;
	if (name.includes('/') || name.includes('\\')) return false;
	if (name.includes('\0')) return false;
	return true;
}

export const GET: RequestHandler = ({ params }) => {
	const { id, filename } = params;
	if (!isSafeFilename(filename)) {
		throw error(404, 'image not found');
	}

	let body: Buffer;
	try {
		body = readFileSync(join('data', 'works', id, 'images', filename));
	} catch {
		throw error(404, 'image not found');
	}

	const contentType = MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'application/octet-stream';

	// Copy the buffer's bytes into a fresh ArrayBuffer so the Blob can
	// own them and TS lib.dom is satisfied (Buffer's underlying buffer
	// is typed `ArrayBufferLike`, which can be `SharedArrayBuffer` and
	// is therefore not directly a valid BodyInit).
	const ab = new ArrayBuffer(body.byteLength);
	new Uint8Array(ab).set(body);
	return new Response(new Blob([ab], { type: contentType }), {
		headers: {
			'content-type': contentType,
			'content-length': String(body.byteLength)
		}
	});
};
