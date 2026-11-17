/**
 * Živý snímek „kdo právě vysílá" (D82) — čtení za běhu a indexy (D85).
 *
 * Píše ho cron Worker `ecamx-cron` (`workers/cron/live.ts`) á 5 minut do KV
 * namespace `ecamx-live` (binding `LIVE_KV`, jen čtení z webu — registry
 * v `ecamx-registry` web nevidí, D85). Klíče:
 *  - `live-snapshot`     celý snímek (~5 MB),
 *  - `live-snapshot:ts`  jen čas snímku — podle něj se pozná, jestli má smysl
 *                        velký klíč stahovat a parsovat znovu,
 *  - `live-paths`        `p` živých modelek BEZ statické stránky (catch-all).
 *
 * Výkon (D85): isolate se každou minutu zeptá jen na malý `:ts`; 5 MB snímek
 * se stáhne a naparsuje jen když je opravdu nový (~1× za 5 min). Během obnovy
 * se vrací předchozí snímek, takže na parse nečeká žádný request kromě
 * úplně prvního v isolate.
 */
import { env } from 'cloudflare:workers';

import { SNAPSHOT_KEY, type LiveRec, type Snapshot } from './live-snapshot-types.ts';
export * from './live-snapshot-types.ts';

export const SNAPSHOT_TS_KEY = `${SNAPSHOT_KEY}:ts`;
export const LIVE_PATHS_KEY = 'live-paths';

const kv = (): KVNamespace | undefined => (env as unknown as { LIVE_KV?: KVNamespace }).LIVE_KV;

let memo: { checked: number; snap: Snapshot | null; refresh?: Promise<Snapshot | null> } | null = null;

async function load(k: KVNamespace): Promise<Snapshot | null> {
	const snap = await k.get<Snapshot>(SNAPSHOT_KEY, { type: 'json', cacheTtl: 60 }).catch(() => null);
	// Výpadek KV nesmí zahodit snímek, který už v paměti je.
	return snap ?? memo?.snap ?? null;
}

/** Snímek s pamětí isolate; stale-while-revalidate podle `live-snapshot:ts`. */
export async function readSnapshot(): Promise<Snapshot | null> {
	const k = kv();
	if (!k) return null;
	const now = Date.now();
	if (!memo?.snap) {
		if (memo?.refresh) return memo.refresh;
		const refresh = load(k).then((snap) => { memo = { checked: Date.now(), snap }; return snap; });
		memo = { checked: now, snap: null, refresh };
		return refresh;
	}
	if (now - memo.checked >= 60_000 && !memo.refresh) {
		memo.checked = now;
		const cur = memo.snap;
		memo.refresh = (async () => {
			const ts = Number(await k.get(SNAPSHOT_TS_KEY, { cacheTtl: 60 }).catch(() => null));
			const snap = ts && ts !== cur.ts ? await load(k) : cur;
			memo = { checked: Date.now(), snap };
			return snap;
		})().catch(() => cur);
	}
	return memo.snap;
}

let pathsMemo: { at: number; set: Set<string> | null; pending?: Promise<Set<string> | null> } | null = null;

/**
 * Cesty živých modelek bez statické stránky — catch-all podle toho rozhodne
 * o přepisu na `/watch/` a nemusí kvůli každé zaniklé URL parsovat 5 MB.
 */
export async function readLivePaths(): Promise<Set<string> | null> {
	const k = kv();
	if (!k) return null;
	const now = Date.now();
	if (pathsMemo && now - pathsMemo.at < 60_000) return pathsMemo.pending ?? pathsMemo.set;
	const pending = k.get<string[]>(LIVE_PATHS_KEY, { type: 'json', cacheTtl: 60 })
		.catch(() => null)
		.then((list) => {
			const set = list ? new Set(list) : (pathsMemo?.set ?? null);
			pathsMemo = { at: Date.now(), set };
			return set;
		});
	pathsMemo = { at: now, set: pathsMemo?.set ?? null, pending };
	return pending;
}

interface SnapIndex {
	byP: Map<string, LiveRec>;
	/** `síť:username malými` */
	byUser: Map<string, LiveRec>;
	/** výsledky `pick()` podle klíče — počítá `live-grid.ts` líně */
	picks: Map<string, unknown>;
}
const indexes = new WeakMap<Snapshot, SnapIndex>();

/** Indexy nad snímkem, postavené jednou na snímek (ne na každý request). */
export function snapIndex(snap: Snapshot): SnapIndex {
	let ix = indexes.get(snap);
	if (ix) return ix;
	ix = { byP: new Map(), byUser: new Map(), picks: new Map() };
	for (const r of snap.m) {
		ix.byP.set(r.p, r);
		ix.byUser.set(`${r.n}:${r.u.toLowerCase()}`, r);
	}
	indexes.set(snap, ix);
	return ix;
}

/** Bezpečný `decodeURIComponent` — rozbitá sekvence (`%C0%80`) je `null`, ne HTTP 500. */
export function safeDecode(s: string): string | null {
	try { return decodeURIComponent(s); } catch { return null; }
}
