/**
 * Static live data (D95) — the shape and the pure logic shared by the
 * publisher (`scripts/live-publish.ts`, GitHub Actions), the Worker
 * (`src/lib/live-data.ts`) and the browser (`src/lib/live-client.ts`).
 *
 * Why it exists: until 23. 11. 2026 the live snapshot lived in KV (cron Worker
 * `ecamx-cron` every 5 min) and every grid / online / watch request parsed it
 * inside the web Worker. On Workers Free (10 ms CPU, 100k requests/day for
 * the whole account, 1 000 KV writes/day, cron triggers reserved for the hub)
 * none of that fits. Now an Actions job builds the snapshot and publishes the
 * answers as plain JSON files of the assets-only Worker `ecamx-live`, routed at
 * `ecamx.com/livedata/*` — same origin, no Worker script runs for them.
 *
 * Files (all under `/livedata/`):
 *   meta.json            { ts, nets } — when the snapshot was taken, per-network state
 *   g/{facet}.json       GFile — default grid for a facet (diversified, `G_DEPTH` cards)
 *   p/{facet}.json       PFile — per-network pools of that facet (site filter, `key@net`)
 *   online/{net}.json    OnlineFile — slug → viewers for one network + 40 player cards
 *   w/{00..63}.json      { [p]: WRec } — every live model, sharded by `shardOf(p)`
 *
 * Pure module: no DOM, no `cloudflare:workers`, no Node — importable anywhere.
 */
import type { CardData } from './card.ts';

export const LIVE_BASE = '/livedata';
export const W_SHARDS = 64;
/** Default grid depth per facet (largest grid on the site is 48 + reserve). */
export const G_DEPTH = 60;
/** Per-network pool depth (pair pages `/site/{net}/{facet}/` show 48). */
export const P_DEPTH = 48;
export const RAIL_N = 10;
/**
 * Older snapshot = "we don't know" (clients keep the static cards). 30 min,
 * not 15 like the KV era: GitHub delays `*\/5` schedules by 5–20 min, and a
 * 15-minute threshold would flip the whole site to static cards several
 * times an hour.
 */
export const FRESH_MS = 30 * 60_000;

export interface NetState {
	ok: boolean;
	/** last SUCCESSFUL fetch (ms) */
	ts: number;
	count: number;
	err?: string;
	/** rooms in a private show (status pages) */
	pr?: number;
	/** people watching, summed over rooms that publish it (status pages) */
	w?: number;
	/** rooms that publish a viewer count */
	wn?: number;
}

export interface LiveMeta {
	v: 1;
	ts: number;
	nets: Record<string, NetState>;
	/** presence bookkeeping for the publisher: hours already written to KV today */
	ph?: { day: string; mask: number };
}

export interface GFile {
	v: 1;
	ts: number;
	/** networks without a fresh, complete list in this snapshot */
	failed: string[];
	total: number;
	/** matches per network */
	tn: Record<string, number>;
	/** default order (open rooms diversified, then private shows) */
	c: CardData[];
	/** only in `g/all.json`: side rail, most watched open rooms */
	rail?: CardData[];
}

export interface PFile {
	v: 1;
	ts: number;
	failed: string[];
	tn: Record<string, number>;
	/** network order for the round robin (first appearance by viewers) */
	order: string[];
	/** per network: open rooms in that network's order, then private shows */
	nets: Record<string, CardData[]>;
}

export interface OnlineFile {
	v: 1;
	network: string;
	ts: number;
	ok: boolean;
	/** last successful fetch of this network */
	nts: number;
	count: number;
	online: Record<string, number>;
	cards: Array<{ s: string; n: string; t: string; v: number; e: string; f?: string }>;
}

/** A live model in a `w/` shard — everything the watch page and `/api/stream/` need. */
export interface WRec {
	n: string;
	u: string;
	s: string;
	p: string;
	st?: 1;
	v?: number;
	t: string;
	tf?: string;
	g?: string;
	a?: number;
	c?: string;
	h?: 1;
	nw?: 1;
	ty?: 1;
	pr?: 1;
	e?: string;
	j?: string;
	pv?: string;
	/** facets (`t:`, `m:`, `c:`, `g:` …) — kept so a failed network can be carried over */
	f: string[];
	/** facet key for "similar" and Next (first money/tag facet, else gender, else `all`) */
	k: string;
	/** up to 2 category slugs for pills */
	tg?: string[];
}

/** FNV-1a 32 → two-digit shard. Same function in publisher, Worker and browser. */
export function shardOf(p: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < p.length; i++) {
		h ^= p.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return String(h % W_SHARDS).padStart(2, '0');
}

/** Facet key → file name: `t:latina` → `t_latina`. Slugs are `[a-z0-9-]`, so `_` is free. */
export function facetFile(key: string): string {
	return key.replace(':', '_');
}

/** Which file answers a grid key: default list (`g/`) or per-network pools (`p/`). */
export function fileFor(key: string, filtered: boolean): string {
	if (key === 'rail') return 'g/all.json';
	if (key.startsWith('n:')) return 'p/all.json';
	const at = key.indexOf('@');
	if (at >= 0) return `p/${facetFile(key.slice(0, at))}.json`;
	return `${filtered ? 'p' : 'g'}/${facetFile(key)}.json`;
}

/** Snapshot (or one network in it) is fresh enough to hide / replace cards. */
export function metaFresh(ts: number, now = Date.now()): boolean {
	return now - ts < FRESH_MS;
}

/** Up to 2 category slugs a card may link to (pages that exist). */
export function categoryTags(f: readonly string[], category: ReadonlySet<string>): string[] {
	const tg: string[] = [];
	for (const k of f) {
		if (tg.length >= 2) break;
		if ((k.startsWith('t:') || k.startsWith('m:')) && category.has(k.slice(2)) && !tg.includes(k.slice(2))) tg.push(k.slice(2));
	}
	return tg;
}

/** Snapshot row → card (the same fields `cardHtml` renders). */
export function toCard(r: Omit<WRec, 'k' | 'tg' | 'f'>, tg: string[]): CardData {
	return {
		n: r.n, u: r.u, p: r.p, s: r.s, t: r.t,
		...(r.tf ? { tf: r.tf } : {}),
		...(r.v ? { v: r.v } : {}),
		...(r.h ? { h: 1 as const } : {}),
		...(r.nw ? { nw: 1 as const } : {}),
		...(r.ty ? { ty: 1 as const } : {}),
		...(r.pr ? { pr: 1 as const } : {}),
		...(r.c ? { c: r.c } : {}),
		...(r.a ? { a: r.a } : {}),
		...(r.pv ? { pv: r.pv } : {}),
		...(tg.length ? { tg } : {}),
	};
}

type Weighted = { n: string; v?: number; ty?: 1 };

/**
 * Network round robin — the same rule as `diversify()` in `data.ts` and the
 * KV-era `diversifyRecs` (weights from `network-weight.ts`, D63). Input queues
 * are already in each network's own order; only the interleaving happens here.
 */
export function roundRobin<T extends Weighted>(queues: Array<[string, T[]]>, limit: number, weightOf: (n: string) => number): T[] {
	const qs = [...queues].sort((a, b) => weightOf(b[0]) - weightOf(a[0]));
	const cursor = new Array(qs.length).fill(0);
	const out: T[] = [];
	let progress = true;
	while (out.length < limit && progress) {
		progress = false;
		for (let i = 0; i < qs.length && out.length < limit; i++) {
			const [net, q] = qs[i]!;
			for (let n = weightOf(net); n > 0 && out.length < limit; n--) {
				const r = q[cursor[i]];
				if (!r) break;
				cursor[i]++;
				out.push(r);
				progress = true;
			}
		}
	}
	return out;
}

/**
 * Cards for a filtered request from a `PFile`: only `sites` (empty = all),
 * without `exclude` (`net:slug`). Open rooms interleaved first, private shows
 * fill the rest (in the player they are a paywall, D41).
 */
export function pickFromPools(p: PFile, limit: number, weightOf: (n: string) => number, sites?: Set<string>, exclude?: string): { cards: CardData[]; total: number } {
	const queues: Array<[string, CardData[]]> = [];
	const priv: CardData[] = [];
	let total = 0;
	for (const net of p.order) {
		if (sites?.size && !sites.has(net)) continue;
		total += p.tn[net] ?? 0;
		const open: CardData[] = [];
		for (const c of p.nets[net] ?? []) {
			if (exclude && `${c.n}:${c.s}` === exclude) continue;
			(c.pr ? priv : open).push(c);
		}
		queues.push([net, open]);
	}
	let cards = roundRobin(queues, limit, weightOf);
	if (cards.length < limit) {
		priv.sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
		cards = cards.concat(priv.slice(0, limit - cards.length));
	}
	return { cards, total };
}
