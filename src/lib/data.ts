/**
 * Přístup ke katalogu vygenerovanému syncem. Čte se JEN při buildu
 * (getStaticPaths / frontmatter statických stránek), nikdy za běhu.
 */
import models from '../data/models.json';
import archive from '../data/archive.json';
import facets from '../data/facets.json';
import meta from '../data/meta.json';
// Kanonizace SDÍLENÁ se syncem. Dřív tu byla vlastní kopie bez `CANONICAL`
// a stránky proto neviděly modelky, které sync do kategorie spočítal.
import {
	canonicalTerm, canonicalCountry, modelLetter, countryPhrase, countryAdjective,
} from './taxonomy.ts';
export { canonicalTerm, canonicalCountry, modelLetter, countryPhrase, countryAdjective };
import { MONEY_BY_SLUG, matchesMoney } from './money-categories.ts';
import { DEFAULT_WEIGHT, payingScore, weightOf } from './network-weight.ts';
import { legacyPages } from './legacy-pages.ts';

export interface Model {
	slug: string;
	network: NetworkId;
	username: string;
	displayName: string;
	gender: string | null;
	age: number | null;
	country: string | null;
	languages: string[];
	tags: string[];
	ethnicity: string | null;
	hairColor: string | null;
	eyeColor: string | null;
	bodyType: string | null;
	bustSize: string | null;
	/**
	 * Kraj/město pod zemí („Antioquia", „Bogota D.C."). Plní ho jen Chaturbate
	 * z pole `location` — 1 913 ze 7 944 pokojů (19. 8. 2026).
	 */
	region?: string | null;
	/** Datum narození (ISO), když ho síť pošle a projde kontrolou uvěřitelnosti. */
	birthDate?: string | null;
	/**
	 * Tato čtyři pole nese JEN živá modelka. U archivních (offline) stránek se
	 * do snapshotu v registry neukládají, protože je nikde nečteme a registry
	 * má hard limit 25 MB — viz `SNAP_OMIT` v scripts/sync-cams.ts.
	 * Proto `?`: kdo je začne používat, musí počítat s `undefined`.
	 */
	appearance?: string[];
	sexualPreference?: string | null;
	streamTypes?: string[];
	subject: string | null;
	viewers: number | null;
	/**
	 * Co je navíc potřeba k sestavení URL přehrávače, když nick nestačí —
	 * číselné ID u Streamate, celá URL u ImLive (náhodné UUID). Ostatní sítě
	 * mají `undefined`. Viz `embedUrl()` v `affiliate.ts` a D54.
	 */
	embedRef?: string | null;
	thumbnail: string | null;
	/**
	 * Obrázek, když se `thumbnail` nenačte. Plní ho jen Cam4 (D69) — jejich
	 * snapshoty pro část modelek vracejí 404 a karta by zůstala prázdná.
	 */
	thumbnailFallback?: string | null;
	blockedCountries?: string[];

	/**
	 * Signály pro konverzi — co která síť plní, viz scripts/cam-networks.ts.
	 * `previewVideo`, `onlineSeconds`, `status` a `goalText` platí jen pro živou
	 * modelku a u archivních stránek chybí (z minula by lhaly). Šablony je už
	 * hlídají přes `model.online &&`.
	 */
	previewVideo?: string | null;
	followers: number | null;
	isHd: boolean;
	isNew: boolean;
	onlineSeconds?: number | null;
	toy: boolean;
	status?: string | null;
	goalText?: string | null;
	turnOns: string | null;
	photos: number | null;
	videos: number | null;

	// ── doplňuje sync z registry ──────────────────────────────────────────────
	/** URL slug. Přidělený jednou provždy, `slug` samotný může kolidovat mezi sítěmi. */
	page: string;
	first: string;
	last: string;
	/** V kolika různých dnech jsme ji viděli. Rozhoduje o indexaci. */
	seen: number;
	/**
	 * Skóre poptávky: imprese v GSC a objem hledání na nick (KV klíč `demand`,
	 * plní `~/ai/scripts/ecamx/demand.py`). 0 = nikdo o stránku neprojevil
	 * zájem. Řídí retenci v syncu, řazení vnitřních odkazů a to, které stránce
	 * se vyplatí delší text. Viz D35.
	 */
	demand?: number;
	streak: number;
	/** Nejvyšší zaznamenaný počet diváků. */
	peak: number;
	/**
	 * Kdy vysílá: 12 dvouhodinových přihrádek UTC v base36 (`0`–`z`). Vzniká
	 * měřením napříč běhy syncu, ne z feedu — proto se s ním musí zacházet
	 * opatrně: dokud není dost vzorků, nesmí se z něj tvrdit rozvrh.
	 * Čte to `usualHours()` níž.
	 */
	hours?: string;
	online: boolean;
	indexable: boolean;
	/**
	 * Bude tahle stránka existovat i příští build? Rozhoduje o SITEMAPĚ, ne
	 * o indexovatelnosti — viz `seenCut` v `scripts/sync-cams.ts`. Kolotoč
	 * stránek je strukturální (17 000 slotů na ~183 000 modelek), takže
	 * sitemapa smí slibovat jen to, co eviction přežije.
	 */
	stable: boolean;
	/**
	 * Stránka postavená jen z nicku a sítě, protože katalog o modelce nic
	 * nemá — viz `legacy-pages.ts`. Šablona podle toho vynechá všechno, co by
	 * si musela vymyslet (věk, země, štítky, „naposledy vysílala", text).
	 */
	archived?: boolean;
}

export type NetworkId =
	| 'chaturbate' | 'camsoda' | 'cam4' | 'amateur'
	| 'bongacams' | 'xlovecam' | 'livejasmin'
	// Přes CrakRevenue (jedno API, čtyři sítě, D54). Seznam je tu ZÁMĚRNĚ
	// zdvojený s `scripts/cam-networks.ts` — sync nesmí importovat `data.ts`,
	// ten tahá 13 MB katalogu. Kdo přidá síť, přidá ji na obou místech; hlídá
	// to tsc, protože `deepLink()` bere tenhle typ.
	| 'stripchat' | 'streamate' | 'imlive';

export interface Facet { slug: string; label: string; count: number }

/** Modelky, které vysílají právě teď. Tohle plní všechny mřížky. */
export const MODELS = models as unknown as Model[];

/**
 * Modelky, které do 45 dnů vysílaly, ale teď ne. Stránku mají dál — právě na ni
 * dopadá longtail dotaz na nick a je to jediná stránka, kterou Google stihne
 * pořádně proindexovat (živé modelky se mění rychleji, než chodí crawler).
 */
export const ARCHIVE = archive as unknown as Model[];

/**
 * Stránky pro nicky, na které Google pořád posílá lidi, ale katalog je nezná.
 * Bez nich končilo 64 % měřených impresí na obecném přesměrování (soft 404) —
 * viz `legacy-pages.ts`.
 */
export const LEGACY_PAGES: Model[] = legacyPages(
	new Set([...MODELS, ...ARCHIVE].map((m) => m.page)),
	(meta as { generatedAt: string }).generatedAt.slice(0, 10),
);

/** Všechno, co má stránku pod /live/. */
export const MODEL_PAGES: Model[] = [...MODELS, ...ARCHIVE, ...LEGACY_PAGES];

export const META = meta as {
	generatedAt: string; modelCount: number; archiveCount: number;
	indexableCount: number; goneCount: number;
	/** Kolik stránek modelek jde do sitemapy (stabilních). Viz D75. */
	sitemapCount?: number;
	/** Práh `seen`, od kterého je stránka považovaná za stabilní. Viz D75. */
	seenCut?: number;
	networks: { id: string; count: number }[]; degraded: string[];
};
export const FACETS = facets as unknown as {
	categories: Facet[]; countries: Facet[]; genders: Facet[]; networks: Facet[];
	ethnicities: Facet[]; hairColors: Facet[]; bodyTypes: Facet[];
	languages: Facet[]; ageGroups: Facet[];
	/** Kurátorské „money" kategorie — viz src/lib/money-categories.ts. */
	curated?: CuratedFacet[];
};

/**
 * Kurátorská kategorie. `girls` spočítal sync z podílu žen; jen když je true,
 * smí titulek použít frázi „cam girls" — jinak by to byla nepravda.
 * `fresh` = slug, který v automatické taxonomii neexistuje (nová URL).
 */
export interface CuratedFacet extends Facet { girls: boolean; fresh: boolean }

/**
 * URL slug → modelka. Slug přiděluje sync a je trvalý: nick je unikátní jen
 * v rámci sítě, takže druhá modelka se stejným nickem dostane `nick-network`.
 * Kdyby se holý slug přeprodával podle aktuální popularity, měl by Google na
 * jedné adrese pokaždé jiného člověka.
 */
export const PAGE_BY_SLUG: Map<string, Model> = new Map(
	MODEL_PAGES.map((m) => [m.page, m])
);

export const CURATED: CuratedFacet[] = FACETS.curated ?? [];
export const CURATED_BY_SLUG = new Map(CURATED.map((c) => [c.slug, c]));

const CATEGORY_SLUGS = new Set(FACETS.categories.map((c) => c.slug));

/**
 * Země, které mají vlastní stránku (prošly `THRESHOLDS.country`). Odkazovat se
 * musí JEN na tyhle — modelka může mít zemi, pro kterou stránka neexistuje,
 * a odkaz na ni je 404. Přesně na tom spadl `check-links.ts`.
 */
export const COUNTRY_SLUGS = new Set(FACETS.countries.map((c) => c.slug));

/**
 * Sítě, které mají vlastní stránku. Staví se z `FACETS.networks`, tedy z toho,
 * co sync opravdu viděl — takže **při výpadku feedu jedna síť zmizí**, ačkoli
 * její modelky v katalogu zůstanou ze snapshotů a z legacy stránek.
 *
 * Přesně na tom spadl build 20. 8. 2026: BongaCams vypadl, 6 501 stránek dál
 * odkazovalo na `/site/bongacams/` a `check-links` to (správně) zastavil.
 * Odkazovat se tedy smí JEN přes `linkableNetwork()` — stejné pravidlo jako
 * u zemí (`linkableCountry`, AGENTS 24).
 */
export const NETWORK_SLUGS = new Set(FACETS.networks.map((n) => n.slug));

/** Síť, ale jen když na ni vede existující stránka. Jinak null → odkaz vynechat. */
export function linkableNetwork(id: string | null | undefined): string | null {
	return id && NETWORK_SLUGS.has(id) ? id : null;
}

/** Země modelky, ale jen když na ni vede existující stránka. */
export function linkableCountry(raw: string | null | undefined): string | null {
	const code = canonicalCountry(raw);
	return code && COUNTRY_SLUGS.has(code) ? code : null;
}

/**
 * Kind určuje, podle čeho se filtruje. Etnicita, vlasy a postava sdílejí
 * jmenný prostor `/cams/` s kategoriemi — jsou to pro uživatele i pro Google
 * tytéž „cam kategorie", jen data k nim chodí v jiném poli.
 */
export type FacetKind = 'tag' | 'ethnicity' | 'hairColor' | 'bodyType' | 'money';

/**
 * Proloží sítě, aby mřížku neovládla jedna jediná — ale VÁŽENĚ.
 *
 * Bez prokládání byla celá homepage Chaturbate: hlásí řádově vyšší počty diváků
 * než ostatní, takže při řazení podle diváků obsadil všech 30 karet.
 * A hlavně — XLoveCam ani LiveJasmin počty diváků NEPOSÍLAJÍ (viewers = null),
 * takže končily úplně poslední a na žádnou mřížku se nedostaly.
 *
 * Rovnoměrné prokládání ale mělo druhou vadu: dávalo všem deseti sítím stejně
 * místa bez ohledu na to, co vydělávají. Změřeno 28. 8. 2026 — Chaturbate nese
 * **polovinu všech prokliků** a dostával 10 % karet. Proto váhy
 * (`NETWORK_WEIGHT`): síť s vahou 4 dostane v každém kole čtyři sloty místo
 * jednoho a kolo jí začíná. Zbytek pořadí se nemění.
 *
 * Uvnitř jedné sítě rozhoduje `payingScore()` a pak diváci: napřed pokoje, kde
 * se právě platí (tip goal, hračka) a kde je jednotlivý dárce vidět.
 *
 * Vstup musí být seřazený podle diváků; pro sítě bez vlastní váhy se pořadí
 * uvnitř sítě zachovává tak, jak přišlo.
 */
export function diversify(list: Model[], limit: number): Model[] {
	const byNetwork = new Map<string, Model[]>();
	for (const m of list) {
		const arr = byNetwork.get(m.network);
		if (arr) arr.push(m); else byNetwork.set(m.network, [m]);
	}
	// Fronty s vahou > 1 se uvnitř přeskládají podle „kde se právě platí".
	// U ostatních by to byl jen výpočet navíc: jednu kartu za kolo dostane
	// stejně ta s nejvíc diváky.
	for (const [net, q] of byNetwork) {
		if (weightOf(net) <= DEFAULT_WEIGHT) continue;
		q.sort((a, b) => (payingScore(b) - payingScore(a)) || ((b.viewers ?? 0) - (a.viewers ?? 0)));
	}
	// Těžší sítě jdou v kole první, ať mají i nejlepší POZICE, nejen počet.
	const queues = [...byNetwork.entries()]
		.sort((a, b) => weightOf(b[0]) - weightOf(a[0]));
	const out: Model[] = [];
	const cursor = new Array(queues.length).fill(0);
	let progress = true;
	while (out.length < limit && progress) {
		progress = false;
		for (let i = 0; i < queues.length && out.length < limit; i++) {
			const [net, q] = queues[i];
			// Kolik karet si tahle síť vezme v jednom kole.
			for (let n = weightOf(net); n > 0 && out.length < limit; n--) {
				const m = q[cursor[i]];
				if (!m) break;
				cursor[i]++;
				out.push(m);
				progress = true;
			}
		}
	}
	return out;
}

/** Modelky v dané kategorii, seřazené podle diváků (nejživější nahoře). */
/**
 * Filtr členství v kategorii. Vytažené ven ze `modelsInCategory()`, protože
 * totéž potřebuje i archiv (`recentlyLiveInCategory`) — a dvě kopie téhle
 * logiky by se rozešly stejně, jako se rozešel `canonicalTerm` mezi syncem
 * a stránkami (viz komentář u importu).
 */
function categoryMatcher(slug: string, kind: FacetKind): (m: Model) => boolean {
	switch (kind) {
		case 'tag': return (m) => m.tags.some((t) => canonicalTerm(t) === slug);
		case 'ethnicity': return (m) => !!m.ethnicity && canonicalTerm(m.ethnicity) === slug;
		case 'hairColor': return (m) => !!m.hairColor && canonicalTerm(m.hairColor) === slug;
		case 'bodyType': return (m) => !!m.bodyType && canonicalTerm(m.bodyType) === slug;
		// Kurátorská kategorie je unie signálů (tagy + strukturovaná pole +
		// věk), protože etnicitu/postavu hlásí jen 2 ze 7 sítí.
		case 'money': {
			const c = MONEY_BY_SLUG.get(slug);
			return (m) => !!c && matchesMoney(m, c.rule);
		}
	}
}

/**
 * Cache plných seznamů. Běží JEN při buildu, kde se `allIn*()` volá dvakrát na
 * každý rozcestník (getStaticPaths pro stránkování + samotná šablona) — bez ní
 * to je 362 rozcestníků × 8 000 modelek × 2 průchody navíc.
 */
const listCache = new Map<string, Model[]>();
function memo(key: string, build: () => Model[]): Model[] {
	const hit = listCache.get(key);
	if (hit) return hit;
	const out = build();
	listCache.set(key, out);
	return out;
}

const byViewers = (a: Model, b: Model) => (b.viewers ?? 0) - (a.viewers ?? 0);

/**
 * CELÝ seznam modelek rozcestníku, ne jen prvních N. Stránkování z něj krájí
 * okna přes `pageWindow()`.
 *
 * Počet stránek se MUSÍ brát z délky tohohle výsledku, nikdy z `facet.count`.
 * Přesně na tom rozdílu stála chyba z 18. 8., kdy `/cams/big-tits/` tvrdilo
 * 1 103 modelek a našlo 244 — tady by z toho byly prázdné stránky 5–19.
 */
export function allInCategory(slug: string, kind: FacetKind = 'tag'): Model[] {
	return memo(`c:${kind}:${slug}`, () => {
		const hits = MODELS.filter(categoryMatcher(slug, kind)).sort(byViewers);
		return diversify(hits, hits.length);
	});
}

export function allInCountry(code: string): Model[] {
	return memo(`n:${code}`, () => {
		const hits = MODELS.filter((m) => canonicalCountry(m.country) === code).sort(byViewers);
		return diversify(hits, hits.length);
	});
}

/** Bez `diversify()` — jedna síť je celá stránka, tady není co prokládat. */
export function allOnNetwork(id: string): Model[] {
	return memo(`s:${id}`, () => MODELS.filter((m) => m.network === id).sort(byViewers));
}

export function allByGender(gender: string): Model[] {
	return memo(`g:${gender}`, () => {
		const hits = MODELS.filter((m) => m.gender === gender).sort(byViewers);
		return diversify(hits, hits.length);
	});
}

/** Homepage: všechno, co vysílá. */
export function allLive(): Model[] {
	return memo('all', () => {
		const hits = [...MODELS].sort(byViewers);
		return diversify(hits, hits.length);
	});
}

/**
 * Modelky, které v kategorii vysílaly, ale teď ne. Dva důvody:
 *  – 4 849 archivních stránek nemělo do 18. 8. NIKDE odkaz, přitom je posíláme
 *    do sitemapy jako indexovatelné (mřížky ukazují jen živé),
 *  – úzká kategorie s třemi živými modelkami vypadala jako mrtvý web.
 * Archiv drží tagy u 5 272 z 5 832 záznamů, takže filtr dosáhne skoro všude.
 */
export function recentlyLiveInCategory(
	slug: string, kind: FacetKind = 'tag', limit = 24,
): Model[] {
	return memo(`r:${kind}:${slug}`, () =>
		ARCHIVE.filter(categoryMatcher(slug, kind))
			// `last` je ISO datum, takže stačí porovnání řetězců. Při stejném dni
			// rozhoduje peak — ať jsou nahoře jména, která někdo vážně hledá.
			.sort((a, b) => (a.last === b.last ? b.peak - a.peak : a.last < b.last ? 1 : -1))
	).slice(0, limit);
}

/**
 * Abecední adresář stránek modelek (`/models/a/`).
 *
 * Vznikl z měření 18. 8.: **6 102 ze 14 000 stránek modelek nemělo nikde na webu
 * odkaz** — 4 849 z nich archivních, tedy přesně těch, které posíláme do
 * sitemapy jako indexovatelné. Mřížky je odkázat nemohou, protože ukazují jen
 * živé modelky. Stránkování mřížek to taky neřeší.
 *
 * Řadí se podle slugu `page`, takže obsah stránky je stabilní a přesuny
 * zůstávají uvnitř písmene — na rozdíl od řazení podle diváků, kde by se každé
 * 2 h přeskládalo všechno.
 */

export const MODELS_BY_LETTER: Map<string, Model[]> = (() => {
	const out = new Map<string, Model[]>();
	for (const m of MODEL_PAGES) {
		const k = modelLetter(m.page);
		const arr = out.get(k);
		if (arr) arr.push(m); else out.set(k, [m]);
	}
	for (const arr of out.values()) arr.sort((a, b) => a.page.localeCompare(b.page));
	return out;
})();

/** Písmena, která mají stránku. `0-9` se řadí první. */
export const MODEL_LETTERS: string[] = [...MODELS_BY_LETTER.keys()].sort();

/**
 * Okno stránkování. `page` je 1-based, jako v URL.
 *
 * Generické v položce, protože kromě modelek stránkuje i adresář nicků
 * na víc sítích (`/models/same-nickname/`). Výchozí `Model` drží zpětnou
 * kompatibilitu s `GridPage.astro`.
 */
export interface PageWindow<T = Model> {
	items: T[];
	page: number;
	/** Kolik stránek se opravdu generuje (u mřížek zastropováno, viz paging.ts). */
	pages: number;
	/** 1-based rozsah pro text „Showing 61–120 of 1 240". */
	from: number;
	to: number;
	total: number;
}

export function pageWindow<T>(all: T[], page: number, size: number, maxPages = Infinity): PageWindow<T> {
	// `maxPages` musí ovlivnit i tohle číslo, ne jen `getStaticPaths()`:
	// stránkovací lišta se kreslí právě z něj, takže bez toho by odkazovala
	// na stránky, které se negenerují — tedy 404 na vlastním webu.
	const pages = Math.min(Math.max(1, Math.ceil(all.length / size)), maxPages);
	const current = Math.min(Math.max(1, page), pages);
	const start = (current - 1) * size;
	const items = all.slice(start, start + size);
	return {
		items, page: current, pages, total: all.length,
		from: all.length ? start + 1 : 0,
		to: start + items.length,
	};
}

/**
 * Okno pro MŘÍŽKU — respektuje strop `GridSize.maxPages`. Adresáře používají
 * `pageWindow()` přímo, ty strop nemají (D33/D64).
 */
export function gridWindow<T>(all: T[], page: number, grid: { size: number; maxPages: number }): PageWindow<T> {
	return pageWindow(all, page, grid.size, grid.maxPages);
}

export function modelsInCategory(slug: string, limit = 60, kind: FacetKind = 'tag'): Model[] {
	return allInCategory(slug, kind).slice(0, limit);
}

/**
 * Všechno, co dostane stránku pod /cams/. Kategorie z tagů + atributy.
 * Kdyby tu atributy nebyly, `latina` (mapuje se na etnicitu `latin`) by
 * neměla stránku vůbec — a to je jeden z nejsilnějších dotazů v segmentu.
 */
export function allCategoryFacets(): Array<Facet & { kind: FacetKind }> {
	const seen = new Set<string>();
	const out: Array<Facet & { kind: FacetKind }> = [];
	const push = (list: Facet[], kind: FacetKind) => {
		for (const f of list) {
			if (seen.has(f.slug)) continue;
			seen.add(f.slug);
			out.push({ ...f, kind });
		}
	};
	// Kurátorské jdou PRVNÍ: u sdíleného slugu má vyhrát jejich širší členství
	// a popisek ve slovníku hledajících (`latin` → „Latina").
	push(CURATED, 'money');
	push(FACETS.categories, 'tag');
	push(FACETS.ethnicities, 'ethnicity');
	push(FACETS.hairColors, 'hairColor');
	push(FACETS.bodyTypes, 'bodyType');
	return out;
}

export function modelsInCountry(code: string, limit = 60): Model[] {
	return allInCountry(code).slice(0, limit);
}

export function modelsOnNetwork(id: string, limit = 60): Model[] {
	return allOnNetwork(id).slice(0, limit);
}

/**
 * Kategorie, které se u modelky vyplatí odkázat — jen ty, co mají vlastní
 * stránku. Odkaz na neexistující kategorii je 404 a rozbité prolinkování.
 */
export function linkableCategories(m: Model, limit = 10): Facet[] {
	const own = new Set(m.tags.map(canonicalTerm).filter(Boolean) as string[]);
	const out: Facet[] = [];
	const seen = new Set<string>();
	// Kurátorské první: jsou to stránky, na kterých nám jde o pozice, a do téhle
	// funkce se dřív nedostaly vůbec (filtrovala jen `FACETS.categories`, takže
	// bbw/granny/pregnant ani etnicity neměly z profilů jediný vnitřní odkaz).
	for (const c of CURATED) {
		const def = MONEY_BY_SLUG.get(c.slug);
		if (def && matchesMoney(m, def.rule)) { seen.add(c.slug); out.push(c); }
	}
	for (const c of FACETS.categories) {
		if (own.has(c.slug) && !seen.has(c.slug)) { seen.add(c.slug); out.push(c); }
	}
	return out.slice(0, limit);
}

/**
 * Živé modelky seřazené podle diváků. Základ pro všechny „podobné" bloky —
 * spočítá se jednou, ne na každé z 15 000 stránek.
 */
const LIVE_BY_VIEWERS: Model[] = [...MODELS].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));

/**
 * Modelky s MĚŘENOU poptávkou, sestupně. Předpočítané ze stejného důvodu jako
 * `LIVE_BY_VIEWERS` — `topDemand()` se volá na každé z 22 000 stránek.
 *
 * Naměřeno 23. 9. 2026: `demand > 0` má jen **238 z 13 846** modelek, ale
 * `topDemand()` dělal `MODELS.filter(...).sort(...)` při každém volání, tedy
 * 22 000× filtr a řazení celého katalogu. Seznam je po předpočítání malý
 * (stovky položek), takže volání je jen `slice`.
 */
const DEMAND_RANKED: Model[] = MODELS
	.filter((m) => (m.demand ?? 0) > 0)
	.sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0));

/**
 * Předpočítané koše. Naivní skórování „podobnosti" by na 15 000 stránkách
 * znamenalo přes sto milionů porovnání a build by se protáhl o desítky minut.
 * Koše dědí pořadí z LIVE_BY_VIEWERS, takže výběr je O(1).
 */
const bucket = (key: string, list: Map<string, Model[]>, m: Model) => {
	const arr = list.get(key);
	if (arr) arr.push(m); else list.set(key, [m]);
};
const BY_GENDER_COUNTRY = new Map<string, Model[]>();
const BY_GENDER = new Map<string, Model[]>();
const BY_NETWORK = new Map<string, Model[]>();
for (const m of LIVE_BY_VIEWERS) {
	if (m.gender && m.country) bucket(`${m.gender}|${m.country}`, BY_GENDER_COUNTRY, m);
	if (m.gender) bucket(m.gender, BY_GENDER, m);
	bucket(m.network, BY_NETWORK, m);
}

/**
 * Živé modelky, které nabídnout místo téhle. Používá se pod přehrávačem a hlavně
 * na offline stránce, kde je to jediný důvod, proč tam návštěvník zůstane.
 * Postupuje od nejužšího koše k nejširšímu, ať to nikdy nevrátí prázdno.
 */
/**
 * Nejhledanější modelky, které právě vysílají — podle skóre poptávky (`demand`,
 * viz D35), ne podle diváků. Slouží k prolinkování: vnitřní odkazy mají mířit
 * tam, kde je měřená poptávka, protože právě ty stránky mají šanci na TOP 3
 * (Ahrefs: 201 220 hledání/měs na nicky v katalogu, KD 0–24).
 */
export function topDemand(limit = 24, excludePage?: string): Model[] {
	// Vylučuje se jen málokdy (jen když má stránka sama měřenou poptávku),
	// takže se seznam obvykle neprochází — a `slice` stejně vrací kopii.
	const ranked = excludePage
		? DEMAND_RANKED.filter((m) => m.page !== excludePage)
		: DEMAND_RANKED;
	return ranked.slice(0, limit);
}

/**
 * Všechny indexovatelné stránky s měřenou poptávkou — živé i offline.
 *
 * `topDemand()` bere jen živé, a protože je to TÝCHŽ 24 odkazů na všech
 * stránkách, dostane interní odkazy pár desítek modelek a zbylé ~2 700
 * vydělávajících stránek (archiv, D53) nic. Změřeno 28. 9. 2026 (D79): 73 %
 * impresí z Bingu je na pozici 4–10 a návštěvnost je šíře nick stránek, takže
 * odkazy mají jít rovnoměrně na celou množinu, ne jen na špičku.
 */
const DEMAND_PAGES: Model[] = MODEL_PAGES
	.filter((m) => (m.demand ?? 0) > 0 && m.indexable)
	.sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0) || (a.page < b.page ? -1 : 1));

/**
 * Stabilní hash slugu (FNV-1a, 32 bit) — výběr se nesmí měnit mezi buildy.
 * **Stejný algoritmus je v `~/ai/scripts/ecamx/title-test.py`**: podle něj se
 * měří skupiny A/B testu titulků, takže se tu nesmí změnit ani o bit.
 */
export function hashSlug(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/**
 * Okno `limit` stránek s poptávkou, jiné pro každou stránku. Posun se odvozuje
 * z hashe slugu, takže je deterministický (stejná stránka → stejné odkazy,
 * dokud se množina nezmění) a přes celý web pokryje každou cílovou stránku
 * zhruba stejně často: 25 000 stránek × 16 odkazů ≈ 140 odkazů na každou
 * z ~2 900 cílů.
 */
/**
 * Skupina A/B testu titulků offline stránek (D80). Polovina stránek podle
 * hashe slugu, takže skupiny jsou náhodné vůči nicku i síti a stabilní.
 */
export const titleVariant = (page: string): 'a' | 'b' => (hashSlug(page) % 2 ? 'b' : 'a');

export function demandRotation(page: string, limit = 16, skip: Set<string> = new Set()): Model[] {
	const n = DEMAND_PAGES.length;
	if (!n) return [];
	const start = hashSlug(page) % n;
	const out: Model[] = [];
	for (let i = 0; i < n && out.length < limit; i++) {
		const m = DEMAND_PAGES[(start + i) % n]!;
		if (m.page !== page && !skip.has(m.page)) out.push(m);
	}
	return out;
}

export function similarLive(m: Model, limit = 12): Model[] {
	const out: Model[] = [];
	const taken = new Set<string>([m.page]);
	const pools: (Model[] | undefined)[] = [
		m.gender && m.country ? BY_GENDER_COUNTRY.get(`${m.gender}|${m.country}`) : undefined,
		m.gender ? BY_GENDER.get(m.gender) : undefined,
		BY_NETWORK.get(m.network),
		LIVE_BY_VIEWERS,
	];
	for (const pool of pools) {
		if (!pool) continue;
		// Koš se prokládá stejnými vahami jako mřížky. Bez toho tenhle blok
		// vracel pořadí z předpočítaných košů, tedy jednu síť za druhou — a je
		// to nejsilnější interní prolinkování na webu (61 % zobrazení jsou
		// stránky modelek), takže právě tady se rozhoduje, kam lidi půjdou dál.
		//
		// **Bere se jen začátek koše, ne celý.** Poslední koš je celý živý
		// katalog (15 500 modelek) a tahle funkce běží pro každou ze 14 tisíc
		// stránek — filtrovat pokaždé všechno by z buildu udělalo hodiny.
		// Koše jsou seřazené podle diváků, takže prefix stačí: `limit * 12` je
		// dost na to, aby v něm bylo víc sítí i po odečtení už použitých.
		const fresh: Model[] = [];
		const want = (limit - out.length) * 12;
		for (const c of pool) {
			if (fresh.length >= want) break;
			if (!taken.has(c.page)) fresh.push(c);
		}
		for (const c of diversify(fresh, limit - out.length)) {
			if (out.length >= limit) return out;
			taken.add(c.page);
			out.push(c);
		}
		if (out.length >= limit) return out;
	}
	return out;
}

/**
 * Související kategorie — nejčastější tagy modelek, které jsou i v této kategorii.
 *
 * Dvě věci, na kterých to dřív ztrácelo:
 * 1. `modelsInCategory` se volalo bez `kind`, takže na stránce etnicity nebo
 *    kurátorské kategorie se vzorek počítal z úplně jiných modelek (default `tag`).
 * 2. Kandidáti se brali jen z `FACETS.categories`, takže kurátorské kategorie
 *    (bbw, granny, pregnant, …) nedostaly z mřížek ani jeden vnitřní odkaz.
 *
 * Mesh je tu nejlevnější dostupná páka: konkurent, který na svůj termín stojí
 * #2, má na stránce 36 odkazů na jiné kategorie, my jsme měli 10 (měřeno 17. 8.).
 */
export function relatedCategories(slug: string, limit = 8, kind: FacetKind = 'tag'): Facet[] {
	const peers = modelsInCategory(slug, 200, kind);
	const tally = new Map<string, number>();
	const bump = (t: string) => {
		if (t !== slug) tally.set(t, (tally.get(t) ?? 0) + 1);
	};
	for (const m of peers) {
		for (const t of new Set(m.tags.map(canonicalTerm).filter(Boolean) as string[])) {
			if (CATEGORY_SLUGS.has(t)) bump(t);
		}
		// Kurátorské kategorie se nepoznají z tagu — modelka do nich patří přes
		// unii signálů, takže se musí testovat pravidlem.
		for (const c of CURATED) {
			const def = MONEY_BY_SLUG.get(c.slug);
			if (def && matchesMoney(m, def.rule)) bump(c.slug);
		}
	}
	const byslug = new Map<string, Facet>([
		...FACETS.categories.map((c) => [c.slug, c] as [string, Facet]),
		// Kurátorské přepisují stejný slug: mají širší count i lepší popisek.
		...CURATED.map((c) => [c.slug, { slug: c.slug, label: c.label, count: c.count }] as [string, Facet]),
	]);
	return [...tally.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([s]) => byslug.get(s)!)
		.filter(Boolean)
		.slice(0, limit);
}

/**
 * Kategorie pro prolinkování z nejsilnějších stránek (homepage, gender, 404).
 * Kurátorské jdou první — to jsou stránky, na kterých nám jde o pozice, a dřív
 * z homepage nedostaly ani jeden odkaz, protože se bralo `FACETS.categories`.
 */
export function topCategories(limit = 24): Facet[] {
	const out: Facet[] = [];
	const seen = new Set<string>();
	for (const c of [...CURATED, ...FACETS.categories]) {
		if (seen.has(c.slug)) continue;
		seen.add(c.slug);
		out.push({ slug: c.slug, label: c.label, count: c.count });
		if (out.length >= limit) break;
	}
	return out;
}

/** Země s nejvíc modelkami — pro prolinkování z kategorií a profilů. */
export function topCountries(limit = 12): Facet[] {
	return FACETS.countries.slice(0, limit);
}

/**
 * Sítě, kde se show platí PO MINUTĚ a zdarma je jen náhled.
 *
 * Jeden zdroj pravdy pro celý web: rozhoduje o slově „Free" v titulku
 * (`seo.ts`), o větě „co to stojí" v textu stránky (`model-copy.ts`) a musí
 * souhlasit s recenzemi v `src/content/networks.ts`. Slíbit u nich „free
 * webcam show, no signup" je lež, kterou návštěvník odhalí prvním kliknutím.
 */
/**
 * Sítě, pro které existuje `/api/online/{síť}` — tedy u kterých má smysl se za
 * běhu ptát na živý stav. Ostatní (cam4 a čtyři sítě z CrakRevenue) jedou ze
 * stavu z buildu.
 *
 * Klient si podle tohohle seznamu filtruje dotazy: bez něj se na každé stránce
 * s jejich kartami střílely **čtyři 404** (změřeno na produkci 26. 8.), a to
 * není zdarma — `/api/` sdílí okno rate limitu 40 req/10 s s vydělávajícím
 * `/go/` (D49). Zdroj pravdy je `FEEDS` v `src/pages/api/online/[network].ts`;
 * kdo tam síť přidá, přidá ji i sem.
 */
export const LIVE_FEED_NETWORKS = new Set<string>([
	'chaturbate', 'camsoda', 'bongacams', 'amateur', 'xlovecam', 'livejasmin', 'cam4',
	// Přibyly 28. 8. 2026: do té doby neměly tyhle tři jak zhasnout, takže
	// 18 z 60 karet na homepage tvrdilo „Live" bez ohledu na skutečnost.
	// Odpověď je useknutá na 100 pokojů, takže potvrzují jen to, KDO vysílá.
	'stripchat', 'streamate', 'imlive',
]);

export const PER_MINUTE_NETWORKS = new Set<string>([
	'livejasmin', 'xlovecam', 'streamate', 'imlive',
]);

/**
 * Odchozí odkaz do stejného tabu u sítí, kterým blokovač nový tab zabije.
 * Bydlí ve vlastním modulu, protože to potřebuje i guard, který si `data.ts`
 * (a s ním celý katalog) dovolit nemůže. Viz D62.
 */
export { POPUP_BLOCKED_NETWORKS, outTargetFor } from './popup-blocked.ts';
export { THUMBNAIL_HOSTS } from './thumbnail-hosts.ts';

/**
 * Váhy sítí v mřížce. Bydlí ve vlastním modulu ze stejného důvodu jako
 * `popup-blocked.ts` — potřebuje je i kód, který si katalog dovolit nemůže.
 */
export { NETWORK_WEIGHT, weightOf, payingScore } from './network-weight.ts';


export const NETWORK_LABELS: Record<string, string> = {
	chaturbate: 'Chaturbate', camsoda: 'CamSoda', cam4: 'Cam4',
	amateur: 'Amateur.tv', bongacams: 'BongaCams',
	xlovecam: 'XLoveCam', livejasmin: 'LiveJasmin',
	stripchat: 'Stripchat', streamate: 'Streamate', imlive: 'ImLive',
};

/**
 * ISO kód → název země.
 *
 * **Musí pokrývat všechno, co umí vrátit `canonicalCountry()`, ne jen dnešní
 * stránky.** Do 19. 8. tu bylo 28 zemí „těch, které reálně máme" — a jakmile
 * pokrytí Chaturbate vyskočilo a zemí bylo 29, dostaly nové stránky do H1
 * „Live Cams from EE" (`countryName` padá na velký kód). Práh 20 modelek se
 * hýbe každé 2 hodiny; seznam názvů se hýbat nesmí.
 */
export const COUNTRY_NAMES: Record<string, string> = {
	co: 'Colombia', us: 'United States', ph: 'Philippines', fr: 'France',
	ua: 'Ukraine', de: 'Germany', ke: 'Kenya', ro: 'Romania', es: 'Spain',
	mg: 'Madagascar', gb: 'United Kingdom', it: 'Italy', ar: 'Argentina',
	br: 'Brazil', ru: 'Russia', ca: 'Canada', pl: 'Poland', ve: 'Venezuela',
	cl: 'Chile', mx: 'Mexico', nl: 'Netherlands', in: 'India', za: 'South Africa',
	au: 'Australia', tw: 'Taiwan', cz: 'Czechia', hu: 'Hungary', pt: 'Portugal',
	lv: 'Latvia', ee: 'Estonia', lt: 'Lithuania', rs: 'Serbia', be: 'Belgium',
	fi: 'Finland', se: 'Sweden', no: 'Norway', dk: 'Denmark', ie: 'Ireland',
	ch: 'Switzerland', at: 'Austria', gr: 'Greece', bg: 'Bulgaria', hr: 'Croatia',
	si: 'Slovenia', sk: 'Slovakia', by: 'Belarus', md: 'Moldova', ge: 'Georgia',
	am: 'Armenia', az: 'Azerbaijan', kz: 'Kazakhstan', kg: 'Kyrgyzstan',
	uz: 'Uzbekistan', mn: 'Mongolia', tr: 'Turkey', il: 'Israel', cy: 'Cyprus',
	mt: 'Malta', is: 'Iceland', lu: 'Luxembourg', mc: 'Monaco', me: 'Montenegro',
	al: 'Albania', mk: 'North Macedonia', ba: 'Bosnia and Herzegovina',
	pe: 'Peru', ec: 'Ecuador', bo: 'Bolivia', py: 'Paraguay', uy: 'Uruguay',
	cr: 'Costa Rica', pa: 'Panama', do: 'Dominican Republic', pr: 'Puerto Rico',
	cu: 'Cuba', jm: 'Jamaica', ht: 'Haiti', hn: 'Honduras', gt: 'Guatemala',
	ni: 'Nicaragua', sv: 'El Salvador', tt: 'Trinidad and Tobago',
	ng: 'Nigeria', gh: 'Ghana', ug: 'Uganda', tz: 'Tanzania', zm: 'Zambia',
	zw: 'Zimbabwe', cm: 'Cameroon', ci: 'Ivory Coast', sn: 'Senegal',
	et: 'Ethiopia', eg: 'Egypt', ma: 'Morocco', tn: 'Tunisia', dz: 'Algeria',
	jp: 'Japan', cn: 'China', kr: 'South Korea', hk: 'Hong Kong', sg: 'Singapore',
	th: 'Thailand', vn: 'Vietnam', id: 'Indonesia', my: 'Malaysia',
	nz: 'New Zealand', pk: 'Pakistan', bd: 'Bangladesh', lk: 'Sri Lanka',
	np: 'Nepal', ir: 'Iran', iq: 'Iraq', lb: 'Lebanon', jo: 'Jordan',
	sa: 'Saudi Arabia', ae: 'United Arab Emirates',
};

/**
 * Hezčí názvy tam, kde kanonický slug není to, co lidé hledají.
 * `latin` je kanonická etnicita, ale dotaz zní „latina cams".
 */
export const FACET_LABEL_OVERRIDES: Record<string, string> = {
	latin: 'Latina',
	// `black` a `brown` jsou BARVY VLASŮ, ne etnicita ani nic jiného. Bez tohohle
	// si „Black" kanibalizovalo `/cams/ebony/` (dotaz „black cam girls" je etnický,
	// 400/měs) a „Brown" nedávalo smysl vůbec.
	black: 'Black Hair',
	brown: 'Brown Hair',
	// „nude cams" má 5 100 hledání/měs při **KD 0**, „naked cams" 1 100 při
	// **KD 81** (Ahrefs, US, 19. 8.) — stejná kategorie, desetkrát jiná šance.
	// Slug `/cams/naked/` zůstává (URL nemá cenu měnit kvůli slovu), titulek
	// a H1 ale musí říkat to, co lidi opravdu hledají.
	naked: 'Nude',
	'white-caucasian': 'White',
	'middle-eastern': 'Middle Eastern',
	hd: 'HD',
	bbw: 'BBW',
	bigass: 'Big Ass',
	'big-tits': 'Big Tits',
};

export function facetLabel(slug: string, fallback: string): string {
	return FACET_LABEL_OVERRIDES[slug] ?? fallback;
}

export function countryName(code: string): string {
	return COUNTRY_NAMES[code] ?? code.toUpperCase();
}


/**
 * „Kdy ji tu vídáme" z přihrádek `hours`.
 *
 * Vrací souvislé okno v UTC, ve kterém padne aspoň 60 % všech vzorků, nebo
 * `null`, když dat není dost. **Prahy jsou schválně vysoké** (7 různých dnů
 * a 12 vzorků): rozvrh postavený na dvou dnech by byl výmysl s číslem, a to je
 * horší než nic. Data se sbírají od 19. 8. 2026, takže na většině stránek
 * začne blok svítit až po pár týdnech.
 */
export function usualHours(m: Model): { from: number; to: number; share: number } | null {
	if (!m.hours || m.hours.length !== 12 || m.seen < 7) return null;
	const b = [...m.hours].map((c) => parseInt(c, 36) || 0);
	const total = b.reduce((a, x) => a + x, 0);
	if (total < 12) return null;
	// Nejlepší souvislé okno (kruhově) — od nejkratšího, které pokryje 60 %.
	for (let len = 1; len <= 8; len++) {
		let best = -1, bestSum = -1;
		for (let start = 0; start < 12; start++) {
			let sum = 0;
			for (let i = 0; i < len; i++) sum += b[(start + i) % 12];
			if (sum > bestSum) { bestSum = sum; best = start; }
		}
		if (bestSum / total >= 0.6) {
			return {
				from: (best * 2) % 24,
				to: ((best + len) * 2) % 24,
				share: Math.round((bestSum / total) * 100),
			};
		}
	}
	return null;
}
