/**
 * Ceny tokenů — jediné místo na webu, kde jsou dolarové částky.
 *
 * ## Proč to není v `networks.ts`
 *
 * Tam stojí: *„ZÁMĚRNĚ tu nejsou konkrétní ceny v dolarech. Sítě je mění
 * a špatná cena je horší než žádná."* To rozhodnutí **platí dál** — próza
 * o sítích čísla mít nebude. Kenny 19. 8. 2026 vědomě rozhodl, že kalkulačka
 * s cenami balíčků vzniknout má (měřeno: „chaturbate token calculator"
 * 288/měs při KD 5, „chaturbate tokens to dollars" 104 při KD 0, CPC $11),
 * takže tady je oddělený datový soubor s **datem ověření u každé sady** a
 * s guardem, který build zastaví, až budou data stará.
 *
 * ## Pravidla, která to drží pravdivé
 *
 * 1. **Co jsem si neověřil, sem nepatří.** Ověřeno 19. 8. 2026: token purchase
 *    page Chaturbate 302-uje na login, CamSoda a BongaCams vracejí anonymnímu
 *    requestu 403, XLoveCam a LiveJasmin 404 — **ani jedna ze sedmi sítí ceny
 *    veřejně nevystavuje.** Nedají se tedy ani automaticky hlídat.
 * 2. **Bez dat NEVZNIKNE URL.** `getStaticPaths()` v `tokens.astro` generuje
 *    stránku jen pro sítě, které tu mají `bundles`. Prázdná kalkulačka je horší
 *    než žádná.
 * 3. **`checkedOn` je povinné a hlídané.** `scripts/check-links.ts` build
 *    zastaví, když je starší než `MAX_AGE_DAYS`. Tichá nepravda je horší než
 *    spadlý build — stejná logika jako `auditEarnings()` v syncu.
 * 4. Na stránce je datum ověření vidět a věta, že si to má návštěvník před
 *    nákupem zkontrolovat.
 *
 * ## Jak sadu doplnit
 *
 * Ceny vidí jen přihlášený uživatel, takže je musí opsat člověk z nákupní
 * stránky sítě. Do `bundles` patří přesně to, co tam stojí (tokeny a cena
 * v USD), `sourceUrl` je ta stránka a `checkedOn` den, kdy se to dělalo.
 */
import type { NetworkId } from '../lib/data';

export interface TokenBundle {
	tokens: number;
	usd: number;
	/** Např. „first purchase only" — píše se k řádku, ne do výpočtu. */
	note?: string;
}

export interface TokenSource {
	label: string;
	url: string;
	/** Datum, ke kterému zdroj svoje ceny vztahuje. */
	date: string;
}

export interface TokenRates {
	/** Jak se jednotka jmenuje u téhle sítě („tokens", „credits"). */
	unit: string;
	/**
	 * Balíčky, na kterých se shodly **aspoň dva nezávislé zdroje**. Co se
	 * neshodlo, sem nepatří — viz `perTokenRange`.
	 */
	bundles: TokenBundle[];
	/**
	 * Rozpětí ceny za jednotku přes VŠECHNY zdroje, včetně těch, které si
	 * u velkých balíčků protiřečí. Používá se tam, kde ověřené balíčky
	 * nedosáhnou, aby stránka řekla „přibližně tolik" místo falešné přesnosti.
	 */
	perTokenRange: { min: number; max: number };
	/** ISO datum, kdy se zdroje kontrolovaly. */
	checkedOn: string;
	/** Odkud to je. Guard vyžaduje aspoň dva. */
	sources: TokenSource[];
	/** Jednou větou, proč to není z první ruky. Renderuje se na stránce. */
	provenance: string;
}

/**
 * **Jen Chaturbate, a jen to, co prošlo dvěma nezávislými zdroji.**
 *
 * Zjišťováno 20. 8. 2026 v tomhle pořadí: vlastní nákupní stránka (302 na
 * login, i ve skutečném prohlížeči 403 „Just a moment…"), archiv té stránky
 * (Wayback má snapshot z 6. 8. 2026, ale i archiv zachytil jen login), a teprve
 * pak nezávislé výpisy.
 *
 * Shoda existuje **jen u dvou nejmenších balíčků**. Nad 200 tokenů si zdroje
 * protiřečí (500 za $44,99 vs $49,99; 1 000 za $79,99 vs $90,99; DatingScout má
 * navíc jinou žebřinu 400/550) a obě stránky samy uvádějí, že ceny závisí na
 * regionu a promo akcích. **Co se neshodlo, tady není** — místo toho je
 * `perTokenRange`, ze kterého stránka počítá „přibližně".
 */
export const TOKEN_RATES: Partial<Record<NetworkId, TokenRates>> = {
	chaturbate: {
		unit: 'tokens',
		bundles: [
			{ tokens: 100, usd: 10.99 },
			{ tokens: 200, usd: 20.99 },
		],
		// $0,08 (největší balíčky podle NavThemes) až $0,12 (balíček 50 podle
		// DatingScout) — tedy celé rozpětí, které zdroje uvádějí.
		perTokenRange: { min: 0.08, max: 0.12 },
		checkedOn: '2026-08-20',
		sources: [
			{ label: 'DatingScout', url: 'https://www.datingscout.com/chaturbate/cost', date: '2026-07-11' },
			{ label: 'NavThemes', url: 'https://www.navthemes.com/how-much-are-chaturbate-tokens/', date: '2026-07-01' },
			{ label: 'UFO VPN', url: 'https://ufovpn.io/blog/chaturbate-tokens-guide', date: '2025-07-16' },
		],
		provenance: 'Chaturbate does not publish token prices to anyone who is not signed in, '
			+ 'so these come from independent listings rather than from the checkout page. We only '
			+ 'state a bundle price where at least two of them agree; where they disagree — which '
			+ 'is everything above 200 tokens — we give a range instead of a number.',
	},
};

/** Po kolika dnech od `checkedOn` build spadne. */
export const MAX_AGE_DAYS = 90;

/** Kolik tokenů se ukazuje v převodní tabulce. */
export const LADDER = [1, 10, 50, 100, 200, 500, 1000, 2000, 5000];

/**
 * Cena za token z nejlevnějšího a nejdražšího balíčku — jen pro větu „1 token
 * stojí $X až $Y". Do tabulky se **nesmí** použít jako násobek, viz `cheapestFor`.
 */
export function perToken(rates: TokenRates): { min: number; max: number } {
	const prices = repeatable(rates).map((b) => b.usd / b.tokens);
	return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Balíčky, které si můžeš koupit opakovaně.
 *
 * Bonus za první nákup do výpočtu nepatří — spočítat s ním „kolik stojí 5 000
 * tokenů" znamená nabídnout cenu, kterou zaplatíš právě jednou v životě.
 */
function repeatable(rates: TokenRates): TokenBundle[] {
	const plain = rates.bundles.filter((b) => !b.note);
	return plain.length ? plain : rates.bundles;
}

/**
 * **Nejnižší cena, za kterou se dá získat aspoň `want` tokenů** — a kolik jich
 * u toho dostaneš.
 *
 * Proč to není `want × cena za token`: ten násobek je pravdivé číslo a přitom
 * nekoupitelná nabídka. Příklad: při balíčcích 100/$10,99 a 1 000/$79,99 by tabulka
 * u „100 tokenů" ukázala $8,00 (kurz z tisícového balíčku), za což ti nikdo
 * 100 tokenů neprodá. Tady se skládají skutečné balíčky, takže výsledek je
 * cena, kterou opravdu zaplatíš — a u malých množství je vidět, že se přeplácí.
 *
 * Dynamické programování přes opakovatelné balíčky; při ≤ 10 balíčcích
 * a `want` ≤ 5 000 je to desítky tisíc operací při buildu.
 */
export function cheapestFor(rates: TokenRates, want: number): { usd: number; tokens: number } {
	const bundles = repeatable(rates);
	const cap = want + Math.max(...bundles.map((b) => b.tokens));
	const cost = new Float64Array(cap + 1).fill(Infinity);
	const got = new Int32Array(cap + 1);
	cost[0] = 0;
	for (let i = 1; i <= cap; i++) {
		for (const b of bundles) {
			const prev = Math.max(0, i - b.tokens);
			const c = cost[prev] + b.usd;
			if (c < cost[i]) { cost[i] = c; got[i] = got[prev] + b.tokens; }
		}
	}
	// Nejlevnější způsob, jak dosáhnout ASPOŇ `want` — občas je levnější koupit
	// větší balíček než skládat menší.
	let best = { usd: cost[want], tokens: got[want] };
	for (let i = want; i <= cap; i++) {
		if (cost[i] < best.usd) best = { usd: cost[i], tokens: got[i] };
	}
	return { usd: Math.round(best.usd * 100) / 100, tokens: best.tokens };
}

/**
 * Rozpětí pro množství, které ověřené balíčky nekryjí — a **obě hranice něco
 * znamenají**, což je celý smysl:
 *
 *   dolní = nejlepší kurz, jaký kterýkoli zdroj u velkých balíčků uvádí.
 *           Je to „kolik to stojí, pokud jsou ty výpisy správné".
 *   horní = cena, kterou zaplatíš **jistě** — opakovaným nákupem největšího
 *           ověřeného balíčku. Nic dražšího dělat nemusíš.
 *
 * První verze brala jako horní hranici `want × nejdražší kurz`, což u 1 000
 * tokenů dávalo $120 — kurz z balíčku po 50 tokenech, který na tisíc tokenů
 * nikdo nepoužije. Pravdivé, ale zbytečně strašící.
 */
export function approxRange(rates: TokenRates, want: number): { min: number; max: number } {
	const optimistic = want * rates.perTokenRange.min;
	const certain = cheapestFor(rates, want).usd;
	return {
		min: Math.round(Math.min(optimistic, certain) * 100) / 100,
		max: Math.round(certain * 100) / 100,
	};
}

/** Nejdražší reálná cesta: všechno v nejmenším opakovatelném balíčku. */
export function smallestBundlePrice(rates: TokenRates, want: number): { usd: number; tokens: number } {
	const smallest = repeatable(rates).reduce((a, b) => (a.tokens <= b.tokens ? a : b));
	const packs = Math.ceil(want / smallest.tokens);
	return {
		usd: Math.round(packs * smallest.usd * 100) / 100,
		tokens: packs * smallest.tokens,
	};
}
