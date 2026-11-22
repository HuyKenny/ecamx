/**
 * Živý stav „kdo právě vysílá" pro jednu síť.
 *
 * **Od 17. 11. 2026 (D82) se nesahá na feedy sítí** — čte se hotový snímek
 * z KV `live-snapshot`, který každých 5 minut skládá cron Worker
 * (`workers/cron/live.ts`) z KOMPLETNÍCH feedů všech sítí. Dřív se tu
 * stahoval jen výřez (top 300 / 150 / 100 kvůli CPU stropu free plánu),
 * takže chybějící modelka u 7 z 10 sítí nic nedokazovala a při výpadku
 * upstreamu odpověď `{online:{}}` zhasla celou síť i s přehrávači.
 *
 * Kontrakt odpovědi zůstává (klient v `Layout.astro` a `watchlist.ts` se
 * nemění): `online` = slug → diváci, `truncated`, `floor`, `absenceUnproven`,
 * `?cards=N` = hotové karty. Rozdíl je v pravdivosti: když je snímek čerstvý
 * a síť `ok`, je seznam úplný (`truncated: false`) a chybějící modelka
 * opravdu nevysílá. Změřeno 17. 11.: průnik snímku z Cloudflare se stejným
 * feedem staženým z Maliny je 97–100 % u všech deseti sítí — rozdíl rosterů
 * podle IP (past 104) byl ve skutečnosti rozdíl výřezů.
 *
 * Když je snímek starý nebo síť spadla, odpověď to přizná
 * (`truncated` + `absenceUnproven` + `stale`) a klient nic neskryje.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { embedUrl } from '../../../lib/affiliate';
import { readSnapshot, isFresh } from '../../../lib/live-snapshot';

export const prerender = false;

const HEADERS = {
	'content-type': 'application/json; charset=utf-8',
	// Snímek se mění á 5 min; 60 s na hraně stačí a klient má 30 s.
	'cache-control': 'public, max-age=30, s-maxage=60',
	// `_headers` na Worker routy neplatí.
	'x-content-type-options': 'nosniff',
	'x-robots-tag': 'noindex',
} as const;

const NETWORKS = new Set([
	'chaturbate', 'camsoda', 'cam4', 'amateur', 'bongacams', 'xlovecam',
	'livejasmin', 'stripchat', 'streamate', 'imlive',
]);

export const GET: APIRoute = async ({ params, request }) => {
	const id = params.network ?? '';
	if (!NETWORKS.has(id)) return new Response('{"error":"unknown network"}', { status: 404, headers: HEADERS });
	const wantCards = Math.min(40, Math.max(0, parseInt(
		new URL(request.url).searchParams.get('cards') ?? '0', 10) || 0));

	// Edge cache: klíč jen `origin+pathname` (+ `?cards=N`, mění obsah — past 86).
	let cache: Cache | null = null;
	let cacheKey: Request | null = null;
	try {
		cache = (caches as any)?.default ?? null;
		if (cache) {
			const u = new URL(request.url);
			cacheKey = new Request(`${u.origin}${u.pathname}${wantCards ? `?cards=${wantCards}` : ''}`);
			const hit = await cache.match(cacheKey);
			if (hit) return hit;
		}
	} catch { cache = null; }

	const snap = await readSnapshot();
	const net = snap?.nets[id];
	const fresh = !!snap && !!net && isFresh(snap, id);

	const online: Record<string, number> = {};
	let cards: Array<{ s: string; n: string; t: string; v: number; e: string; f?: string }> | undefined;
	if (snap) {
		const recs = snap.m.filter((r) => r.n === id);
		for (const r of recs) online[r.s] = r.v ?? 0;
		if (wantCards) {
			const get = (k: string) => String((env as unknown as Record<string, string>)[k] ?? '');
			cards = [];
			for (const r of recs) {
				if (cards.length >= wantCards) break;
				if (r.pr) continue; // soukromá show = v přehrávači zeď
				let e = '';
				try { e = embedUrl(id as never, r.u, get, r.e ?? null); } catch { e = ''; }
				cards.push({ s: r.s, n: r.u, t: r.t, v: r.v ?? 0, e, ...(r.tf ? { f: r.tf } : {}) });
			}
		}
	}

	const body = JSON.stringify({
		network: id,
		count: Object.keys(online).length,
		// Úplný seznam jen ze svěží, úspěšně stažené sítě. Jinak „nevíme".
		truncated: !fresh,
		...(fresh ? {} : { absenceUnproven: true, stale: true }),
		...(cards ? { cards } : {}),
		floor: 0,
		age: snap ? Math.round((Date.now() - snap.ts) / 1000) : null,
		online,
	});
	const out = new Response(body, { headers: HEADERS });
	try { if (cache && cacheKey) await cache.put(cacheKey, out.clone()); } catch { /* bonus */ }
	return out;
};
