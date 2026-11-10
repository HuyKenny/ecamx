/**
 * Registr 7 cam sítí jako DATA, ne kód (vzor: apps/vian/scripts/ehub-shops.ts).
 *
 * Endpointy, parametry i tvar odpovědi jsou reverzně zjištěné z pluginu
 * `plugincams` na starém WordPressu (16. 8. 2026) a ověřené proti živému HTML.
 * Kde se plugin choval chybně, je to tady opravené a označené — viz komentáře
 * u jednotlivých sítí a docs/DECISIONS.md.
 *
 * Affiliate ID se NIKDY nepíšou sem — čtou se z env (viz .env.example).
 */

import {
	XLOVE_GENDER, XLOVE_CATEGORY_TAG, XLOVE_TAGS, XLOVE_LANGUAGES, xloveDecode,
} from './xlove-filter-map.ts';
// Jazyky i lokalitu normalizuje TÁŽ funkce jako web — dvě kopie kanonizace už
// se tu jednou rozešly (viz komentář v src/lib/taxonomy.ts).
import { parseLanguages, parseLocation } from '../src/lib/taxonomy.ts';
// Odkaz, který vydělává, se staví JEN tady — `auditEarnings` ho porovnává
// s tvarem, který posílá feed. Import je bezpečný: `affiliate.ts` má z `data.ts`
// jen `import type`, takže se katalog (13 MB JSON) do syncu nenatáhne.
import { deepLink, type EnvGet } from '../src/lib/affiliate.ts';

/** Normalizovaný tvar modelky napříč všemi sítěmi. */
export interface Model {
	/** slug = klíč URL, `sanitize_title(username)`. Spolu s `network` tvoří identitu. */
	slug: string;
	network: NetworkId;
	/** Originální username u sítě (může mít kapitalizaci, kterou slug ztrácí). */
	username: string;
	displayName: string;
	gender: string | null;
	age: number | null;
	country: string | null;
	languages: string[];
	tags: string[];
	ethnicity: string | null;
	hairColor: string | null;
	eyeColor: string | null;
	bodyType: string | null;
	bustSize: string | null;
	appearance: string[];
	sexualPreference: string | null;
	streamTypes: string[];
	/** Text, který si modelka nastavila (room subject). Krátký, často marketingový. */
	subject: string | null;
	/**
	 * Kraj/město pod zemí („Antioquia", „Bogota D.C.", „California"). Posílá ho
	 * jen Chaturbate v poli `location` — je nepovinné, protože ostatních šest
	 * sítí nic pod úrovní země nemá. Změřeno 19. 8. 2026: 1 913 ze 7 944 pokojů.
	 */
	region?: string | null;
	/**
	 * Datum narození (ISO), když ho síť pošle a projde kontrolou. Chaturbate ho
	 * má u 69 % pokojů, ale u 27 z nich je to výplňová hodnota (`1901-01-26`
	 * spolu s věkem 99), takže se ověřuje rok i odvozený věk.
	 */
	birthDate?: string | null;
	viewers: number | null;
	/**
	 * Co je navíc potřeba k sestavení URL přehrávače, když nick nestačí.
	 * U sítí z CrakRevenue: číselné ID u Streamate
	 * (`purecam?performer={nick}&performerid={ID}`) a celá URL u ImLive, kde je
	 * v ní náhodné UUID a odvodit se nedá. Ostatní sítě to nepotřebují a mají
	 * `undefined` — bajty v katalogu se počítají.
	 */
	embedRef?: string | null;
	thumbnail: string | null;
	/**
	 * Obrázek pro případ, že se `thumbnail` nenačte.
	 *
	 * Plní ho **jen Cam4** a je to jejich vlastní řešení: feed dává vedle
	 * `thumb` i `profile_thumb` (profilovka) a `thumb_error` (generický avatar
	 * podle pohlaví). Změřeno 29. 8.: `snapshots.xcdnpro.com` vrací pro část
	 * modelek **404 s `text/html`** — i pro ty, které právě vysílají, i na
	 * čerstvé adrese z feedu — a prohlížeč to u obrázku zahodí (ORB), takže
	 * z karty zbude díra. Na `/site/cam4/` to bylo 8 ze 40 karet.
	 * Ostatní sítě mají `undefined`; bajty v katalogu se počítají.
	 */
	thumbnailFallback?: string | null;
	/** Země, ve kterých je stream blokovaný (geo-blocking sítě). */
	blockedCountries: string[];

	// ── signály pro konverzi ──────────────────────────────────────────────────
	// Ověřeno živě 16. 8. 2026, co feedy opravdu plní. Cam4 `goal`/`goal_balance`
	// vrací 0 u všech modelek, takže se ukazatel cíle NEDÁ postavit na datech —
	// jediný funkční zdroj je text v subjectu (`goalText`).

	/** MP4 smyčka pro náhled na hoveru. Posílá ji jen CamSoda (`vthumb`). */
	previewVideo: string | null;
	followers: number | null;
	isHd: boolean;
	isNew: boolean;
	/** Jak dlouho vysílá (sekundy) — „streaming for 2h" je silnější než „live". */
	onlineSeconds: number | null;
	/** Interaktivní hračka reagující na dýška. Nejpřímější důvod poslat tokeny. */
	toy: boolean;
	/** Stav pokoje: `free` (volný chat), `private`, `away`. */
	status: string | null;
	/** Cíl dýšek vytažený ze subjectu — feedy ho jako číslo nedávají. */
	goalText: string | null;
	/** Co ji bere. Unikátní text, díky kterému stránka není thin (BongaCams). */
	turnOns: string | null;
	photos: number | null;
	videos: number | null;
}

export type NetworkId =
	| 'chaturbate' | 'camsoda' | 'cam4' | 'amateur'
	| 'bongacams' | 'xlovecam' | 'livejasmin'
	// Přes CrakRevenue (jedno API, čtyři sítě) — viz `crakRevenue()` níž a D54.
	| 'stripchat' | 'streamate' | 'imlive';

export interface NetworkDef {
	id: NetworkId;
	/** Jméno pro uživatele (nadpisy, recenze sítí). */
	label: string;
	/** Doména sítě — pro recenzní stránku /site/{id}/ a rel=nofollow odkazy. */
	homepage: string;
	/** Host(y) CDN s náhledy → jdou do preconnect a do CSP img-src. */
	thumbnailHosts: string[];
	/**
	 * Sestaví URL requestu. `offset` je nenulový jen u sítí, které mají `pagination`
	 * — ostatní ho ignorují a vrací celý online feed najednou.
	 */
	buildRequest(env: NodeJS.ProcessEnv, offset: number): { url: string; init: RequestInit };
	/**
	 * Sítě, které umí stránkovat. Bez tohohle bereme jen první dávku — a právě
	 * proto starý plugin tahal z Chaturbate zlomek toho, co mohl.
	 */
	pagination?: { pageSize: number; maxPages: number };
	/** Vytáhne pole modelek z odpovědi (tvar wrapperu se u každé sítě liší). */
	extract(payload: unknown): unknown[];
	/** Namapuje jeden syrový záznam na normalizovaný tvar. */
	map(raw: any): Omit<Model, 'network'> | null;
	/**
	 * Kontrola, že odkaz, kterým vyděláváme, pořád odpovídá tomu, co síť sama
	 * posílá ve feedu. Vrací seznam nálezů; **sync na neprázdném poli padá.**
	 *
	 * Existuje to proto, že tohle je jediná věc na webu, která nese peníze,
	 * a zároveň se nedá otestovat z nasazeného webu: odkaz vypadá stejně, ať už
	 * provizi přiřadí, nebo ne. Kdyby Chaturbate změnil kód programu v `tour`,
	 * kliky by dál fungovaly a jen by přestaly vydělávat — tiše, bez chyby.
	 *
	 * POZN.: builders `embedUrl`/`deepLink` tady BÝVALY a byly mrtvý kód —
	 * 14 funkcí, které nikdo nevolal, protože živé jsou ty v `src/lib/affiliate.ts`.
	 * Nebyly ale neškodné: chaturbatí kopie měla neplatící tvar
	 * `/{nick}/?campaign=…` a cam4 tu 404 cestu `/en/embed/{nick}`, takže při
	 * opravě „na špatné kopii" by se nestalo nic. Smazáno 19. 8. 2026.
	 */
	auditEarnings?(raw: any[], env: NodeJS.ProcessEnv): string[];
	/** Které env proměnné síť potřebuje, aby fungovala. */
	requiredEnv: string[];
	/**
	 * Kolik modelek minimálně čekáme. Když jich přijde míň, sync selže hlasitě
	 * místo aby tiše nasadil poloprázdný katalog (viz plán, sekce Rizika).
	 */
	minExpected: number;
}

// ── sdílené normalizační helpery ────────────────────────────────────────────

/** Stejný slugify musí používat sync i web, jinak nesedí cesty. */
export function slugify(s: string): string {
	return String(s ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 96);
}

function num(v: unknown): number | null {
	const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
	return Number.isFinite(n) ? n : null;
}

/**
 * Odstraní nespárované poloviny surrogate páru. Vznikají, když se text ořízne
 * uprostřed emoji (regex i `slice` počítají UTF-16 jednotky, ne znaky) —
 * `JSON.stringify` z takové půlky udělá `\ud83e` a striktní JSON parser
 * v buildu na tom spadne: „unexpected end of hex escape". Ověřeno 16. 8. 2026
 * na room subjectu „100 tokens -- 🩵CelesteMadson 🩵".
 */
export function stripLoneSurrogates(s: string): string {
	return s
		.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
		.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function str(v: unknown): string | null {
	const s = typeof v === 'string' ? stripLoneSurrogates(v).trim() : '';
	return s.length ? s : null;
}

function arr(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
	if (typeof v === 'string') return v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
	return [];
}

/**
 * Cam4 posílá tagy ve tvaru `gay-gangbang|niche.292.name` — jméno tagu, svislítko,
 * interní klíč lokalizace. Starý plugin slugifikoval celý řetězec, čímž vznikly ty
 * stovky nesmyslných termů typu `analniche-34-name`. Bereme jen část před `|`.
 */
function cleanTags(v: unknown): string[] {
	return arr(v)
		.map((t) => t.split('|')[0].trim())
		.filter((t) => t && !/^niche[.\-]?\d+/i.test(t));
}

/** Sítě posílají „N/A"/„unknown" místo prázdné hodnoty — sjednotit na null. */
function nullish(v: unknown): string | null {
	const s = str(v);
	if (!s) return null;
	return /^(n\/a|na|unknown|none|null|-)$/i.test(s) ? null : s;
}

/** Protokol-relativní `//host/…` → https. Posílají tak BongaCams i XLove. */
function https(u: unknown): string | null {
	const s = str(u);
	if (!s) return null;
	if (s.startsWith('//')) return 'https:' + s;
	return s.replace(/^http:\/\//, 'https://').replace(/\\\//g, '/');
}

/** Gender se napříč sítěmi jmenuje různě; sjednocujeme na 4 hodnoty + group. */
function normGender(g: unknown): string | null {
	const s = String(g ?? '').toLowerCase();
	if (!s) return null;
	if (/(^|[^a-z])(f|female|woman|girl)([^a-z]|$)/.test(s)) {
		// BongaCams posílá "female+couple" jako řetězec — pár má přednost.
		if (s.includes('couple')) return 'couple';
		return 'female';
	}
	if (/trans|shemale|tranny/.test(s)) return 'trans';
	if (/couple/.test(s)) return 'couple';
	if (/group/.test(s)) return 'group';
	if (/(^|[^a-z])(m|male|man|guy)([^a-z]|$)/.test(s)) return 'male';
	if (s === 'c') return 'couple';
	if (s === 't') return 'trans';
	if (s === 'm') return 'male';
	if (s === 'f') return 'female';
	return null;
}

/** Feedy míchají `true`/`1`/`"1"`/`"yes"`. Cokoli jiného je false. */
function bool(v: unknown): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v > 0;
	return /^(1|true|yes|on|active)$/i.test(String(v ?? ''));
}

/**
 * Datum narození z feedu, ale jen když je uvěřitelné.
 *
 * Chaturbate posílá `birthday` u 69 % pokojů a je to nejlepší zdroj věku, jaký
 * máme — počítá se při každém buildu, takže se nikdy nerozejde s realitou.
 * U 27 pokojů (změřeno 19. 8. 2026 na celém feedu) je to ale výplň:
 * `1901-01-26` spolu s věkem 99. Proto se ověřuje rok i odvozený věk; co
 * neprojde, je null a stránka o narození nenapíše nic.
 */
function birthDate(v: unknown, feedAge: number | null): string | null {
	const s = str(v);
	if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const age = ageFromBirth(s);
	if (age == null || age < 18 || age > 80) return null;
	// Když se datum a věk z feedu rozcházejí o víc než rok, je jedno z nich
	// nesmysl a nevíme které → nepoužije se ani jedno.
	if (feedAge != null && feedAge >= 18 && feedAge <= 80 && Math.abs(feedAge - age) > 1) return null;
	return s;
}

/** Věk k dnešnímu dni. Bez knihovny: stačí porovnat měsíc a den. */
function ageFromBirth(iso: string): number | null {
	const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
	if (!y || !m || !d) return null;
	const now = new Date();
	let age = now.getUTCFullYear() - y;
	const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
	if (md < m * 100 + d) age--;
	return age;
}

/** Stav pokoje na tři hodnoty, se kterými umí pracovat šablona. */
function normStatus(v: unknown): string | null {
	const s = String(v ?? '').toLowerCase();
	if (!s) return null;
	if (/away|offline/.test(s)) return 'away';
	// `hidden` = placená skrytá show (Chaturbate, 45 pokojů z 7 944). Pro
	// návštěvníka je to totéž co private: v přehrávači nic neuvidí.
	if (/priv|group|exclusive|member|ticket|hidden/.test(s)) return 'private';
	if (/free|public|online|chat/.test(s)) return 'free';
	return null;
}

/**
 * Cíl dýšek. Modelky si ho píšou do room subjectu („Goal: 500 tk — squirt"),
 * protože strukturovaně ho neposílá nikdo: Cam4 má pole `goal` i `goal_balance`,
 * ale obě vracejí 0 u všech modelek (ověřeno 16. 8. 2026 na živém feedu).
 */
function goalFromSubject(subject: string | null): string | null {
	if (!subject) return null;
	const m = subject.match(/goal\b[^:@#|]{0,15}:?\s*([^|#@]{3,70})/i);
	if (!m) return null;
	// Regex kvantifikátor umí seknout emoji v půlce → uklidit i tady.
	const text = stripLoneSurrogates(m[1]).replace(/\s+/g, ' ').trim();
	// „Goal Completed!" a podobné nejsou cíl, jen oslava.
	return /^(reached|completed|complete|done)\b/i.test(text) ? null : text || null;
}

// ── definice sítí ───────────────────────────────────────────────────────────

export const NETWORKS: NetworkDef[] = [
	{
		id: 'chaturbate',
		label: 'Chaturbate',
		homepage: 'https://chaturbate.com',
		thumbnailHosts: ['thumb.live.mmcdn.com'],
		requiredEnv: ['CHATURBATE_AFFILIATE'],
		// Zvednuto z 800 spolu s pokrytím: 800 by prošlo i při odpovědi, ze které
		// zbyla desetina. Ranní minima feedu jsou nad 5 000, takže 3 000 je
		// bezpečně pod realitou a přesto to pozná rozbitý feed.
		minExpected: 3000,
		// Ověřeno 16. 8. 2026: limit má strop 500 (nad tím HTTP 400) a offset
		// funguje — offset 0/500/1000/2000 vrací pokaždé jiné modelky.
		//
		// 20 stránek, ne 8. Feed hlásil 19. 8. 2026 `count` **7 944** a osmi
		// stránkami jsme brali 4 000 — tedy polovinu Chaturbate jsme neviděli
		// vůbec, a to zdola, kde jsou nicky s nejmenší konkurencí v SERPu.
		// Rozpočet 10 000 dává rezervu na špičku; sync na prázdné stránce končí.
		pagination: { pageSize: 500, maxPages: 20 },
		buildRequest(env, offset) {
			const u = new URL('https://chaturbate.com/api/public/affiliates/onlinerooms/');
			u.searchParams.set('wm', env.CHATURBATE_AFFILIATE!);
			// POVINNÉ — bez client_ip vrací API HTTP 400 „This field is required".
			u.searchParams.set('client_ip', 'request_ip');
			u.searchParams.set('format', 'json');
			u.searchParams.set('limit', '500');
			if (offset) u.searchParams.set('offset', String(offset));
			return { url: u.toString(), init: {} };
		},
		extract: (p: any) => p?.results ?? [],
		map: (r) => {
			const username = str(r.username);
			if (!username) return null;
			// `location` si modelka píše sama („Antioquia, Colombia", ale taky
			// „in your heart"). Země z něj vytáhne 951 pokojů, kterým pole
			// `country` chybí — to je 12 % celého feedu (změřeno 19. 8. 2026).
			const loc = parseLocation(str(r.location));
			const birth = birthDate(r.birthday, num(r.age));
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.gender),
				// Věk z datumu narození je vždycky aktuální; feedové `age` se
				// u některých pokojů nemění a u 27 z nich je to sentinel 99.
				age: birth ? ageFromBirth(birth) : num(r.age),
				// OPRAVA proti pluginu: ten ukládal `country` do blocked_countries,
				// takže země modelky se nikde nezobrazovala. Patří sem.
				country: nullish(r.country) ?? loc.country,
				region: loc.region,
				birthDate: birth,
				languages: parseLanguages(r.spoken_languages),
				tags: arr(r.tags),
				ethnicity: null, hairColor: null, eyeColor: null,
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: null, streamTypes: [],
				subject: str(r.room_subject),
				viewers: num(r.num_users),
				thumbnail: https(r.image_url_360x270),
				blockedCountries: [],
				previewVideo: null,
				followers: num(r.num_followers),
				isHd: bool(r.is_hd),
				isNew: bool(r.is_new),
				onlineSeconds: num(r.seconds_online),
				toy: false,
				status: normStatus(r.current_show),
				goalText: goalFromSubject(str(r.room_subject)),
				turnOns: null,
				photos: null,
				videos: null,
			};
		},
		/**
		 * Feed posílá u každého pokoje `chat_room_url_revshare` — hotový
		 * revshare deeplink. Je to autorita na tvar odkazu, tak ho porovnáme
		 * s tím, co staví `deepLink()`. Ověřeno 19. 8. 2026 na 2 388 pokojích:
		 * `tour` je stabilní (`LQps` revshare, `yiMH` PPS) a náš odkaz se
		 * shodoval do posledního znaku. Guard je tu na den, kdy to přestane platit.
		 */
		auditEarnings(raw, env) {
			const problems: string[] = [];
			const get: EnvGet = (k) => String(env[k] ?? '');
			for (const r of raw.slice(0, 25)) {
				const username = str(r.username);
				const theirs = str(r.chat_room_url_revshare);
				if (!username || !theirs) continue;
				const ours = new URL(deepLink('chaturbate', username, 'profile', get));
				const feed = new URL(theirs);
				// `track` nese naši placementu, takže se úmyslně liší. Zbytek ne.
				for (const key of ['tour', 'campaign', 'room']) {
					if (ours.searchParams.get(key) !== feed.searchParams.get(key)) {
						problems.push(
							`${username}: ${key} je u nás „${ours.searchParams.get(key)}", ` +
							`feed posílá „${feed.searchParams.get(key)}"`
						);
					}
				}
				if (ours.origin + ours.pathname !== feed.origin + feed.pathname) {
					problems.push(`${username}: cesta ${ours.pathname} vs ${feed.pathname}`);
				}
				if (problems.length) break; // jeden nález stačí, je systémový
			}
			return problems;
		},
	},

	{
		id: 'camsoda',
		label: 'CamSoda',
		homepage: 'https://www.camsoda.com',
		thumbnailHosts: ['media.livemediahost.com'],
		requiredEnv: ['CAMSODA_AFFILIATE'],
		minExpected: 300,
		buildRequest(env, _offset) {
			const u = new URL('https://feed.camsoda.com/api/v1/browse/online_embed');
			u.searchParams.set('id', env.CAMSODA_AFFILIATE!);
			u.searchParams.set('limit', '1000');
			// POZN.: plugin sem posílal `cmp=CMP_HERE` — nedodělaný placeholder,
			// který nikdy nebyl nahrazen. Vynecháno záměrně.
			return { url: u.toString(), init: {} };
		},
		extract: (p: any) => p?.results ?? [],
		map: (r) => {
			const username = str(r.username);
			if (!username) return null;
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.gender),
				age: num(r.age),
				country: nullish(r.country),
				languages: parseLanguages(r.language),
				tags: arr(r.tags),
				ethnicity: null, hairColor: null, eyeColor: null,
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: null, streamTypes: [],
				subject: str(r.subject),
				viewers: num(r.viewers),
				thumbnail: https(r.thumb),
				blockedCountries: [],
				// Jediná síť, která posílá hotovou MP4 smyčku — jinde se náhled
				// „rozhýbe" obnovováním živého JPEGu (viz ModelCard.astro).
				previewVideo: https(r.vthumb),
				followers: num(r.followers),
				isHd: false,
				isNew: bool(r.is_new),
				onlineSeconds: null,
				toy: false,
				status: normStatus(r.status),
				goalText: goalFromSubject(str(r.subject)),
				turnOns: null,
				photos: null,
				videos: null,
			};
		},
	},

	{
		id: 'cam4',
		label: 'Cam4',
		homepage: 'https://www.cam4.com',
		// `stackvaults-media` a `static.cam4.com` nesou náhradní obrázek, když
		// snapshot chybí — bez nich by ho zablokovala CSP.
		thumbnailHosts: ['snapshots.xcdnpro.com', 'stackvaults-media.xcdnpro.com', 'static.cam4.com'],
		requiredEnv: ['CAM4_SID'],
		/**
		 * **Práh musí sedět pod DENNÍM MINIMEM, ne u maxima.** 19. 8. jsem ho dal
		 * na 1 200 podle jednoho měření (1 778) — a cam4 běžně vrací 1 342–1 422,
		 * takže guard byl pár desítek modelek od toho, aby při běžném poklesu
		 * vyhodil celou síť místo aby chytal rozbitý feed.
		 */
		minExpected: 700,
		buildRequest(env, _offset) {
			const u = new URL('https://api.cam4pays.com/api/v1/cams/online.json');
			// 3000, ne 1000. Ověřeno 19. 8. 2026 proti živému API: při `limit=1000`
			// vrátí přesně 1 000 (což je NÁŠ strop, ne velikost sítě), při 3000
			// vrátí 1 778. `offset` API ignoruje — vrací pořád první dávku, takže
			// stránkovat nejde a jediná páka je limit. Stejná třída chyby jako
			// u Chaturbate (D42): kulaté číslo rovné limitu je příznak useknutí.
			u.searchParams.set('limit', '3000');
			u.searchParams.set('order_by', 'viewers_desc');
			u.searchParams.set('extended', '1');
			if (env.CAM4_SID) u.searchParams.set('sid', env.CAM4_SID);
			else { u.searchParams.set('aid', env.CAM4_AID!); u.searchParams.set('rp', env.CAM4_RP || 'rs'); }
			return { url: u.toString(), init: {} };
		},
		// Cam4 vrací holé pole, žádný wrapper.
		extract: (p: any) => (Array.isArray(p) ? p : []),
		map: (r) => {
			const username = str(r.nickname);
			if (!username) return null;
			const streamTypes = [str(r.broadcast_type), str(r.show_type)].filter(Boolean) as string[];
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.gender),
				age: num(r.age),
				country: nullish(r.country),
				languages: parseLanguages(r.languages),
				tags: cleanTags(r.show_tags),
				ethnicity: null, hairColor: null, eyeColor: null,
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: nullish(r.sex_preference),
				streamTypes,
				subject: str(r.status),
				viewers: num(r.viewers),
				thumbnail: https(r.thumb),
				// Cam4 pro část modelek snapshot nemá; profilovka je pořád
				// skutečná fotka, avatar podle pohlaví je až poslední záchrana.
				thumbnailFallback: https(r.profile_thumb) ?? https(r.thumb_error),
				// HLS stream místo cizího rámce (D70). Adresa je krátkodobá —
				// po 12 h vrací 404 — takže si stránka bere čerstvou
				// z `/api/stream/cam4/{nick}/`; tahle je jen odrazový můstek.
				embedRef: https(r.preview_url),
				blockedCountries: arr((r.blocked_regions ?? []).map((b: any) => b?.countryIsoCode)),
				previewVideo: null,
				followers: null,
				// POZOR: `hd_stream` vrací null u všech modelek a `goal`/`goal_balance`
				// nuly — Cam4 ta pole má, ale neplní je. Použitelné je jen
				// `new_performer` (ověřeno na živém feedu 16. 8. 2026).
				isHd: bool(r.hd_stream),
				isNew: bool(r.new_performer),
				onlineSeconds: null,
				toy: bool(r.kiiroo),
				status: normStatus(r.show_type ?? r.broadcast_type),
				goalText: goalFromSubject(str(r.status)),
				turnOns: null,
				photos: null,
				videos: null,
			};
		},
	},

	{
		id: 'amateur',
		label: 'Amateur.tv',
		homepage: 'https://www.amateur.tv',
		thumbnailHosts: ['www.amateur.tv'],
		requiredEnv: ['AMATEUR_API_KEY'],
		minExpected: 50,
		buildRequest(env, _offset) {
			const u = new URL('https://api.a00s.net/v3/cache/affiliates/camsfeed/json');
			u.searchParams.set('a', env.AMATEUR_API_KEY!);
			u.searchParams.set('lang', env.AMATEUR_LANG || 'en');
			u.searchParams.set('wl', 'www.amateur.tv');
			// Vlastní UA — bez něj API odpovídá nekonzistentně.
			return { url: u.toString(), init: { headers: { 'User-Agent': 'ecamx/1.0 (+https://ecamx.com)' } } };
		},
		extract: (p: any) => p?.body ?? [],
		map: (r) => {
			const username = str(r.username);
			if (!username) return null;
			// `country` je asociativní pole {kod: nazev} → bereme první klíč.
			const country = r.country && typeof r.country === 'object'
				? Object.keys(r.country)[0] ?? null
				: str(r.country);
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.genre),
				age: num(Array.isArray(r.age) ? r.age[0] : r.age),
				country,
				languages: parseLanguages(r.camLang),
				tags: arr(r.tagsOnline),
				ethnicity: null, hairColor: null, eyeColor: null,
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: null, streamTypes: [],
				subject: str(r.topic),
				viewers: num(r.viewers),
				thumbnail: https(r.imageCapture),
				blockedCountries: [],
				previewVideo: null,
				followers: null,
				isHd: false,
				isNew: false,
				onlineSeconds: null,
				toy: false,
				status: null,
				goalText: goalFromSubject(str(r.topic)),
				turnOns: null,
				photos: null,
				videos: null,
			};
		},
	},

	{
		id: 'bongacams',
		label: 'BongaCams',
		homepage: 'https://bongacams.com',
		thumbnailHosts: ['i.bgicdn.com'],
		requiredEnv: ['BONGACAMS_USER_ID'],
		/**
		 * Původně 1 000 podle jediného měření (1 361) — a BongaCams reálně vrací
		 * 1 032–1 391, takže **síť opakovaně vypadávala celá** (3 běhy CI z 6) a
		 * s ní 6 501 stránek odkazujících na `/site/bongacams/`. Viz D51.
		 */
		minExpected: 400,
		buildRequest(env, _offset) {
			const u = new URL('https://bngprm.com/promo.php');
			u.searchParams.set('c', env.BONGACAMS_USER_ID!);
			u.searchParams.set('lang', 'en');
			u.searchParams.set('type', 'api');
			u.searchParams.set('api_v', '1');
			// 3000, ne 1000 — viz komentář u cam4. Ověřeno: při 1000 přijde přesně
			// 1 000, při 3000 přijde 1 395. `offset` se taky ignoruje.
			u.searchParams.set('limit', '3000');
			u.searchParams.set('api_type', 'json');
			return { url: u.toString(), init: {} };
		},
		extract: (p: any) => (Array.isArray(p) ? p : []),
		map: (r) => {
			const username = str(r.username);
			if (!username) return null;
			const imgs = r.profile_images ?? {};
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.gender),
				age: num(r.display_age),
				// POZOR: feed BongaCams pole `country` NEMÁ — jmenuje se `homecountry`.
				// Kvůli téhle jedné záměně bylo 866 modelek bez země, takže se
				// nedostaly na žádnou ze 20 stránek zemí.
				country: nullish(r.homecountry ?? r.country),
				languages: parseLanguages([str(r.primary_language), str(r.secondary_language)].filter(Boolean)),
				tags: arr(r.tags),
				ethnicity: nullish(r.ethnicity),
				hairColor: nullish(r.hair_color),
				eyeColor: nullish(r.eye_color),
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: null, streamTypes: [],
				subject: str(r.chat_topic),
				viewers: num(r.members_count),
				thumbnail: https(
					imgs.thumbnail_image_big_live ?? imgs.thumbnail_image_live ??
					imgs.thumbnail_image_big ?? imgs.thumbnail_image_medium ?? imgs.thumbnail_image_small
				),
				blockedCountries: [],
				previewVideo: null,
				followers: null,
				/**
				 * HLS playlist pro NÁŠ přehrávač (`embedUrl` → `hls:…`, D62).
				 * Iframe z bongacams.com je na EasyListu, tohle ne. Adresa nese
				 * shard (`ded6740-edge20.bcvcdn.com`) a **z nicku se odvodit
				 * nedá** — cizí shard vrací 404. Zastarává: medián `online_time`
				 * je 1,2 h, takže po reconnectu může být neplatná; klient si ji
				 * pak obnoví z `/api/online/bongacams/?s=1`.
				 */
				embedRef: https(r.stream_feed_url),
				isHd: bool(r.hd_cam),
				isNew: bool(r.is_new),
				onlineSeconds: num(r.online_time),
				toy: bool(r.vibratoy),
				status: normStatus(r.chat_status),
				goalText: goalFromSubject(str(r.chat_topic)),
				// Nejbohatší feed ze všech — tenhle text jinde nenajdeš, takže
				// právě on dělá ze stránky modelky něco jiného než thin content.
				turnOns: str(r.turns_on),
				photos: num(r.photos_count),
				videos: num(r.videos_count),
			};
		},
	},

	{
		id: 'xlovecam',
		label: 'XLoveCam',
		homepage: 'https://www.xlovecam.com',
		thumbnailHosts: ['img1.wlresources.com'],
		requiredEnv: ['XLOVE_AFFILIATE_ID', 'XLOVE_API_KEY'],
		minExpected: 200,
		pagination: { pageSize: 500, maxPages: 6 },
		buildRequest(env, offset) {
			// Jediná síť s POSTem a jediná, která umí offset (plugin ho měl natvrdo 0).
			const body = new URLSearchParams({
				authServiceId: '2',
				authItemId: env.XLOVE_AFFILIATE_ID!,
				authSecret: env.XLOVE_API_KEY!,
				timestamp: String(Math.floor(Date.now() / 1000)),
				lang: 'en',
				offset: String(offset),
				limit: '500',
			});
			return {
				url: 'https://webservice-affiliate.xlovecam.com/model/listonline',
				init: { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
			};
		},
		extract: (p: any) => p?.content?.models_list ?? [],
		map: (r) => {
			const username = str(r.nick) ?? str(r.model_id);
			if (!username) return null;
			return {
				slug: slugify(username),
				username,
				displayName: username,
				// XLove kóduje všechno do čísel; mapa je v xlove-filter-map.ts
				// (vytažená ze starého pluginu). Bez ní měly všechny modelky
				// gender/tagy/jazyky prázdné a síť nebyla na žádné filtrované stránce.
				gender: XLOVE_GENDER[num(r.category) ?? -1] ?? null,
				age: num(r.age),
				// Zemi XLoveCam nehlásí vůbec.
				country: null,
				languages: parseLanguages(xloveDecode(r.language_speak, XLOVE_LANGUAGES)),
				// `tagList` je vyplněný jen u ~12 % modelek, `category` u všech —
				// proto se z kategorie dělá ještě jeden tag, jinak by se zbytek
				// nedostal do žádné kategorie.
				tags: [
					...xloveDecode(r.tagList, XLOVE_TAGS),
					...(XLOVE_CATEGORY_TAG[num(r.category) ?? -1] ? [XLOVE_CATEGORY_TAG[num(r.category)!]] : []),
				],
				ethnicity: null, hairColor: null, eyeColor: null,
				bodyType: null, bustSize: null, appearance: [],
				sexualPreference: null,
				streamTypes: arr(r.show_type),
				subject: null,
				viewers: null,
				thumbnail: https(r.model_profil_photo),
				blockedCountries: [],
				previewVideo: null,
				followers: null,
				isHd: false,
				isNew: false,
				onlineSeconds: null,
				toy: false,
				status: normStatus(r.show_type),
				goalText: null,
				turnOns: null,
				photos: null,
				videos: null,
			};
		},
	},

	{
		id: 'livejasmin',
		label: 'LiveJasmin',
		homepage: 'https://www.livejasmin.com',
		thumbnailHosts: ['galleryn0.vcmdiawe.com', 'galleryn1.vcmdiawe.com', 'galleryn2.vcmdiawe.com'],
		requiredEnv: ['LIVEJASMIN_USERID', 'LIVEJASMIN_API_KEY'],
		minExpected: 200,
		buildRequest(env, _offset) {
			const u = new URL('https://ptcdw.com/api/model/feed');
			const p = u.searchParams;
			p.set('siteId', 'jasmin');
			p.set('psId', env.LIVEJASMIN_USERID!);
			p.set('psTool', '213_1');
			p.set('psProgram', env.LIVEJASMIN_PSPROGRAM || 'revs');
			p.set('category', 'girl');
			p.set('limit', '1000');
			p.set('imageSizes', '320x240');
			p.set('imageType', 'any');
			p.set('showOffline', '0');
			p.set('onlyFreeStatus', '0');
			p.set('extendedDetails', '1');
			p.set('responseFormat', 'json');
			p.set('accessKey', env.LIVEJASMIN_API_KEY!);
			p.set('legacyRedirect', '1');
			return { url: u.toString(), init: {} };
		},
		extract: (p: any) => p?.data?.models ?? [],
		map: (r) => {
			const username = str(r.performerId);
			if (!username) return null;
			const person = Array.isArray(r.persons) ? r.persons[0] ?? {} : {};
			const body = person.body ?? {};
			const d = r.details ?? {};
			return {
				slug: slugify(username),
				username,
				displayName: username,
				gender: normGender(r.category === 'girl' ? 'female' : r.category),
				age: num(person.age),
				country: nullish(r.country),
				languages: parseLanguages(d.languages),
				tags: arr(d.willingnesses),
				ethnicity: nullish(r.ethnicity),
				hairColor: nullish(body.hairColor),
				eyeColor: nullish(body.eyeColor),
				bodyType: nullish(body.build),
				bustSize: nullish(body.breastSize),
				appearance: arr(d.appearances),
				sexualPreference: nullish(person.sexualPreference),
				streamTypes: [],
				subject: str(d.about?.biography),
				viewers: null,
				thumbnail: https(r.profilePictureUrl?.size320x240),
				blockedCountries: arr(r.bannedCountries),
				previewVideo: null,
				followers: null,
				isHd: /hd/i.test(String(d.streamQuality ?? '')),
				isNew: bool(r.isNewbie),
				onlineSeconds: null,
				// „Interactive toy" je nejpřímější důvod poslat tokeny — LiveJasmin
				// je jediná síť, která ho hlásí spolehlivě.
				toy: bool(r.interactiveToyStatus),
				status: normStatus(r.status),
				goalText: null,
				turnOns: str(d.about?.turnsOn),
				photos: null,
				videos: null,
			};
		},
	},
];

/* ── CrakRevenue: jedno API, čtyři sítě ──────────────────────────────────────
 *
 * `performers-ext` je agregátor nad sedmi cam brandy. Bereme z něj **jen ty,
 * které přímo nemáme** — stripchat, streamate, imlive (MyFreeCams vypnuto
 * 26. 8., viz `CRAK_OFFERS`). Chaturbate,
 * BongaCams (`bongacash`) a LiveJasmin (`awempire`) tenhle endpoint umí taky,
 * ale **tahat tutéž síť z obou zdrojů se NESMÍ**: vznikly by dvě stránky téhož
 * člověka pod dvěma „sítěmi" (to řeší D48) a agregátor jich navíc vidí míň —
 * měřeno 25. 8. 2026: 5 721 živých pokojů Chaturbate proti ~7 900 z přímého API,
 * a chybí právě ty nejmenší, tedy náš longtail.
 *
 * Co API NEDÁVÁ: počty diváků. Žádné pole s nimi neexistuje, takže
 * `viewers: null` a `peak` se u těchto sítí nedá počítat. Nedopočítávat
 * a nevymýšlet (D48) — v UI je „Live" bez čísla.
 *
 * Pasti změřené při integraci:
 *  - **`User-Agent` je povinný.** Bez něj vrací API HTML 403, ne JSON.
 *  - **Víc genderů jde jen s enkódovanou čárkou** (`gender=f%2Cm%2Cc%2Ct`).
 *    S `gender=f,m` nebo bez parametru tiše vrátí jen ženy (default `f`).
 *  - `size` má strop 100 a `page` je 1-based.
 *  - `age: 0` a `country: ""` znamenají „neuvedeno", ne nulu a prázdno.
 *  - Lite verze má `i18n` prázdné — popisky jsou jen ve full verzi, kterou
 *    zapíná affiliate manažer.
 */

/** Offer ID v tracking URL na brand. Není tajemství — je ve veřejné URL. */
export const CRAK_OFFERS: Partial<Record<NetworkId, string>> = {
	stripchat: '4247',
	streamate: '3941',
	imlive: '3923',
	// MyFreeCams (3648) vypnuto 26. 8. 2026 — nabídka ignoruje `model=` a každý
	// nick končí na `myfreecams.com/?cam=30352`. Ověřeno i na URL přímo z jejich
	// feedu, takže chyba je na jejich straně. Viz D59.
};

interface CrakOpts {
	id: NetworkId;
	label: string;
	/** Jméno brandu v API (`brands=`), nemusí být totožné s naším `id`. */
	brand: string;
	homepage: string;
	thumbnailHosts: string[];
	/**
	 * Kvóta stránek = `maxPages` × 100. Vynucuje se už při stahování, takže
	 * rozpočet souborů free plánu (20 000) nemá co dohánět. Čísla vycházejí
	 * z měření živých pokojů 25. 8. 2026 a z kvality dat u toho brandu.
	 */
	maxPages: number;
	minExpected: number;
}

function crakRevenue(o: CrakOpts): NetworkDef {
	return {
		id: o.id,
		label: o.label,
		homepage: o.homepage,
		thumbnailHosts: o.thumbnailHosts,
		requiredEnv: ['CRAKREVENUE_TOKEN', 'CRAKREVENUE_API_KEY', 'CRAKREVENUE_AFF_ID'],
		minExpected: o.minExpected,
		pagination: { pageSize: 100, maxPages: o.maxPages },
		buildRequest(env, offset) {
			const u = new URL('https://performersext-api.pcvdaa.com/performers-ext');
			u.searchParams.set('token', env.CRAKREVENUE_TOKEN!);
			u.searchParams.set('brands', o.brand);
			u.searchParams.set('live', 'true');
			// `score` = systemScore podle konverzní efektivity pokoje. Když se
			// bere jen zlomek sítě, ať je to ten, který vydělává.
			u.searchParams.set('sorting', 'score');
			u.searchParams.set('lang', 'en');
			u.searchParams.set('size', '100');
			u.searchParams.set('page', String(Math.floor(offset / 100) + 1));
			// URLSearchParams zakóduje čárku na %2C — a jen v té podobě API
			// víc genderů přijme (viz past výš).
			u.searchParams.set('gender', 'f,m,c,t');
			return {
				url: u.toString(),
				init: {
					headers: {
						'x-api-key': env.CRAKREVENUE_API_KEY!,
						// Povinná hlavička, jinak 403 v HTML.
						'user-agent': 'ecamx-sync/1.0 (+https://ecamx.com)',
						accept: 'application/json',
					},
				},
			};
		},
		extract: (p: any) => p?.performers ?? [],
		map: (r) => {
			const username = str(r.name) ?? str(r.nameClean);
			if (!username) return null;
			const c = r.characteristic ?? {};
			// `nameClean` je jejich normalizovaný tvar; slug si ale děláme sami,
			// ať sedí s ostatními sítěmi.
			const slug = slugify(str(r.nameClean) ?? username);
			if (!slug) return null;
			const age = num(c.age);
			return {
				slug,
				username,
				displayName: username,
				gender: normGender(c.genderCode ?? c.gender),
				// 0 = „neuvedeno". U Stripchatu to platí pro 90 % pokojů.
				age: age && age >= 18 && age <= 80 ? age : null,
				country: nullish(c.country),
				languages: parseLanguages(arr(c.languages).join(',')),
				// Dvě sady tagů: `autoTags` popisují, co se v pokoji děje
				// (blowjob, dirty talk, squirt), `characteristicsTags` spíš jak
				// vypadá (blond hair, green eyes, caucasian). **Činnosti první** —
				// text i mřížky berou prvních pár tagů a věta „ukazuje se pro
				// hnědé oči" je nesmysl. Kanonizaci a NOT_A_CATEGORY řeší
				// taxonomy.ts dál v syncu.
				tags: [...new Set([...arr(r.autoTags), ...arr(r.characteristicsTags)])],
				ethnicity: str(arr(c.ethnicities)[0]),
				hairColor: str(c.hairColor),
				eyeColor: str(c.eyeColor),
				bodyType: str(arr(c.bodyTypes)[0]),
				bustSize: str(c.bustSize),
				appearance: arr(c.bodyMods),
				sexualPreference: str(arr(c.sexualPreferences)[0]),
				streamTypes: [],
				// API room subject nemá — a bez něj u těchto sítí nejde opt-out
				// kódem `ecamx-out` (past 60). Modelka z nich musí na e-mail.
				subject: null,
				viewers: null,
				embedRef: embedRefFor(o.id, r),
				// `liveSnapshotURL` je živý obrázek z pokoje, `thumbnailUrl`
				// statický avatar. Živý je lepší náhled, když ho brand posílá.
				thumbnail: https(r.liveSnapshotURL) ?? https(r.thumbnailUrl),
				blockedCountries: [],
				previewVideo: null,
				followers: null,
				isHd: false,
				isNew: false,
				onlineSeconds: null,
				toy: false,
				status: r.live === false ? 'away' : 'free',
				goalText: null,
				turnOns: str(r.i18n?.turnOns),
				photos: null,
				videos: num(r.totalVideos),
			};
		},
		auditEarnings(raw, env) {
			// Feed sám vrací kanonický `roomUrl` s naším affiliate ID, takže je
			// to silnější kontrola než u Chaturbate: stačí porovnat, že vedeme
			// na tentýž host, tutéž cestu a tutéž modelku.
			const problems: string[] = [];
			const get: EnvGet = (k) => String(env[k] ?? '');
			for (const r of raw.slice(0, 25)) {
				const username = str(r.name) ?? str(r.nameClean);
				const theirs = str(r.roomUrl);
				if (!username || !theirs) continue;
				let ours: URL, feed: URL;
				try {
					ours = new URL(deepLink(o.id, username, 'profile', get));
					feed = new URL(theirs);
				} catch {
					problems.push(`${username}: neplatná URL (naše nebo z feedu)`);
					continue;
				}
				if (ours.host !== feed.host) {
					problems.push(`${username}: host ${ours.host} ≠ ${feed.host}`);
					break;
				}
				if (ours.pathname !== feed.pathname) {
					problems.push(`${username}: cesta ${ours.pathname} ≠ ${feed.pathname} (jiné offer ID?)`);
					break;
				}
				if (ours.searchParams.get('model') !== feed.searchParams.get('model')) {
					problems.push(`${username}: parametr model nesedí`);
					break;
				}
			}
			return problems;
		},
	};
}

/** Co si u dané sítě musíme zapamatovat, aby šel sestavit přehrávač. */
function embedRefFor(id: NetworkId, r: any): string | null {
	// Streamate: purecam potřebuje číselné ID performera. Je v `itemId`
	// (`streamate_142790745`), takže se ukládá jen to číslo.
	if (id === 'streamate') return str(String(r.itemId ?? '').split('_')[1]);
	// ImLive má v URL náhodné UUID a stream name — odvodit se nedá, ukládá se
	// celá. Je to ~110 modelek, takže na velikosti katalogu to nepoznat.
	if (id === 'imlive') return https(r.iframeFeedURL);
	// Stripchat a MFC jedou ze šablony `suaplf.live/{brand}?name={nick}`.
	return null;
}

NETWORKS.push(
	// Nejlepší data z celé čtveřice: country a age u 100 %, ~20 tagů na modelku,
	// živý snapshot u všech. Proto se bere celá (1 292 živých 25. 8.).
	crakRevenue({
		id: 'streamate', label: 'Streamate', brand: 'streamate',
		homepage: 'https://www.streamate.com',
		thumbnailHosts: ['imagetransform.icfcdn.com'],
		maxPages: 13, minExpected: 400,
	}),
	// Největší síť (5 790 živých), ale age má jen u 10 % pokojů — a hlavně se
	// nevejde: při 1 500 stránkách dal build 19 320 souborů, tedy nad stropem
	// CI (19 000). Proto 800 nejlepších podle skóre. Až se uvolní místo
	// (prořezáním bez poptávky), je tohle první číslo, které se zvedá.
	crakRevenue({
		id: 'stripchat', label: 'Stripchat', brand: 'stripchat',
		homepage: 'https://stripchat.com',
		thumbnailHosts: ['static-cdn.strpst.com', 'static-proxy.strpst.com', 'img.doppiocdn.com'],
		maxPages: 8, minExpected: 500,
	}),
	// Malá, ale s bohatými tagy a věkem u všech. Bere se celá.
	crakRevenue({
		id: 'imlive', label: 'ImLive', brand: 'imlive',
		homepage: 'https://www.imlive.com',
		thumbnailHosts: ['i0.imlmediahub.com'],
		maxPages: 2, minExpected: 30,
	}),
);

export const NETWORK_BY_ID: Record<string, NetworkDef> =
	Object.fromEntries(NETWORKS.map((n) => [n.id, n]));

/** Všechny CDN hosty náhledů — do preconnect v <head> a do CSP img-src. */
export const ALL_THUMBNAIL_HOSTS: string[] =
	[...new Set(NETWORKS.flatMap((n) => n.thumbnailHosts))];
