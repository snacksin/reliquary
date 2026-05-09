export type LastRead = {
	chapter: number;
	scroll_y: number;
};

export type Work = {
	id: string;
	title: string;
	author: string;
	summary: string | null;
	chapter_count: number;
	word_count: number | null;
	last_read: LastRead | null;
	is_favorite: boolean;
	/**
	 * ISO 8601 timestamp set by POST /api/works/[id]/favorite. Used
	 * client-side to sort the Favorites carousel most-recent-first.
	 * Null when `is_favorite` is false.
	 */
	favorited_at: string | null;
};

type Fetch = typeof fetch;

export async function listWorks(fetch: Fetch): Promise<Work[]> {
	const res = await fetch('/api/works');
	if (!res.ok) throw new Error(`GET /api/works failed: ${res.status}`);
	return res.json();
}

export async function uploadEpub(file: File, fetch: Fetch): Promise<{ work_id: string }> {
	const fd = new FormData();
	fd.append('file', file);
	const res = await fetch('/api/upload', { method: 'POST', body: fd });
	if (!res.ok) {
		throw new Error(await extractError(res));
	}
	return res.json();
}

export type ChapterKind = 'preface' | 'summary' | 'chapter' | 'afterword';

export type WorkDetail = Work & {
	chapters: { number: number; title: string | null; kind: ChapterKind }[];
};

export async function getWork(id: string, fetch: Fetch): Promise<WorkDetail> {
	const res = await fetch(`/api/works/${id}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.json();
}

export async function getChapterHtml(
	workId: string,
	n: number | string,
	fetch: Fetch
): Promise<string> {
	const res = await fetch(`/api/works/${workId}/ch/${n}`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function getPrefaceHtml(workId: string, fetch: Fetch): Promise<string> {
	const res = await fetch(`/api/works/${workId}/preface`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function getAfterwordHtml(workId: string, fetch: Fetch): Promise<string> {
	const res = await fetch(`/api/works/${workId}/afterword`);
	if (!res.ok) throw new Error(await extractError(res));
	return res.text();
}

export async function saveProgress(
	workId: string,
	chapter: number,
	scroll_y: number,
	fetch: Fetch
): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chapter, scroll_y: Math.round(scroll_y) })
	});
	if (!res.ok) throw new Error(await extractError(res));
}

export async function removeProgress(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/progress`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function setFavorite(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/favorite`, { method: 'POST' });
	if (!res.ok) throw new Error(await extractError(res));
}

export async function unsetFavorite(workId: string, fetch: Fetch): Promise<void> {
	const res = await fetch(`/api/works/${workId}/favorite`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await extractError(res));
}

async function extractError(res: Response): Promise<string> {
	const body = await res.text();
	try {
		const parsed = JSON.parse(body) as { message?: unknown };
		if (typeof parsed.message === 'string') return parsed.message;
	} catch {
		// not JSON — fall through
	}
	return body || `request failed: ${res.status}`;
}
