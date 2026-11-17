/**
 * Hosty CDN náhledů → preconnect a CSP.
 *
 * Vlastní modul, ne položka v `data.ts`: postbuildový `build-csp.ts` z toho
 * skládá `img-src` a přes `data.ts` by si natáhl 17 MB katalogu (past 64).
 * Stejný důvod jako u `popup-blocked.ts`; `data.ts` seznam re-exportuje, takže
 * se pro zbytek webu nic nemění.
 *
 * Musí tu být i sítě, které zrovna nemají v buildu ani jednu kartu: náhledy
 * záchranných karet přicházejí z feedu až za běhu (D67), takže se z HTML
 * vyčíst nedají a chybějící host by se poznal až u návštěvníka.
 */
export const THUMBNAIL_HOSTS = [
	// Prvních šest = preconnect v <head>. Pořadí podle sítí, které nejčastěji
	// obsazují první karty mřížky (Chaturbate má váhu 4, D63), přeměřeno
	// 17. 11. 2026 na živých mřížkách (D85).
	'thumb.live.mmcdn.com', 'img.doppiocdn.com', 'media.livemediahost.com',
	'snapshots.xcdnpro.com', 'i.bgicdn.com', 'imagetransform.icfcdn.com',
	// Zbytek jen dns-prefetch (a CSP img-src v `build-csp.ts`).
	'galleryn0.vcmdiawe.com', 'galleryn1.vcmdiawe.com', 'galleryn2.vcmdiawe.com',
	'galleryn3.vcmdiawe.com', 'img1.wlresources.com', 'i0.imlmediahub.com',
	// Amateur.tv: adresa náhledu je `www.amateur.tv`, ale přesměruje na a0s.net.
	'www.amateur.tv', 'f-stream-captures.a0s.net',
	'static-cdn.strpst.com', 'static-proxy.strpst.com',
	// Náhradní obrázky Cam4, když snapshot chybí (D69).
	'stackvaults-media.xcdnpro.com', 'static.cam4.com',
];
