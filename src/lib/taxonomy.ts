/**
 * Kanonizace termů — JEDINÝ zdroj pravdy pro sync i pro renderování stránek.
 *
 * Proč to je tady a ne ve `scripts/`: importuje si to `src/lib/data.ts` (běží
 * při buildu stránek) i `scripts/taxonomy-cleanup.ts` (běží v syncu). Dřív
 * existovaly DVĚ divergentní kopie `canonicalTerm()` a ta v `data.ts`
 * neaplikovala `CANONICAL`. Důsledek byl měřitelný: `/cams/big-tits/` mělo
 * v titulku 1 103 modelek, ale stránka jich našla 244 — zbylých 878 má tag
 * `bigboobs` (709) nebo `bigtits` (169), který sync sloučil a render ne.
 * Stejně tak `/cams/bigass/` 1 107 vs. 786. NIKDY tuhle funkci neduplikovat.
 */

/**
 * Termy, které jsou technický artefakt API, ne uživatelský pojem.
 * Cam4 posílá `…|niche.NNN.name`; když se to slugifikovalo celé, vznikly stovky
 * termů typu `analniche-34-name`. Filtrujeme i zpětně, kdyby něco proteklo.
 */
export const NICHE_ARTIFACT = /niche[.\-]?\d+[.\-]?name$/i;

/** Čistý šum — zkratky, předložky a nesmysly, které se do tagů dostaly z feedů. */
export const JUNK = new Set([
	'no', 'and', 'ymas', 'jogos', 'bastardos', 'nouso', 'eeuu', 'conttolush',
	'vertical', 'na', 'null', 'none', 'other', 'various', 'general',
	'cam4bday19', 'full-private-chat-for-60-89-tokens',
	// LiveJasmin posílá `snapshot` jako „willingness" u 374 modelek — je to
	// technický údaj o tom, že umí snímek, ne kategorie, kterou by někdo hledal.
	'snapshot',
]);

/**
 * Slučování duplicit. Vlevo varianty, které feedy posílají, vpravo kanonický tvar.
 * Bez tohohle má web zvlášť `bigass`, `big-ass` i `big-ass-babe` — tři stránky
 * o tomtéž, které si navzájem kanibalizují.
 */
export const CANONICAL: Record<string, string> = {
	// kategorie
	'big-ass': 'bigass', 'big-ass-babe': 'bigass', 'bigasses': 'bigass',
	'tattoo': 'tattoos', 'tatoo': 'tattoos', 'tatoos': 'tattoos',
	'blondes': 'blonde', 'blondie': 'blonde',
	'brunettes': 'brunette',
	'bigtits': 'big-tits', 'bigboobs': 'big-tits', 'big-boobs': 'big-tits',
	'hd+': 'hd', 'hd-plus': 'hd',
	'squirting': 'squirt',
	'toy': 'toys',
	'feets': 'feet',
	// etnicita
	'white': 'white-caucasian', 'caucasian': 'white-caucasian',
	'latino-hispanic': 'latin', 'latina': 'latin', 'hispanic': 'latin',
	'middle_eastern': 'middle-eastern', 'arab': 'middle-eastern',
	'native_american': 'native-american',
	// barva očí
	'grey': 'gray',
	// gender
	'man': 'male', 'guy': 'male', 'men': 'male',
	'woman': 'female', 'girl': 'female', 'girls': 'female',
	'transsexual': 'trans', 'shemale': 'trans', 'tranny': 'trans',
	'couples': 'couple',
};

/** Slugifikace bez slučování — společný základ pro termy i pro jiné taxonomie. */
export function slugifyTerm(raw: string): string | null {
	let s = String(raw ?? '').trim().toLowerCase();
	if (!s) return null;
	// percent-encoded (cyrilice z Chaturbate) → dekódovat
	if (s.includes('%')) {
		try { s = decodeURIComponent(s); } catch { /* ponech jak je */ }
	}
	s = s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!s || s.length < 2 || s.length > 40) return null;
	return s;
}

/** Normalizace jednoho tagu/termu na kanonický slug, nebo null když se má zahodit. */
export function canonicalTerm(raw: string): string | null {
	const s = slugifyTerm(raw);
	if (!s) return null;
	if (NICHE_ARTIFACT.test(s)) return null;
	if (JUNK.has(s)) return null;
	if (/^\d+$/.test(s)) return null; // holá čísla nejsou kategorie
	return CANONICAL[s] ?? s;
}

/** Věk → skupina. 103 samostatných věkových URL nedává smysl, 4 skupiny ano. */
export function ageBucket(age: number | null): string | null {
	if (age == null || age < 18 || age > 80) return null; // 99 je junk hodnota z feedu
	if (age <= 21) return '18-21';
	if (age <= 25) return '22-25';
	if (age <= 30) return '26-30';
	return '30-plus';
}

export const AGE_BUCKETS = ['18-21', '22-25', '26-30', '30-plus'] as const;

/**
 * Země → ISO-3166-1 alpha-2.
 *
 * Nutné kvůli BongaCams: jeho `homecountry` je VOLNÝ TEXT, který si píše sama
 * performerka. Ze 646 modelek má 613 jméno místo kódu a je tam 183 různých
 * hodnot — anglické názvy, cyrilice („Россия"), vtipy („Бонгания" = Bongania,
 * „Вебкамия" = Webcamia), „Europe" i vycenzurovaný „*********k".
 *
 * Bez normalizace z toho vznikly DVĚ stránky pro jednu zemi: `/country/co/`
 * (1 385 modelek) i `/country/colombia/` (151), a protože `COUNTRY_NAMES` klíč
 * `colombia` nemá, druhá měla v titulku i v H1 „COLOMBIA Cams".
 *
 * Co se nerozpozná, se ZAHODÍ — junk stránka je horší než chybějící údaj.
 */
export const COUNTRY_ALIASES: Record<string, string> = {
	// anglické názvy
	colombia: 'co', kenya: 'ke', russia: 'ru', 'russian-federation': 'ru',
	ukraine: 'ua', poland: 'pl', latvia: 'lv', philippines: 'ph',
	madagascar: 'mg', romania: 'ro', france: 'fr', serbia: 'rs',
	germany: 'de', spain: 'es', bulgaria: 'bg', 'united-kingdom': 'gb',
	'great-britain': 'gb', england: 'gb', uk: 'gb', usa: 'us', 'united-states': 'us',
	'united-states-of-america': 'us', italy: 'it', netherlands: 'nl',
	brazil: 'br', venezuela: 've', argentina: 'ar', chile: 'cl',
	mexico: 'mx', peru: 'pe', ecuador: 'ec', 'dominican-republic': 'do',
	canada: 'ca', australia: 'au', india: 'in', 'south-africa': 'za',
	nigeria: 'ng', ghana: 'gh', japan: 'jp', china: 'cn', taiwan: 'tw',
	thailand: 'th', vietnam: 'vn', indonesia: 'id', malaysia: 'my',
	turkey: 'tr', greece: 'gr', portugal: 'pt', belgium: 'be',
	switzerland: 'ch', austria: 'at', sweden: 'se', norway: 'no',
	denmark: 'dk', finland: 'fi', ireland: 'ie', czechia: 'cz',
	'czech-republic': 'cz', slovakia: 'sk', hungary: 'hu', croatia: 'hr',
	slovenia: 'si', lithuania: 'lt', estonia: 'ee', belarus: 'by',
	moldova: 'md', georgia: 'ge', armenia: 'am', kazakhstan: 'kz',
	israel: 'il', egypt: 'eg', morocco: 'ma', kyrgyzstan: 'kg',
	uzbekistan: 'uz', 'puerto-rico': 'pr', cuba: 'cu', bolivia: 'bo',
	paraguay: 'py', uruguay: 'uy', 'costa-rica': 'cr', panama: 'pa',
	// Doplněno 19. 8. 2026 z pole `location` Chaturbate feedu — tam si zemi
	// píše modelka sama, takže jsou tam členy („The Netherlands", 56×),
	// zkratky („Czech", 10×) i překlepy („Bulgary"). Bez těchhle klíčů
	// zůstalo 2 561 modelek bez země, i když ji ve skutečnosti uvedly.
	'the-netherlands': 'nl', holland: 'nl', czech: 'cz', 'the-poland': 'pl',
	bulgary: 'bg', uganda: 'ug', tanzania: 'tz', zambia: 'zm',
	zimbabwe: 'zw', cameroon: 'cm', 'ivory-coast': 'ci', senegal: 'sn',
	ethiopia: 'et', tunisia: 'tn', algeria: 'dz', 'south-korea': 'kr',
	korea: 'kr', 'hong-kong': 'hk', singapore: 'sg', 'new-zealand': 'nz',
	philipines: 'ph', pilipinas: 'ph', cyprus: 'cy', monaco: 'mc',
	montenegro: 'me', albania: 'al', macedonia: 'mk', 'north-macedonia': 'mk',
	'bosnia-and-herzegovina': 'ba', bosnia: 'ba', iceland: 'is',
	luxembourg: 'lu', malta: 'mt', pakistan: 'pk', bangladesh: 'bd',
	'sri-lanka': 'lk', nepal: 'np', iran: 'ir', iraq: 'iq', lebanon: 'lb',
	jordan: 'jo', 'saudi-arabia': 'sa', 'united-arab-emirates': 'ae',
	azerbaijan: 'az', mongolia: 'mn', 'trinidad-and-tobago': 'tt',
	jamaica: 'jm', honduras: 'hn', guatemala: 'gt', nicaragua: 'ni',
	'el-salvador': 'sv', haiti: 'ht',
	// cyrilice (BongaCams)
	'россия': 'ru', 'украина': 'ua', 'германия': 'de', 'беларусь': 'by',
	'казахстан': 'kz', 'латвия': 'lv', 'молдова': 'md', 'польша': 'pl',
	// ISO3, které feedy občas pošlou
	rus: 'ru', ukr: 'ua', col: 'co', ken: 'ke', deu: 'de', fra: 'fr',
	esp: 'es', ita: 'it', gbr: 'gb', pol: 'pl', rou: 'ro', phl: 'ph',
	mdg: 'mg', lva: 'lv', srb: 'rs', bra: 'br', can: 'ca', aus: 'au',
	ind: 'in', zaf: 'za', jpn: 'jp', chn: 'cn', usa3: 'us',
};

/**
 * Země na ISO-2 slug, nebo null když to zemi nepřipomíná.
 * Vrací jen dvouznakové kódy, takže z toho nikdy nevznikne `/country/europe/`.
 */
export function canonicalCountry(raw: string | null | undefined): string | null {
	if (!raw) return null;
	// Cyrilici musíme hledat PŘED slugifikací — ta nechává jen [a-z0-9],
	// takže „Россия" by se scvrklo na prázdný řetězec.
	const bare = String(raw).trim().toLowerCase();
	if (COUNTRY_ALIASES[bare]) return COUNTRY_ALIASES[bare];
	const s = slugifyTerm(bare);
	if (!s) return null;
	const mapped = COUNTRY_ALIASES[s] ?? s;
	return /^[a-z]{2}$/.test(mapped) ? mapped : null;
}

/**
 * Země, které v anglické větě potřebují člen: „cams from **the** Philippines".
 * Bez tohohle stálo na tisících stránkách „from United Kingdom" a stránka zní
 * jako stroj — což je poslední dojem, který chceme dělat na textu, kterým se
 * odlišujeme.
 */
const COUNTRY_THE = new Set([
	'United States', 'United Kingdom', 'Netherlands', 'Philippines',
	'Czech Republic', 'Dominican Republic', 'United Arab Emirates',
]);

/** Název země tak, jak se dá vložit do věty („the Philippines", „Colombia"). */
export function countryPhrase(name: string): string {
	return COUNTRY_THE.has(name) ? `the ${name}` : name;
}

/**
 * Přídavné jméno k zemi — „Colombian cam girls", ne „Colombia cam models".
 *
 * Není to kosmetika: dotazy na geo mají tvar **přídavného jména**
 * („british sex cams", „colombian cams", „filipina cams"), takže titulek
 * s podstatným jménem míjí tvar, který lidé opravdu píšou. Co v mapě není,
 * se vrací nezměněné — vymyšlené „Estoniaian" by bylo horší než „Estonia".
 */
const COUNTRY_ADJECTIVE: Record<string, string> = {
	Colombia: 'Colombian', 'United States': 'American', Philippines: 'Filipina',
	France: 'French', Ukraine: 'Ukrainian', Germany: 'German', Kenya: 'Kenyan',
	Romania: 'Romanian', Spain: 'Spanish', Madagascar: 'Malagasy',
	'United Kingdom': 'British', Italy: 'Italian', Argentina: 'Argentinian',
	Brazil: 'Brazilian', Russia: 'Russian', Canada: 'Canadian', Poland: 'Polish',
	Venezuela: 'Venezuelan', Chile: 'Chilean', Mexico: 'Mexican', Netherlands: 'Dutch',
	India: 'Indian', 'South Africa': 'South African', Australia: 'Australian',
	Taiwan: 'Taiwanese', Czechia: 'Czech', Hungary: 'Hungarian', Portugal: 'Portuguese',
	Latvia: 'Latvian', Estonia: 'Estonian', Lithuania: 'Lithuanian', Serbia: 'Serbian',
	Belgium: 'Belgian', Finland: 'Finnish', Sweden: 'Swedish', Norway: 'Norwegian',
	Denmark: 'Danish', Ireland: 'Irish', Switzerland: 'Swiss', Austria: 'Austrian',
	Greece: 'Greek', Bulgaria: 'Bulgarian', Croatia: 'Croatian', Slovenia: 'Slovenian',
	Slovakia: 'Slovak', Belarus: 'Belarusian', Moldova: 'Moldovan', Georgia: 'Georgian',
	Armenia: 'Armenian', Kazakhstan: 'Kazakh', Turkey: 'Turkish', Israel: 'Israeli',
	Japan: 'Japanese', China: 'Chinese', 'South Korea': 'Korean', Thailand: 'Thai',
	Vietnam: 'Vietnamese', Indonesia: 'Indonesian', Malaysia: 'Malaysian',
	'New Zealand': 'New Zealand', Peru: 'Peruvian', Ecuador: 'Ecuadorian',
	Bolivia: 'Bolivian', Paraguay: 'Paraguayan', Uruguay: 'Uruguayan',
	'Costa Rica': 'Costa Rican', Panama: 'Panamanian', Cuba: 'Cuban',
	Jamaica: 'Jamaican', Nigeria: 'Nigerian', Ghana: 'Ghanaian', Uganda: 'Ugandan',
	Egypt: 'Egyptian', Morocco: 'Moroccan', Pakistan: 'Pakistani',
	Bangladesh: 'Bangladeshi', Iran: 'Iranian',
};

export function countryAdjective(name: string): string {
	return COUNTRY_ADJECTIVE[name] ?? name;
}

/**
 * Jazyky, které smí vzniknout. **Whitelist, ne blacklist** — a je to oprava
 * měřené chyby, ne kosmetika.
 *
 * Do 19. 8. 2026 se neznámý token delší než 3 znaky bral jako jazyk. Chaturbate
 * ale posílá `spoken_languages` jako volný text psaný modelkou:
 * „English,Spanish, French (a bit)", „Spanish and English (translator)",
 * „English(preferred), French, German". Změřeno na 2 914 pokojích: vznikly z toho
 * jazyky `translator` (14×), `espanol-ingles` (10×), `only`, `little`,
 * `learning`, `nglish`, `english-preferred` — a šly do výpisu na stránce
 * modelky („Languages: Spanish, and, English").
 *
 * Co v tomhle seznamu není, se ZAHODÍ. Chybějící jazyk je lepší než vymyšlený.
 */
export const LANGUAGES: ReadonlySet<string> = new Set([
	'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian',
	'ukrainian', 'polish', 'dutch', 'czech', 'slovak', 'romanian', 'hungarian',
	'turkish', 'arabic', 'chinese', 'cantonese', 'japanese', 'korean', 'hindi',
	'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'hebrew', 'thai',
	'vietnamese', 'indonesian', 'malay', 'filipino', 'bulgarian', 'serbian',
	'croatian', 'slovenian', 'latvian', 'lithuanian', 'estonian', 'georgian',
	'armenian', 'persian', 'urdu', 'bengali', 'punjabi', 'swahili', 'afrikaans',
	'catalan', 'albanian', 'macedonian', 'bosnian', 'mongolian', 'kazakh',
	'azerbaijani', 'icelandic', 'irish', 'welsh', 'tamil', 'telugu', 'marathi',
	'nepali', 'sinhala', 'burmese', 'khmer', 'belarusian',
]);

/**
 * Aliasy → kanonický název. ISO kódy, názvy v cizím jazyce, cyrilice
 * i překlepy, které feed opravdu poslal (`nglish`, `panish`, `espanish`).
 */
export const LANGUAGE_MAP: Record<string, string> = {
	en: 'english', eng: 'english', ingles: 'english', inglés: 'english',
	inglés2: 'english', nglish: 'english', anglais: 'english', englisch: 'english',
	es: 'spanish', esp: 'spanish', espanol: 'spanish', español: 'spanish',
	espanish: 'spanish', panish: 'spanish', castellano: 'spanish', espagnol: 'spanish',
	fr: 'french', fra: 'french', francais: 'french', français: 'french',
	frances: 'french', francés: 'french',
	de: 'german', deu: 'german', ger: 'german', deutsch: 'german', aleman: 'german',
	it: 'italian', ita: 'italian', italiano: 'italian',
	pt: 'portuguese', por: 'portuguese', portugues: 'portuguese', português: 'portuguese',
	brasileiro: 'portuguese', 'portuguese-brazil': 'portuguese',
	ru: 'russian', rus: 'russian', 'русский': 'russian', ruso: 'russian', russe: 'russian',
	uk: 'ukrainian', ukr: 'ukrainian', 'українська': 'ukrainian', ukraine: 'ukrainian',
	ukrainien: 'ukrainian',
	pl: 'polish', pol: 'polish', polski: 'polish', polaco: 'polish',
	nl: 'dutch', nederlands: 'dutch', hollands: 'dutch',
	cs: 'czech', cz: 'czech', cesky: 'czech', 'čeština': 'czech',
	sk: 'slovak', slovensky: 'slovak',
	ro: 'romanian', rom: 'romanian', romana: 'romanian', 'română': 'romanian',
	hu: 'hungarian', magyar: 'hungarian',
	tr: 'turkish', turkce: 'turkish', 'türkçe': 'turkish',
	ar: 'arabic', arabe: 'arabic',
	zh: 'chinese', cn: 'chinese', mandarin: 'chinese', 'chinese-mandarin': 'chinese',
	ja: 'japanese', jp: 'japanese', nihongo: 'japanese',
	ko: 'korean', kr: 'korean',
	hi: 'hindi', sv: 'swedish', svenska: 'swedish',
	no: 'norwegian', norsk: 'norwegian',
	da: 'danish', dansk: 'danish',
	fi: 'finnish', suomi: 'finnish',
	el: 'greek', greek2: 'greek', ellinika: 'greek',
	he: 'hebrew', iw: 'hebrew', ivrit: 'hebrew',
	th: 'thai', vi: 'vietnamese', id: 'indonesian', bahasa: 'indonesian',
	ms: 'malay', tl: 'filipino', tagalog: 'filipino', pinoy: 'filipino',
	bisaya: 'filipino', cebuano: 'filipino',
	bg: 'bulgarian', 'български': 'bulgarian',
	sr: 'serbian', srpski: 'serbian', hr: 'croatian', hrvatski: 'croatian',
	sl: 'slovenian', lv: 'latvian', latviesu: 'latvian',
	lt: 'lithuanian', et: 'estonian', eesti: 'estonian',
	ka: 'georgian', hy: 'armenian', fa: 'persian', farsi: 'persian',
	ur: 'urdu', bn: 'bengali', pa: 'punjabi', sw: 'swahili', kiswahili: 'swahili',
	af: 'afrikaans', ca: 'catalan', sq: 'albanian', mk: 'macedonian',
	bs: 'bosnian', mn: 'mongolian', kk: 'kazakh', az: 'azerbaijani',
	is: 'icelandic', ga: 'irish', cy: 'welsh',
	// Názvy zapsané vlastním písmem. Musí být tady jako celý řetězec:
	// `canonicalTerm` nechá jen [a-z0-9], takže „简体中文" by se scvrklo na nic.
	'中文': 'chinese', '简体中文': 'chinese', '繁體中文': 'chinese',
	'日本語': 'japanese', '한국어': 'korean', 'ไทย': 'thai',
	'العربية': 'arabic', 'עברית': 'hebrew', 'ελληνικά': 'greek',
	'беларуская': 'belarusian', 'қазақша': 'kazakh',
	'английский': 'english', 'испанский': 'spanish', 'немецкий': 'german',
	'французский': 'french', 'итальянский': 'italian', 'украинский': 'ukrainian',
};

/**
 * Slova, která v poli jazyků nesou úroveň nebo poznámku, ne jazyk. Musí spadnout
 * PŘED whitelist, protože `translator` a `learning` by jinak prošly jako
 * neznámý token (a přesně tak se do faset dostaly).
 */
const LANGUAGE_NOISE = /\b(a bit|bit|fluent|basic|native|preferred|only|little|learning|learn|translator|translate|traductor|google|some|understand|speak|speaks|and|or|plus|etc)\b/gi;

/** Jazyk na kanonický název (english, spanish, …), nebo null. */
export function canonicalLanguage(raw: string): string | null {
	// Cyrilici hledat PŘED slugifikací — ta nechá jen [a-z0-9], takže klíč
	// `русский` v LANGUAGE_MAP by byl nedosažitelný (stejná past jako u zemí).
	const bare = String(raw ?? '').trim().toLowerCase();
	if (LANGUAGES.has(bare)) return bare;
	if (LANGUAGE_MAP[bare]) return LANGUAGE_MAP[bare];
	const t = canonicalTerm(raw);
	if (!t) return null;
	if (LANGUAGES.has(t)) return t;
	return LANGUAGE_MAP[t] ?? null;
}

/**
 * Volný text `spoken_languages` → seznam kanonických jazyků.
 *
 * Oddělovač je cokoli z `, ; / | & +` nebo slovo „and". Když celý úsek jako
 * jazyk nedopadne, zkusí se ještě po slovech — kvůli tvarům „espanol ingles"
 * bez oddělovače.
 */
export function parseLanguages(raw: unknown): string[] {
	const items = Array.isArray(raw) ? raw.map((x) => String(x)) : [String(raw ?? '')];
	const out: string[] = [];
	const push = (l: string | null) => { if (l && !out.includes(l)) out.push(l); };
	for (const item of items) {
		// „French (a bit)", „English(preferred)" — co je v závorce, není jazyk.
		const cleaned = item.replace(/\([^)]*\)/g, ' ').replace(LANGUAGE_NOISE, ' ');
		// Plnošířková čárka i podtržítko jsou oddělovač taky („Chinese，English",
		// „español_English") — ověřeno na feedu.
		for (const part of cleaned.split(/[,;/|&+_.，、]/)) {
			// Celý úsek první, aby přežily aliasy s pomlčkou (`chinese-mandarin`).
			const whole = canonicalLanguage(part);
			if (whole) { push(whole); continue; }
			// Teprve pak po slovech — „Español-English" i „espanol ingles".
			for (const word of part.split(/[-\s]+/)) push(canonicalLanguage(word));
		}
	}
	// Víc než pět jazyků nikdo neumí a delší výpis je jen šum.
	return out.slice(0, 5);
}

/**
 * `location` z Chaturbate feedu → region + země. Pole si píše modelka sama,
 * takže je to „Antioquia, Colombia" i „in your heart".
 *
 * Změřeno 19. 8. 2026 na všech 7 944 pokojích: **země chybí u 2 561 z nich
 * a u 854 ji lze získat právě odsud** (poslední úsek za čárkou). Region
 * (úsek před zemí) má 1 886 pokojů a je to skutečná geografie — Antioquia 360×,
 * Bogota D.C. 283×, Nairobi County 69×, California 40×.
 */
const REGION_JUNK = /(dream|heart|heaven|hell|wonderland|neverland|narnia|atlantis|paradise|fantas|pussy|bed|mind|screen|computer|internet|universe|milky|mars|moon|space|planet|somewhere|nowhere|secret|next to|next door|near you|ask me|chatur|chatgpt|wakanda|silent hill|south park|rainbow)/i;

export function parseLocation(raw: string | null | undefined): { region: string | null; country: string | null } {
	const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	if (!parts.length) return { region: null, country: null };
	const country = canonicalCountry(parts[parts.length - 1]);
	if (!country || parts.length < 2) return { region: null, country };
	// Emoji a interpunkce na krajích („🖤Antioquia", „medellin.") pryč, ať se
	// nestejné zápisy téhož místa nerozcházejí.
	const region = parts.slice(0, -1).join(', ')
		.replace(/[^\p{L}\p{N}\s.,'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s.,'-]+|[\s,'-]+$/g, '')
		.trim()
		// Tečku na konci smazat jen tehdy, když to není zkratka: „Medellin." →
		// „Medellin", ale „Bogota D.C." si tečku nechá.
		.replace(/^([^.]*)\.$/, '$1');
	// Dlouhý název se NEZKRACUJE, zahodí se. Ořezaný „Llanfairpwllgwyngyllgo…"
	// vypadá jako rozbitá stránka, a jméno místa ořezat nejde jinak než špatně.
	if (region.length < 3 || region.length > 40 || REGION_JUNK.test(region)) {
		return { region: null, country };
	}
	// „MEDELLIN" i „medellin" na „Medellin" — jinak vypadá stránka jako křik
	// nebo jako nedbalost. Smíšené psaní („Bogota D.C.", „KwaZulu-Natal")
	// se nechává, tam by titlecase škodil.
	const nice = region === region.toUpperCase() || region === region.toLowerCase()
		? region.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
		: region;
	return { region: nice, country };
}

/**
 * Termy, které patří do jiné taxonomie a v kategoriích jsou jen duplicitou.
 * Např. `skinny` je body_type, `spanish` je jazyk — jako kategorie by tvořily
 * konkurenční URL k té správné stránce.
 */

/**
 * Písmeno abecedního adresáře (`/models/a/`). Bydlí tady, ne v `data.ts`,
 * protože ji potřebuje i catch-all route ve Workeru — a ta nesmí natáhnout
 * katalog (13 MB `models.json` + `archive.json`) do bundlu.
 */
export function modelLetter(page: string): string {
	const c = page[0]?.toLowerCase() ?? '';
	return /^[a-z]$/.test(c) ? c : '0-9';
}
