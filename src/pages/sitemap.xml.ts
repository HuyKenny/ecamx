/**
 * Sitemapindex. Do 24. 8. 2026 to byl jediný soubor s 681 URL a stropem
 * 150 stránek modelek; teď zastřešuje dva druhy souborů:
 *
 *  - `sitemap-hubs.xml` — homepage, kategorie, země, sítě, adresář (beze změny),
 *  - `sitemap-models-{n}.xml` — VŠECHNY indexovatelné stránky modelek po 5 000.
 *
 * Důvod je změřený, ne kosmetický: stránky modelek nesou **97 % kliků webu**
 * (1 048 z 1 076 za měřené okno Bingu) a Bing crawluje 9 500 URL denně, kdežto
 * Google pár. Držet před Bingem seznam schovaný kvůli Googlu, který ho stejně
 * nečte, nemělo co koupit. Viz D53.
 *
 * `robots.txt` (statický, `public/robots.txt`) odkazuje na `/sitemap.xml`, což
 * je pořád tenhle soubor — v robots se tedy nic nemění.
 */
import type { APIRoute } from 'astro';
import { sitemapIndex, sitemapNode, isoDate, XML_HEADERS } from '../lib/sitemap';
import { META } from '../lib/data';
import { SITE_URL } from '../lib/seo';
import { modelSitemapCount } from './sitemap-models-[n].xml';

export const GET: APIRoute = () => {
	const lastmod = isoDate(new Date(META.generatedAt));
	const nodes = [
		sitemapNode(`${SITE_URL}/sitemap-hubs.xml`, lastmod),
		...Array.from({ length: modelSitemapCount() }, (_, i) =>
			sitemapNode(`${SITE_URL}/sitemap-models-${i + 1}.xml`, lastmod)),
	];
	return new Response(sitemapIndex(nodes), { headers: XML_HEADERS });
};
