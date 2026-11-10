/**
 * Přesměrování zaniklých stránek — JEDNO místo pro build i runtime.
 *
 * Proč to vzniklo (19. 8. 2026): `_redirects` má tvrdý limit **2 000 pravidel**
 * a Cloudflare přebytek tiše zahodí. Zaniklých stránek modelek bylo 2 085,
 * takže se 414 z nich nevešlo a ty URL padaly na 404. Horší ale bylo, že
 * sync přiděloval `gone` jen stránkám nad prahem `INDEX_MIN_DAYS` — a živých
 * modelek pod tím prahem je 5 878 z 8 168. Jejich stránka tedy existovala,
 * dokud modelka vysílala, a v okamžiku, kdy skončila, se z URL stala tvrdá 404.
 *
 * Změřeno v GSC: **729 z 837 stránek modelek, které kdy měly imprese, vracelo
 * 404** — 2 185 z 2 474 impresí (89 %), včetně dvou nejsilnějších stránek webu
 * (`/live/lunarspark/`, pozice 6,7 a `/live/tinyxstar/`, 10,3). Právě proto
 * hlásí URL Inspection u stránek modelek „Crawled – currently not indexed":
 * Google si stránku prolezl a při dalším průchodu dostal 404.
 *
 * Řešení: mapa se čte v **Workeru** (`src/pages/[...path].ts`), kde žádný limit
 * na počet pravidel není. `_redirects` zůstalo jen na legacy WP strukturu.
 * Viz docs/DECISIONS.md D35.
 */
// **Mapa přesměrování se SEM neimportuje.** Do 23. 9. 2026 tu byl
// `import gone from '../data/gone.json'` a z 195 706 slugů se stal JS literál,
// který byl 87 % bundlu Workeru (6,0 z 6,9 MB) a parsoval se při každém
// studeném startu isolate. Teď ji sync zapisuje jako shardované statické
// assety do `public/gone/` a Worker si je tahá přes binding `ASSETS` — viz
// `ShardLoader` níž a D76.
//
// Historické slugy ze starého WordPressu. Leží v `seed/`, ne v `src/data/`,
// protože `src/data/*` generuje sync a je gitignorované — tohle je naopak
// jednorázový, commitnutý seznam z GSC historie (viz scripts/build-legacy-gone).
import legacyGone from '../../seed/legacy-gone.json';
import facets from '../data/facets.json';
import { canonicalLanguage, canonicalTerm, modelLetter } from './taxonomy.ts';
import { shardOf } from './redirect-shard.ts';

/** Slugy, které kdy měly imprese v GSC — i ty, které registry nezná. */
const LEGACY = legacyGone as Record<string, string>;

/**
 * Načte jeden shard mapy (`a`–`z`, `0`–`9`, `_`), nebo `null`, když není.
 *
 * Dodává ho route `[...path].ts`, protože `gone.ts` sám na binding `ASSETS`
 * sahat nesmí — importuje ho i `check-links.ts` a ten běží mimo Worker.
 * Když shard chybí (výpadek, starý build), vrátí se `null` a lookup spadne na
 * záložní adresář: přesměrování bude méně přesné, ale **nikdy ne 404** (D53).
 */
export type ShardLoader = (shard: string) => Promise<Record<string, string> | null>;

/**
 * Cíl musel existovat v době zápisu, ale kategorie zaniká, když spadne pod
 * práh. Přesměrování na 404 je horší než žádné, tak se cíl ověřuje proti
 * aktuálním facetám — stejná kontrola jako v scripts/build-redirects.ts.
 */
const f = facets as unknown as Record<string, { slug: string }[]>;
const VALID = new Set<string>(['/cams/', '/']);
for (const c of f.categories ?? []) VALID.add(`/cams/${c.slug}/`);
for (const c of f.ethnicities ?? []) VALID.add(`/cams/${c.slug}/`);
for (const c of f.hairColors ?? []) VALID.add(`/cams/${c.slug}/`);
for (const c of f.bodyTypes ?? []) VALID.add(`/cams/${c.slug}/`);
for (const c of f.curated ?? []) VALID.add(`/cams/${c.slug}/`);
for (const c of f.countries ?? []) VALID.add(`/country/${c.slug}/`);
for (const n of f.networks ?? []) VALID.add(`/site/${n.slug}/`);

/**
 * Písmena, pro která adresář opravdu existuje. Sync je píše do `facets.json`
 * (`letters`), protože `MODEL_LETTERS` z `data.ts` by do Workeru přitáhlo 13 MB
 * katalogu. Když seznam chybí (starý snapshot), zbývá `/models/`.
 */
const LETTERS = new Set<string>((f.letters as unknown as string[] | undefined) ?? []);

/**
 * Kam poslat slug, ke kterému nemáme nic než jméno. Abecední adresář je
 * z existujících stránek nejblíž tomu, co člověk hledal — je to seznam profilů
 * modelek, ne náhodná kategorie. `/cams/` by byl skoro soft 404 (viz D7).
 */
function fallback(slug: string): string {
	const letter = modelLetter(slug);
	return LETTERS.has(letter) ? `/models/${letter}/` : '/models/';
}

/**
 * Nick musí vypadat jako nick. Bez téhle kontroly by se na adresář
 * přesměrovalo cokoli, co někdo napíše za `/live/`, a web by neměl 404 vůbec —
 * to je horší než 404, protože Google „soft 404" pozná a počítá ji za chybu.
 */
const NICK = /^[A-Za-z0-9_.-]{1,64}$/;

/** `/live/{slug}/` → cíl přesměrování, nebo `null` když ani nick to není. */
export async function redirectForModel(slug: string, load: ShardLoader): Promise<string | null> {
	// LEGACY se zkouší první jen když je shard nedostupný — jinak je pořadí
	// stejné jako dřív (`GONE` mělo přednost před `LEGACY`).
	const shard = await load(shardOf(slug));
	const target = shard?.[slug] ?? LEGACY[slug];
	if (target) return VALID.has(target) ? target : fallback(slug);
	// **Slug, který mapa nezná, NESMÍ padnout na 404.** Změřeno 24. 8. 2026 na
	// vzorku 24 stránek modelek s měřenou poptávkou na Bingu: 13 z nich vracelo
	// 404, protože to byly nicky ze starého WordPressu, které registry nikdy
	// nevidělo — mapa `gone` je zná jen tehdy, když u nás stránku měly.
	// D35 („zaniklá stránka nikdy nesmí padat na 404") tedy platilo jen na
	// polovinu případů. Viz D53.
	return NICK.test(slug) ? fallback(slug) : null;
}

/**
 * Staré WordPressové taxonomie. `_redirects` jich pokrývá 338, ale jen v základní
 * podobě — **stránkované varianty a rozbité slugy tam nejsou** a padaly na 404.
 * Změřeno 24. 8. 2026 na bingových datech: 37 takových URL má měřenou poptávku
 * (103 impresí, 21 kliků) a žádný cíl, např. `/webcam_category/underwear/`,
 * `/webcam_category/milfniche-47-name/`, `/webcam_category/big-tits/page/5/`.
 * Vzorů je pár, URL tisíce — proto je řeší Worker, ne dalších tisíc pravidel
 * v `_redirects` (limit 2 000). Viz D53.
 */
const LEGACY_CATEGORY = /^\/webcam_category\/([^/]+)(?:\/page\/\d+)?\/?$/;
const LEGACY_LANGUAGE = /^\/webcam_languages\/([^/]+)(?:\/page\/\d+)?\/?$/;

/**
 * Starý plugin slugifikoval celý řetězec z feedu, takže z `bigtits|niche.291.name`
 * vznikl term `bigtitsniche-291-name` (viz past 3). Ocas se odsekne, jinak
 * kanonizace nic nenajde.
 */
function legacyTerm(raw: string): string {
	return raw.replace(/niche-\d+-name$/, '');
}

/** Term ze starého WP → existující kategorie, nebo rozcestník kategorií. */
function categoryTarget(raw: string): string {
	const term = canonicalTerm(legacyTerm(raw));
	const url = term ? `/cams/${term}/` : '';
	return url && VALID.has(url) ? url : '/cams/';
}

/** Kam a jak (301 vs 302) — trvale zaniklá je jen legacy struktura. */
export interface Redirect { to: string; permanent: boolean }

/**
 * Přesměrování pro celou cestu. Řeší i variantu bez koncového lomítka —
 * `trailingSlash: 'always'`, takže na tu se stejně jen přesměrovává.
 */
export async function redirectFor(pathname: string, load: ShardLoader): Promise<Redirect | null> {
	const model = /^\/live\/([^/]+)\/?$/.exec(pathname);
	if (model) {
		/**
		 * **Odsud se NIKDY nevede ven k partnerovi.**
		 *
		 * Do 29. 8. tu byla zkratka: záchranná karta mířila na
		 * `/live/{slug}/?r={síť}&n={nick}` a když u nás stránka nebyla, Worker
		 * poslal návštěvníka rovnou do pokoje. Kenny to zakázal — „žádné
		 * přesměrování k partnerovi hned, potřebujeme ty lidi co nejdýl udržet
		 * na webu" — a měl pravdu i věcně: byla to čtvrtina záchranných kliků,
		 * které web opustily bez jediné naší stránky. Karty teď vznikají jen
		 * pro modelky, jejichž stránku máme (`/live-pages.json`), a neznámý
		 * `/live/{nick}/` končí tam, kde končil vždycky — na naší stránce.
		 */
		const to = await redirectForModel(decodeURIComponent(model[1]), load);
		// 302: modelka se běžně vrátí a její stránka se znovu postaví.
		return to ? { to, permanent: false } : null;
	}
	/**
	 * Zaniklý rozcestník sítě nebo kategorie. Když se síť vypne (MyFreeCams
	 * 26. 8., D59) nebo kategorie spadne pod práh, její `/site/{x}/` resp.
	 * `/cams/{x}/` zmizí z buildu — a protože mapa `gone` zná jen stránky
	 * modelek, padalo to na tvrdou 404 (ověřeno na `/site/mfc/`). To D35
	 * zakazuje: zaniklá stránka má vést na nejbližší živý rozcestník.
	 */
	/**
	 * Hluboké stránkování mřížek se od 28. 8. negeneruje (strop `MAX_GRID_PAGES`,
	 * D64) — ale crawleři si adresy pamatují. Místo 404 je pošleme na rozcestník,
	 * kde je obsah dnes. Dočasně, protože strop se může zase zvednout.
	 */
	const deep = /^\/(cams|country|site)\/([^/]+)\/(\d+)\/?$/.exec(pathname)
		?? /^\/(girls|guys|couples|trans|page)\/(\d+)\/?$/.exec(pathname);
	if (deep) {
		const base = deep.length === 4 ? `/${deep[1]}/${deep[2]}/` : `/${deep[1]}/`;
		// `/page/2/` je stránkování homepage — základ je kořen webu.
		return { to: base === '/page/' ? '/' : base, permanent: false };
	}

	const hub = /^\/(site|cams)\/([^/]+)\/?$/.exec(pathname);
	if (hub) {
		const [, kind, slug] = hub;
		const known = VALID.has(`/${kind}/${slug}/`);
		// Existující rozcestník sem nikdy nedojde (obsluhuje ho statický soubor),
		// takže tady zbývají jen ty zaniklé.
		if (!known) return { to: `/${kind}/`, permanent: false };
	}

	const cat = LEGACY_CATEGORY.exec(pathname);
	if (cat) return { to: categoryTarget(decodeURIComponent(cat[1])), permanent: true };
	const lang = LEGACY_LANGUAGE.exec(pathname);
	if (lang) {
		const raw = decodeURIComponent(lang[1]);
		// Jazykové stránky web nemá (jazyk je faseta, ne URL), takže jazyk míří
		// na rozcestník. Nick v jazykové taxonomii ale znamená, že člověk hledal
		// modelku — `/webcam_languages/nicedoll54/` má 3 kliky.
		if (canonicalLanguage(raw)) return { to: '/cams/', permanent: true };
		if (NICK.test(raw)) return { to: `/live/${raw}/`, permanent: true };
		return { to: '/cams/', permanent: true };
	}
	return null;
}

// `GONE_COUNT` tu byl „pro logy a guardy" — nikdo ho nevolal a s mapou mimo
// bundle ho ani nejde spočítat (Worker by musel stáhnout všech 36 shardů).
// Kdo chce počet, ať se podívá do `dist/client/gone/` nebo do logu syncu.
// Odstraněno 23. 9. 2026 (D76).
