/**
 * Browser side of the static live data (D95): the old `/api/live/grid/`,
 * `/api/live/is/` and `/api/online/{net}/` answers, assembled from plain
 * JSON files under `/livedata/` (assets-only Worker `ecamx-live`, published
 * by GitHub Actions every ~5 min). Response shapes stay what `live.ts`,
 * `zap.ts`, `watchlist.ts`, the finder and `model-page.ts` already read.
 *
 * Freshness is decided here, not by the server: a file only knows when it
 * was written (`ts`), so "stale" = older than `FRESH_MS` by the visitor's
 * clock. Stale or missing data = say nothing, keep the static cards.
 */
import type { CardData } from './card';
import { weightOf } from './network-weight';
import {
	FRESH_MS, LIVE_BASE, W_DIR, fileFor, metaFresh, pickFromPools, shardOf,
	type GFile, type LiveMeta, type OnlineFile, type PFile, type WRec,
} from './live-static';

const inflight = new Map<string, Promise<unknown>>();

/** One fetch per file per page view (several grids share `all`). */
function getFile<T>(path: string): Promise<T | null> {
	let p = inflight.get(path) as Promise<T | null> | undefined;
	if (!p) {
		p = fetch(`${LIVE_BASE}/${path}`, { signal: AbortSignal.timeout(8000) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);
		inflight.set(path, p);
		// Long-lived pages (zap, polling) must see new snapshots.
		setTimeout(() => inflight.delete(path), 60_000);
	}
	return p;
}

export interface GridResp {
	age: number | null;
	fresh: boolean;
	failed: string[];
	total?: Record<string, number>;
	g: Record<string, CardData[]>;
}

/**
 * `parts` = [[key, n]] as the old `?q=` (max 6), `sites` = network filter,
 * `exclude` = `net:slug`. Returns `null` when nothing could be read.
 */
export async function fetchGrid(parts: Array<[string, number]>, sites: string[] = [], exclude?: string): Promise<GridResp | null> {
	const siteSet = new Set(sites);
	const filtered = siteSet.size > 0;
	const want = parts.slice(0, 6);
	const files = await Promise.all(want.map(([k]) => getFile<GFile & PFile>(fileFor(k, filtered))));
	const g: Record<string, CardData[]> = {};
	const total: Record<string, number> = {};
	let ts = 0;
	let failed: string[] = [];
	want.forEach(([key, n], i) => {
		const f = files[i];
		if (!f) return;
		if (f.ts > ts) { ts = f.ts; failed = f.failed ?? []; }
		if (key === 'rail') {
			g.rail = (f.rail ?? []).filter((c) => !filtered || siteSet.has(c.n)).slice(0, n);
			return;
		}
		const at = key.indexOf('@');
		const only = key.startsWith('n:') ? key.slice(2) : at >= 0 ? key.slice(at + 1) : null;
		if (only || filtered) {
			const s = only ? new Set([only]) : siteSet;
			if (only && filtered && !siteSet.has(only)) { g[key] = []; total[key] = 0; return; }
			const r = pickFromPools(f as PFile, n, weightOf, s, exclude);
			g[key] = r.cards;
			total[key] = r.total;
			return;
		}
		g[key] = (f.c ?? []).filter((c) => !exclude || `${c.n}:${c.s}` !== exclude).slice(0, n);
		total[key] = f.total;
	});
	if (!ts) return null;
	const now = Date.now();
	return { age: Math.round((now - ts) / 1000), fresh: metaFresh(ts, now), failed, total, g };
}

/** The old `/api/online/{net}/` contract (+ `cards`), computed from `online/{net}.json`. */
export interface OnlineResp {
	network: string;
	count: number;
	truncated: boolean;
	absenceUnproven?: boolean;
	stale?: boolean;
	floor: number;
	age: number | null;
	online: Record<string, number>;
	cards: OnlineFile['cards'];
}

export async function fetchOnline(network: string): Promise<OnlineResp | null> {
	if (!/^[a-z0-9]{2,20}$/.test(network)) return null;
	const f = await getFile<OnlineFile>(`online/${network}.json`);
	if (!f) return null;
	const now = Date.now();
	// Complete list only from a fresh snapshot AND a network fetched in it.
	const fresh = f.ok && metaFresh(f.ts, now) && now - f.nts < FRESH_MS;
	return {
		network: f.network,
		count: f.count,
		truncated: !fresh,
		...(fresh ? {} : { absenceUnproven: true, stale: true }),
		floor: 0,
		age: Math.round((now - f.ts) / 1000),
		online: f.online ?? {},
		cards: f.cards ?? [],
	};
}

/**
 * Is `net:slug` still live? `p` is the page path (`/live/{p}/`) — it picks the
 * shard. `null` = don't know (old snapshot or the file did not load).
 */
export async function isLive(p: string, network: string, slug: string): Promise<{ live: boolean | null; v?: number | null }> {
	const [shard, meta] = await Promise.all([
		getFile<Record<string, WRec>>(`${W_DIR}/${shardOf(p)}.json`),
		getFile<LiveMeta>('meta.json'),
	]);
	const st = meta?.nets[network];
	const now = Date.now();
	if (!shard || !meta || !st?.ok || !metaFresh(meta.ts, now) || now - st.ts > FRESH_MS) return { live: null };
	const r = shard[p];
	if (r && r.n === network && r.s === slug) return { live: true, v: r.v ?? null };
	// Not under this path (rare: publisher ran without the page index) — the
	// online map is the network's complete list and settles it.
	const on = await getFile<OnlineFile>(`online/${network}.json`);
	if (!on) return { live: null };
	return slug in (on.online ?? {}) ? { live: true, v: on.online[slug] ?? null } : { live: false };
}
