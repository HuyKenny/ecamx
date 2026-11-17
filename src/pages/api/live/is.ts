/**
 * `/api/live/is/?k=síť:slug` — vysílá modelka ještě? (D88)
 *
 * Pro přepínání streamů (`src/scripts/zap.ts`): stránka se každé ~2 min
 * zeptá, jestli běžící stream neskončil, a když ano, nabídne odpočet
 * na další. `/api/online/{síť}/` by na to stačil taky, ale má až 60 kB
 * (gzip) — tady je odpověď pár bajtů.
 *
 * `live: null` = snímek je starý nebo síť ve snímku spadla, nic se netvrdí.
 */
import type { APIRoute } from 'astro';
import { readSnapshot, isFresh, snapIndex } from '../../../lib/live-snapshot';
import { NETWORK_IDS } from '../../../lib/live-grid';

export const prerender = false;

const HEADERS = {
	'content-type': 'application/json; charset=utf-8',
	'cache-control': 'public, max-age=30, s-maxage=60',
	'x-content-type-options': 'nosniff',
	'x-robots-tag': 'noindex',
} as const;
const KEY_RE = /^([a-z0-9]{2,20}):([a-z0-9-]{1,96})$/;

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const m = KEY_RE.exec(url.searchParams.get('k') ?? '');
	if (!m || !NETWORK_IDS.has(m[1]!)) return new Response('{"error":"bad k"}', { status: 400, headers: HEADERS });
	const key = `${m[1]}:${m[2]}`;

	const cacheKey = new Request(`${url.origin}${url.pathname}?k=${key}`);
	let cache: Cache | null = null;
	try {
		cache = (caches as any)?.default ?? null;
		const hit = cache ? await cache.match(cacheKey) : null;
		if (hit) return hit;
	} catch { cache = null; }

	const snap = await readSnapshot();
	let body: string;
	if (!snap || !isFresh(snap, m[1]!)) body = '{"live":null}';
	else {
		const r = snapIndex(snap).byKey.get(key);
		body = JSON.stringify(r ? { live: true, v: r.v ?? null } : { live: false });
	}
	const res = new Response(body, { headers: HEADERS });
	if (cache) { try { await cache.put(cacheKey, res.clone()); } catch { /* cache je bonus */ } }
	return res;
};
