/**
 * Text na stránku modelky, sestavený VÝHRADNĚ z uložených dat.
 *
 * Proč to existuje: longtail na nicky je jediný změřený zdroj pozic, který
 * tenhle web má. GSC (90 dní): `/live/carolvask/` pozice 1,0, `/live/peliirrojoo/`
 * 1,0, `/live/alaydream/` 1,0, `/live/chanteclingan/` 4,0 (2 kliky). Mechanismus
 * funguje. Jenže stránka měla jen `<dl>` s atributy a citaci `subject`, takže
 * u vyhledávanějších nicků (`azhunastar` 52, `kloee-brown` 55, `chatepoilue` 50)
 * nemá čím konkurovat. Konkurenční uncams.com má na stránce modelky 1 156 slov
 * a její profily nesou 900–2 200 návštěv/měs.
 *
 * PRAVIDLA, která se tu nesmí porušit:
 * 1. **Nic se nevymýšlí.** Každá věta odpovídá konkrétnímu poli. Když pole není,
 *    věta se vynechá — nedoplňuje se domněnkou.
 * 2. **Žádné relativní časy** („3 days ago"). Sync deployuje 12× denně, takže
 *    by se text měnil při každém buildu. Absolutní datum je stabilní.
 * 3. **Žádný `Math.random()`.** Varianta se vybírá deterministicky z `page`,
 *    aby jedna URL neměla při každém buildu jiný text.
 * 4. **Hodiny se hlásí jen z měření, dny v týdnu vůbec.** Do 19. 8. 2026 tu
 *    stálo „nehlásíme hodiny", protože registry držela jen `first`/`last`/`seen`/
 *    `streak`/`peak` a histogram by ji nafoukl. Od 19. 8. je v registry pole
 *    `hours`: 12 dvouhodinových přihrádek v base36, tedy **12 znaků na záznam**
 *    (~1,1 MB na 51 357 záznamů, a jen u těch, které mají stránku). Věta se
 *    napíše až od 7 různých dnů a 12 vzorků — viz `usualHours()` v `data.ts`.
 *    Dny v týdnu pořád nehlásíme: to by byl histogram 7× větší za odpověď,
 *    o kterou se nikdo neptá.
 */
import { countryPhrase, usualHours, PER_MINUTE_NETWORKS, type Model } from './data.ts';
import {
	countryCohort, languageCohort, networkCount, networkShape, peakBand, tagCohort,
} from './catalogue-stats.ts';
import { approx } from './seo.ts';
import { canonicalLanguage } from './taxonomy.ts';

/** Stabilní volba varianty podle slugu — stejná URL má vždy stejný text. */
function pick<T>(seed: string, options: T[]): T {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return options[h % options.length];
}

/** „12 August 2026" — absolutní, tedy stabilní mezi buildy. */
export function longDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-GB', {
		day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
	});
}

const GENDER_NOUN: Record<string, string> = {
	female: 'cam girl', male: 'male cam model', trans: 'trans cam model',
	couple: 'cam couple', group: 'group cam show',
};

/**
 * Zájmeno podle genderu. U párů, skupin a neznámého genderu „they" —
 * a s ním `plural: true`, jinak z textu vypadne „They chats in English".
 */
interface Pron { subj: string; obj: string; poss: string; plural: boolean }

function pronoun(gender: string | null): Pron {
	if (gender === 'female') return { subj: 'she', obj: 'her', poss: 'her', plural: false };
	if (gender === 'male') return { subj: 'he', obj: 'him', poss: 'his', plural: false };
	return { subj: 'they', obj: 'them', poss: 'their', plural: true };
}

/** Sloveso ve správném čísle: v(p, 'chat', 'chats'). */
function v(p: Pron, plural: string, singular: string): string {
	return p.plural ? plural : singular;
}

/**
 * Odstavec „About …". Skládá se z atributů, které o modelce SKUTEČNĚ máme.
 * Etnicitu/postavu hlásí jen 2 ze 7 sítí, takže většina modelek dostane
 * kratší verzi — a to je správně, lepší než vymyšlený detail.
 */
export function aboutParagraphs(m: Model, networkLabel: string, country: string | null): string[] {
	const p = pronoun(m.gender);
	const noun = (m.gender && GENDER_NOUN[m.gender]) || 'cam model';
	const out: string[] = [];

	const age = m.age && m.age >= 18 && m.age <= 80 ? `${m.age}-year-old ` : '';
	// „a 18-year-old" bylo na tisících stránkách. Člen se řídí VÝSLOVNOSTÍ:
	// 8, 11, 18 a osmdesátky začínají samohláskou („an eighteen-year-old").
	const article = /^(8|11|18|8\d)/.test(String(m.age ?? '')) && age ? 'an' : 'a';
	// Region je konkrétnější než země („from Antioquia, Colombia") a je to
	// jediný geografický detail, který v katalogu nemá nikdo jiný. Sám bez země
	// se nepoužije — „from Antioquia" by čtenáři nic neřeklo.
	// Člen patří jen k zemi, která ve větě stojí sama: „from the United Kingdom",
	// ale „from England, United Kingdom" — s krajem před ní člen být nesmí.
	const place = country && m.region
		? `${m.region}, ${country}`
		: country ? countryPhrase(country) : null;
	const from = place ? ` from ${place}` : '';
	out.push(
		pick(m.page, [
			`${m.displayName} is ${article} ${age}${noun}${from} broadcasting on ${networkLabel}.`,
			`${m.displayName} is ${article} ${age}${noun}${from} who ${v(p, 'stream', 'streams')} on ${networkLabel}.`,
		])
	);

	const looks: string[] = [];
	if (m.ethnicity) looks.push(m.ethnicity.toLowerCase());
	if (m.bodyType) looks.push(`${m.bodyType.toLowerCase()} build`);
	if (m.hairColor) looks.push(`${m.hairColor.toLowerCase()} hair`);
	if (m.eyeColor) looks.push(`${m.eyeColor.toLowerCase()} eyes`);
	if (looks.length) {
		out[out.length - 1] +=
			` ${cap(p.subj)} ${v(p, 'list', 'lists')} ${p.poss} appearance as ${andList(looks)}.`;
	}

	const langs = [...new Set(
		m.languages.map((l) => canonicalLanguage(l)).filter(Boolean) as string[]
	)].slice(0, 4).map(cap);
	if (langs.length) {
		out[out.length - 1] +=
			` ${cap(p.subj)} ${v(p, 'chat', 'chats')} in ${andList(langs)}` +
			(m.languages.length > langs.length ? ' among other languages.' : '.');
	}

	// Tagy, které jen opakují atributy z předchozí věty („blond hair", „brown
	// eyes", „caucasian", „english"), do tématu pokoje nepatří — u sítí
	// z CrakRevenue jich `characteristicsTags` nese většinu a věta pak tvrdila,
	// že „se ukazuje pro hnědé oči".
	const said = new Set(
		[m.ethnicity, m.bodyType, m.hairColor, m.eyeColor, ...(m.languages ?? [])]
			.filter(Boolean)
			.flatMap((x) => String(x).toLowerCase().split(/\s+/))
	);
	const topics = m.tags
		.filter((t) => {
			const words = t.toLowerCase().split(/\s+/);
			return !words.every((w) => said.has(w));
		})
		.slice(0, 6);
	if (topics.length) {
		out.push(
			`${cap(p.poss)} room is tagged ${andList(topics)}` +
			`, which is what ${p.subj} ${v(p, 'show', 'shows')} up for most often.`
		);
	}

	// Sloveso musí být v čísle podle genderu — u páru „stream/have", ne „streams/has".
	const extras: string[] = [];
	const has = v(p, 'have', 'has');
	if (m.isHd) extras.push(`${v(p, 'stream', 'streams')} in HD`);
	if (m.toy) extras.push(`${v(p, 'use', 'uses')} an interactive toy that responds to tips`);
	if (m.photos) extras.push(`${has} ${m.photos} photo${m.photos === 1 ? '' : 's'} on ${p.poss} profile`);
	if (m.videos) extras.push(`${has} ${m.videos} recorded video${m.videos === 1 ? '' : 's'}`);
	if (m.followers) extras.push(`${has} ${m.followers.toLocaleString('en-US')} followers on ${networkLabel}`);
	if (extras.length) out.push(`${m.displayName} ${andList(extras)}.`);

	return out;
}

/**
 * Odstavce o historii vysílání. Tohle je jediná část, kterou nemá NIKDO jiný —
 * je to náš vlastní pozorovací záznam, ne přepsaný feed.
 */
export function historyParagraphs(m: Model): string[] {
	const p = pronoun(m.gender);
	const out: string[] = [];

	// Modelka viděná jediný den nemá historii. Přiznat to je lepší než
	// nafukovat text do prázdna.
	if (m.seen <= 1) {
		out.push(
			`${m.displayName} is new to our listings — ${p.subj} first showed up on ` +
			`${longDate(m.first)}, so there is no viewing history to report yet. ` +
			`This page updates every two hours as ${p.subj} ${v(p, 'stream', 'streams')} again.`
		);
		return out;
	}

	const days = `${m.seen} separate day${m.seen === 1 ? '' : 's'}`;
	out.push(
		`We first recorded ${m.displayName} live on ${longDate(m.first)}. ` +
		`Since then ${p.subj} ${v(p, 'have', 'has')} gone online on ${days}, ` +
		`most recently on ${longDate(m.last)}.`
	);

	// Streak platí JEN u online modelky. Na archivní stránce by „is on a 3-day run
	// right now" byla lež — ta modelka právě nevysílá.
	if (m.online && m.streak > 1) {
		out.push(
			`${cap(p.subj)} ${v(p, 'are', 'is')} currently on a ${m.streak}-day run of ` +
			`consecutive broadcasts, counting today.`
		);
	}

	if (m.peak > 0) {
		out.push(
			`The largest audience we have seen in ${p.poss} room at one time is ` +
			`${m.peak.toLocaleString('en-US')} viewer${m.peak === 1 ? '' : 's'}.`
		);
	}

	// Frekvence je poctivější než „usually online at 8pm", kterou z dat nevyčteme.
	const span = daysBetween(m.first, m.last);
	if (span >= 7 && m.seen >= 3) {
		const rate = m.seen / span;
		const how = rate >= 0.7 ? 'almost every day'
			: rate >= 0.4 ? 'most days'
			: rate >= 0.15 ? 'a few times a week'
			: 'now and then';
		out.push(
			`Across the ${span} days since ${p.subj} first appeared here, ` +
			`${p.subj} ${v(p, 'have', 'has')} been live ${how}.`
		);
	}

	// Kdy vysílá. Odpovídá to na dotaz, na který dnes stránka odpověď nemá
	// („when is <nick> online"), a je to údaj, který nemá odkud opsat ani
	// konkurence, ani samotná síť — vzniká jen měřením v čase.
	// `usualHours` mlčí, dokud vzorků není dost, takže žádné „usually" naslepo.
	const when = usualHours(m);
	if (when) {
		out.push(
			`Most of the broadcasts we have logged start between ${clock(when.from)} and ` +
			`${clock(when.to)} UTC — that window covers ${when.share}% of the times we ` +
			`found ${p.obj} online.`
		);
	}

	return out;
}

/** „14:00" — hodina v UTC. Bez minut: přihrádka je dvouhodinová. */
function clock(hour: number): string {
	return `${String(hour).padStart(2, '0')}:00`;
}

/** Má stránka dost dat, aby unesla vlastní text? */
export function hasHistory(m: Model): boolean {
	return m.seen > 1;
}

function daysBetween(a: string, b: string): number {
	const d1 = Date.parse(a + 'T00:00:00Z');
	const d2 = Date.parse(b + 'T00:00:00Z');
	if (Number.isNaN(d1) || Number.isNaN(d2)) return 0;
	return Math.max(1, Math.round((d2 - d1) / 86_400_000) + 1);
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function andList(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ── kontext z našeho měření ─────────────────────────────────────────────────
 *
 * Tohle je ta část, kterou konkurence nemá jak zkopírovat: nejsou to atributy
 * z feedu (ty má každý), ale **poloha modelky v katalogu, který sami měříme**.
 * Kolik pokojů té sítě vedeme, jak velké publikum má proti ostatním, kolik
 * modelek máme z její země a kolik s jejím tématem.
 *
 * Každá věta má práh vzorku a **vynechá se, když data nestačí** (past 29).
 * Čísla jdou přes `approx()`, přihrádky publika jsou hrubé — jinak by se text
 * měnil při každém z dvanácti denních buildů (pravidlo 2 a past 30).
 */
export function contextParagraphs(m: Model, networkLabel: string, countryLabel?: string | null): string[] {
	const p = pronoun(m.gender);
	const out: string[] = [];
	const bits: string[] = [];

	const shape = networkShape(m.network);
	const band = peakBand(m);
	if (shape && band) {
		// Přihrádka se pojmenuje slovem, ne pořadím: „418. největší" by se hýbalo
		// každé dvě hodiny, „mezi horními 10 %" ne.
		const where = band === 'top'
			? `puts ${p.obj} in the top tenth of the ${networkLabel} rooms we log`
			: band === 'above'
				? `is above the median for ${networkLabel} rooms in our index`
				: `is around the median for ${networkLabel} rooms in our index`;
		bits.push(
			`We track ${approx(shape.rooms)} ${networkLabel} rooms, and the biggest audience ` +
			`we have recorded in ${p.poss} room — ${m.peak.toLocaleString('en-US')} viewers — ${where} ` +
			`(the median there is ${shape.median.toLocaleString('en-US')}).`
		);
	} else if (shape) {
		// Sítě bez počtů diváků (LiveJasmin, XLoveCam a čtyři z CrakRevenue,
		// D54) nemají `peak`, takže se o publiku nic netvrdí — jen o velikosti
		// pokrytí, což je pravda, kterou máme.
		bits.push(
			`${networkLabel} is one of ${networkCount()} cam sites we watch, and ` +
			`${approx(shape.rooms)} of its rooms are in our index.`
		);
	}

	const fromCountry = countryCohort(m.country);
	if (fromCountry && countryLabel) {
		bits.push(
			`${cap(p.subj)} ${v(p, 'are', 'is')} one of ${approx(fromCountry)} models we list ` +
			`from ${countryPhrase(countryLabel)}.`
		);
	}

	const topTag = (m.tags ?? [])[0];
	const withTag = tagCohort(topTag);
	if (topTag && withTag) {
		bits.push(
			`${approx(withTag)} rooms in our index carry the same “${topTag}” tag, ` +
			`so it is an easy one to browse sideways from here.`
		);
	}

	// Jazyk se zmíní, jen když není samozřejmost — `languageCohort()` vrací 0
	// u jazyků nad čtvrtinou katalogu (typicky angličtina).
	const lang = (m.languages ?? []).find((l) => languageCohort(l) > 50);
	if (lang) {
		bits.push(
			`${approx(languageCohort(lang))} rooms in our index list ${cap(lang.toLowerCase())}, ` +
			`which is a narrower way in than browsing by site.`
		);
	}

	if (bits.length) out.push(bits.join(' '));
	// Věta „co to stojí" tu BÝVALA taky a s FAQ níž se opakovala dvakrát na
	// jedné stránce. Zůstala jen ve FAQ, kde je na ni položená otázka.
	return out;
}

/* ── otázky, které lidé opravdu píšou ────────────────────────────────────────
 *
 * Tvary dotazů nejsou vymyšlené: 3 141 dotazů z Bing Webmaster Tools za
 * 9 měsíců (25. 8. 2026) vypadá takhle — `{nick} cam` 1 917 impresí,
 * `{nick} webcam` 690, `{nick} chaturbate` 218, `{nick} live cam`, `{nick} nude`.
 * Lidé hledají nick plus jedno slovo a chtějí vědět: vysílá teď, kde, kolik to
 * stojí, odkud je. Tenhle blok na to odpovídá **jen z uložených dat** — otázka,
 * na kterou odpověď nemáme, se vynechá (past 29).
 *
 * Bez JSON-LD `FAQPage` schválně: Google ho od 2023 pro rich results u běžných
 * webů nepoužívá, takže by to na 16 000 stránkách byly jen bajty navíc.
 */
export function faqItems(
	m: Model,
	networkLabel: string,
	countryLabel?: string | null,
	alsoOn: string[] = [],
): Array<{ q: string; a: string }> {
	const p = pronoun(m.gender);
	const out: Array<{ q: string; a: string }> = [];
	const name = m.displayName;

	out.push({
		q: `Is ${name} live right now?`,
		a: pick(m.page, [
			`The badge at the top of this page checks ${networkLabel} the moment you open it.`,
			`Live status on this page is checked against ${networkLabel} when the page loads.`,
			`This page asks ${networkLabel} for ${p.poss} status every time you open it.`,
		]) + ' '
			+ (m.online
				? `At our last sweep on ${longDate(m.last)} ${p.subj} ${v(p, 'were', 'was')} broadcasting.`
				: `${cap(p.subj)} ${v(p, 'were', 'was')} last seen live on ${longDate(m.last)}.`)
			+ ' We re-check every two hours.',
	});

	out.push({
		q: `What cam site is ${name} on?`,
		a: `${cap(p.subj)} ${v(p, 'stream', 'streams')} on ${networkLabel}.`
			+ (alsoOn.length
				? ` We also found the same name on ${andList(alsoOn)} — cam sites do not reserve `
					+ `nicknames across platforms, so treat that as a name match, not proof it is the same person.`
				: ''),
	});

	const perMinute = PER_MINUTE_NETWORKS.has(m.network);
	out.push({
		q: `Is ${name}'s cam show free?`,
		a: perMinute
			? `Not entirely. ${networkLabel} gives you the room and chat for free, but private shows `
				+ `are billed by the minute, so anything explicit costs money.`
			: `The public room is free. ${networkLabel} runs on tips: you can watch and chat without `
				+ `paying, and you only spend if you tip or take ${p.obj} private.`,
	});

	if (m.age) {
		out.push({
			q: `How old is ${name}?`,
			a: `${cap(p.poss)} ${networkLabel} profile lists ${m.age}. That is self-reported — `
				+ `we pass on what the site publishes and do not verify it.`,
		});
	}

	if (countryLabel) {
		out.push({
			q: `Where is ${name} from?`,
			a: `${cap(p.poss)} profile says ${countryPhrase(countryLabel)}`
				+ (m.region ? `, and more precisely ${m.region}` : '')
				+ `. Cam sites let performers set this themselves, so read it as where ${p.subj} `
				+ `${v(p, 'say', 'says')} ${p.subj} ${v(p, 'are', 'is')}, not a verified location.`,
		});
	}

	const langs = [...new Set(
		m.languages.map((l) => canonicalLanguage(l)).filter(Boolean) as string[]
	)].slice(0, 4).map(cap);
	if (langs.length) {
		out.push({
			q: `What languages does ${name} speak in chat?`,
			a: `${cap(p.poss)} profile lists ${andList(langs)}.`,
		});
	}

	const when = usualHours(m);
	if (when) {
		out.push({
			q: `When is ${name} usually online?`,
			a: `From our own log, most broadcasts start between ${clock(when.from)} and `
				+ `${clock(when.to)} UTC — that window covers ${when.share}% of the times we found `
				+ `${p.obj} live. It is a measurement, not a schedule ${p.subj} published.`,
		});
	}

	return out;
}
