/**
 * Čísla o sítích z NAŠEHO měření — podklad pro `/site/`.
 *
 * ## Proč to není prostý výpis polí
 *
 * Feedy se liší v tom, co vůbec hlásí, a **nula znamená „síť to neposílá", ne
 * „modelky to nemají"**. Změřeno 19. 8. 2026 (podíl vyplněných polí):
 *
 *   isHd      Chaturbate 80 %, BongaCams 28 %, ostatních pět **0 %**
 *   viewers   pět sítí 95–100 %, XLoveCam a LiveJasmin **0 %**
 *   age       šest sítí 70–100 %, CamSoda **0 %**
 *   country   čtyři sítě 72–100 %, CamSoda/XLove/LiveJasmin **0 %**
 *   toy       BongaCams 69 %, LiveJasmin 68 %, Chaturbate **0 %**
 *
 * Kdyby tabulka napsala „CamSoda: HD 0 %", je to lež — a shodou okolností lež,
 * která lichotí Chaturbate, tedy našemu největšímu zdroji provizí. To je přesně
 * ten affiliate bias, kterým se nechceme lišit od blogů s „TOP 10 cam sites".
 *
 * Proto se **srovnává jen to, co měříme my sami stejně u všech sedmi**
 * (počet modelek, rozdělení gender, podíl modelek viděných i na jiné síti)
 * a u zbytku se místo čísla řekne, že to síť nezveřejňuje.
 *
 * Druhá past, kterou to muselo přežít: do 19. 8. tahal sync z cam4 i BongaCams
 * `limit=1000` a přesně 1 000 dostával, takže „velikost sítě" byl náš vlastní
 * strop. Kdo sem přidá další síť, ať se podívá, jestli počet není podezřele
 * kulatý.
 *
 * **Zamítnutá metrika: „nových modelek za týden".** Spočítal jsem ji a vyšlo
 * 8 471 z 8 795 u Chaturbate — jenže `first` je datum, kdy jsme modelku poprvé
 * viděli MY, a katalog je starý tři dny. Neměřilo by to síť, ale nás. Dává smysl
 * ji vrátit nejdřív za měsíc provozu, a i pak s popiskem „first seen in our
 * catalogue", ne „new on the site".
 */
import { MODEL_PAGES, MODELS, type Model, type NetworkId } from './data.ts';
import { crossNetworkNicks } from './cross-network.ts';

/** Pod tímhle podílem vyplněnosti se pole považuje za „síť to nehlásí". */
const REPORTED_MIN = 0.5;

export interface NetworkStats {
	id: NetworkId;
	/** Modelek, které jsme viděli online v posledním syncu. */
	online: number;
	genders: { female: number; male: number; trans: number; couple: number };
	/** Medián diváků, nebo null když síť počty diváků nezveřejňuje. */
	medianViewers: number | null;
	/** Kolik jejích modelek jsme viděli i na jiné síti. */
	alsoElsewhere: number;
	/** Co o modelkách zveřejňuje — pro řádek „what each site tells us". */
	reports: { age: boolean; country: boolean; hd: boolean; toy: boolean; looks: boolean };
}

function median(nums: number[]): number | null {
	if (!nums.length) return null;
	const s = [...nums].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function filled(models: Model[], pick: (m: Model) => unknown): boolean {
	if (!models.length) return false;
	const n = models.filter((m) => {
		const v = pick(m);
		return v !== null && v !== undefined && v !== '' && v !== false;
	}).length;
	return n / models.length >= REPORTED_MIN;
}

export function networkStats(): NetworkStats[] {
	// Dvojčata se počítají nad VŠÍM, co má stránku (živé i archivní) — modelka
	// nemusí vysílat na obou sítích ve stejnou chvíli.
	const twinNetworks = new Map<string, Set<NetworkId>>();
	for (const { slug, entries } of crossNetworkNicks(MODEL_PAGES)) {
		twinNetworks.set(slug, new Set(entries.map((m) => m.network)));
	}
	const byNetwork = new Map<NetworkId, Model[]>();
	for (const m of MODELS) {
		const arr = byNetwork.get(m.network);
		if (arr) arr.push(m); else byNetwork.set(m.network, [m]);
	}

	const out: NetworkStats[] = [];
	for (const [id, models] of byNetwork) {
		const g = { female: 0, male: 0, trans: 0, couple: 0 };
		for (const m of models) {
			if (m.gender === 'female') g.female++;
			else if (m.gender === 'male') g.male++;
			else if (m.gender === 'trans') g.trans++;
			else if (m.gender === 'couple') g.couple++;
		}
		out.push({
			id,
			online: models.length,
			genders: g,
			medianViewers: filled(models, (m) => m.viewers)
				? median(models.map((m) => m.viewers).filter((v): v is number => v != null))
				: null,
			alsoElsewhere: models.filter((m) => (twinNetworks.get(m.slug)?.size ?? 0) > 1).length,
			reports: {
				age: filled(models, (m) => m.age),
				country: filled(models, (m) => m.country),
				hd: filled(models, (m) => m.isHd),
				toy: filled(models, (m) => m.toy),
				looks: filled(models, (m) => m.ethnicity) || filled(models, (m) => m.hairColor),
			},
		});
	}
	out.sort((a, b) => b.online - a.online);
	return out;
}
