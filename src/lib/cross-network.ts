/**
 * Stejný nick na víc sítích.
 *
 * Modelky běžně vysílají na několika platformách pod týmž jménem — a nikdo to
 * nikde nepublikuje, protože k tomu musíš mít všechny sítě v jednom katalogu.
 * My je máme, takže je to jediná věc na stránce modelky, kterou nemá odkud
 * opsat ani konkurence, ani samotná síť. Změřeno 19. 8. 2026 po zvětšení
 * pokrytí cam4 a bongacams: **944 nicků / 2 075 existujících stránek**,
 * nejčastěji camsoda↔chaturbate, bongacams↔chaturbate, cam4↔chaturbate.
 *
 * ## Čeho se tenhle modul drží
 *
 * **Tvrdíme shodu JMÉNA, ne totožnost osoby.** Nick není napříč sítěmi
 * rezervovaný a `molly` nebo `sativa` si zvolí kdokoli — D35 na tom změřilo,
 * že z 400 kandidátů na „poptávku po nicku" bylo 91 falešných. Proto se
 * o každém páru řekne přesně tolik, kolik o něm víme, a rozdělují se na tři
 * úrovně podle toho, co **obě strany** hlásí:
 *
 *   A — korroborovaný: obě strany uvádějí zemi a shodují se, nebo obě uvádějí
 *       věk do ±4 let. **1 087 stránek.**
 *   B — jen nick: jediná shoda je gender (u 80 % katalogu „female"), nebo
 *       jedna strana neuvádí nic. **896 stránek.**
 *   C — rozporný: jiný gender, nebo věk nad ±4. **92 stránek.**
 *       **Blok se u nich nevynechává** —
 *       ta informace je pravdivá právě proto, že je negativní, a hledající ji chce.
 *       Rozdílná země sem NEPATŘÍ: ze 111 takových párů má 63 % shodný věk,
 *       takže je to nastavená lokalita, ne jiný člověk.
 *
 * Pozor na past, na kterou jsem sám naletěl: „země známá jen na jedné straně"
 * NENÍ shoda. Původní pravidlo ji za shodu bralo, a proto vypadalo, že je
 * korroborovaných skoro všechno.
 *
 * **Nikdy `sameAs` ani `identifier` v JSON-LD** mezi dvěma našimi `/live/` URL.
 * To je strojově čitelné tvrzení o identitě entity a neumíme ho podložit ani
 * u tieru A.
 *
 * Počítá se při BUILDU z `MODEL_PAGES`, ne v syncu: je to čistá funkce nad už
 * hotovými daty, nepatří to do registry a nestojí to ani bajt v KV.
 */
import { canonicalCountry, type Model } from './data.ts';

export type MatchTier = 'corroborated' | 'name-only' | 'conflicting';

export interface CrossMatch {
	/** Stránka dvojčete — vždy `page`, které v tomhle buildu existuje. */
	page: string;
	network: Model['network'];
	tier: MatchTier;
	/** Co se u tieru A shodlo — jde to do věty, aby nebyla vágní. */
	sharedCountry: string | null;
	/** Rozdíl věků, když ho obě strany uvádějí. */
	ageGap: number | null;
	/** U tieru C: čím si ty dva profily odporují. */
	conflict: 'gender' | 'age' | null;
	/**
	 * Obě strany uvádějí zemi a liší se. **Není to důkaz jiné osoby** —
	 * změřeno 19. 8. 2026: ze 111 takových párů má **63 % shodný věk (±1 rok)**,
	 * takže je to spíš marketing (modelky si lokalitu na každé síti nastavují
	 * jinak) než dva různí lidé. Proto to jde jako poznámka, ne jako rozpor.
	 */
	differentCountry: boolean;
}

/** Gender páry, které se vylučují. `female` vs `couple` NE — modelka vysílá
 *  sólo i ve dvou a mění to podle dne. */
const GENDER_CONFLICT = new Set([
	'female|male', 'male|female', 'female|trans', 'trans|female',
	'male|trans', 'trans|male',
]);

function compare(a: Model, b: Model): Omit<CrossMatch, 'page' | 'network'> {
	const ca = canonicalCountry(a.country);
	const cb = canonicalCountry(b.country);
	const ga = a.gender;
	const gb = b.gender;
	const aa = a.age && a.age >= 18 && a.age <= 80 ? a.age : null;
	const ab = b.age && b.age >= 18 && b.age <= 80 ? b.age : null;
	const gap = aa != null && ab != null ? Math.abs(aa - ab) : null;
	const differentCountry = !!(ca && cb && ca !== cb);

	// Rozpor je jen to, co opravdu ukazuje na jiného člověka. Země mezi ně
	// NEPATŘÍ (viz `differentCountry`).
	if (ga && gb && GENDER_CONFLICT.has(`${ga}|${gb}`)) {
		return { tier: 'conflicting', sharedCountry: null, ageGap: gap, conflict: 'gender', differentCountry };
	}
	if (gap != null && gap > 4) {
		return { tier: 'conflicting', sharedCountry: null, ageGap: gap, conflict: 'age', differentCountry };
	}

	// Korroborace vyžaduje údaj z OBOU stran — „známé jen na jedné straně"
	// není shoda, i když to tak na první pohled vypadá.
	if (ca && cb && ca === cb) {
		return { tier: 'corroborated', sharedCountry: ca, ageGap: gap, conflict: null, differentCountry: false };
	}
	if (gap != null) {
		return { tier: 'corroborated', sharedCountry: null, ageGap: gap, conflict: null, differentCountry };
	}

	return { tier: 'name-only', sharedCountry: null, ageGap: null, conflict: null, differentCountry };
}

/**
 * `page` → dvojčata na jiných sítích.
 *
 * Seskupuje se podle `m.slug` (surový nick), NE podle `m.page` — dvojče má
 * `page = {nick}-{network}`, takže podle `page` by se nenašlo nic. Dvojice
 * (slug, network) je v registry unikátní, takže duplicita v rámci jedné sítě
 * vzniknout nemůže.
 */
export function buildCrossNetwork(pages: Model[]): Map<string, CrossMatch[]> {
	const bySlug = new Map<string, Model[]>();
	for (const m of pages) {
		const arr = bySlug.get(m.slug);
		if (arr) arr.push(m); else bySlug.set(m.slug, [m]);
	}

	const out = new Map<string, CrossMatch[]>();
	for (const group of bySlug.values()) {
		if (group.length < 2) continue;
		for (const me of group) {
			const matches: CrossMatch[] = [];
			for (const other of group) {
				if (other === me || other.network === me.network) continue;
				// Tier se počítá PER PÁR, ne pro celou skupinu — jinak by jeden
				// rozporný záznam zneplatnil dva korroborované.
				const c = compare(me, other);
				matches.push({ page: other.page, network: other.network, ...c });
			}
			if (!matches.length) continue;
			// Nejdřív to, co je nejlíp podložené.
			const rank: Record<MatchTier, number> = { corroborated: 0, 'name-only': 1, conflicting: 2 };
			matches.sort((x, y) => rank[x.tier] - rank[y.tier] || x.network.localeCompare(y.network));
			out.set(me.page, matches);
		}
	}
	return out;
}

/** Nicky, které mají dvojče — podklad pro adresář `/models/same-nickname/`. */
export function crossNetworkNicks(pages: Model[]): Array<{ slug: string; entries: Model[] }> {
	const bySlug = new Map<string, Model[]>();
	for (const m of pages) {
		const arr = bySlug.get(m.slug);
		if (arr) arr.push(m); else bySlug.set(m.slug, [m]);
	}
	const out: Array<{ slug: string; entries: Model[] }> = [];
	for (const [slug, entries] of bySlug) {
		if (entries.length < 2) continue;
		if (new Set(entries.map((m) => m.network)).size < 2) continue;
		out.push({ slug, entries: [...entries].sort((a, b) => a.network.localeCompare(b.network)) });
	}
	// Stabilní řazení podle slugu — adresář se nesmí přeskládat každé 2 h.
	out.sort((a, b) => a.slug.localeCompare(b.slug));
	return out;
}
