/**
 * Souhrny nad celým katalogem — podklad pro text, který nemá odkud opsat
 * ani konkurence, ani samotná síť.
 *
 * Proč to existuje: stránka modelky stojí a padá s tím, jestli má co říct.
 * Feed dává atributy, které má stejně tak každý druhý agregátor; co máme jen my,
 * je **kontext** — kolik pokojů té sítě sledujeme, jak velké publikum má ona
 * proti ostatním, kolik modelek vedeme z její země. To jsou pravdivá čísla
 * z našeho měření a na každé stránce vycházejí jinak.
 *
 * PRAVIDLA:
 *  - **Stabilita přes buildy.** Sync deployuje 12× denně; kdyby text nesl
 *    přesné pořadí („je 418. největší"), měnil by se každé dvě hodiny. Proto
 *    se ven dávají jen hrubé přihrádky (`peakBand`) a čísla přes `approx()`.
 *  - **Prahy vzorku.** Pod `MIN_SAMPLE` se nevrací nic — z osmi pokojů se
 *    percentil počítat nedá a věta by lhala s číslem.
 *  - Počítá se **jednou za build**, líně, z `MODEL_PAGES`. Katalog má 16 000+
 *    záznamů, takže per-stránku by to byl nesmysl.
 */
import { MODEL_PAGES, type Model, type NetworkId } from './data.ts';
import { canonicalTerm } from './taxonomy.ts';

/** Míň záznamů = žádné tvrzení. Percentil z hrsti pokojů není informace. */
const MIN_SAMPLE = 200;
/** Země a jazyky snesou nižší práh — jsou to prosté počty, ne percentily. */
const MIN_COHORT = 20;

export interface NetworkShape {
	/** Kolik jejích pokojů vedeme (živé i archivní stránky). */
	rooms: number;
	/** Kolik z nich má změřený peak — jen z nich se počítají hranice. */
	measured: number;
	/** Hranice peaku: medián a 90. percentil. */
	median: number;
	p90: number;
}

interface Stats {
	networks: Map<string, NetworkShape>;
	countries: Map<string, number>;
	tags: Map<string, number>;
	languages: Map<string, number>;
}

let cache: Stats | null = null;

function build(): Stats {
	const peaks = new Map<string, number[]>();
	const networks = new Map<string, NetworkShape>();
	const countries = new Map<string, number>();
	const tags = new Map<string, number>();
	const languages = new Map<string, number>();

	const bump = (map: Map<string, number>, key: string | null | undefined) => {
		if (!key) return;
		map.set(key, (map.get(key) ?? 0) + 1);
	};

	for (const m of MODEL_PAGES as Model[]) {
		const shape = networks.get(m.network) ?? { rooms: 0, measured: 0, median: 0, p90: 0 };
		shape.rooms++;
		networks.set(m.network, shape);
		if (m.peak > 0) {
			const arr = peaks.get(m.network) ?? [];
			arr.push(m.peak);
			peaks.set(m.network, arr);
		}
		bump(countries, m.country);
		for (const t of new Set((m.tags ?? []).map((x) => canonicalTerm(x)).filter(Boolean) as string[])) {
			bump(tags, t);
		}
		for (const l of new Set((m.languages ?? []).map((x) => x.toLowerCase()))) bump(languages, l);
	}

	for (const [net, arr] of peaks) {
		const shape = networks.get(net)!;
		arr.sort((a, b) => a - b);
		shape.measured = arr.length;
		shape.median = arr[Math.floor(arr.length / 2)] ?? 0;
		shape.p90 = arr[Math.floor(arr.length * 0.9)] ?? 0;
	}
	return { networks, countries, tags, languages };
}

function stats(): Stats {
	if (!cache) cache = build();
	return cache;
}

/** Tvar sítě, nebo `null` když je vzorek tak malý, že by čísla lhala. */
export function networkShape(network: NetworkId | string): NetworkShape | null {
	const s = stats().networks.get(network);
	return s && s.rooms >= MIN_SAMPLE ? s : null;
}

/**
 * Kam modelka spadá publikem v rámci své sítě. Schválně jen tři hrubé
 * přihrádky: přesné pořadí by se měnilo každé dvě hodiny se syncem.
 */
export type PeakBand = 'top' | 'above' | 'typical';

export function peakBand(m: Model): PeakBand | null {
	const s = networkShape(m.network);
	if (!s || s.measured < MIN_SAMPLE || !m.peak) return null;
	if (m.peak >= s.p90) return 'top';
	if (m.peak > s.median) return 'above';
	return 'typical';
}

/** Kolik sítí máme v katalogu. Číslo se hýbe s tím, co sync opravdu stáhl. */
export function networkCount(): number {
	return stats().networks.size;
}

/** Kolik modelek vedeme ze země / s jazykem / s termem. `0` = pod prahem. */
export function countryCohort(country: string | null | undefined): number {
	const n = country ? stats().countries.get(country) ?? 0 : 0;
	return n >= MIN_COHORT ? n : 0;
}

/**
 * Kolik modelek mluví daným jazykem — ale **jen když je to informace**.
 * Angličtinu uvádí skoro každá, takže věta „12 000+ modelek uvádí angličtinu"
 * stála na 192 stránkách z 300 a neříkala nic. Nad `COMMON_SHARE` katalogu se
 * proto vrací 0 a věta se vynechá.
 */
const COMMON_SHARE = 0.25;

export function languageCohort(language: string | null | undefined): number {
	const s = stats();
	const n = language ? s.languages.get(language.toLowerCase()) ?? 0 : 0;
	if (n < MIN_COHORT) return 0;
	const total = [...s.networks.values()].reduce((a, x) => a + x.rooms, 0) || 1;
	return n / total > COMMON_SHARE ? 0 : n;
}

export function tagCohort(tag: string | null | undefined): number {
	const t = tag ? canonicalTerm(tag) : null;
	const n = t ? stats().tags.get(t) ?? 0 : 0;
	return n >= MIN_COHORT ? n : 0;
}
