/**
 * Kolik místa v mřížce která síť dostane — a proč právě tolik.
 *
 * Vlastní malý modul schválně: potřebuje ho i klientský průchod mřížkou
 * a případné skripty, ale `data.ts` s sebou táhne celý katalog (13 MB JSONu,
 * past 64). Šablony si to berou z `data.ts`, který to jen reexportuje —
 * stejný vzor jako `popup-blocked.ts`.
 *
 * **Čísla jsou z měření, ne z dojmu.** GA4 za 28 dní (`ga4.py money`, měřeno
 * 28. 8. 2026, 38 prokliků celkem):
 *
 *   chaturbate 19 · bongacams 6 · livejasmin 4 · xlovecam 4 · camsoda 3
 *   amateur 1 · stripchat 1 · ostatní 0
 *
 * Chaturbate tedy nese **polovinu všech prokliků**, přestože mu rovnoměrné
 * prokládání dávalo 6 karet z 60 (10 %). Váha 4 z něj na homepage udělá zhruba
 * třetinu mřížky a první kartu; ostatní sítě zůstávají viditelné, protože web
 * má být pořád agregátor deseti sítí (na tom stojí srovnávací stránky a s nimi
 * dotazy typu „X vs Y").
 *
 * **Nezvedat naslepo.** Kdo tohle mění, ať se nejdřív podívá na `ga4.py money`:
 * poměr prokliků ke kartám je jediný důvod, proč tady nějaká čísla jsou.
 * Při 38 proklicích za měsíc to není statistika, ale směr — a když se poměr
 * otočí, mají se otočit i váhy.
 */
export const NETWORK_WEIGHT: Record<string, number> = {
	chaturbate: 4,
};

/** Výchozí váha sítě, která v tabulce není. */
export const DEFAULT_WEIGHT = 1;

export function weightOf(network: string): number {
	return NETWORK_WEIGHT[network] ?? DEFAULT_WEIGHT;
}

/**
 * Jak atraktivní je pokoj pro člověka, který přišel utrácet.
 *
 * Používá se jen k **pořadí uvnitř jedné sítě**, nikdy napříč sítěmi (na to je
 * váha výš) a nikdy k tomu, co se vůbec zobrazí.
 *
 * Dva signály, oba už v datech: běžící **tip goal** a **interaktivní hračka**.
 * V takovém pokoji se platí teď, ne teoreticky. K tomu pásmo publika: pokoj se
 * 40 000 diváky je špatná první karta, protože v něm jednotlivý dárce zanikne
 * (a změřeno 28. 8.: pokoje nad 500 diváků taky nejdřív končí — přežití 69 %
 * proti 84 % ve středním pásmu). Prázdný pokoj je zase mrtvý.
 *
 * **Tohle je hypotéza, ne měření.** Při 38 proklicích za 28 dní se nedá
 * vyhodnotit A/B testem; ověřuje se na objemu `?p=player` po měsíci. Kdyby to
 * nevyšlo, stačí funkci vrátit nulu — pořadí pak zůstane podle diváků.
 */
export function payingScore(m: { viewers?: number | null; toy?: boolean; goalText?: string | null }): number {
	let s = 0;
	if (m.goalText) s += 2;
	if (m.toy) s += 1;
	const v = m.viewers ?? 0;
	if (v >= 50 && v <= 800) s += 2;
	else if (v > 800 && v <= 3000) s += 1;
	else if (v < 5) s -= 1;
	return s;
}
