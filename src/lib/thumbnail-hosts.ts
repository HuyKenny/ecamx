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
	'thumb.live.mmcdn.com', 'media.livemediahost.com', 'snapshots.xcdnpro.com',
	'www.amateur.tv', 'i.bgicdn.com', 'img1.wlresources.com',
	'galleryn0.vcmdiawe.com', 'galleryn1.vcmdiawe.com', 'galleryn2.vcmdiawe.com',
	// Sítě přes CrakRevenue (D54). `img.doppiocdn.com` a `imagetransform.icfcdn.com`
	// nesou živé snapshoty, ostatní statické avatary.
	'img.doppiocdn.com', 'static-cdn.strpst.com', 'static-proxy.strpst.com',
	'imagetransform.icfcdn.com', 'i0.imlmediahub.com',
	// Náhradní obrázky Cam4, když snapshot chybí (D69).
	'stackvaults-media.xcdnpro.com', 'static.cam4.com',
];
