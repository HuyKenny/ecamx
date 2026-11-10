/**
 * robots.txt. Vzor: apps/vian/src/pages/robots.txt.ts.
 *
 * `Disallow: /*?` chrání crawl budget — filtry se řeší klientsky přes query
 * parametry a nesmí se z nich stát tisíce indexovaných kombinací.
 *
 * **Na produkci jsou v robots.txt DVĚ skupiny `User-agent: *` a druhá je naše.**
 * Tenhle soubor vydává jednu jedinou; tu první (jen `Content-Signal` a
 * `Allow: /`, plus bloky pro AI boty) předsazuje **Cloudflare** — zóna má
 * `is_robots_txt_managed: true` v `zones/{zone}/bot_management`. V repu se to
 * tedy opravit NEDÁ a hledat to tady je slepá ulička (plán ze 4. 9. 2026 se
 * na tom spletl).
 *
 * Vypínat to nemá cenu: reálné vynucení dělá `ai_bots_protection: "block"`
 * na hraně, ne robots.txt, ale ta injektáž s sebou nese
 * `Content-Signal: search=yes,ai-train=no,use=reference` — což je výslovná
 * rezervace práv podle čl. 4 směrnice EU 2019/790. Vyměnit ji za tabulkově
 * hezčí robots.txt by byl špatný obchod.
 *
 * A duplicita nic nekazí: podle RFC 9309 crawler skupiny se stejným
 * user-agentem **slučuje**, takže naše `Disallow` platí. Změřeno 7. 9. 2026 na
 * 28 dnech GSC: ze 36 stránek s impresemi má **0** vzor `/go/`, `/api/` nebo
 * `?`. Kdyby to někdy přestalo platit, poznáš to přesně takhle — ne čtením
 * robots.txt.
 */
import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/seo';

// Crawlers that send no visitors but cost Worker requests (Cloudflare Workers Paid bill, Oct 2026).
const BLOCKED_BOTS = ['YouBot', 'MJ12bot', 'QlyzeBot', 'ExaSearchBot', 'AhrefsBot', 'SemrushBot', 'DataForSeoBot', 'Applebot', 'Amazonbot', 'Amzn-SearchBot'];

export const GET: APIRoute = () => {
	const body = [
		...BLOCKED_BOTS.flatMap((ua) => [`User-agent: ${ua}`, 'Disallow: /', '']),
		'User-agent: bingbot',
		'Crawl-delay: 5',
		'Disallow: /*?',
		'Disallow: /api/',
		'Disallow: /go/',
		'Disallow: /gone/',
		'',
		'User-agent: *',
		'Allow: /',
		'Disallow: /*?',      // filtrované/řazené výpisy = duplicity
		'Disallow: /api/',   // interní endpoint pro živý stav
		'Disallow: /go/',    // odchozí přesměrování, do indexu nepatří
		// Shardy mapy přesměrování (D76) — Worker si je tahá přes ASSETS,
		// ale pro crawler je to jen datový soubor bez obsahu.
		'Disallow: /gone/',
		'',
		`Sitemap: ${SITE_URL}/sitemap.xml`,
		'',
	].join('\n');

	return new Response(body, {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
};
