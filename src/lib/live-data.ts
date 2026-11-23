/**
 * Worker side of the static live data (D95). Reads the files of the
 * assets-only Worker `ecamx-live` through the service binding `LIVE_DATA`
 * (a plain `fetch('https://ecamx.com/livedata/…')` from this Worker would skip
 * the route of another Worker on the same zone).
 *
 * Replaces `live-snapshot.ts` (5 MB KV value parsed per isolate): the Worker
 * now parses one ~80 kB shard per lookup, memoised per isolate for 60 s —
 * well inside the 10 ms CPU of Workers Free.
 */
import { env } from 'cloudflare:workers';
import { LIVE_BASE, W_DIR, metaFresh, shardOf, FRESH_MS, type LiveMeta, type WRec, type PFile } from './live-static.ts';

type Fetcher = { fetch(req: Request): Promise<Response> };
const binding = (): Fetcher | undefined => (env as unknown as { LIVE_DATA?: Fetcher }).LIVE_DATA;

const TTL = 60_000;
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

/** One file, memoised per isolate (Promise, so parallel requests share one fetch). */
function getFile<T>(path: string): Promise<T | null> {
	const now = Date.now();
	const hit = memo.get(path);
	if (hit && now - hit.at < TTL) return hit.p as Promise<T | null>;
	const b = binding();
	if (!b) return Promise.resolve(null);
	const prev = hit?.p as Promise<T | null> | undefined;
	const p = b.fetch(new Request(`https://ecamx.com${LIVE_BASE}/${path}`))
		.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
		.catch(() => null)
		// A failed refresh must not throw away data we already had.
		.then(async (v) => v ?? (prev ? await prev : null));
	memo.set(path, { at: now, p });
	return p;
}

export const readMeta = () => getFile<LiveMeta>('meta.json');
export const readPools = (facetFileName: string) => getFile<PFile>(`p/${facetFileName}.json`);

/**
 * Live model by page path `p`. `undefined` = we don't know (no data),
 * `null` = not live in the last snapshot.
 */
export async function liveByPath(p: string): Promise<WRec | null | undefined> {
	const shard = await getFile<Record<string, WRec>>(`${W_DIR}/${shardOf(p)}.json`);
	if (!shard) return undefined;
	return Object.prototype.hasOwnProperty.call(shard, p) ? shard[p]! : null;
}

/** Network has a fresh, complete list in the snapshot. */
export function netFresh(meta: LiveMeta, network: string, now = Date.now()): boolean {
	const n = meta.nets[network];
	return !!n && n.ok && metaFresh(meta.ts, now) && now - n.ts < FRESH_MS;
}

/** Bezpečný `decodeURIComponent` — rozbitá sekvence (`%C0%80`) je `null`, ne HTTP 500. */
export function safeDecode(s: string): string | null {
	try { return decodeURIComponent(s); } catch { return null; }
}
