/**
 * Živý stav „kdo právě vysílá". JEDINÁ dynamická route na celém webu.
 *
 * Proč per-síť a ne jeden endpoint pro všechny: free plán Workers má strop
 * **10 ms CPU na invokaci**. Parsovat sedm feedů naráz by ho spolehlivě přelilo.
 * Jedna síť = jeden malý parse, a klient si sedm requestů pustí paralelně.
 *
 * Odpověď je záměrně minimální (slug → diváci) — čím míň se parsuje, tím líp.
 */
import type { APIRoute } from 'astro';
// Astro 7 zrušilo `Astro.locals.runtime.env` — env se bere odsud.
// (Stejný vzor jako apps/vian/src/db/client.ts.)
import { env } from 'cloudflare:workers';
// Adresu přehrávače staví tatáž funkce jako build — klíče tím zůstávají na
// serveru (past 19) a klient nemusí nic odvozovat. `/go/` na ni sahá stejně.
import { embedUrl } from '../../../lib/affiliate';

export const prerender = false;

/** Kolik sekund držet odpověď v edge cache. Kratší nemá smysl, delší už je stará. */
const TTL = 60;

/**
 * Kolik záznamů si od které sítě říct. Nejde o šířku pokrytí, ale o CPU:
 * parsování odpovědi je jediná drahá věc v celé invokaci a free plán má
 * strop 10 ms. Naměřeno 16. 8. 2026 přes `wrangler tail`:
 * bongacams při 300 záznamech = 14 ms (přes limit), při 150 pak 5 ms.
 * BongaCams posílá u každé modelky přes 50 polí, proto má nejnižší strop.
 */
const FEED_LIMIT: Record<string, number> = {
	bongacams: 150,
	// CrakRevenue má strop `size=100` (past 65). Odpověď váží 98 kB, takže
	// parse je levný — problém je jen v tom, že víc než 100 pokojů nedostaneme.
	stripchat: 100,
	streamate: 100,
	imlive: 100,
};
const DEFAULT_LIMIT = 300;

/**
 * Surová karta z feedu, ze které endpoint staví odpověď.
 *
 * `f` je **záložní náhled** a je nepovinné: Cam4 nemá snapshot pro část
 * modelek (i vysílajících) a `snapshots.xcdnpro.com` vrací 404 s `text/html`,
 * které prohlížeč u obrázku zahodí — na `/site/cam4/` to bylo 8 ze 40 karet
 * (past 109). Ostatní sítě pole neposílají. Bez `f?` v tomhle typu byl
 * `pnpm exec tsc --noEmit` červený (TS2339 na `c.f`).
 */
type Card = { n: string; t: string; f?: string };

/**
 * Jen to, co klient potřebuje: kde vzít seznam a jak z něj dostat nick + diváky.
 * `req` vrací i `init`, protože XLoveCam chce POST s podepsaným tělem.
 */
const FEEDS: Record<string, {
	req: (env: Record<string, string>, LIM: number) => { url: string; init?: RequestInit };
	pick: (payload: any) => Array<[string, number]>;
	/**
	 * Levnější cesta pro feed, který `limit` ignoruje a pošle megabajty.
	 * Vytáhne dvojice přímo z textu, takže se nestaví tisíce objektů.
	 * Když vrátí podezřele málo, volající spadne zpátky na `pick`.
	 */
	pickText?: (raw: string) => Array<[string, number]>;
	/**
	 * Feed vrací celý online seznam, ne jen prvních `limit`. Pak smíme
	 * chybějící modelku bez váhání označit za offline.
	 */
	complete?: boolean;
	/**
	 * **Chybějící modelka u téhle sítě NEDOKAZUJE, že nevysílá.** Dva důvody,
	 * oba změřené 28. 8. 2026:
	 *
	 * 1. *Síť nehlásí počty diváků* (CrakRevenue, LiveJasmin, XLoveCam). Pak je
	 *    `floor` samá nula a heuristika „měla při buildu víc diváků než
	 *    nejslabší v odpovědi" prohlásí za offline úplně každého.
	 * 2. *Síť servíruje jiný roster podle IP volajícího.* Build běží z Maliny
	 *    nebo z GitHubu, runtime z Cloudflare — a to jsou jiné seznamy.
	 *    Naměřeno: z 18 karet CamSody hlásil náš endpoint 0 živých, přitom
	 *    proti feedu z Maliny jich žilo 14; u cam4 0 proti 11 z 18;
	 *    u LiveJasminu 0 proti 15 ze 17. Průnik našeho endpointu s feedem
	 *    z Maliny byl u CamSody 190 z 1 689 klíčů, u cam4 11 z 300.
	 *
	 * Chaturbate, BongaCams a Amateur.tv tímhle netrpí (roster sedí), takže
	 * u nich zhasínání dál platí — a Chaturbate je 40 % mřížky.
	 *
	 * Cena: karta, která opravdu dovysílala, u těchto sítí zůstane viset.
	 * Je to menší zlo než schovat živý pokoj, který vydělává — a od D63 vede
	 * i taková karta na stránku, která umí říct „právě dovysílala".
	 */
	absenceUnproven?: boolean;
	/**
	 * Hotová karta pro klienta — `?cards=N`. Feed nese nick i náhled, takže
	 * z něj jde postavit celá karta; **odvodit adresu náhledu z nicku jde jen
	 * u Chaturbate a Streamate**, u ostatních je v ní podpis, číselný shard
	 * nebo hash (změřeno 29. 8. na 14 600 záznamech katalogu). Proto to musí
	 * posílat endpoint, ne klient odvozovat. Viz D67.
	 */
	cards?: (payload: any) => Array<Card>;
	/** Totéž z textu — pro síť, u které se `JSON.parse` nevyplatí. */
	cardsText?: (raw: string) => Array<Card>;
}> = {
	// Sítě z CrakRevenue (stripchat, streamate, imlive) tu do 28. 8. 2026
	// SCHVÁLNĚ nebyly — a byla to díra: jejich karty neměly jak zhasnout, takže
	// 18 z 60 karet na homepage tvrdilo „Live" napořád, ať modelka vysílala nebo
	// ne. Teď se ptáme na **top 100 podle score** (jeden request, 98 kB), což je
	// jejich strop na stránku. Nedostaneme celý online seznam, takže odpověď je
	// `truncated` a chybějící modelka znamená „nevíme" — ne „nevysílá".
	// Potvrzené živé karty ale mřížka pozná a upřednostní je při plnění děr.
	//
	// Dotaz na konkrétní nicky (`name={nick}`) API umí, ale **jen po jednom**
	// (čárka ani opakovaný parametr nefungují, ověřeno), takže mřížka se šesti
	// kartami té sítě by potřebovala šest requestů. Na to je čas i rate limit
	// (40 req/10 s sdílené s vydělávajícím `/go/`, D49) škoda. Viz D54, D63.
	...crakFeed('stripchat'),
	...crakFeed('streamate'),
	...crakFeed('imlive'),
	chaturbate: {
		// Náhled z feedu, ne odvozený: `/ri/{nick}.jpg` sice funguje, ale
		// feed dává rovnou variantu 360×270, kterou používá i build.
		cards: (p: any) => (p?.results ?? []).map((r: any) => ({
			n: String(r.username ?? ''), t: String(r.image_url_360x270 ?? r.image_url ?? ''),
		})),
		req: (e, LIM) => ({ url: `https://chaturbate.com/api/public/affiliates/onlinerooms/?wm=${e.CHATURBATE_AFFILIATE}&client_ip=request_ip&format=json&limit=${LIM}` }),
		pick: (p) => (p?.results ?? []).map((r: any) => [String(r.username ?? ''), Number(r.num_users ?? 0)]),
	},
	// CamSoda parametr `limit` IGNORUJE — ověřeno 16. 8. 2026: při limit=50
	// i limit=200 vrátí vždy všech ~1 112 modelek a 1,2 MB JSONu. Snižovat
	// limit tedy nemá smysl; drahé je `JSON.parse`, ne počet řádků. Proto se
	// dvojice tahají regexem z textu (11 ms → jednotky ms).
	camsoda: {
		// roster podle IP volajícího → chybějící modelka nedokazuje offline (viz `absenceUnproven`).
		absenceUnproven: true,
		complete: true,
		req: (e) => ({ url: `https://feed.camsoda.com/api/v1/browse/online_embed?id=${e.CAMSODA_AFFILIATE}` }),
		pick: (p) => (p?.results ?? []).map((r: any) => [String(r.username ?? ''), Number(r.viewers ?? 0)]),
		// `viewers` následuje v každém záznamu krátce po `username`; ověřeno
		// proti naparsované pravdě: 1 112 z 1 112 dvojic sedí.
		pickText: (raw) =>
			[...raw.matchAll(/"username":"((?:[^"\\]|\\.)*)".*?"viewers":(\d+)/g)]
				.map((m) => [m[1], Number(m[2])] as [string, number]),
		// Náhled ze stejného textu — `thumb` následuje krátce po `username`,
		// stejně jako `viewers`. Parsovat kvůli tomu 1,2 MB JSONu by stálo
		// 11 ms CPU při stropu 10 ms.
		cardsText: (raw: string) =>
			[...raw.matchAll(/"username":"((?:[^"\\]|\\.)*)".*?"thumb":"((?:[^"\\]|\\.)*)"/g)]
				.map((m) => ({ n: m[1], t: m[2].replace(/\\\//g, '/') })),
	},
	cam4: {
		cards: (p: any) => (Array.isArray(p) ? p : []).map((r: any) => ({
			n: String(r.nickname ?? ''), t: String(r.thumb ?? ''),
			// Snapshot Cam4 pro část modelek chybí a vrací 404 (D69); feed
			// k tomu posílá profilovku a generický avatar podle pohlaví.
			f: String(r.profile_thumb ?? r.thumb_error ?? ''),
		})),
		// roster podle IP volajícího → chybějící modelka nedokazuje offline (viz `absenceUnproven`).
		absenceUnproven: true,
		req: (e, LIM) => ({ url: `https://api.cam4pays.com/api/v1/cams/online.json?limit=${LIM}&order_by=viewers_desc&sid=${e.CAM4_SID}` }),
		pick: (p) => (Array.isArray(p) ? p : []).map((r: any) => [String(r.nickname ?? ''), Number(r.viewers ?? 0)]),
	},
	bongacams: {
		cards: (p: any) => (Array.isArray(p) ? p : []).map((r: any) => {
			const i = r.profile_images ?? {};
			return { n: String(r.username ?? ''), t: String(i.thumbnail_image_big_live
				?? i.thumbnail_image_live ?? i.thumbnail_image_big ?? '') };
		}),
		req: (e, LIM) => ({ url: `https://bngprm.com/promo.php?c=${e.BONGACAMS_USER_ID}&lang=en&type=api&api_v=1&limit=${LIM}&api_type=json` }),
		pick: (p) => (Array.isArray(p) ? p : []).map((r: any) => [String(r.username ?? ''), Number(r.members_count ?? 0)]),
		// Adresu HLS streamu tady NEHLEDEJ: mřížka ji nepotřebuje a stránka
		// modelky si čerstvou vyžádá na `/api/stream/bongacams/{nick}/`, který
		// se ptá na JEDNU modelku (2,8 kB) místo celého feedu (4,4 MB). Viz D62.
	},
	amateur: {
		cards: (p: any) => (p?.body ?? []).map((r: any) => ({
			n: String(r.username ?? ''), t: String(r.imageCapture ?? r.image ?? ''),
		})),
		req: (e) => ({
			url: `https://api.a00s.net/v3/cache/affiliates/camsfeed/json?a=${e.AMATEUR_API_KEY}&lang=en&wl=www.amateur.tv`,
			init: { headers: { 'User-Agent': 'ecamx/1.0 (+https://ecamx.com)' } },
		}),
		pick: (p) => (p?.body ?? []).map((r: any) => [String(r.username ?? ''), Number(r.viewers ?? 0)]),
	},
	// XLoveCam ani LiveJasmin počty diváků neposílají — 0 tady znamená „vysílá,
	// počet neznáme" a klient číslo nevykreslí. Podstatné je, že klíč v mapě JE,
	// takže se karta neoznačí za offline. Dokud tyhle dvě sítě v endpointu
	// chyběly, zůstávalo 773 karet napořád „Live", i když modelka dávno skončila
	// — a LiveJasmin je z celé sedmičky nejlépe platící.
	xlovecam: {
		cards: (p: any) => (p?.content?.models_list ?? []).map((r: any) => ({
			n: String(r.nick ?? ''), t: String(r.model_profil_photo ?? ''),
		})),
		// nehlásí počty diváků → chybějící modelka nedokazuje offline (viz `absenceUnproven`).
		absenceUnproven: true,
		// Jediná síť s POSTem a podepsaným tělem; GET varianta neexistuje.
		req: (e, LIM) => ({
			url: 'https://webservice-affiliate.xlovecam.com/model/listonline',
			init: {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					authServiceId: '2',
					authItemId: e.XLOVE_AFFILIATE_ID,
					authSecret: e.XLOVE_API_KEY,
					timestamp: String(Math.floor(Date.now() / 1000)),
					lang: 'en', offset: '0', limit: String(LIM),
				}).toString(),
			},
		}),
		pick: (p) => (p?.content?.models_list ?? []).map((r: any) => [String(r.nick ?? r.model_id ?? ''), 0]),
	},
	livejasmin: {
		cards: (p: any) => (p?.data?.models ?? []).map((r: any) => ({
			n: String(r.performerId ?? ''), t: String(r.profilePictureUrl?.size320x240 ?? ''),
		})),
		// nehlásí počty diváků → chybějící modelka nedokazuje offline (viz `absenceUnproven`).
		absenceUnproven: true,
		req: (e, LIM) => ({
			url: 'https://ptcdw.com/api/model/feed?siteId=jasmin' +
				`&psId=${e.LIVEJASMIN_USERID}&psTool=213_1&psProgram=${e.LIVEJASMIN_PSPROGRAM || 'revs'}` +
				'&category=girl&limit=' + LIM + '&imageSizes=320x240&showOffline=0&responseFormat=json' +
				`&accessKey=${e.LIVEJASMIN_API_KEY}`,
		}),
		pick: (p) => (p?.data?.models ?? []).map((r: any) => [String(r.performerId ?? ''), 0]),
	},
};

/**
 * Tři sítě z CrakRevenue jedou přes tentýž endpoint, liší se jen značkou.
 * Klíč je Worker secret; ve statické části webu nesmí být (past 19).
 */
function crakFeed(brand: 'stripchat' | 'streamate' | 'imlive') {
	return {
		[brand]: {
			absenceUnproven: true,
			req: (e: Record<string, string>, LIM: number) => ({
				url: 'https://performersext-api.pcvdaa.com/performers-ext'
					+ `?token=${encodeURIComponent(e.CRAKREVENUE_TOKEN ?? '')}`
					+ `&brands=${brand}&live=true&sorting=score&lang=en`
					+ `&size=${LIM}&page=1&gender=${encodeURIComponent('f,m,c,t')}`,
				init: {
					headers: {
						'x-api-key': e.CRAKREVENUE_API_KEY ?? '',
						// Povinná hlavička, jinak přijde 403 v HTML (past 65).
						'user-agent': 'ecamx/1.0 (+https://ecamx.com)',
						accept: 'application/json',
					},
				},
			}),
			// Diváky API nedává vůbec → 0 znamená „vysílá, počet neznáme".
			// Slug se musí počítat z `nameClean` stejně jako v syncu, jinak se
			// karty nespárují.
			pick: (p: any) => (p?.performers ?? []).map((r: any) =>
				[String(r.nameClean ?? r.name ?? ''), 0] as [string, number]),
			cards: (p: any) => (p?.performers ?? []).map((r: any) => ({
				// Do přehrávače patří `name` s kapitalizací, do odkazu
				// `nameClean` malými (past 65).
				n: String(r.name ?? r.nameClean ?? ''),
				t: String(r.liveSnapshotURL ?? r.thumbnailUrl ?? ''),
			})),
		},
	};
}

/** Stejný slugify jako v syncu — jinak klient nespáruje karty. */
/**
 * Stejná normalizace adresy obrázku jako při buildu (`https()`
 * v `cam-networks.ts`): část feedů dává adresu bez schématu nebo po `http://`,
 * a taková se na HTTPS stránce s `img-src https:` vůbec nenačte.
 * Prázdný řetězec = použitelná adresa z toho nevznikla.
 */
function https(u: string): string {
	const s = u.startsWith('//') ? `https:${u}`
		: u.replace(/^http:\/\//, 'https://').replace(/\\\//g, '/');
	return s.startsWith('https://') ? s : '';
}

function slugify(s: string): string {
	return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const GET: APIRoute = async ({ params, request }) => {
	const id = params.network ?? '';
	// `Object.hasOwn`, ne prostý lookup: `?network=constructor` by jinak vrátil
	// funkci z prototypu a proteklo by to až do `catch`.
	const feed = Object.hasOwn(FEEDS, id) ? FEEDS[id] : undefined;
	if (!feed) return new Response('{"error":"unknown network"}', { status: 404 });
	/**
	 * `?cards=N` = „pošli hotové karty", ne jen kdo vysílá.
	 *
	 * Statická karta nemůže zaručit živý stream: stránka je i za nejlepších
	 * okolností až 6 h stará (build 4× denně, D65) a za tu dobu dovysílá
	 * většina pokojů. Změřeno 29. 8. na 13,9 h starém buildu: z 60 viditelných
	 * karet bylo potvrzeně živých **12**. Odsud si klient dotáhne karty, které
	 * vysílají PRÁVĚ TEĎ. Bez parametru je odpověď bajt po bajtu stejná jako
	 * dřív — tahá ji každá mřížka na webu. Viz D67.
	 */
	const wantCards = Math.min(40, Math.max(0, parseInt(
		new URL(request.url).searchParams.get('cards') ?? '0', 10) || 0));

	// Cache API nemusí být v každém kontextu dostupná — nesmí to shodit request.
	let cache: Cache | null = null;
	let cacheKey: Request | null = null;
	try {
		cache = (caches as any)?.default ?? null;
		if (cache) {
			// Bez query: `?cb=<random>` jinak obejde edge cache a vynutí nový
			// upstream fetch s naším affiliate klíčem. Kdo sem přidá parametr,
			// který MĚNÍ OBSAH odpovědi, musí ho přidat i do klíče — jinak by
			// mřížka dostala odpověď určenou stránce modelky a naopak (past 86).
			// Proto je `?cards=N` v klíči a nic jiného ne.
			const u = new URL(request.url);
			const suffix = wantCards ? `?cards=${wantCards}` : '';
			cacheKey = new Request(`${u.origin}${u.pathname}${suffix}`, { method: 'GET' });
			const hit = await cache.match(cacheKey);
			if (hit) return hit;
		}
	} catch { cache = null; }

	// Klíče sítí jsou Worker secrets (`wrangler secret put`). Ve statické části
	// webu se používají PUBLIC_* z build-time env — to je jiná cesta.
	let body: string;
	let status = 200;
	const limit = FEED_LIMIT[id] ?? DEFAULT_LIMIT;
	try {
		const { url, init } = feed.req(env as unknown as Record<string, string>, limit);
		const res = await fetch(url, { ...(init ?? {}), signal: AbortSignal.timeout(8000) });
		if (!res.ok) throw new Error(`upstream ${res.status}`);

		let entries: Array<[string, number]>;
		// Payload (nebo syrový text) se drží jen když jsou potřeba karty —
		// u sítí s `pickText` je celá pointa v tom, že se tisíce objektů
		// nestaví.
		let payload: any = null;
		let rawText: string | null = null;
		if (feed.pickText) {
			const raw = await res.text();
			if (wantCards) rawText = raw;
			entries = feed.pickText(raw);
			// Kdyby síť změnila tvar odpovědi, regex by tiše vrátil skoro nic
			// a všechny karty by zhasly. Radši zaplatit parse než lhát.
			if (entries.length < 20) entries = feed.pick(payload = JSON.parse(raw));
		} else {
			payload = await res.json();
			entries = feed.pick(payload);
		}

		const online: Record<string, number> = {};
		// Nejnižší počet diváků v odpovědi. Slouží klientovi k rozhodnutí, jestli
		// smí modelku prohlásit za offline — viz `truncated` níž.
		let floor = Infinity;
		for (const [name, viewers] of entries) {
			if (!name) continue;
			online[slugify(name)] = viewers;
			if (viewers < floor) floor = viewers;
		}
		const count = Object.keys(online).length;

		/**
		 * Hotové karty: slug (páruje se s mřížkou), nick (do odkazu i do
		 * přehrávače), náhled, diváci a adresa přehrávače. Bere se prvních
		 * `wantCards` v pořadí feedu, tedy podle popularity nebo score.
		 */
		let cards: Array<{ s: string; n: string; t: string; v: number; e: string; f?: string }> | undefined;
		if (wantCards && (feed.cards || feed.cardsText)) {
			const src = feed.cardsText && rawText
				? feed.cardsText(rawText)
				: (feed.cards && payload ? feed.cards(payload) : []);
			// Klíče secretů jsou tu BEZ prefixu `PUBLIC_` — build je má naopak
			// s ním (past 95).
			const get = (k: string) => String((env as unknown as Record<string, string>)[k] ?? '');
			cards = [];
			for (const c of src) {
				if (cards.length >= wantCards) break;
				if (!c?.n || !c.t) continue;
				const slug = slugify(c.n);
				// Do karet jde jen to, o čem VÍME, že vysílá — v tom je celý smysl.
				if (!(slug in online)) continue;
				const t = https(c.t);
				if (!t) continue;
				let e = '';
				try { e = embedUrl(id as never, c.n, get); } catch { e = ''; }
				const f = c.f ? https(c.f) : '';
				cards.push({ s: slug, n: c.n, t, v: online[slug] ?? 0, e, ...(f ? { f } : {}) });
			}
		}

		body = JSON.stringify({
			network: id,
			count,
			// Feed vrací jen prvních `limit` modelek podle popularity. Když je
			// odpověď plná, VÍME, že jsme neviděli celý online seznam — a modelku,
			// která v ní chybí, nesmíme označit za offline. Bez tohohle se na
			// kategoriích s méně sledovanými modelkami zhasínaly živé karty.
			truncated: !feed.complete && count >= limit,
			...(cards ? { cards } : {}),
			...(feed.absenceUnproven ? { absenceUnproven: true } : {}),
			floor: Number.isFinite(floor) ? floor : 0,
			online,
		});
	} catch (e: any) {
		// Výpadek jedné sítě nesmí rozbít stránku — klient prostě nechá
		// hodnoty z buildu. Krátká cache, ať se to zkusí brzy znovu.
		// Chybu NEposílat klientovi: `fetch` dává do message celou URL a u
		// Amateur.tv se do 120 znaků vejde i affiliate klíč (57 + 36 = 93).
		// Plná chyba patří do observability, veřejně stačí, že je odpověď stará.
		console.error(`[api/online/${id}] ${String(e?.message ?? e)}`);
		body = JSON.stringify({
			network: id, count: 0, online: {}, stale: true, reason: 'upstream',
		});
		status = 200;
	}

	const out = new Response(body, {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': `public, max-age=30, s-maxage=${TTL}`,
			// `_headers` na tuhle routu NEPLATÍ (je to Worker, ne asset),
			// takže hlavičky musí být tady.
			'x-content-type-options': 'nosniff',
			'x-robots-tag': 'noindex',
		},
	});
	try {
		if (cache && cacheKey) await cache.put(cacheKey, out.clone());
	} catch { /* cache je bonus, ne podmínka */ }
	return out;
};
