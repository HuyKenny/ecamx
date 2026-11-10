/**
 * Stránky pro nicky, které katalog nezná, ale Google na ně pořád posílá lidi.
 *
 * **Proč to vzniklo (19. 8. 2026):** oprava z rána nahradila tvrdé 404
 * přesměrováním, takže se URL přestaly rozbíjet. Změřeno ale na všech 965 URL,
 * které kdy měly imprese: **64 % impresí skončilo na obecném cíli** —
 * `/models/{písmeno}/` (39 %) nebo `/site/{síť}/` (24 %). Dotaz „lunarspark cam"
 * (143 impresí, pozice 6,7) vede na abecední seznam. Google nerelevantní
 * přesměrování čte jako soft 404 a pozici zahodí stejně jako u 404 — problém
 * se tedy jen přesunul.
 *
 * Proč to nespravila demand-retence v syncu: `lunarspark` a `hoaarisa` už
 * v registry NEJSOU (krok 5 je smazal dřív, než pravidlo vzniklo) a
 * `tinyxstar` s `tooclose_toofar` v registry jsou, ale krok 4 jim smazal
 * `snap`, takže je filtr `!!e.snap` vyřadí. Ani jednu z nich neumí sync
 * postavit, protože nemá z čeho.
 *
 * Řešení: stránka postavená z toho mála, co OPRAVDU víme — nick a síť. Žádná
 * data z feedu se nevymýšlejí: archivní stránka neukazuje věk, zemi, štítky
 * ani „naposledy vysílala", protože nic z toho nemáme. Má nick v H1, pravdivý
 * stav („právě nevysílá"), affiliate odkaz do sítě a mřížku živých modelek,
 * aby nebyla slepou uličkou.
 *
 * **Síť se nehádá.** 341 nicků ji má z `legacy-gone.json` (cíl `/site/{síť}/`),
 * dalších 333 potvrdila sonda proti Chaturbate API (`biocontext`, 200/401 =
 * pokoj existuje, 404 = neexistuje). Zbylých 162 nicků síť nemá, a proto
 * stránku NEDOSTANE — dál jim odpovídá přesměrování z `gone.ts`. Radši
 * o 417 impresí míň než stránka, která tvrdí něco, co nevíme.
 */
import legacyNetworks from '../../seed/legacy-networks.json';
import legacyStats from '../../seed/legacy-gone-stats.json';
import type { Model, NetworkId } from './data';

interface LegacyStat { clicks?: number; impressions?: number; position?: number }

const NETWORKS = legacyNetworks as Record<string, NetworkId>;
const STATS = legacyStats as Record<string, LegacyStat>;

/**
 * Prázdný katalogový záznam. Všechno, co by bylo vymyšlené, je `null`/`[]` —
 * šablony a `attrs` v `live/[slug].astro` tyhle hodnoty už umí přeskočit.
 */
function legacyModel(page: string, network: NetworkId, generatedAt: string): Model {
	const stat = STATS[page] ?? {};
	return {
		slug: page,
		network,
		username: page,
		displayName: page,
		gender: null, age: null, country: null,
		languages: [], tags: [],
		ethnicity: null, hairColor: null, eyeColor: null,
		bodyType: null, bustSize: null,
		subject: null, viewers: null, thumbnail: null,
		followers: null, isHd: false, isNew: false, toy: false,
		turnOns: null, photos: null, videos: null,
		page,
		// `first`/`last` neznáme. `last` čte jen `dateModified` a sitemapa, což
		// je datum poslední přestavby stránky — to je pravda. Text „naposledy
		// vysílala" se u archivní stránky nevypisuje (hlídá `model.archived`).
		first: generatedAt,
		last: generatedAt,
		seen: 0, streak: 0, peak: 0,
		// Poptávka = imprese v GSC. Klik váží 10×, stejně jako v syncu.
		demand: (stat.impressions ?? 0) + (stat.clicks ?? 0) * 10,
		online: false,
		// Do indexu patří: každá z nich má měřené imprese, většina pozici v TOP 10.
		indexable: true,
		// Seed soubor se mezi buildy nemění, takže tyhle URL nikdy nezmizí.
		stable: true,
		archived: true,
	};
}

/**
 * Archivní stránky pro slugy, které katalog nezná. `known` = slugy, které už
 * stránku mají (živé i archivní z katalogu) — ty se nesmí duplikovat.
 */
export function legacyPages(known: Set<string>, generatedAt: string): Model[] {
	return Object.entries(NETWORKS)
		.filter(([page]) => !known.has(page))
		.map(([page, network]) => legacyModel(page, network, generatedAt))
		.sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0));
}
