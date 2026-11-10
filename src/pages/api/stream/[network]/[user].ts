/**
 * Čerstvá adresa live streamu jedné modelky. Druhá (a poslední) dynamická
 * route vedle `/api/online/[network]` a `/go/[network]/[user]`.
 *
 * Proč to existuje
 * ----------------
 * Stránka modelky nese adresu HLS streamu z buildu, ale ta zastarává: nese
 * shard (`ded6740-edge20.bcvcdn.com`), který se z nicku odvodit nedá (cizí
 * shard = 404) a modelka ho po reconnectu mění. **Změřeno 27. 8. 2026 na
 * vzorku 25 modelek 40 minut po syncu: 14 adres pořád hrálo, 11 bylo mrtvých**
 * (8× modelka skončila, 3× změnila shard).
 *
 * První verze obnovy posílala mapu 150 nejsledovanějších do `/api/online/?s=1`
 * a byla k ničemu: **všechny tři modelky se změněným shardem byly z dlouhého
 * ocasu** (10–49 diváků, hranice top 150 je 102). Populární modelky vysílají
 * dlouho a shard jim drží; mění ho právě ty, které v mapě nejsou.
 *
 * Proto dotaz na JEDNU modelku. BongaCams to umí přes `api_v=2&username={nick}`
 * — 2,8 kB místo 4,4 MB celého feedu, takže se to vejde do 10 ms CPU
 * s velkou rezervou. Nick je **case-sensitive** a offline modelka vrací
 * `{"message":"Invalid model username or offline model"}`, což je čistší signál
 * než prázdný playlist (ten se vrací s HTTP 200, past 85).
 *
 * Odpověď: `{ url }`, nebo `{ offline: true }`. Klient na `offline` odkryje
 * odkaz do pokoje a dál to nezkouší. Viz D62.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

/** Kratší než u `/api/online` (60 s): tady jde o adresu, která právě vznikla. */
const TTL = 45;

/** Stejná ochrana jako v `/go/`: bez ní by šel parametr do cizí URL. */
const USERNAME = /^[A-Za-z0-9_.-]{1,64}$/;

const json = (body: unknown, status = 200, ttl = 0) => new Response(JSON.stringify(body), {
	status,
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': ttl ? `public, max-age=15, s-maxage=${ttl}` : 'private, no-store',
		// `_headers` na Worker routu neplatí, hlavičky musí být tady.
		'x-content-type-options': 'nosniff',
		'x-robots-tag': 'noindex',
	},
});

/**
 * **Cam4: adresa streamu se tahá z celého feedu, ne z dotazu na jednu modelku.**
 *
 * Jejich API dotaz na jeden nick nemá, takže se sáhne pro celý seznam. Aby to
 * nestálo 10 ms CPU, hledá se dvojice `nickname` + `preview_url` **regexem
 * v textu**, ne přes `JSON.parse` — tentýž trik jako u CamSody v `/api/online/`.
 * Odpověď se cachuje na edge, takže upstream se ptáme jednou za TTL bez ohledu
 * na počet modelek, na které se lidi dívají.
 *
 * Adresa je krátkodobá: 12 h stará vracela 404 u 8 z 8 zkoušených. Viz D70.
 */
async function cam4Stream(user: string, e: Record<string, string>): Promise<string> {
	const res = await fetch(
		`https://api.cam4pays.com/api/v1/cams/online.json?limit=1000&order_by=viewers_desc&sid=${encodeURIComponent(e.CAM4_SID ?? '')}`,
		{ headers: { 'User-Agent': 'ecamx/1.0 (+https://ecamx.com)' }, signal: AbortSignal.timeout(8000) },
	);
	if (!res.ok) throw new Error(`upstream ${res.status}`);
	const raw = await res.text();
	// **Hledá se jen ten jeden nick, ne všechny dvojice.** Globální regex přes
	// 1,5 MB by musel mít okno přes tisíc znaků (mezi `nickname` a
	// `preview_url` je jich 1 100) a u modelky bez streamu — 14 z 300 ho nemá —
	// by přeskočil do dalšího záznamu a vrátil cizí stream. Proto: najít nick,
	// vzít úsek po další `"nickname":` a v něm hledat adresu.
	// Nick porovnáváme bez ohledu na velikost písmen; v naší URL je zmenšený.
	const esc = user.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
	const at = new RegExp(`"nickname":"${esc}"`, 'i').exec(raw);
	if (!at) return '';
	const win = raw.slice(at.index, at.index + 4000);
	const next = win.indexOf('"nickname":"', 1);
	const scope = next > 0 ? win.slice(0, next) : win;
	const m = /"preview_url":"((?:[^"\\]|\\.)*)"/.exec(scope);
	return m ? m[1].replace(/\\\//g, '/') : '';
}

export const GET: APIRoute = async ({ params, request }) => {
	// Sítě, které adresu streamu posílají. Ostatní jedou přes iframe (nebo
	// přehrávač nemají), takže se tady nemají co ptát.
	const net = params.network;
	if (net !== 'bongacams' && net !== 'cam4') return json({ error: 'unsupported network' }, 404);
	const user = params.user ?? '';
	if (!USERNAME.test(user)) return json({ error: 'bad username' }, 400);

	let cache: Cache | null = null;
	let cacheKey: Request | null = null;
	try {
		cache = (caches as any)?.default ?? null;
		if (cache) {
			// Klíč VČETNĚ nicku — odpověď je pro každou modelku jiná.
			const u = new URL(request.url);
			cacheKey = new Request(`${u.origin}${u.pathname}`, { method: 'GET' });
			const hit = await cache.match(cacheKey);
			if (hit) return hit;
		}
	} catch { cache = null; }

	const e = env as unknown as Record<string, string>;

	if (net === 'cam4') {
		let out: Response;
		try {
			const stream = await cam4Stream(user, e);
			// Cizí hosty se sem dostat nesmí — jde to do `<video src>` u nás.
			out = /^https:\/\/[a-z0-9.-]+\.xcdnpro\.com\//i.test(stream)
				? json({ url: stream }, 200, TTL)
				: json({ offline: true }, 200, TTL);
		} catch (err: any) {
			// Do chyby dává `fetch` celou URL i s naším `sid` — ven nesmí.
			console.error(`[api/stream/cam4] ${String(err?.message ?? err)}`);
			out = json({ error: 'upstream' }, 200);
		}
		// Stejná podmínka jako u BongaCams níž: chybová odpověď má
		// `no-store`, takže se necachuje a příští návštěvník to zkusí znovu.
		if (cache && cacheKey && out.headers.get('cache-control')?.includes('s-maxage')) {
			try { await cache.put(cacheKey, out.clone()); } catch { /* cache je bonus */ }
		}
		return out;
	}

	// `client_ip` je u `api_v=2` povinný (bez něj přijde jen chybová zpráva).
	// Posílá se IP návštěvníka — přesně na to ho síť chce, kvůli geo cílení.
	const ip = request.headers.get('cf-connecting-ip') ?? '1.1.1.1';
	const url = 'https://bngprm.com/promo.php?type=api&api_v=2&api_type=json&lang=en'
		+ `&c=${encodeURIComponent(e.BONGACAMS_USER_ID ?? '')}`
		+ `&client_ip=${encodeURIComponent(ip)}`
		+ `&username=${encodeURIComponent(user)}`;

	let out: Response;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'ecamx/1.0 (+https://ecamx.com)' },
			signal: AbortSignal.timeout(8000),
		});
		// **Offline modelka je HTTP 400**, ne 200 s prázdným tělem (změřeno:
		// `{"message":"Invalid model username or offline model"}`). Kdyby se na
		// `!res.ok` házela výjimka, hlásili bychom poruchu tam, kde je jen
		// „nevysílá" — a hlavně by se ta odpověď necachovala a stránka offline
		// modelky by tloukla na upstream při každém zobrazení.
		if (!res.ok && res.status !== 400) throw new Error(`upstream ${res.status}`);
		const data = await res.json().catch(() => null) as
			{ stream_feed_url?: string; message?: string } | null;
		const stream = String(data?.stream_feed_url ?? '');
		// Cizí hosty se sem dostat nesmí — jde to do `<video src>` na naší stránce.
		out = /^https:\/\/[a-z0-9.-]+\.bcvcdn\.com\//i.test(stream)
			? json({ url: stream }, 200, TTL)
			: json({ offline: true }, 200, TTL);
	} catch (err: any) {
		// Chybu klientovi neposílat: `fetch` dává do message celou URL, a v té
		// je náš affiliate identifikátor (stejný důvod jako v `/api/online`).
		console.error(`[api/stream/bongacams] ${String(err?.message ?? err)}`);
		out = json({ error: 'upstream' }, 200);
	}
	try {
		if (cache && cacheKey && out.headers.get('cache-control')?.includes('s-maxage')) {
			await cache.put(cacheKey, out.clone());
		}
	} catch { /* cache je bonus, ne podmínka */ }
	return out;
};
