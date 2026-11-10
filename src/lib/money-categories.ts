/**
 * Kurátorská vrstva „money" kategorií — ruční seznam podle ZMĚŘENÉ poptávky.
 *
 * Proč existuje: automatická taxonomie se staví z tagů, které si nastavují
 * performerky, takže je to slovník performerek, ne hledajících. Měřeno 17. 8. 2026
 * (Ahrefs, US): 15 největších kategorií webu = ~13 000 modelek a dohromady jen
 * 2 910 hledání/měs (lovense 1 717 modelek → 100 hledání, dancing 1 084 → 10,
 * games 885 → 0). Naopak `bbw cams` má 7 400 hledání/měs při KD 24 a stránku
 * NEMĚLO, protože `bbw` je v `NOT_A_CATEGORY` jako body type — jenže bodyType
 * hlásí jen 2 ze 7 sítí (379 z 8 082 modelek), takže term propadl oběma síty.
 *
 * Členství se proto skládá z UNIE signálů: tagy (nejbohatší — 181 modelek má
 * tag `bbw`) + strukturovaná pole + gender + věková skupina. Tagy se porovnávají
 * přes `slugifyTerm`, NE `canonicalTerm`, protože `CANONICAL` by `latina` složil
 * do `latin` a `arab` do `middle-eastern` — tady chceme varianty řídit sami.
 *
 * PRÁH 50 živých modelek se tu neuplatňuje (nika s velkou poptávkou nemá 50
 * modelek online v každém okamžiku), ale MINIMUM obsahu ano — viz MIN_MEMBERS.
 * Bez něj bychom vyrobili tenké stránky, a přesně to zabilo starý web.
 */
import { slugifyTerm, ageBucket } from './taxonomy.ts';

export interface MoneyRule {
	/** Varianty tagů, jak je posílají feedy (porovnává se slugifyTerm). */
	tags?: string[];
	ethnicity?: string[];
	bodyType?: string[];
	hairColor?: string[];
	gender?: string[];
	/** Věkové skupiny podle `ageBucket()`. */
	ageBucket?: string[];
}

export interface MoneyCategory {
	slug: string;
	/** Popisek ve slovníku hledajících, ne feedu. */
	label: string;
	/** Změřená poptávka (US/měs, Ahrefs 17. 8. 2026) — podklad pro ladění, ne logika. */
	demand: { volume: number; kd: number };
	rule: MoneyRule;
	/** Ověřený intent SERPu. `false` = termín znamená něco jiného, nevyrábět. */
	intentOk?: boolean;
	note?: string;
}

/**
 * Minimální počet modelek (živé + archiv), aby kurátorská kategorie dostala URL.
 * Pod tím se stránka nevyrobí — raději žádná stránka než thin content.
 */
export const MIN_MEMBERS = 20;

/**
 * Minimum ŽIVÝCH modelek. Mřížka totiž offline karty skrývá (D14), takže
 * kategorie s 20 modelkami v archivu a nulou online by se návštěvníkovi
 * ukázala prázdná. `MIN_MEMBERS` sám nestačí.
 */
export const MIN_LIVE = 10;

/**
 * Nika, u které je „cam girls" v titulku pravdivé, musí být převážně ženská.
 * Počítá se z dat při syncu, netipuje se.
 */
export const GIRLS_SHARE_MIN = 0.8;

export const MONEY_CATEGORIES: MoneyCategory[] = [
	// ── velká poptávka, kterou web vůbec nepokrýval ────────────────────────────
	{
		slug: 'bbw', label: 'BBW', demand: { volume: 7400, kd: 24 },
		note: 'Nejcennější jediná stránka, kterou web neměl. SERP ověřen: #1 bbwcamhouse.com má DR 0, #5 bbwchat.com DR 3 — žádná velká platforma to nedrží.',
		rule: {
			tags: ['bbw', 'chubby', 'fat', 'plus-size', 'plussize', 'thick', 'curvy-bbw', 'big-beautiful-woman'],
			bodyType: ['bbw', 'chunky', 'plus-size'],
		},
	},
	{
		slug: 'granny', label: 'Granny', demand: { volume: 300, kd: 0 },
		rule: { tags: ['granny', 'gilf', 'grandma', 'grandmother'] },
	},
	{
		slug: 'pregnant', label: 'Pregnant', demand: { volume: 1200, kd: 42 },
		rule: { tags: ['pregnant', 'preggo', 'pregnancy'] },
	},
	{
		slug: 'indian', label: 'Indian', demand: { volume: 90, kd: 0 },
		rule: { tags: ['indian', 'desi', 'hindi'], ethnicity: ['indian'] },
	},
	{
		slug: 'arab', label: 'Arab', demand: { volume: 200, kd: 5 },
		note: '`CANONICAL` skládá arab → middle-eastern, ale ten term nemá dost modelek na stránku. Tady se matchuje surový tag.',
		rule: { tags: ['arab', 'arabic', 'middle-eastern', 'middle_eastern'], ethnicity: ['middle-eastern'] },
	},
	{
		slug: 'japanese', label: 'Japanese', demand: { volume: 70, kd: 52 },
		rule: { tags: ['japanese', 'japan', 'nippon'] },
	},
	{
		slug: 'filipina', label: 'Filipina', demand: { volume: 70, kd: 8 },
		note: 'Sloučeno s `pinay` (83 modelek) — je to totéž a dvě URL by si kanibalizovaly.',
		rule: { tags: ['filipina', 'pinay', 'filipino', 'philippines'] },
	},
	{
		slug: 'gay', label: 'Gay', demand: { volume: 3000, kd: 67 },
		note: 'Mužská nika — „cam girls" se do titulku nesmí. /guys/ je gender stránka, tahle míří na jiný dotaz.',
		rule: { tags: ['gay', 'gay-men', 'homosexual'] },
	},

	// ── existující kategorie, kterým chybí členství z tagů ─────────────────────
	{
		slug: 'ebony', label: 'Ebony', demand: { volume: 3600, kd: 0 },
		note: 'Etnicitu hlásí 2 ze 7 sítí (11 modelek), tag `ebony` má 316. SERP zaspamovaný (#1 má DR 0, dál hacknutá .edu) → reálná příležitost.',
		rule: { tags: ['ebony', 'black', 'african', 'dark-skin'], ethnicity: ['ebony'] },
	},
	{
		slug: 'asian', label: 'Asian', demand: { volume: 2200, kd: 50 },
		rule: { tags: ['asian', 'oriental'], ethnicity: ['asian'] },
	},
	{
		slug: 'latin', label: 'Latina', demand: { volume: 2000, kd: 55 },
		note: 'Slug zůstává `latin` (kanonická etnicita), popisek i titulek říkají „Latina" — tak to lidi hledají. Tag `latina` má 522 modelek, etnicita jen 275.',
		rule: { tags: ['latina', 'latin', 'hispanic', 'latino', 'latino-hispanic'], ethnicity: ['latin'] },
	},
	{
		slug: 'mature', label: 'Mature', demand: { volume: 1700, kd: 13 },
		rule: { tags: ['mature', 'older', 'cougar'] },
	},
	{
		slug: 'milf', label: 'MILF', demand: { volume: 7800, kd: 68 },
		rule: { tags: ['milf', 'mom', 'mommy'] },
	},
	{
		slug: 'feet', label: 'Feet', demand: { volume: 1400, kd: 4 },
		rule: { tags: ['feet', 'feets', 'foot', 'foot-fetish', 'footfetish', 'soles', 'toes'] },
	},
	{
		slug: 'teen', label: 'Teen', demand: { volume: 1100, kd: 0 },
		note: 'Jen 18+ — věková skupina 18-21. Nic mladšího v datech neexistuje (ageBucket vrací null pod 18).',
		rule: { tags: ['teen', 'teen-18', '18-plus-girls', 'teens'], ageBucket: ['18-21'] },
	},
	{
		slug: 'lesbian', label: 'Lesbian', demand: { volume: 500, kd: 20 },
		rule: { tags: ['lesbian', 'lesbians', 'girl-on-girl', 'girlongirl'] },
	},
	{
		slug: 'smoking', label: 'Smoking', demand: { volume: 500, kd: 0 },
		rule: { tags: ['smoking', 'smoke', 'cigarette'] },
	},
	{
		slug: 'redhead', label: 'Redhead', demand: { volume: 150, kd: 0 },
		rule: { tags: ['redhead', 'ginger', 'red-hair'], hairColor: ['redhead', 'auburn', 'red'] },
	},
	{
		slug: 'curvy', label: 'Curvy', demand: { volume: 10, kd: 1 },
		rule: { tags: ['curvy', 'curves'], bodyType: ['curvy'] },
	},
	{
		slug: 'petite', label: 'Petite', demand: { volume: 40, kd: 12 },
		rule: { tags: ['petite', 'small', 'tiny'], bodyType: ['petite'] },
	},
	{
		slug: 'hairy', label: 'Hairy', demand: { volume: 50, kd: 16 },
		rule: { tags: ['hairy', 'hairy-pussy', 'unshaved', 'bush'] },
	},
	{
		slug: 'bigass', label: 'Big Ass', demand: { volume: 600, kd: 46 },
		rule: { tags: ['bigass', 'big-ass', 'big-ass-babe', 'bigasses', 'booty', 'phat-ass'] },
	},
	{
		slug: 'big-tits', label: 'Big Tits', demand: { volume: 500, kd: 55 },
		note: 'Sync tenhle slug počítal na 1 103, ale render jich našel 244 — 878 modelek má tag `bigboobs`/`bigtits`. Opraveno sdílenou kanonizací, tady je to navíc explicitní.',
		rule: { tags: ['big-tits', 'bigtits', 'bigboobs', 'big-boobs', 'busty', 'huge-tits'] },
	},
	{
		slug: 'anal', label: 'Anal', demand: { volume: 1300, kd: 50 },
		rule: { tags: ['anal', 'anal-sex', 'anal-play', 'anal-toys', 'assfuck'] },
	},
	{
		slug: 'bdsm', label: 'BDSM', demand: { volume: 500, kd: 48 },
		rule: { tags: ['bdsm', 'bondage', 'domination', 'submissive', 'fetish', 'sub', 'dom'] },
	},

	// ── ověřeno jako ŠPATNÝ intent, stránku nevyrábět ─────────────────────────
	{
		slug: 'squirt', label: 'Squirt', demand: { volume: 2000, kd: 12 }, intentOk: false,
		note: 'PAST: SERP na „squirt cams" je o SKUTEČNÝCH kamerách — dronový web shendrones.com/squirt-v2, akvárium cmaquarium.org/webcams/, Amazon „Squirt Fountain webcam". Naše největší kategorie (1 691 modelek) míří na cizí intent. Stránka zůstává z automatické taxonomie, ale text a titulek na tenhle termín NEcílit.',
		rule: { tags: ['squirt', 'squirting'] },
	},
];

/** Jen ty, u kterých má cenu o termín soupeřit. */
export const MONEY_TARGETS = MONEY_CATEGORIES.filter((c) => c.intentOk !== false);

export const MONEY_BY_SLUG = new Map(MONEY_CATEGORIES.map((c) => [c.slug, c]));

/** Model má dost polí, aby se dal otestovat proti pravidlu. */
export interface MoneyCandidate {
	tags: string[];
	ethnicity: string | null;
	hairColor: string | null;
	bodyType: string | null;
	gender: string | null;
	age: number | null;
}

const has = (list: string[] | undefined, value: string | null): boolean => {
	if (!list || !list.length || !value) return false;
	const s = slugifyTerm(value);
	return !!s && list.includes(s);
};

/** Patří modelka do kurátorské kategorie? Unie signálů — stačí jeden. */
export function matchesMoney(m: MoneyCandidate, rule: MoneyRule): boolean {
	if (rule.tags?.length) {
		for (const t of m.tags) {
			const s = slugifyTerm(t);
			if (s && rule.tags.includes(s)) return true;
		}
	}
	if (has(rule.ethnicity, m.ethnicity)) return true;
	if (has(rule.hairColor, m.hairColor)) return true;
	if (has(rule.bodyType, m.bodyType)) return true;
	if (rule.gender?.length && m.gender && rule.gender.includes(m.gender)) return true;
	if (rule.ageBucket?.length) {
		const b = ageBucket(m.age);
		if (b && rule.ageBucket.includes(b)) return true;
	}
	return false;
}
