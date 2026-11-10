/**
 * Sdílené helpery pro XML sitemapy. Katalog má stovky tisíc produktů → sitemap
 * se dělí na chunky po CHUNK_SIZE a zastřešuje se sitemap indexem.
 */

export const CHUNK_SIZE = 50_000;

/** Escape pro textový obsah XML (loc/lastmod). Ampersand aj. by jinak rozbil dokument. */
export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** ISO datum (YYYY-MM-DD) pro <lastmod>. */
export function isoDate(d: Date | number | null | undefined): string | null {
	if (d == null) return null;
	const date = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
}

/** Jeden <url> záznam. */
export function urlNode(loc: string, lastmod?: string | null): string {
	const lm = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
	return `<url><loc>${escapeXml(loc)}</loc>${lm}</url>`;
}

/** Jeden <sitemap> záznam (do sitemap indexu). */
export function sitemapNode(loc: string, lastmod?: string | null): string {
	const lm = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
	return `<sitemap><loc>${escapeXml(loc)}</loc>${lm}</sitemap>`;
}

/** Obalí <url> uzly do urlset dokumentu. */
export function urlset(nodes: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${nodes.join("")}</urlset>`;
}

/** Obalí <sitemap> uzly do sitemapindex dokumentu. */
export function sitemapIndex(nodes: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${nodes.join("")}</sitemapindex>`;
}

/** Standardní hlavičky pro XML sitemap — denní edge cache (boti chodí zřídka). */
export const XML_HEADERS = {
	"content-type": "application/xml; charset=utf-8",
	"cache-control": "public, max-age=0, s-maxage=86400",
};
