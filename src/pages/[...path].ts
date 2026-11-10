/**
 * Catch-all pro cesty, na které neexistuje statický soubor.
 *
 * **Proč to je nejdůležitější route na webu:** do 19. 8. 2026 tady nebylo nic
 * a stránky modelek, které přestaly existovat, vracely tvrdou 404. Změřeno
 * v GSC: 729 z 837 stránek modelek, které kdy měly imprese, byla 404 — 2 185
 * z 2 474 impresí (89 %). A nebyla to jen historie: modelka pod prahem
 * `INDEX_MIN_DAYS` (5 878 z 8 168 živých) dostala stránku, dokud vysílala,
 * a v momentě, kdy skončila, se z URL stala 404 — `/live/shena-nomy/` zmizela
 * během dvou hodin. Google to čte jako nedůvěryhodný web; odtud „Crawled –
 * currently not indexed" u prakticky celého `/live/`.
 *
 * Statické soubory obsluhuje **assets layer PŘED Workerem**, takže se sem
 * dostane jen to, co soubor nemá. Když se modelka vrátí, její stránka je znovu
 * statický soubor a tahle route ji vůbec neuvidí.
 *
 * ⚠️ NESMÍ zastínit `/go/` ani `/api/` — to jsou vydělávající a datové routy
 * a mají vlastní, konkrétnější soubory. Astro dává přednost konkrétnější
 * routě, ale hlídá to i guard v CI („Verify /go/ redirects earn money").
 *
 * Viz docs/DECISIONS.md D35.
 */
import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { redirectFor, type ShardLoader } from '../lib/gone';


/**
 * Hodnotu doplní `scripts/build-csp.ts` po buildu — složí ji z toho, co
 * postavený web reálně načítá, a stejný řetězec zapíše do `_headers`.
 * Tady musí být zástupný text, protože Worker se sestavuje dřív, než ta
 * měření existují. Když by náhrada neproběhla, build-csp spadne.
 */
const CSP = '__ECAMX_CSP__';

export const prerender = false;

/**
 * 302, ne 301. Modelka se běžně vrátí za pár hodin a její stránka se znovu
 * postaví — u 301 by si prohlížeč i Google pamatovali přesměrování dál
 * a URL, která zase žije, by nikdo nenavštívil. Trvale přesunutá je jen
 * legacy WP struktura, a ta jede přes `_redirects` jako 301.
 */
const STATUS = 302;

/**
 * Cache shardů mapy přesměrování **v rámci isolate**.
 *
 * Mapa má 195 706 slugů (6,0 MB) a do 23. 9. 2026 byla vložená v bundlu jako
 * JS literál — 87 % jeho velikosti, kterou zaplatil každý studený start, i když
 * se přesměrování týká jen cest bez statického souboru (D76). Teď leží
 * v `public/gone/{a–z,0–9,_}.json` a stahuje se jen shard, který je potřeba.
 *
 * Cache je bez evikce schválně: shardů je 36, takže strop je 36 záznamů
 * a isolate je stejně nedrží věčně. Ukládá se **Promise**, ne výsledek — dva
 * souběžné requesty na tentýž shard tak vyvolají jeden fetch, ne dva.
 */
const shards = new Map<string, Promise<Record<string, string> | null>>();

function shardLoader(assets: { fetch(req: Request): Promise<Response> } | undefined, url: URL): ShardLoader {
	return async (shard) => {
		let p = shards.get(shard);
		if (!p) {
			p = (async () => {
				if (!assets) return null;
				try {
					// `shard` už je klíč z `shardOf()` — `gone.ts` ho tak posílá.
					const res = await assets.fetch(new Request(new URL(`/gone/${shard}.json`, url)));
					return res.ok ? await res.json() as Record<string, string> : null;
				} catch {
					// Výpadek shardu nesmí shodit přesměrování — vrátí se `null`
					// a `gone.ts` spadne na záložní adresář (D53: nikdy 404).
					return null;
				}
			})();
			shards.set(shard, p);
		}
		return p;
	};
}

export const GET: APIRoute = async ({ url }) => {
	const assets = (workerEnv as unknown as { ASSETS?: { fetch(req: Request): Promise<Response> } }).ASSETS;
	const target = await redirectFor(url.pathname, shardLoader(assets, url));
	if (target) {
		return new Response(null, {
			// Legacy WP struktura je trvale zaniklá → 301. Stránka modelky
			// zůstává 302 (viz výš).
			status: target.permanent ? 301 : STATUS,
			headers: {
				location: target.to,
				// Krátce, ať se vrácená stránka projeví. Bez toho by 302 viselo
				// v edge cache i po tom, co modelka zase začne vysílat.
				'cache-control': 'public, max-age=300',
				'referrer-policy': 'strict-origin-when-cross-origin',
			},
		});
	}

	// Neznámá cesta → naše 404 stránka, ne prázdné tělo. Nabízí rozcestník,
	// takže i špatná adresa má kam pokračovat.
	if (assets) {
		const res = await assets.fetch(new Request(new URL('/404.html', url)));
		if (res.ok) {
			return new Response(res.body, {
				status: 404,
				// `_headers` na Worker routu neplatí (je to Worker, ne asset),
				// takže tahle 404 byla jediná HTML odpověď na webu bez
				// bezpečnostních hlaviček — dala se zarámovat do cizí stránky.
				// Držet v souladu s `public/_headers`. Viz D63.
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'public, max-age=300',
					'x-content-type-options': 'nosniff',
					'x-frame-options': 'DENY',
					'referrer-policy': 'strict-origin-when-cross-origin',
					'strict-transport-security': 'max-age=31536000; includeSubDomains',
					'content-security-policy': CSP,
				},
			});
		}
	}
	return new Response('Not found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
};
