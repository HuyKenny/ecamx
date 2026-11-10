/**
 * Sitemapa rozcestníků — homepage, kategorie, země, sítě, abecední adresář
 * a statické stránky. **Bez stránek modelek**, ty mají vlastní soubory
 * (`sitemap-models-{n}.xml`), aby se dal Googlu a Bingu nabídnout jiný objem:
 * Google z tohohle webu crawluje pár URL denně, Bing 9 500.
 *
 * Obsah se od 19. 8. nezměnil, jen se přestěhoval z `sitemap.xml`, ze kterého
 * je teď sitemapindex. Viz D53.
 */
import type { APIRoute } from 'astro';
import { ALTERNATIVES_FOR } from '../content/network-compare';
import { TOKEN_RATES } from '../content/token-rates';
import { urlNode, urlset, isoDate, XML_HEADERS } from '../lib/sitemap';
import { DIRECTORY_SIZE, pageCount } from '../lib/paging';
import { FACETS, allCategoryFacets, META, MODEL_LETTERS, MODELS_BY_LETTER } from '../lib/data';
import { SITE_URL } from '../lib/seo';

export const GET: APIRoute = () => {
	const lastmod = isoDate(new Date(META.generatedAt));
	const abs = (p: string) => `${SITE_URL}${p}`;
	const nodes: string[] = [
		urlNode(abs('/'), lastmod),
		...['girls', 'guys', 'couples', 'trans'].map((g) => urlNode(abs(`/${g}/`), lastmod)),
		urlNode(abs('/cams/'), lastmod),
		// allCategoryFacets(), ne FACETS.categories — jinak vypadne 12 atributových
		// stránek (/cams/latin/, /cams/blonde/, …), které existují, ale nikdo je nenajde.
		...allCategoryFacets().map((c) => urlNode(abs(`/cams/${c.slug}/`), lastmod)),
		// Rozcestník zemí — do 28. 9. neexistoval a drobeček „Countries“ vedl donikam.
		urlNode(abs('/country/'), lastmod),
		...FACETS.countries.map((c) => urlNode(abs(`/country/${c.slug}/`), lastmod)),
		// Rozcestník sítí. Do 19. 8. neexistoval, přestože na `/site/{síť}/`
		// odkazuje 16 830 stránek — kdo URL zkrátil, dostal 404.
		urlNode(abs('/site/'), lastmod),
		...FACETS.networks.map((n) => urlNode(abs(`/site/${n.slug}/`), lastmod)),
		// Podstránky sítí existují jen tam, kde je ručně psaný obsah (a u tokenů
		// ověřené ceny) — sitemapa musí jet z týchž seznamů, jinak by ohlásila
		// URL, která se nevygenerovala.
		...ALTERNATIVES_FOR.map((id) => urlNode(abs(`/site/${id}/alternatives/`), lastmod)),
		...Object.keys(TOKEN_RATES).map((id) => urlNode(abs(`/site/${id}/tokens/`), lastmod)),
		urlNode(abs('/finder/'), lastmod),
		// `/for-models/` do sitemapy patří, `/my/` NE — ta je osobní, `noindex`
		// a pro crawlera prázdná.
		urlNode(abs('/for-models/'), lastmod),
		urlNode(abs('/models/'), lastmod),
		// Adresář nicků na víc sítích. Stránka 1 je `index, follow` a stabilní
		// (řadí se podle slugu); stránky 2+ jsou `noindex` a do sitemapy nepatří,
		// stejně jako u mřížek.
		urlNode(abs('/models/same-nickname/'), lastmod),
		// Abecední adresář. Stránkované mřížky (`/cams/bbw/2/`) tu SCHVÁLNĚ
		// nejsou — jsou `noindex` a jejich obsah se mění každé 2 h. Adresář je
		// naopak stabilní a je to trvalá crawl cesta ke stránkám modelek,
		// které nevysílají. Viz D32, D33.
		...MODEL_LETTERS.flatMap((l) => {
			const pages = pageCount(MODELS_BY_LETTER.get(l)!.length, DIRECTORY_SIZE);
			return Array.from({ length: pages }, (_, i) =>
				urlNode(abs(i === 0 ? `/models/${l}/` : `/models/${l}/${i + 1}/`), lastmod));
		}),
		// Statické stránky bez vazby na katalog.
		...['about', 'contact', 'terms', 'privacy', '2257', 'dmca'].map((p) => urlNode(abs(`/${p}/`))),
	];
	return new Response(urlset(nodes), { headers: XML_HEADERS });
};
