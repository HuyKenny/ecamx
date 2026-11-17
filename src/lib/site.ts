/**
 * Konstanty webu a kanonická URL — bez katalogu, aby je směl importovat
 * i Worker (dynamická stránka modelky, D82). `seo.ts` je reexportuje.
 */
export const SITE_NAME = 'eCamx';
export const SITE_URL = 'https://ecamx.com';
export const SITE_TAGLINE = 'Watch Free Live Sex Cams & Chat with Real Girls Online';

/**
 * Kanonická URL: bez query stringu, vždy s koncovým lomítkem.
 * Kombinace filtrů nikdy nejsou kanonické — jinak si stránky kanibalizují.
 */
export function canonicalUrl(pathname: string): string {
	const clean = pathname.split('?')[0].split('#')[0];
	const withSlash = clean.endsWith('/') ? clean : clean + '/';
	return new URL(withSlash, SITE_URL).toString();
}
