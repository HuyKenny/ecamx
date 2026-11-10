/**
 * SEO helpery. Vzor: apps/pokector/app/lib/seo/meta.tsx a apps/vian/src/lib/categorySeo.ts.
 *
 * Starý web měl na všech 26 830 profilech IDENTICKOU meta description (site tagline)
 * a homepage neměla H1. Tady se generuje unikátní popisek z reálných čísel.
 */

// Člen u názvu země („from the Philippines"). Bydlí v taxonomy.ts, protože ten
// modul netahá katalog — seo.ts se importuje i tam, kde 13 MB JSON nesmí být.
import { countryAdjective, countryPhrase } from './taxonomy.ts';
import { META, PER_MINUTE_NETWORKS } from './data.ts';

export const SITE_NAME = 'eCamx';
export const SITE_URL = 'https://ecamx.com';
export const SITE_TAGLINE = 'Watch Free Live Sex Cams & Chat with Real Girls Online';

/**
 * Kanonická URL: bez query stringu, vždy s koncovým lomítkem.
 * Kombinace filtrů nikdy nejsou kanonické — jinak si stránky kanibalizují.
 */
export function canonicalUrl(pathname: string): string {
	const clean = pathname.split('?')[0].split('#')[0];
	const withSlash = clean.endsWith('/') ? clean : clean + '/';
	return new URL(withSlash, SITE_URL).toString();
}

/** Číslo s mezerou jako oddělovačem tisíců (anglická konvence: čárka). */
export function fmt(n: number): string {
	return n.toLocaleString('en-US');
}

/**
 * Počet zaokrouhlený DOLŮ na „hezký" krok, vypsaný jako `290+`.
 *
 * Proč: sync běží každé 2 h a deployuje, takže přesný počet v titulku se měnil
 * 12× denně. Google pak vidí u jedné URL dvanáct různých titulků za den a v SERPu
 * to stejně přepisuje. Zaokrouhlení dolů je pravdivé (`290+` při 297) a mění se
 * jen když inventář opravdu vyroste.
 */
export function approx(n: number): string {
	if (n <= 0) return '0';
	const step = n < 50 ? 10 : n < 200 ? 25 : n < 1000 ? 50 : 100;
	const v = Math.max(step, Math.floor(n / step) * step);
	return `${fmt(v)}+`;
}

export interface PageSeo {
	title: string;
	description: string;
	noindex?: boolean;
}

/**
 * Kolik znaků titulku SERP ukáže, než ho ořízne.
 *
 * Google měří pixely, ne znaky, takže je to přibližné — 65 je běžně užívaný
 * odhad pro desktop. Není to zákaz: delší titulek se netrestá, jen se z něj
 * část nezobrazí. Proto se nezkracuje naslepo, ale volí se kratší varianta,
 * když ta bohatší přeteče.
 */
const TITLE_BUDGET = 65;

/**
 * První varianta, která se vejde do rozpočtu; jinak ta poslední.
 *
 * Nikdy neseká uprostřed slova — místo mrzačení textu se ubere ta část, která
 * nese nejmíň. Poslední varianta jde dovnitř i když je dlouhá: u nicku, který
 * má sám 30 znaků, už není co uříznout a nick je přesně to, na co lidi hledají.
 */
function fitTo(budget: number, variants: string[]): string {
	return variants.find((v) => v.length <= budget) ?? variants[variants.length - 1];
}

const fitTitle = (...variants: string[]) => fitTo(TITLE_BUDGET, variants);

/** Kolik znaků popisku SERP ukáže. Stejně přibližné jako u titulku. */
const DESC_BUDGET = 155;

/**
 * Popisek: úvod + volitelné vsuvky + závěr, ale **nikdy neuseknutý uprostřed**.
 *
 * Změřeno 4. 9. 2026: 46 % popisků bylo nad 160 znaků — a protože se skládají
 * v pořadí „kdo to je · téma pokoje · na co je známá · výzva k akci", ořezával
 * SERP právě tu výzvu na konci. Vsuvky se proto přidávají jen dokud se s
 * závěrem vejdou, a přeskočí se ta, která by rozpočet přetáhla. Úvod a závěr
 * jdou dovnitř vždycky: bez nich by popisek nedával smysl, a delší popisek se
 * netrestá — jen se z něj část nezobrazí. Viz D74.
 */
function fitDescription(lead: string, optional: string[], tail: string): string {
	let out = lead;
	for (const part of optional) {
		if ((out + part + tail).length <= DESC_BUDGET) out += part;
	}
	return out + tail;
}

/**
 * Kategorie: „BBW Cams – 290+ BBW Cam Girls Live Now | eCamx".
 *
 * Slovník je změřený, ne odhadnutý (Ahrefs, US, 17. 8. 2026): větší rodina je
 * `{X} cams` (ebony cams 3 600/měs vs. ebony cam girls 1 100; bbw cams 7 400 vs.
 * bbw cam girls 200), ale obě fráze se do titulku vejdou zároveň. Konkurenční
 * uncams.com/ebony-cams má jako nejsilnější klíč doslova „ebony cam girls".
 *
 * `girls` MUSÍ přijít z dat (podíl žen v kategorii, viz GIRLS_SHARE_MIN).
 * Na `/cams/gay/` nebo na mužské nice by „cam girls" byla lež.
 */
export function categorySeo(label: string, count: number, girls = false): PageSeo {
	const what = girls ? `${label} Cam Girls` : `${label} Models`;
	const low = label.toLowerCase();
	return {
		// Zdvojený štítek („Interactive Vibrator Cams – 500+ Interactive Vibrator
		// Models Live Now") cílí na dvě různé fráze, jak popisuje komentář výš.
		// U dlouhých štítků se ale nevejde: změřeno 4. 9. 2026, 14 % titulků bylo
		// nad 65 znaků a nejdelší měl 79 — a co SERP ořízne, to druhou frázi
		// nepokryje, jen zahodí značku na konci. Nad rozpočtem se proto opakování
		// vypustí; kratší štítky ho mají dál (D74).
		title: fitTitle(
			`${label} Cams – ${approx(count)} ${what} Live Now | ${SITE_NAME}`,
			`${label} Cams – ${approx(count)} Live Now | ${SITE_NAME}`,
		),
		// Popisek opakuje štítek dvakrát až třikrát, což u dlouhých názvů
		// („full private chat for 90 tokens") přeteče na 183 znaků a SERP ořízne
		// právě závěr. Nad rozpočtem se proto opakování vypustí (D74).
		description: fitTo(DESC_BUDGET, [
			`Watch ${approx(count)} live ${low} cams streaming right now. `
				+ (girls ? `Free ${low} cam girls with open chat — ` : `Free chat, no signup — `)
				+ `browse ${low} performers from ${META.networks.length} major cam sites in one place.`,
			`Watch ${approx(count)} live ${low} cams streaming right now. `
				+ `Free chat, no signup — browse performers from ${META.networks.length} major cam sites in one place.`,
		]),
	};
}

/**
 * Země. Dotazy mají tvar „british sex cams" / „colombian cams", takže „Sex Cams"
 * patří do titulku. Poptávka je ale malá (18 geo termů = 830 hledání/měs
 * dohromady), proto sem nepatří velká investice — jen pravdivý titulek.
 */
export function countrySeo(name: string, count: number): PageSeo {
	return {
		// „Cam Models", NE „Cam Girls": u zemí se podíl žen nepočítá, a fráze
		// „cam girls" smí do titulku jen s ověřeným `girls === true` (D23).
		title: `${name} Sex Cams – ${approx(count)} Live ${countryAdjective(name)} Cam Models | ${SITE_NAME}`,
		description: `${approx(count)} live cam models from ${countryPhrase(name)} streaming now. ` +
			`Free chat with ${countryAdjective(name)} performers across Chaturbate, CamSoda, Cam4 and more.`,
	};
}

/**
 * Rozcestník zemí. Vzniká ze stejného důvodu jako `/site/`: drobeček
 * „Countries" na každé stránce země vedl donikam a `/country/` dávalo 404.
 * Geo poptávka je malá (viz `countrySeo`), takže titulek jen říká pravdu.
 */
export function countriesHubSeo(countries: number, models: number): PageSeo {
	return {
		title: fitTitle(
			`Sex Cams by Country – Live Models From ${countries} Countries | ${SITE_NAME}`,
			`Cams by Country – ${countries} Countries Live Now | ${SITE_NAME}`,
		),
		description: `${approx(models)} live cam models sorted by the country they broadcast from. ` +
			`Pick a country and see who is streaming from there right now.`,
	};
}

/**
 * Rozcestník sítí. Cílí sekundárně na „best cam sites" (1 733/měs, KD 43) —
 * je to bonus, ne důvod, proč stránka vzniká: hlavní důvod je, že na
 * `/site/{síť}/` odkazuje 16 830 stránek a rodič **neexistoval**.
 */
export function siteHubSeo(networks: number, models: number): PageSeo {
	return {
		title: `Cam Sites Compared – ${networks} Networks, ${approx(models)} Models Live | ${SITE_NAME}`,
		description: `We track ${networks} cam sites and count what is actually live on each. ` +
			`How many models, who they are, and what each site does and does not tell you.`,
	};
}

/**
 * „sites like chaturbate" 748/měs + „websites like chaturbate" 340 při KD 21,
 * „chaturbate alternatives" 321 při KD 0. Slovo „review" do titulku NESMÍ —
 * to má `/site/{síť}/` a kanibalizovalo by se to.
 */
export function alternativesSeo(label: string, others: number, models: number): PageSeo {
	return {
		title: `${others} Sites Like ${label} – Compared With Live Numbers | ${SITE_NAME}`,
		description: `Real alternatives to ${label}, checked against ${approx(models)} models we see live ` +
			`right now. What each site does differently, who broadcasts there, and what it hides.`,
	};
}

export function networkSeo(label: string, count: number): PageSeo {
	return {
		title: `${label} Review – ${approx(count)} Live Cams & How It Works | ${SITE_NAME}`,
		description: `Is ${label} worth it? ${approx(count)} models live right now. ` +
			`What ${label} costs, how tokens work, and what you get for free.`,
	};
}

/**
 * Profil modelky. Popisek musí být unikátní — proto se skládá z toho, co o ní
 * skutečně víme (síť, země, věk, tagy), ne z generické šablony.
 */
export function profileSeo(o: {
	name: string; network: string; country?: string | null;
	/** ID sítě (ne popisek) — rozhoduje, jestli smí titulek slíbit „free". */
	networkId?: string;
	/** Kraj/město (jen Chaturbate). Dělá popisek konkrétnějším a unikátnějším. */
	region?: string | null;
	age?: number | null; tags: string[];
	/** Offline modelka potřebuje jiný slib — jinak titulek lže. */
	online?: boolean;
	/** ISO datum posledního vysílání (jen offline). */
	lastSeen?: string;
	/** Téma pokoje z feedu. Nejsilnější věc, kterou v popisku máme. */
	subject?: string | null;
	/**
	 * Stránka postavená jen z nicku a sítě (viz `legacy-pages.ts`). Popisek pak
	 * nesmí slibovat „when she was last live" — datum posledního vysílání
	 * u takové stránky neznáme a nikde ho neukazujeme.
	 */
	archived?: boolean;
	/** Skupina A/B testu titulku offline stránky (`titleVariant`, D80). */
	variant?: 'a' | 'b';
}): PageSeo {
	const bits: string[] = [];
	if (o.age) bits.push(`${o.age} years old`);
	if (o.country) {
		// Člen jen u samostatné země, viz model-copy.ts.
		bits.push(o.region ? `from ${o.region}, ${o.country}` : `from ${countryPhrase(o.country)}`);
	}
	const who = bits.length ? ` — ${bits.join(', ')}` : '';
	const topics = o.tags.slice(0, 4).join(', ');
	// Téma pokoje bývá plné hashtagů a emoji; do popisku patří jen čitelný zbytek.
	const subject = (o.subject ?? '')
		.replace(/#\S+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 90);

	if (o.online === false) {
		return {
			// „Webcam" i „Cam" schválně obojí: GSC měří `<nick> cam` (197 impresí)
			// i `<nick> webcam` (133) jako nejčastější tvary dotazu na nick.
			//
			// **A/B test od 28. 9. 2026 (D80).** Nejčastější tvar dotazu na Bingu je
			// „`<nick>` live cam" (kotogal live cam: 226 impresí, nejvíc ze všech),
			// a varianta A tu frázi v celku nemá. B ji dává dopředu a „Webcam"
			// nechává za sítí, takže pokrývá `cam`, `live cam` i `webcam`. Není to
			// slib, že vysílá — „live cam" je jméno té věci, ne stav. Vyhodnocuje
			// `~/ai/scripts/ecamx/title-test.py` (rozdíl v rozdílech proti A).
			title: o.variant === 'b'
				? fitTitle(
					`${o.name} Live Cam – ${o.network} Webcam Profile & Schedule | ${SITE_NAME}`,
					`${o.name} Live Cam – ${o.network} Webcam Profile | ${SITE_NAME}`,
					`${o.name} Live Cam – ${o.network} | ${SITE_NAME}`,
				)
				: fitTitle(
					`${o.name} Webcam – ${o.network} Cam Profile & Live Schedule | ${SITE_NAME}`,
					`${o.name} Webcam – ${o.network} Cam Profile | ${SITE_NAME}`,
				),
			// Popisek NEZAČÍNÁ „is offline right now": na to nikdo neklikne.
			// Vede tím, co hledající chce — profil, obvyklé časy, kdo jede teď.
			description: fitDescription(
				`${o.name}${who ? who.replace(' — ', ' (') + ')' : ''} on ${o.network}. `,
				[topics ? `Known for ${topics}. ` : ''],
				o.archived
					? `Open ${o.name}'s room on ${o.network} — and see which cams are online right now.`
					: `See ${o.name}'s cam profile, when she was last live and which cams are online now.`,
			),
		};
	}
	// **Slovo „Free" smí jen tam, kde je veřejná show opravdu zdarma.**
	// LiveJasmin, XLoveCam, Streamate a ImLive účtují show po minutě a volný je
	// jen náhled — slibovat u nich „free webcam show, no signup" je lež, kterou
	// návštěvník odhalí na první kliknutí. (Do 25. 8. to tak stálo na všech
	// stránkách včetně premiových; s Streamate a ImLive by se to týkalo dalších
	// 1 100 URL.) Freemium sítě to mají dál, protože u nich to platí.
	const freemium = !PER_MINUTE_NETWORKS.has(o.networkId ?? '');
	return {
		// „Live Sex Cam" táhne i z `live sex cams` (28 000/měs, KD 0) — a je to
		// pravda, ne keyword stuffing: je to živý přenos.
		// Žebřík: u dlouhého nicku se nejdřív obětuje „Free" (u freemium sítí),
		// pak „Webcam Show". „Live Sex Cam" a nick zůstávají vždycky — nick je
		// dotaz a „live sex cams" má 28 000 hledání/měs. Změřeno 4. 9.: bez
		// žebříku bylo 8 % titulků modelek nad 65 znaků, nejdelší 80 (D74).
		title: freemium
			? fitTitle(
				`${o.name} Live Sex Cam – Free ${o.network} Webcam Show | ${SITE_NAME}`,
				`${o.name} Live Sex Cam – ${o.network} Webcam Show | ${SITE_NAME}`,
				`${o.name} Live Sex Cam – ${o.network} | ${SITE_NAME}`,
			)
			: fitTitle(
				`${o.name} Live Sex Cam – ${o.network} Webcam Show | ${SITE_NAME}`,
				`${o.name} Live Sex Cam – ${o.network} | ${SITE_NAME}`,
			),
		description: fitDescription(
			`${o.name} is live on ${o.network} right now${who}. `,
			[subject ? `“${subject}”. ` : '', topics ? `Known for ${topics}. ` : ''],
			freemium
				? `Free webcam show, no signup.`
				: `Free preview; private shows are billed by the minute.`,
		),
	};
}

/**
 * Gender stránky. `/girls/` je jediné místo, kde je fráze „cam girls" úplně
 * pravdivá, takže tam patří na začátek titulku — je to head term (20 000/měs).
 * `/trans/` (4 500/měs) a `/couples/` (3 200/měs) mají vlastní silné dotazy,
 * proto se i u nich hledaná fráze dává dopředu, ne za slovo „Live".
 */
export function genderSeo(label: string, count: number): PageSeo {
	const isGirls = label.toLowerCase() === 'girl';
	const head = isGirls ? 'Cam Girls' : `${label} Cams`;
	const tail = isGirls ? 'Live Girls Streaming Right Now' : `Live ${label} Models Streaming Now`;
	const who = isGirls ? 'cam girls' : `${label.toLowerCase()} cam models`;
	return {
		title: `${head} – ${approx(count)} ${tail} | ${SITE_NAME}`,
		// Počet sítí se bere z dat, ne z prstu: od 25. 8. je jich jedenáct a
		// „across 7 cam sites" na čtyřech gender stránkách bylo prostě nepravda.
		description: `${approx(count)} ${who} live right now across ${META.networks.length} cam sites. ` +
			`Free chat, no registration, and every stream opens on one page.`,
	};
}
