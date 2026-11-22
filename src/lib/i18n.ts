/**
 * Španělský pilot `/es/` (D94, 22. 11. 2026).
 *
 * Proč: Ahrefs MX/global 22. 11. — „sexo en vivo" 136 tis./měs (KD 18),
 * „porno en vivo" 458 tis. (KD 48), „mujeres desnudas en vivo" 20 tis. (KD 1),
 * „porno gay en vivo" 11 tis. (KD 0), „cam gay" 18 tis. (KD 1). Řádově větší
 * a lehčí trh než anglický long-tail. Kategorie × země („colombianas en vivo")
 * mají ≈ 0 hledání, proto je pilot jen pár silných stránek, ne kopie webu.
 *
 * **Malý modul bez `data.ts`** — čte ho Layout, který běží i ve Workeru
 * (past 135/140). Texty stránek jsou v `src/content/es-pages.ts`.
 */

import facets from '../data/facets.json';

export type Lang = 'en' | 'es';

/** Jak se španělská stránka plní: jako gender, kategorie, nebo celá nabídka. */
export type EsSource =
	| { kind: 'all' }
	| { kind: 'gender'; gender: 'female' | 'male' | 'trans' | 'couple' }
	| { kind: 'category'; slug: string };

export interface EsRoute {
	/** Slug pod `/es/` ('' = `/es/`). */
	slug: string;
	/** Anglický protějšek pro hreflang. */
	en: string;
	source: EsSource;
}

export const ES_ROUTES: EsRoute[] = [
	{ slug: '', en: '/', source: { kind: 'all' } },
	{ slug: 'mujeres-desnudas', en: '/girls/', source: { kind: 'gender', gender: 'female' } },
	{ slug: 'tetonas', en: '/cams/big-tits/', source: { kind: 'category', slug: 'big-tits' } },
	{ slug: 'gay', en: '/cams/gay/', source: { kind: 'category', slug: 'gay' } },
	{ slug: 'hombres', en: '/guys/', source: { kind: 'gender', gender: 'male' } },
	{ slug: 'trans', en: '/trans/', source: { kind: 'gender', gender: 'trans' } },
	{ slug: 'milf', en: '/cams/milf/', source: { kind: 'category', slug: 'milf' } },
	{ slug: 'anal', en: '/cams/anal/', source: { kind: 'category', slug: 'anal' } },
	{ slug: 'squirt', en: '/cams/squirt/', source: { kind: 'category', slug: 'squirt' } },
];

export const esPath = (slug: string) => (slug ? `/es/${slug}/` : '/es/');

/**
 * Jen trasy, které v tomhle buildu opravdu vzniknou: kategorie musí být
 * ve `facets.json` (kurátorská nebo běžná), jinak by `/es/x/` i hreflang
 * vedly na 404. Čte to stránka, Layout (hreflang) i sitemapa.
 */
const F = facets as unknown as { categories?: Array<{ slug: string }>; curated?: Array<{ slug: string }> };
const builtCats = new Set([...(F.curated ?? []), ...(F.categories ?? [])].map((c) => c.slug));
export const ES_ACTIVE: EsRoute[] = ES_ROUTES.filter((r) => r.source.kind !== 'category' || builtCats.has(r.source.slug));

/**
 * Páry pro hreflang. Všechny ES stránky se staví vždy (mřížku doplní klient
 * z celé nabídky), anglické protějšky jsou velké kategorie (stovky modelek) —
 * `scripts/check-links.ts` hlídá, že žádný alternate nevede na 404.
 */
/** `<link rel="alternate" hreflang>` pro danou cestu, nebo [] když pár nemá. */
export function alternatesFor(path: string): Array<{ hreflang: string; href: string }> {
	const r = ES_ACTIVE.find((x) => x.en === path || esPath(x.slug) === path);
	if (!r) return [];
	return [
		{ hreflang: 'en', href: r.en },
		{ hreflang: 'es', href: esPath(r.slug) },
		{ hreflang: 'x-default', href: r.en },
	];
}

export function langOf(path: string): Lang {
	return path === '/es/' || path.startsWith('/es/') ? 'es' : 'en';
}

/** „13,800+" → „13.800+" (španělský oddělovač tisíců). */
export const esNumber = (s: string) => s.replace(/,/g, '.');

/** Texty rozhraní (Layout, karty). Klíče jsou stejné pro oba jazyky. */
export const UI = {
	en: {
		skip: 'Skip to content', adult: 'Adult content.', analytics: ' Analytics cookies.',
		terms: 'Terms', privacy: 'Privacy', accept: 'Accept', decline: 'Decline',
		liveChannels: 'Live channels', home: 'eCamx home', main: 'Main', closeMenu: 'Close menu',
		findModel: 'Find a model by name', findModelDots: 'Find a model by name…',
		liveNow: 'Live now', seeAll: 'See all', mostWatched: 'Most watched live now',
		browse: 'Browse', girls: 'Girls', couples: 'Couples', guys: 'Guys', trans: 'Trans',
		camSites: 'Cam sites', countries: 'Countries', guides: 'Guides',
		popular: 'Popular categories', all: 'All',
		tagline: 'Every big cam site in one grid, checked every five minutes so the cams you see are actually live.',
		otherLang: 'Español', otherLangLabel: 'Ver esta página en español',
	},
	es: {
		skip: 'Saltar al contenido', adult: 'Contenido para adultos.', analytics: ' Cookies de analítica.',
		terms: 'Términos', privacy: 'Privacidad', accept: 'Aceptar', decline: 'Rechazar',
		liveChannels: 'Canales en vivo', home: 'eCamx inicio', main: 'Principal', closeMenu: 'Cerrar menú',
		findModel: 'Buscar una modelo por nombre', findModelDots: 'Buscar una modelo por nombre…',
		liveNow: 'En vivo ahora', seeAll: 'Ver todo', mostWatched: 'Las más vistas ahora',
		browse: 'Explorar', girls: 'Chicas', couples: 'Parejas', guys: 'Hombres', trans: 'Trans',
		camSites: 'Sitios de cams', countries: 'Países', guides: 'Guías (en inglés)',
		popular: 'Categorías', all: 'Todas',
		tagline: 'Todos los grandes sitios de webcams en una sola cuadrícula, comprobados cada cinco minutos para que lo que ves esté de verdad en vivo.',
		otherLang: 'English', otherLangLabel: 'View this page in English',
	},
} as const;

/** Texty karty modelky (`cardHtml`). */
export const CARD_UI = {
	en: { live: 'Live', private: 'Private', new: 'New', toy: 'Toy', toyTitle: 'Interactive toy — reacts to tips', watching: ' watching', alt: 'live cam' },
	es: { live: 'En vivo', private: 'Privado', new: 'Nueva', toy: 'Juguete', toyTitle: 'Juguete interactivo — reacciona a las propinas', watching: ' mirando', alt: 'cam en vivo' },
} as const;
