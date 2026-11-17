/**
 * Živý snímek „kdo právě vysílá" (D82) — tvar a čtení za běhu.
 *
 * Píše ho cron Worker `ecamx-cron` (`workers/cron/live.ts`) á 5 minut do KV
 * `ecamx-registry` pod klíčem `live-snapshot`; web ho čte přes binding
 * `LIVE_KV`. Jeden snímek ~6 MB, parsuje se nejvýš jednou za minutu na isolate.
 *
 * Typy jsou tady (ne v cron Workeru), aby je web importoval bez toho, že by
 * si do bundlu natáhl registr sítí.
 */
import { env } from 'cloudflare:workers';

import { SNAPSHOT_KEY, type Snapshot } from './live-snapshot-types.ts';
export * from './live-snapshot-types.ts';

let memo: { at: number; snap: Snapshot | null; pending?: Promise<Snapshot | null> } | null = null;

/**
 * Snímek z KV s pamětí isolate na 60 s. Ukládá se i rozdělaný Promise, aby
 * souběžné requesty nevyvolaly dva parsy 6 MB (stejný vzor jako `gone.ts`).
 */
export async function readSnapshot(): Promise<Snapshot | null> {
	const now = Date.now();
	if (memo && now - memo.at < 60_000) return memo.pending ?? memo.snap;
	const kv = (env as unknown as { LIVE_KV?: KVNamespace }).LIVE_KV;
	if (!kv) return null;
	const pending = kv.get<Snapshot>(SNAPSHOT_KEY, { type: 'json', cacheTtl: 60 })
		.catch(() => null)
		.then((snap) => {
			// Výpadek KV nesmí zahodit snímek, který už v paměti je.
			const keep = snap ?? memo?.snap ?? null;
			memo = { at: Date.now(), snap: keep };
			return keep;
		});
	memo = { at: now, snap: memo?.snap ?? null, pending };
	return pending;
}
