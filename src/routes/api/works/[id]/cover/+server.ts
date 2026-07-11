import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getDb } from '$lib/server/db';

/**
 * Per-work cover art (Cover Art Part A, DESIGN §6.19).
 *
 * GET streams the current cover (extracted or manual — works.cover_path is
 * the single source of truth); PUT uploads a manual cover (PNG/JPG, magic-
 * byte-sniffed, ≤10 MB) which ALWAYS wins over extraction; DELETE clears
 * back to the placeholder. Manual files live at the work-dir root as
 * `cover-<unix-ms>.<ext>` — the timestamped basename doubles as the cache-
 * bust token the client appends as ?v=, so a replaced cover is never served
 * stale. cover_path is stored cwd-relative (the content_path convention).
 */

const MAX_COVER_BYTES = 10 * 1024 * 1024;

type CoverRow = { cover_path: string | null; cover_source: string | null };

function coverRow(db: ReturnType<typeof getDb>, id: string): CoverRow | undefined {
	return db.prepare(`SELECT cover_path, cover_source FROM works WHERE id = ?`).get(id) as
		| CoverRow
		| undefined;
}

/** PNG/JPEG detection by magic bytes — extensions and content-types lie. */
function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
	if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
		return { ext: '.png', mime: 'image/png' };
	}
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return { ext: '.jpg', mime: 'image/jpeg' };
	}
	return null;
}

const MIME_BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

/** GET /api/works/[id]/cover — stream the cover image, 404 when none. */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = coverRow(db, params.id);
	if (!row?.cover_path) throw error(404, 'no cover');

	let body: Buffer;
	try {
		body = readFileSync(row.cover_path);
	} catch {
		throw error(404, 'no cover');
	}
	const mime = MIME_BY_EXT[extname(row.cover_path).toLowerCase()] ?? 'application/octet-stream';
	const ab = new ArrayBuffer(body.byteLength);
	new Uint8Array(ab).set(body);
	return new Response(new Blob([ab], { type: mime }), {
		headers: {
			'content-type': mime,
			'content-length': String(body.byteLength),
			// Immutable-per-URL: the client varies ?v= with the stored basename,
			// so a replaced cover gets a fresh URL rather than a stale hit.
			'cache-control': 'private, max-age=31536000'
		}
	});
};

/**
 * PUT /api/works/[id]/cover — set a manual cover. Multipart form, field
 * `file`. Manual ALWAYS wins: overwrites any prior manual or extracted
 * assignment (extracted files stay on disk — they're part of the work's
 * images; a prior MANUAL file is deleted, it has no other owner).
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const row = coverRow(db, params.id);
	if (!row) throw error(404, 'work not found');

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(400, 'expected multipart form data');
	}
	const file = formData.get('file');
	if (!(file instanceof File)) throw error(400, 'missing file field');
	if (file.size > MAX_COVER_BYTES) throw error(400, 'cover image too large (max 10 MB)');

	const buf = Buffer.from(await file.arrayBuffer());
	const kind = sniffImage(buf);
	if (!kind) throw error(400, 'cover must be a PNG or JPG image');

	const workDir = join('data', 'works', params.id);
	if (!existsSync(workDir)) throw error(404, 'work not found');

	return json(installManualCover(db, params.id, workDir, row, buf, kind.ext), { status: 200 });
};

/**
 * Shared tail of both manual-cover paths (file upload + pick-from-images):
 * write the bytes to a fresh timestamped `cover-<ts>.<ext>` at the work-dir
 * root, drop the prior manual file if any (no other owner), and stamp the
 * row 'manual'. Downstream, an installed cover is indistinguishable
 * regardless of origin — same dir-swap carry, same Remove semantics.
 */
function installManualCover(
	db: ReturnType<typeof getDb>,
	workId: string,
	workDir: string,
	prior: CoverRow,
	buf: Buffer,
	ext: string
): { cover_v: string } {
	const filename = `cover-${Date.now()}${ext}`;
	writeFileSync(join(workDir, filename), buf);

	if (prior.cover_source === 'manual' && prior.cover_path) {
		try {
			unlinkSync(prior.cover_path);
		} catch {
			/* already gone — fine */
		}
	}

	db.prepare(`UPDATE works SET cover_path = ?, cover_source = 'manual' WHERE id = ?`).run(
		join(workDir, filename),
		workId
	);
	return { cover_v: filename };
}

/**
 * PATCH /api/works/[id]/cover — set the cover from one of the work's own
 * EXTRACTED images (Cover Art Part A.5). Body: { image: "<filename>" }, a
 * bare filename within data/works/<id>/images/ (traversal-guarded, raster
 * types only — the same set the images route serves).
 *
 * 🔴 The picked file is COPIED to the manual-cover location, never
 * referenced in place: ingest rewrites images/ wholesale on every
 * update-in-place, so an in-place reference would dangle after a re-drop.
 * The copy makes a picked cover indistinguishable from an uploaded one —
 * cover_source='manual', survives the dir swap via the existing carry,
 * identical Remove/replace semantics.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const row = coverRow(db, params.id);
	if (!row) throw error(404, 'work not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const image = (body as { image?: unknown })?.image;
	if (typeof image !== 'string' || image.length === 0) throw error(400, 'image must be a filename');
	// Same traversal guard as the images serving route: bare filename only.
	if (
		image === '.' ||
		image === '..' ||
		image.includes('..') ||
		image.includes('/') ||
		image.includes('\\') ||
		image.includes('\0')
	) {
		throw error(400, 'invalid image filename');
	}
	const ext = extname(image).toLowerCase();
	if (!(ext in MIME_BY_EXT)) throw error(400, 'not a raster image');

	const workDir = join('data', 'works', params.id);
	let buf: Buffer;
	try {
		buf = readFileSync(join(workDir, 'images', image));
	} catch {
		throw error(404, 'image not found');
	}

	return json(installManualCover(db, params.id, workDir, row, buf, ext), { status: 200 });
};

/**
 * DELETE /api/works/[id]/cover — clear back to the placeholder. Deletes the
 * file only when it was a manual upload (extracted images belong to the
 * work's image set and stay). Idempotent.
 */
export const DELETE: RequestHandler = ({ params }) => {
	const db = getDb();
	const row = coverRow(db, params.id);
	if (!row) throw error(404, 'work not found');

	if (row.cover_source === 'manual' && row.cover_path) {
		try {
			unlinkSync(row.cover_path);
		} catch {
			/* already gone — fine */
		}
	}
	db.prepare(`UPDATE works SET cover_path = NULL, cover_source = NULL WHERE id = ?`).run(params.id);
	return new Response(null, { status: 204 });
};
