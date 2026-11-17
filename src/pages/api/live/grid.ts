/**
 * `/api/live/grid/` — karty právě vysílajících modelek pro mřížky (D82).
 *
 *   ?q=all~60,t:latina~12   fasety a počty (max 6 faset, max 120 karet na fasetu)
 *   &s=chaturbate,camsoda   jen tyhle sítě (filtr v liště)
 *   &x=chaturbate:nick      vynechat modelku (podobné na jejím profilu)
 *
 * Čte živý snímek (cron á 5 min). Odpověď nese `age` a `failed` — klient
 * podle toho pozná, jestli smí statické karty z buildu nahradit, nebo je
 * nechat být (výpadek nesmí zhasnout mřížku, chyba 1 z plánu).
 */
import type { APIRoute } from 'astro';
import { readSnapshot, isFresh, snapIndex } from '../../../lib/live-snapshot';
import { allowedFacet, NETWORK_IDS, roundN, pick } from '../../../lib/live-grid';

export const prerender = false;

const HEADERS = {
	'content-type': 'application/json; charset=utf-8',
	'cache-control': 'public, max-age=30, s-maxage=60',
	'x-content-type-options': 'nosniff',
	'x-robots-tag': 'noindex',
} as const;

const NET_RE = /^[a-z0-9]{2,20}$/;
const KEY_RE = /^[a-z0-9]{2,20}:[a-z0-9-]{1,96}$/;

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	// Normalizace parametrů = i normalizovaný klíč cache (jiné pořadí, stejná odpověď).
	const wants: Array<[string, number]> = [];
	for (const part of (url.searchParams.get('q') ?? 'all~60').split(',').slice(0, 6)) {
		const [key, n] = part.split('~');
		if (!key || !allowedFacet(key)) continue;
		wants.push([key, roundN(Math.min(120, Math.max(1, parseInt(n ?? '60', 10) || 60)))]);
	}
	if (!wants.length) return new Response('{"error":"bad q"}', { status: 400, headers: HEADERS });
	const sites = new Set((url.searchParams.get('s') ?? '').split(',').filter((x) => NET_RE.test(x) && NETWORK_IDS.has(x)));
	const xRaw = url.searchParams.get('x') ?? '';
	const exclude = KEY_RE.test(xRaw) ? xRaw : undefined;

	const norm = new URL(url.origin + url.pathname);
	norm.searchParams.set('q', wants.map(([k, n]) => `${k}~${n}`).join(','));
	if (sites.size) norm.searchParams.set('s', [...sites].sort().join(','));
	if (exclude) norm.searchParams.set('x', exclude);
	const cacheKey = new Request(norm.toString());
	let cache: Cache | null = null;
	try {
		cache = (caches as any)?.default ?? null;
		const hit = cache ? await cache.match(cacheKey) : null;
		if (hit) return hit;
	} catch { cache = null; }

	const snap = await readSnapshot();
	if (!snap) {
		// Bez snímku nic netvrdit — klient nechá statické karty.
		return new Response(JSON.stringify({ age: null, fresh: false, failed: [], g: {} }), { headers: HEADERS });
	}
	const now = Date.now();
	const failed = Object.keys(snap.nets).filter((n) => !isFresh(snap, n, now));
	const g: Record<string, unknown> = {};
	const total: Record<string, number> = {};
	// Výběr bez filtru a bez výjimky je pro všechny stejný → počítá se jednou
	// na snímek (D85), ne při každém requestu (prokládání řadí ~6k záznamů).
	const memo = snapIndex(snap).picks as Map<string, ReturnType<typeof pick>>;
	for (const [key, n] of wants) {
		const plain = !sites.size && !exclude;
		const mk = `${key}~${n}`;
		const r = (plain && memo.get(mk)) || pick(snap.m, key, n, { sites, exclude });
		if (plain && !memo.has(mk)) memo.set(mk, r);
		g[key] = r.cards;
		total[key] = r.total;
	}
	const body = JSON.stringify({
		age: Math.round((now - snap.ts) / 1000),
		// Čerstvý = snímek mladší 15 min. Jednotlivé spadlé sítě jsou ve `failed`.
		fresh: now - snap.ts < 15 * 60_000,
		failed,
		total,
		g,
	});
	const out = new Response(body, { headers: HEADERS });
	try { if (cache) await cache.put(cacheKey, out.clone()); } catch { /* bonus */ }
	return out;
};
