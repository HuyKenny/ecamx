/**
 * Index pro hledání modelky podle jména (`/finder/`).
 *
 * ## Proč klientský soubor a ne Worker
 *
 * Rozhodly to limity, ne pohodlí. `/api/online/[network]` má v komentáři
 * naměřeno, že **BongaCams při 300 záznamech = 14 ms CPU, tedy nad free stropem
 * 10 ms** — `JSON.parse` celého indexu by padal na CPU dřív, než by se vůbec
 * dostal k hledání. KV navíc neumí substringový dotaz nad hodnotami, takže by
 * se v každé invokaci musel načíst celý. A typeahead by při 4–6 requestech na
 * dotaz tlačil na **rate limit 40 req/10 s, který sdílí s `/go/`** — riskovat
 * 429 na vydělávající cestě kvůli hledání je nepřijatelné.
 *
 * Statický soubor je tedy 0 invokací Workeru, 0 requestů proti dennímu limitu
 * a hledání běží lokálně nad blobem přes `String.indexOf`.
 *
 * ## Formát (textový, ne JSON)
 *
 * ```
 * řádek 1     JSON meta (verze, slovníky, cross-network skupiny, override mapa)
 * řádky 2..N  jeden nick na řádek, v pořadí ranku (online desc, peak desc)
 * poslední    base64 Uint8Array(rows × 3) — sloupce
 * ```
 *
 * Textový, protože `JSON.parse` 300kB objektu je na throttlovaném mobilu
 * desítky ms, kdežto `text()` + tři `indexOf` + `atob` jednotky ms. Přesně
 * z tohohle důvodu má `api/online/[network].ts` u CamSody `pickText` regexem
 * místo `JSON.parse` („11 ms → jednotky ms").
 *
 * Bajty na řádek:
 * ```
 * b0 = net<<5 | gender<<2 | online<<1 | pageSuffix     (3+3+1+1 bitů = přesně 8)
 * b1 = index země (0 = neznámá)
 * b2 = věk (0 = neznámý) | hasTwin<<7                  (věk ≤ 80 se vejde do 7 bitů)
 * ```
 *
 * ## Tři věci, které to drží malé
 *
 * 1. **Žádné `page` řetězce.** Změřeno: `page` je u všech 16 327 řádků buď
 *    `slug`, nebo `slug-network` → stačí 1 bit. Klient si `page` složí
 *    slugifikací nicku; 201 řádků (103 z nich legacy ze starého WP), kde slug
 *    drží podtržítka a slugifikací by nevyšel, je v override mapě (3 kB).
 * 2. **Žádné `displayName`.** Rovná se nicku u **všech** 16 327 řádků, takže
 *    jeden blob obsluhuje hledání i zobrazení.
 * 3. **Žádný sloupec popularity.** Řádky jsou předřazené, takže **pořadí řádku
 *    JE ranking** — ušetří to 16 kB a klient nemusí nic řadit.
 *
 * Kdo tenhle formát mění, ať nejdřív spustí `assertIndexAssumptions()`. Ty tři
 * triky nejsou optimalizace pro optimalizaci: bez nich má index 780 kB a to je
 * rozdíl mezi „stáhne se po fokusu pole" a „nestahuje se vůbec".
 */
import {
	MODEL_PAGES, META, NETWORK_LABELS, canonicalCountry, countryName,
	type Model, type NetworkId,
} from './data.ts';
import { crossNetworkNicks } from './cross-network.ts';

/**
 * Pořadí sítí v indexu. Fixní — mění se jen s verzí formátu.
 *
 * **Kdo přidá síť, přidá ji SEM.** Do 25. 8. 2026 měla síť v prvním bajtu jen
 * tři bity (max 8 hodnot) a `indexOf` u neznámé sítě vrací −1 → v `Uint8Array`
 * z toho bylo 224, tedy index 7. Se čtyřmi novými sítěmi (D54) by finder
 * u 2 750 modelek tvrdil „Amateur.tv". Teď má síť celý bajt a `buildSearchIndex`
 * na neznámé síti **padá**, místo aby tiše lhala.
 */
export const IDX_NETWORKS: NetworkId[] = [
	'chaturbate', 'camsoda', 'cam4', 'bongacams', 'xlovecam', 'livejasmin', 'amateur',
	'stripchat', 'streamate', 'imlive',
];
/** Index 0 = neznámý; víc než 8 hodnot se do 3 bitů nevejde. */
export const IDX_GENDERS = ['', 'female', 'male', 'trans', 'couple', 'group'];

/** Tentýž slugify jako v `scripts/cam-networks.ts` — klient ho má taky. */
function slugifyNick(s: string): string {
	return String(s ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 96);
}

export interface IndexAssumptions {
	rows: number;
	pageDerivable: number;
	overrides: number;
	nonAscii: number;
	displayNameEqualsUsername: number;
}

/**
 * Ověří, na čem formát stojí. Volá se při buildu; když se katalog změní tak, že
 * některý předpoklad přestane platit, chceme to vědět z buildu, ne z rozbitých
 * odkazů ve výsledcích hledání.
 */
export function assertIndexAssumptions(rows: Model[] = MODEL_PAGES): IndexAssumptions {
	let pageDerivable = 0, overrides = 0, nonAscii = 0, dispEq = 0;
	for (const m of rows) {
		const s = slugifyNick(m.username);
		if (m.page === s || m.page === `${s}-${m.network}`) pageDerivable++;
		else overrides++;
		if (/[^\x20-\x7E]/.test(m.username)) nonAscii++;
		if (m.displayName === m.username) dispEq++;
	}
	// Nicky mimo ASCII by rozbily jak `atob`/`toLowerCase` předpoklady, tak
	// řádkový blob (past AGENTS 8 — osamocené surrogate páry shodí i build).
	if (nonAscii) {
		throw new Error(
			`search-index: ${nonAscii} nicků mimo ASCII — blob i klientský slugify s tím nepočítají`
		);
	}
	return { rows: rows.length, pageDerivable, overrides, nonAscii, displayNameEqualsUsername: dispEq };
}

export interface BuiltIndex {
	text: string;
	stats: IndexAssumptions & { bytes: number; countries: number; twinGroups: number };
}

export function buildSearchIndex(rows: Model[] = MODEL_PAGES): BuiltIndex {
	const stats = assertIndexAssumptions(rows);

	// Pořadí = ranking. Online první, pak podle nejvyššího viděného počtu diváků.
	const sorted = [...rows].sort((a, b) =>
		Number(b.online) - Number(a.online) || (b.peak ?? 0) - (a.peak ?? 0) || a.page.localeCompare(b.page));

	// Země podle frekvence, aby ty časté měly nízký index (a slovník byl krátký).
	const freq = new Map<string, number>();
	for (const m of sorted) {
		const cc = canonicalCountry(m.country);
		if (cc) freq.set(cc, (freq.get(cc) ?? 0) + 1);
	}
	const countries = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 254).map(([c]) => c);
	const ccIndex = new Map(countries.map((c, i) => [c, i + 1]));

	// Dvojčata: skupiny indexů řádků. Používá je filtr „na 2+ sítích" a hlavně
	// „její pokoj je offline, ale na jiné síti právě vysílá" — což je jediná věc,
	// kterou agregátor umí a samotná síť ne.
	const rowOf = new Map<string, number>();
	sorted.forEach((m, i) => rowOf.set(m.page, i));
	const twins: number[][] = [];
	const hasTwin = new Uint8Array(sorted.length);
	for (const { entries } of crossNetworkNicks(rows)) {
		const idx = entries.map((m) => rowOf.get(m.page)).filter((i): i is number => i !== undefined);
		if (idx.length < 2) continue;
		twins.push(idx);
		for (const i of idx) hasTwin[i] = 1;
	}

	// **4 bajty na řádek**, ne 3: síť má celý bajt, protože do tří bitů se
	// jedenáct sítí nevejde (viz IDX_NETWORKS). Cena je +1 bajt × řádek, tedy
	// ~17 kB nekomprimovaně a ~5 kB po brotli — proti tomu, že by filtr sítě
	// ukazoval cizí síť, je to zdarma.
	//
	//   bajt 0: index sítě (0–255)
	//   bajt 1: gender<<2 | online<<1 | pageSuffix
	//   bajt 2: index země (0 = neznámá)
	//   bajt 3: věk (0 = neznámý) | hasTwin<<7
	const cols = new Uint8Array(sorted.length * 4);
	const overrides: Record<number, string> = {};
	const nicks: string[] = [];
	sorted.forEach((m, i) => {
		nicks.push(m.username);
		// Neznámá síť se NESMÍ schovat do indexu 0 — to je přesně ta tichá lež,
		// kterou tenhle formát v srpnu předvedl (viz IDX_NETWORKS).
		const net = IDX_NETWORKS.indexOf(m.network);
		if (net < 0) {
			throw new Error(
				`index finderu: síť "${m.network}" není v IDX_NETWORKS — přidej ji tam, `
				+ 'jinak by finder u jejích modelek ukazoval cizí síť.'
			);
		}
		const g = Math.max(0, IDX_GENDERS.indexOf(m.gender ?? ''));
		const s = slugifyNick(m.username);
		const suffix = m.page === `${s}-${m.network}` ? 1 : 0;
		if (m.page !== s && !suffix) overrides[i] = m.page;
		cols[i * 4] = net;
		cols[i * 4 + 1] = (g << 2) | (Number(m.online) << 1) | suffix;
		const cc = canonicalCountry(m.country);
		cols[i * 4 + 2] = (cc && ccIndex.get(cc)) || 0;
		const age = m.age && m.age >= 18 && m.age <= 80 ? m.age : 0;
		cols[i * 4 + 3] = age | (hasTwin[i] << 7);
	});

	const meta = {
		v: META.generatedAt,
		rows: sorted.length,
		nets: IDX_NETWORKS,
		// Popisky sem patří, i když jsou odvoditelné: klient by jinak potřeboval
		// vlastní kopii `NETWORK_LABELS` a `COUNTRY_NAMES`, a dvě kopie téhož
		// slovníku se v tomhle repu už jednou rozešly (D24).
		netLabels: IDX_NETWORKS.map((n) => NETWORK_LABELS[n]),
		gens: IDX_GENDERS,
		cc: countries,
		ccNames: countries.map((c) => countryName(c)),
		tw: twins,
		ov: overrides,
	};
	const text = `${JSON.stringify(meta)}\n${nicks.join('\n')}\n${Buffer.from(cols).toString('base64')}\n`;
	return {
		text,
		stats: {
			...stats,
			bytes: Buffer.byteLength(text),
			countries: countries.length,
			twinGroups: twins.length,
		},
	};
}
