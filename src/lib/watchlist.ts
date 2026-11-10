/**
 * Watchlist — „ulož si ji jednou, hlídáme všech sedm sítí".
 *
 * ## Proč je to celé v prohlížeči
 *
 * Ne z lenosti, ale protože server na to na free plánu není:
 *
 *  - **KV má 1 000 zápisů/den** na namespace a sync z nich bere ~36. Jeden
 *    uživatel, který si přidá pět modelek a jednou to změní, je ~6 zápisů →
 *    **~150 aktivních lidí a namespace je vyčerpaný.**
 *  - Worker za běhu **žádný KV binding nemá** (`kv_namespaces: []`), KV se čte
 *    jen přes REST při buildu.
 *  - Worker má **10 ms CPU** na invokaci a u BongaCams je naměřeno 14 ms už při
 *    300 záznamech, takže hlídat sedm feedů na serveru neprojde.
 *
 * Klientský stav navíc drží naši linii „žádné účty, žádná PII" (D45): tenhle
 * modul neposílá nikam nic a nikdy nesmí začít.
 *
 * ## Formát
 *
 * `localStorage['ecamx-watch']` = JSON pole záznamů `[page, network, username]`.
 * Pole, ne objekt, protože v tom localStorage klíči jde o bajty a pořadí je
 * informace (naposledy přidaná první).
 *
 * `page` je URL slug (`/live/{page}/`), `username` je nick u sítě — potřebný pro
 * `/go/{network}/{username}/`, protože ten se od slugu liší (podtržítka).
 *
 * Modul **nesmí importovat `data.ts`** — ten tahá 13 MB katalogu a šel by do
 * klientského bundlu.
 */

export const WATCH_KEY = 'ecamx-watch';

/**
 * Strop počtu sledovaných. Není to technický limit, ale ochrana proti tomu, aby
 * `/my/` musela dotahovat živý stav pro stovky nicků a aby localStorage nerostl
 * bez konce. 200 je řádově nad tím, co kdo reálně sleduje.
 */
export const WATCH_MAX = 200;

/** Jeden sledovaný profil. Ukládá se jako pole kvůli velikosti. */
export interface WatchEntry {
	page: string;
	network: string;
	username: string;
}

type Row = [string, string, string];

export function readWatch(): WatchEntry[] {
	let raw: string | null = null;
	try { raw = localStorage.getItem(WATCH_KEY); } catch { return []; }
	if (!raw) return [];
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return []; }
	if (!Array.isArray(parsed)) return [];
	const out: WatchEntry[] = [];
	for (const row of parsed) {
		// Cizí/starý obsah se přeskočí, nikdy nehodí výjimku — rozbitý zápis
		// v localStorage nesmí shodit stránku.
		if (!Array.isArray(row) || row.length < 3) continue;
		const [page, network, username] = row as Row;
		if (typeof page !== 'string' || typeof network !== 'string' || typeof username !== 'string') continue;
		if (!page || !network || !username) continue;
		out.push({ page, network, username });
	}
	return out;
}

function write(entries: WatchEntry[]): void {
	try {
		localStorage.setItem(
			WATCH_KEY,
			JSON.stringify(entries.slice(0, WATCH_MAX).map((e) => [e.page, e.network, e.username])),
		);
	} catch { /* privátní režim nebo plná kvóta → sledování prostě nepřetrvá */ }
}

export function isWatched(page: string): boolean {
	return readWatch().some((e) => e.page === page);
}

/** Přidá nebo odebere. Vrací nový stav, aby volající nemusel číst znovu. */
export function toggleWatch(entry: WatchEntry): { watched: boolean; count: number } {
	const list = readWatch();
	const at = list.findIndex((e) => e.page === entry.page);
	if (at >= 0) {
		list.splice(at, 1);
		write(list);
		return { watched: false, count: list.length };
	}
	// Naposledy přidaná první — `/my/` to tak i vypisuje.
	list.unshift(entry);
	write(list);
	return { watched: true, count: Math.min(list.length, WATCH_MAX) };
}

/** Sítě, které je potřeba se ptát na živý stav. Prázdné = neptat se vůbec. */
export function watchedNetworks(list: WatchEntry[] = readWatch()): string[] {
	return [...new Set(list.map((e) => e.network))];
}

/* ── živý stav sledovaných ──────────────────────────────────────────────────
 *
 * Odznak v hlavičce a stránka `/my/` se ptají na tytéž feedy, takže to čte
 * JEDEN modul. Než tohle vzniklo, `/my/` stahovala `camsoda` dvakrát (změřeno):
 * jednou odznak, jednou stránka — a `/api/` sdílí okno rate limitu 40 req/10 s
 * s vydělávajícím `/go/` (D49), takže request navíc není zdarma.
 *
 * Dvě úrovně sdílení:
 *  1. **Rozdělaný request** drží `inflight` v modulu. Astro z `watchlist.ts`
 *     dělá jeden sdílený chunk, takže hlavička i stránka běží nad TOUŽ instancí
 *     a dvě paralelní volání téže sítě se scvrknou na jedno.
 *  2. **`sessionStorage` na 60 s** = TTL endpointu, takže klikání po webu už
 *     nestahuje nic. Cachuje se jen to, na co se ptáme (nicky ze seznamu),
 *     ne celý feed sítě — ten má u Chaturbate přes 13 000 položek.
 */

const LIVE_CACHE = 'ecamx-live-cache';
const LIVE_TTL = 60_000;

interface Feed { online: Record<string, number>; truncated?: boolean }

export interface LiveState {
	/** Počet diváků, nebo `undefined` když ji ve feedu nevidíme. 0 = vysílá, počet síť nehlásí. */
	viewers(network: string, slug: string): number | undefined;
	/** Feed dohlédne jen na prvních N pokojů — chybět v něm pak neznamená být offline (D11). */
	truncated(network: string): boolean;
}

interface Cached {
	at: number;
	nets: string[];
	slugs: string[];
	hits: Record<string, number>;
	cut: string[];
}

const inflight = new Map<string, Promise<Feed | null>>();

function feedOf(network: string): Promise<Feed | null> {
	let p = inflight.get(network);
	if (!p) {
		p = fetch(`/api/online/${network}/`, { signal: AbortSignal.timeout(6000) })
			.then((r) => (r.ok ? (r.json() as Promise<Feed>) : null))
			.catch(() => null);
		inflight.set(network, p);
	}
	return p;
}

function fromCache(nets: string[], slugs: string[]): LiveState | null {
	let c: Cached;
	try {
		const raw = sessionStorage.getItem(LIVE_CACHE);
		if (!raw) return null;
		c = JSON.parse(raw) as Cached;
	} catch { return null; }
	// Použitelné jen když pokrývá VŠECHNO, na co se ptáme — jinak by chybějící
	// nick vypadal jako offline.
	if (!c || Date.now() - c.at > LIVE_TTL) return null;
	if (nets.some((n) => !c.nets.includes(n))) return null;
	if (slugs.some((s) => !c.slugs.includes(s))) return null;
	return state(c);
}

function state(c: Cached): LiveState {
	return {
		viewers: (network, slug) => c.hits[`${network}/${slug}`],
		truncated: (network) => c.cut.includes(network),
	};
}

/**
 * Živý stav pro dané sítě a nicky (slugy, tak jak je klíčovaný `/api/online/`).
 * Nikdy nevyhodí — když endpoint mlčí, vypadá to jako „nikdo není live", což je
 * na stránce vidět jako stav z buildu.
 */
export async function liveFor(nets: string[], slugs: string[]): Promise<LiveState> {
	const cached = fromCache(nets, slugs);
	if (cached) return cached;

	const feeds = await Promise.all(nets.map((n) => feedOf(n).then((f) => [n, f] as const)));
	const hits: Record<string, number> = {};
	const cut: string[] = [];
	for (const [net, feed] of feeds) {
		if (!feed?.online) continue;
		if (feed.truncated) cut.push(net);
		for (const s of slugs) {
			const v = feed.online[s];
			if (v !== undefined) hits[`${net}/${s}`] = v;
		}
	}
	const c: Cached = { at: Date.now(), nets, slugs, hits, cut };
	try { sessionStorage.setItem(LIVE_CACHE, JSON.stringify(c)); } catch { /* plná kvóta → jen se nezacachuje */ }
	return state(c);
}
