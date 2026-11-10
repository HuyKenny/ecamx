/**
 * Sitemapy stránek modelek, po `MODELS_PER_FILE` URL.
 *
 * **Proč se od 24. 8. posílají všechny (dřív jen 150).** Strop 150 vznikl
 * 19. 8. z měření „sitemapa nabídla 8 730 URL a indexovaných je 0" — logika
 * byla nerozptylovat Googlu crawl budget a nechat ho pochytat rozcestníky.
 * Po týdnu je změřeno, že to nekoupilo nic: `/cams/`, `/cams/asian/`
 * a `/country/us/` hlásí URL Inspection pořád „URL is unknown to Google"
 * a `/girls/`, `/finder/`, `/models/` „Discovered – currently not indexed“.
 * Google prostě crawluje pár URL denně a sitemapa to nezmění.
 *
 * Bing je druhá věc: má v indexu **52 380 URL**, crawluje **9 500 stránek
 * denně** a **97 % všech kliků webu jde na stránky modelek** (1 048 z 1 076).
 * Tomu má cenu dát kompletní seznam s `lastmod`, protože poptávka na nick je
 * nejvyšší, když modelka vysílá — a to je otázka hodin, ne týdnů.
 *
 * Jméno souboru drží tvar `sitemap-*.xml`, ne `*-sitemap.xml` (past 43).
 * Viz D53.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { urlNode, urlset, XML_HEADERS } from '../lib/sitemap';
import { MODEL_PAGES } from '../lib/data';
import { SITE_URL } from '../lib/seo';

/**
 * 5 000 URL na soubor. Limit formátu je 50 000, ale menší soubory se rychleji
 * stahují a Bing si mezi nimi vybírá podle `lastmod` — u jednoho velkého
 * souboru by musel stáhnout všechno, aby zjistil, že se změnilo pět řádků.
 */
export const MODELS_PER_FILE = 5_000;

/**
 * Stránky modelek do sitemapy: jen indexovatelné **a stabilní**, ve stabilním
 * pořadí.
 *
 * `stable` je tu klíčové. Změřeno 7. 9. 2026 na dvou po sobě jdoucích buildech:
 * z 15 927 URL, které sitemapa slibovala, jich 5 037 (31,6 %) do dvou hodin
 * odpovídalo 302 — kolotoč stránek je strukturální (17 000 slotů na ~183 000
 * modelek v registry). Sitemapa, kde třetina URL vrací přesměrování, je pro web
 * s DR 14 aktivně škodlivá. Filtr zúží seznam na ~2 900 URL s churnem 0 %
 * a **neztratí ani jednu z 2 876 stránek s měřenou poptávkou** — ty jsou
 * `stable` z definice. Discovery drží adresář `/models/{písmeno}/` (D33), takže
 * zbytek katalogu zůstává dosažitelný. Viz D75.
 */
export function sitemapModels() {
	return MODEL_PAGES
		.filter((m) => m.indexable && m.stable)
		.slice()
		.sort((a, b) => a.page.localeCompare(b.page));
}

export function modelSitemapCount(): number {
	return Math.max(1, Math.ceil(sitemapModels().length / MODELS_PER_FILE));
}

export const getStaticPaths: GetStaticPaths = () =>
	Array.from({ length: modelSitemapCount() }, (_, i) => ({ params: { n: String(i + 1) } }));

export const GET: APIRoute = ({ params }) => {
	const n = Math.max(1, parseInt(String(params.n ?? '1'), 10));
	const chunk = sitemapModels().slice((n - 1) * MODELS_PER_FILE, n * MODELS_PER_FILE);
	// `lastmod` je den, kdy jsme ji naposled viděli — ne čas buildu. Build jde
	// 12× denně a stejný `lastmod` u 13 000 URL by crawleru neřekl nic.
	const nodes = chunk.map((m) => urlNode(`${SITE_URL}/live/${m.page}/`, m.last));
	return new Response(urlset(nodes), { headers: XML_HEADERS });
};
