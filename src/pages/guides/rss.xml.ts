/**
 * RSS průvodců (audit 22. 11. 2026). Čtečky a agregátory se o novém průvodci
 * dozví bez crawlu; statický soubor, generuje se při buildu ze stejné kolekce
 * jako `/guides/`.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_URL, SITE_NAME } from '../../lib/site';
import { escapeXml } from '../../lib/sitemap';
import { fillStats } from '../../lib/guide-stats';

export const GET: APIRoute = async () => {
	const guides = (await getCollection('guides'))
		.sort((a, b) => (b.data.published ?? b.data.updated).getTime() - (a.data.published ?? a.data.updated).getTime());
	const items = guides.map((g) => {
		const url = `${SITE_URL}/guides/${g.id}/`;
		return `<item><title>${escapeXml(fillStats(g.data.h1))}</title><link>${url}</link><guid isPermaLink="true">${url}</guid>`
			+ `<pubDate>${(g.data.published ?? g.data.updated).toUTCString()}</pubDate>`
			+ `<description>${escapeXml(fillStats(g.data.description))}</description></item>`;
	});
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>`
		+ `<title>${escapeXml(`${SITE_NAME} guides`)}</title><link>${SITE_URL}/guides/</link>`
		+ `<atom:link href="${SITE_URL}/guides/rss.xml" rel="self" type="application/rss+xml"/>`
		+ `<description>How cam sites work, what they cost and how to stay safe — written from our own live data.</description>`
		+ `<language>en</language>${items.join('')}</channel></rss>\n`;
	return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
