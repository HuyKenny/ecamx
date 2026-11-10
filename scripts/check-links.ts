/**
 * Poprodukční kontrola vygenerovaného `dist/client`. Běží v CI po buildu.
 *
 * Kontroluje pět věcí, které se na tomhle webu už jednou rozbily nebo se
 * rozbít můžou tiše — tedy tak, že web vypadá funkčně:
 *
 *   1. každý interní odkaz vede na existující soubor  (bylo 6 757 mrtvých)
 *   2. žádný slug není zároveň stránka i přesměrování (nová logika zániku)
 *   3. `_redirects` se vejde do limitu 2 000 pravidel (přebytek Cloudflare zahodí)
 *   4. sitemapa neobsahuje noindex stránku            (plýtvání crawl budgetem)
 *   5. žádná stránka modelky není sirotek             (bylo 6 102 ze 14 000)
 *   6. každý zaniklý slug má PLATNÝ cíl přesměrování   (bylo 729 tvrdých 404)
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { TOKEN_RATES, MAX_AGE_DAYS } from '../src/content/token-rates.ts';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'client');

if (!existsSync(DIST)) {
	console.error('[links] dist/client neexistuje — nejdřív `pnpm build`');
	process.exit(1);
}

const files = new Set<string>();
(function walk(dir: string) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else files.add('/' + relative(DIST, p).split('\\').join('/'));
	}
})(DIST);

const html = [...files].filter((f) => f.endsWith('.html'));
console.log(`[links] ${html.length} HTML souborů, ${files.size} souborů celkem`);

/**
 * Dynamické routy obsluhuje Worker, ne assets layer — v `dist/client` pro ně
 * žádný soubor není a kontrolor je jinak hlásí jako rozbité odkazy.
 */
const WORKER_ROUTES = ['/go/', '/api/'];

/** `/cams/asian/` → `/cams/asian/index.html`; `/robots.txt` → sám sebou. */
function resolves(href: string): boolean {
	const clean = href.split('#')[0].split('?')[0];
	if (!clean.startsWith('/')) return true;
	if (WORKER_ROUTES.some((r) => clean.startsWith(r))) return true;
	if (files.has(clean)) return true;
	const withIndex = clean.endsWith('/') ? clean + 'index.html' : clean + '/index.html';
	return files.has(withIndex);
}

// ── 1. interní odkazy ───────────────────────────────────────────────────────

const broken = new Map<string, string[]>();
let checked = 0;
for (const f of html) {
	const body = readFileSync(join(DIST, f.slice(1)), 'utf8');
	for (const m of body.matchAll(/href="(\/[^"#][^"]*)"/g)) {
		const href = m[1];
		checked++;
		if (resolves(href)) continue;
		const where = broken.get(href) ?? [];
		if (where.length < 3) where.push(f);
		broken.set(href, where);
	}
}
console.log(`[links] ověřeno ${checked} interních odkazů`);

// ── 2. + 3. přesměrování ────────────────────────────────────────────────────

const redirectsFile = join(DIST, '_redirects');
const redirects = existsSync(redirectsFile)
	? readFileSync(redirectsFile, 'utf8').split('\n').filter((l) => l.startsWith('/'))
	: [];

const collisions: string[] = [];
for (const line of redirects) {
	const from = line.trim().split(/\s+/)[0];
	// Přesměrování na URL, která zároveň existuje jako soubor, se nikdy
	// neuplatní (statika má přednost) — a u zaniklých modelek by to znamenalo,
	// že jsme ji zároveň smazali i vykreslili.
	if (files.has(from + 'index.html') || files.has(from)) collisions.push(from);
}

// ── 4. sitemapa vs. noindex ─────────────────────────────────────────────────

// `sitemap.xml` je od 24. 8. sitemapINDEX (D53), takže se musí projít i soubory,
// na které odkazuje. Bez toho by guard kontroloval prázdno a 13 000 URL by
// z kontroly vypadlo úplně — přesně ta část, která nese 97 % kliků.
const sitemapPath = join(DIST, 'sitemap.xml');
const readLocs = (file: string): string[] => existsSync(file)
	? [...readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
	: [];
const indexed = readLocs(sitemapPath);
const isIndex = existsSync(sitemapPath)
	&& readFileSync(sitemapPath, 'utf8').includes('<sitemapindex');
const sitemapFiles: string[] = [];
const missingSitemaps: string[] = [];
const locs: string[] = [];
if (isIndex) {
	for (const loc of indexed) {
		const path = new URL(loc).pathname;
		const file = join(DIST, path.slice(1));
		sitemapFiles.push(path);
		if (!existsSync(file)) {
			// `fail` je deklarovaný až v reportovací části souboru, takže se
			// tady jen sbírá — volání by skončilo v TDZ.
			missingSitemaps.push(path);
			continue;
		}
		locs.push(...readLocs(file));
	}
} else {
	locs.push(...indexed);
}
const noindexed: string[] = [];
for (const loc of locs) {
	const path = new URL(loc).pathname;
	const file = join(DIST, path.slice(1), 'index.html');
	if (!existsSync(file)) { noindexed.push(`${path} (chybí soubor)`); continue; }
	if (readFileSync(file, 'utf8').includes('name="robots" content="noindex')) {
		noindexed.push(`${path} (noindex)`);
	}
}

// ── 5. sirotci mezi stránkami modelek ───────────────────────────────────────
//
// Měření z 18. 8.: 6 102 ze 14 000 stránek modelek nemělo NIKDE na webu odkaz,
// z toho 4 849 archivních — a archiv posíláme do sitemapy jako indexovatelný.
// Od zavedení adresáře `/models/` má odkaz každá z nich, takže tohle číslo musí
// zůstat na nule. Když guard spadne, chybí odkaz, ne test (viz D33).

const modelPages = new Set(
	[...files]
		.filter((f) => f.startsWith('/live/') && f.endsWith('/index.html'))
		.map((f) => f.slice('/live/'.length, -'/index.html'.length))
);
const linkedModels = new Set<string>();
for (const f of html) {
	// Odkazy ze stránek modelek se nepočítají: 14 000 stránek, které odkazují
	// jen na sebe navzájem, by guard uspokojilo, i kdyby do celého bloku nevedla
	// z rozcestníků ani jedna cesta.
	if (f.startsWith('/live/')) continue;
	const body = readFileSync(join(DIST, f.slice(1)), 'utf8');
	for (const m of body.matchAll(/href="\/live\/([^"/]+)\/"/g)) linkedModels.add(m[1]);
}
const orphans = [...modelPages].filter((p) => !linkedModels.has(p));

// ── 6. zaniklé stránky mají kam vést ────────────────────────────────────────
//
// Přesměrování zaniklých stránek obsluhuje Worker (`src/pages/[...path].ts`),
// takže v `dist/client` po nich není ani stopa a kontrolor #1 je nevidí. Že
// mapa nelže, jde ověřit staticky: každý cíl musí existovat jako soubor.
// Do 19. 8. se 414 pravidel nevešlo do `_redirects` a 729 stránek modelek
// s historií v GSC vracelo 404 (89 % impresí webu) — tenhle guard hlídá, aby
// se to nevrátilo.

const goneFiles = [
	join(ROOT, 'src', 'data', 'gone.json'),
	join(ROOT, 'seed', 'legacy-gone.json'),
];
const goneMap: Record<string, string> = {};
for (const f of goneFiles) {
	if (!existsSync(f)) continue;
	Object.assign(goneMap, JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>);
}
/**
 * Stejná záloha jako v `src/lib/gone.ts`: cíl uložený v mapě mohl mezitím
 * zaniknout (kategorie spadne pod práh, země pod 20 modelek), a pak se použije
 * abecední adresář. Guard musí kontrolovat to, co se **opravdu** stane, ne
 * surovou hodnotu — jinak hlásí chybu i tam, kde runtime zafunguje správně.
 */
function goneFallback(slug: string): string {
	const c = slug[0]?.toLowerCase() ?? '';
	return `/models/${/^[a-z]$/.test(c) ? c : '0-9'}/`;
}

/**
 * Velikost mapy se hlásí jako podíl na bundlu Workeru — je to největší
 * jednotlivý modul a první kandidát na přesun ze bundlu (viz rozpočet níž).
 */
const goneBytes = goneFiles.filter((f) => existsSync(f))
	.reduce((sum, f) => sum + statSync(f).size, 0);

const badTargets = new Map<string, string[]>();
let goneChecked = 0;
let goneFallbacks = 0;
for (const [slug, target] of Object.entries(goneMap)) {
	// Slug, který zase vysílá, má vlastní stránku — ta má přednost před mapou
	// (assets layer běží před Workerem), takže cíl kontrolovat nemusíme.
	if (files.has(`/live/${slug}/index.html`)) continue;
	goneChecked++;
	let real = target;
	if (!resolves(real)) { real = goneFallback(slug); goneFallbacks++; }
	if (resolves(real)) continue;
	const list = badTargets.get(real) ?? [];
	if (list.length < 3) list.push(slug);
	badTargets.set(real, list);
}

// ── verdikt ─────────────────────────────────────────────────────────────────

let failed = false;
const fail = (msg: string) => { console.error(`[links] CHYBA: ${msg}`); failed = true; };

// ── 7. index finderu ────────────────────────────────────────────────────────
// Dvě věci, které se z nasazeného webu nepoznají: (a) index se rozejde
// s vygenerovanými stránkami a výsledky hledání začnou vést na 404,
// (b) do veřejného assetu se dostane affiliate klíč. `AMATEUR_API_KEY` je
// zároveň affiliate ID i credential k feedu (AGENTS 19), takže by to nebyl
// jen únik provize.
{
	const idxPath = join(DIST, 'search', 'idx.txt');
	if (!existsSync(idxPath)) {
		console.log('[links] ✓ index finderu: nevygenerován (stránka /finder/ ho nemá odkud vzít)');
	} else {
		const text = readFileSync(idxPath, 'utf8');
		const nl = text.indexOf('\n');
		const meta = JSON.parse(text.slice(0, nl)) as { rows: number };
		const livePages = [...files].filter((f) => /^\/live\/[^/]+\/index\.html$/.test(f)).length;
		if (meta.rows !== livePages) {
			fail(
				`index finderu má ${meta.rows} řádků, ale stránek modelek je ${livePages} — ` +
				`výsledky hledání by vedly na 404. Přestavěl se index ze stejného katalogu?`
			);
		} else {
			console.log(`[links] ✓ index finderu: ${meta.rows} řádků == ${livePages} stránek modelek`);
		}
	}
}

// ── 7b. klíče nesmí být ve vygenerovaných souborech ─────────────────────────
/**
 * Skenuje CELÝ výstup, ne jen index finderu.
 *
 * Do 28. 8. 2026 se hledalo výhradně v `dist/search/idx.txt` — a přesně proto
 * guard přehlédl dvě věci naráz: `AMATEUR_API_KEY` ležel čitelně v `data-id`
 * widgetu na **274 stránkách** (je to týž řetězec jako credential k jejich
 * feedu, past 19), a `PUBLIC_XLOVE_API_KEY` s `PUBLIC_LIVEJASMIN_API_KEY` byly
 * zapečené v `dist/server/chunks/*.mjs`, takže by je ruční `pnpm deploy` nahrál
 * do produkčního Workeru. Guard, který kontroluje jeden soubor z osmnácti tisíc,
 * dává jen falešný pocit bezpečí.
 *
 * `dist/server` se kontroluje taky: je to nasazovaný kód Workeru, čitelný
 * každému, kdo má na účet Cloudflare API token.
 */
{
	const secrets = Object.entries(process.env)
		.filter(([k]) => /AFFILIATE|API_KEY|USERID|USER_ID|_SID|_AID|SECRET|TOKEN|WIDGET_ID/.test(k))
		// Krátká hodnota by dělala falešné poplachy (běžný text ji obsahuje).
		.filter(([, v]) => v && v.length >= 8);
	// `CRAKREVENUE_AFF_ID` a podobná ID jsou veřejná — jsou v odchozí URL
	// a nedají se skrýt. Sem patří jen to, co je zároveň credential.
	const PUBLIC_BY_DESIGN = /^(PUBLIC_)?(CRAKREVENUE_AFF_ID|CHATURBATE_AFFILIATE|CAMSODA_AFFILIATE|CAM4_SID|CAM4_AID|CAM4_RP|BONGACAMS_USER_ID|XLOVE_AFFILIATE_ID|LIVEJASMIN_USERID)$/;
	const watched = secrets.filter(([k]) => !PUBLIC_BY_DESIGN.test(k));
	if (!watched.length) {
		console.log('[links] ~ kontrola úniku klíčů: v prostředí není co hledat');
	} else {
		const roots = [DIST, join(ROOT, 'dist', 'server')].filter((d) => existsSync(d));
		const hits = new Map<string, string[]>();

		/**
		 * **Hledá se jedním `grep`em, ne čtením souborů v Node.**
		 *
		 * Do 23. 9. 2026 se každý soubor načetl do paměti a pro každý z ~15
		 * klíčů se dělalo `text.includes(v)`. Při 23 000 souborech (a skoro
		 * gigabajtu na disku) to byl jeden z nejdražších kroků běhu — a běh
		 * stojí minuty z rozpočtu GitHub Actions (past 101). `grep -rlF -f`
		 * přečte strom jednou a hledá všechny hodnoty současně.
		 *
		 * Který klíč to je, se dohledá až u nalezených souborů — těch je
		 * v normálním stavu nula, takže je to zdarma.
		 */
		const exts = ['html', 'txt', 'js', 'mjs', 'json', 'xml', 'css'];
		const patterns = watched
			.filter(([, v]) => !/\r|\n/.test(v!))
			.map(([, v]) => v!);
		const patFile = join(tmpdir(), `ecamx-secrets-${process.pid}.txt`);
		writeFileSync(patFile, patterns.join('\n') + '\n');
		let matched: string[] = [];
		try {
			const args = ['-rlF', '-f', patFile, ...exts.map((e) => `--include=*.${e}`), ...roots];
			const res = spawnSync('grep', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
			if (res.error || res.status === 2) {
				// `grep` není nebo selhal — radši hlasitě, než tiše nezkontrolovat nic.
				fail(`kontrolu úniku klíčů nešlo spustit (${res.error?.message ?? `grep exit ${res.status}`})`);
			} else {
				matched = res.stdout.split('\n').filter(Boolean);
			}
		} finally {
			try { unlinkSync(patFile); } catch { /* úklid není kritický */ }
		}
		for (const file of matched) {
			const text = readFileSync(file, 'utf8');
			for (const [k, v] of watched) {
				if (!v || !text.includes(v)) continue;
				const arr = hits.get(k);
				if (arr) { if (arr.length < 3) arr.push(relative(ROOT, file)); }
				else hits.set(k, [relative(ROOT, file)]);
			}
		}
		// Počet prohledaných souborů se hlásí dál — je to jediné číslo, které
		// řekne, že kontrola skutečně proběhla nad celým stromem.
		let scanned = 0;
		const countFiles = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) { countFiles(p); continue; }
				if (/\.(html|txt|js|mjs|json|xml|css)$/.test(p)) scanned++;
			}
		};
		for (const root of roots) countFiles(root);
		if (hits.size) {
			for (const [k, where] of hits) {
				fail(`hodnota ${k} je ve vygenerovaných souborech (${where.join(', ')}…) — `
					+ 'klíč, který je zároveň credential, nesmí opustit Worker secrets');
			}
		} else {
			console.log(`[links] ✓ ${scanned} souborů neobsahuje žádnou z ${watched.length} tajných hodnot`);
		}
	}
}

// ── 8. ceny tokenů nesmí tiše zestárnout ────────────────────────────────────
// Jediná dolarová čísla na webu. Sítě je mění a **žádná z nich je nezveřejňuje
// veřejně** (ověřeno 19. 8. 2026: login/403/404), takže je nejde ani
// automaticky hlídat — musí je obnovit člověk. Radši spadlý build než stránka,
// která rok tvrdí starou cenu. Stejná logika jako `auditEarnings()` v syncu.
{
	const stale: string[] = [];
	const thin: string[] = [];
	for (const [id, rates] of Object.entries(TOKEN_RATES)) {
		if (!rates) continue;
		const age = Math.floor((Date.now() - Date.parse(`${rates.checkedOn}T00:00:00Z`)) / 86_400_000);
		if (age > MAX_AGE_DAYS) stale.push(`${id} (ověřeno před ${age} dny)`);
		// Cena od jednoho zdroje není ověřená cena. Sítě je nezveřejňují, takže
		// jediná dostupná kontrola je shoda nezávislých výpisů — a když ta
		// podmínka někdy vypadne, má to build zastavit, ne projít.
		if (rates.sources.length < 2) thin.push(`${id} (${rates.sources.length} zdroj)`);
	}
	if (thin.length) {
		fail(
			`ceny tokenů se opírají o jediný zdroj: ${thin.join(', ')}. ` +
			`Publikovat cenu, kterou nikdo nepotvrdil, je horší než ji neuvádět.`
		);
	}
	if (stale.length) {
		fail(
			`ceny tokenů jsou starší než ${MAX_AGE_DAYS} dnů: ${stale.join(', ')}. ` +
			`Obnov je v src/content/token-rates.ts (jsou jen za přihlášením, musí je opsat člověk), ` +
			`nebo tu síť z TOKEN_RATES vyndej — stránka pak zmizí i ze sitemapy.`
		);
	} else {
		const n = Object.keys(TOKEN_RATES).length;
		console.log(n
			? `[links] ✓ ceny tokenů u ${n} sítí jsou čerstvé (strop ${MAX_AGE_DAYS} dnů)`
			: '[links] ✓ ceny tokenů: žádná síť je zatím nemá, /site/*/tokens/ se negeneruje');
	}
}


if (broken.size) {
	fail(`${broken.size} rozbitých interních odkazů`);
	for (const [href, where] of [...broken].slice(0, 20)) {
		console.error(`  ${href}  ← ${where.join(', ')}`);
	}
} else console.log('[links] ✓ žádný rozbitý interní odkaz');

if (collisions.length) {
	fail(`${collisions.length} slugů je zároveň stránka i přesměrování: ${collisions.slice(0, 10).join(', ')}`);
} else console.log(`[links] ✓ ${redirects.length} přesměrování bez kolize se stránkami`);

if (redirects.length > 2000) {
	fail(`${redirects.length} pravidel v _redirects, limit je 2 000 — Cloudflare přebytek zahodí`);
}

if (missingSitemaps.length) {
	fail(`sitemapindex odkazuje na ${missingSitemaps.length} souborů, které se `
		+ `nevygenerovaly: ${missingSitemaps.join(', ')}`);
}

if (noindexed.length) {
	fail(`${noindexed.length} URL v sitemapě je noindex nebo chybí: ${noindexed.slice(0, 10).join(', ')}`);
} else {
	console.log(`[links] ✓ sitemapy: ${locs.length} URL, všechny indexovatelné`
		+ (sitemapFiles.length ? ` (${sitemapFiles.length} souborů: ${sitemapFiles.join(', ')})` : ''));
}

if (badTargets.size) {
	fail(`${badTargets.size} cílů přesměrování neexistuje (zaniklé stránky by skončily na 404)`);
	for (const [target, slugs] of [...badTargets].slice(0, 10)) {
		console.error(`  ${target}  ← /live/${slugs.join('/, /live/')}/`);
	}
} else console.log(`[links] ✓ ${goneChecked} zaniklých slugů má platný cíl (${goneFallbacks}× přes záložní adresář)`);

/**
 * **Shardy mapy musí být v nasazovaném výstupu.**
 *
 * Worker si mapu od 23. 9. 2026 netahá z bundlu, ale z `dist/client/gone/*.json`
 * přes binding `ASSETS` (D76). Když tam nejsou, `redirectForModel()` spadne na
 * záložní adresář — zaniklé stránky sice pořád neskončí na 404 (D53), ale
 * VŠECHNY se svezou na abecední rozcestník, takže se ztratí přesné cíle
 * u 197 000 URL a **nikdo si toho nevšimne**. Proto tvrdá kontrola: chybějící
 * shardy, nebo jiný počet záznamů než v `src/data/gone.json`, je chyba.
 *
 * (Mapa v `src/data/gone.json` zůstává zdrojem pravdy pro tenhle guard
 * a pro `build-redirects.ts`; shardy jsou jen její nasazovaná podoba.)
 */
const shardDir = join(DIST, 'gone');
const goneOnly = goneFiles[0];
if (!existsSync(goneOnly)) {
	console.log('[links] ~ mapa přesměrování není — shardy se nekontrolují');
} else if (!existsSync(shardDir)) {
	fail('chybí dist/client/gone/ — Worker by neměl odkud vzít mapu přesměrování '
		+ '(chybí `pnpm sync` před buildem?)');
} else {
	const expected = Object.keys(JSON.parse(readFileSync(goneOnly, 'utf8')) as Record<string, string>).length;
	let shards = 0;
	let records = 0;
	for (const name of readdirSync(shardDir)) {
		if (!name.endsWith('.json')) continue;
		shards++;
		records += Object.keys(JSON.parse(readFileSync(join(shardDir, name), 'utf8')) as Record<string, string>).length;
	}
	if (records !== expected) {
		fail(`shardy mají ${records} záznamů, ale mapa ${expected} — `
			+ 'část přesměrování by spadla na záložní adresář');
	} else {
		console.log(`[links] ✓ ${records} přesměrování v ${shards} shardech (${(dirBytes(shardDir) / 1024 / 1024).toFixed(1)} MB)`);
	}
}

// ── rozpočet bundlu Workeru ─────────────────────────────────────────────────
//
// **Limit je 64 MiB v NEkomprimované podobě a platí pro oba plány** (dokumentace
// Cloudflare, ověřeno 23. 9. 2026); gzip, který vypisuje wrangler, je jen
// informativní údaj. Do 23. 9. tu stál strop 6 MB na `gone.json` s odůvodněním
// „bundle Workeru má limit 3 MB po gzipu" — to číslo pocházelo ze staršího
// free limitu a už neplatí.
//
// Guard tím padal na něčem, co problém není. Měří se proto to, co se opravdu
// nasazuje — a **změřeno**: nasazený Worker měl `Total Upload: 7167 KiB`,
// z toho 6,4 MB byla mapa přesměrování. Ta se odstěhovala do shardovaných
// assetů (D77) a bundle spadl na **719 KiB**. Viz D76 a D77.
const SERVER = join(ROOT, 'dist', 'server');
const PRERENDER = join(SERVER, '.prerender');
const LIMIT_BYTES = 64 * 1024 * 1024;

function dirBytes(dir: string): number {
	let sum = 0;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) sum += dirBytes(p);
		else if (e.isFile()) sum += statSync(p).size;
	}
	return sum;
}

if (existsSync(PRERENDER)) {
	// **Po úspěšném buildu tam být nemá** — Astro si ho uklidí sám a ověřeno
	// (CI i lokálně) tam není. Zbyde jen po buildu, který spadl nebo byl
	// přerušený, a takový dist se nikdy nenasazuje. Když tu přesto je, je to
	// 25 MB mrtvé váhy v uploadu, což nemá co dělat v nasazovaném výstupu.
	fail(
		'.prerender je v nasazovaném bundlu — build-time katalog, který se za běhu ' +
		'nikdy nenačte. Zbyl tu po neúspěšném buildu; spusť build znovu, nebo ' +
		'`node scripts/strip-prerender.mjs`'
	);
} else if (existsSync(SERVER)) {
	const bundle = dirBytes(SERVER);
	const pct = (bundle / LIMIT_BYTES) * 100;
	const size = `${(bundle / 1024 / 1024).toFixed(1)} MB`;
	if (bundle > LIMIT_BYTES * 0.75) {
		fail(`bundle Workeru ${size} = ${pct.toFixed(0)} % limitu 64 MiB — než ho zvedneš, podívej se, co v něm je`);
	} else if (bundle > LIMIT_BYTES * 0.5) {
		console.log(`[links] ~ bundle Workeru ${size} (${pct.toFixed(0)} % limitu 64 MiB) — roste, ale v limitu`);
	} else {
		console.log(`[links] ✓ bundle Workeru ${size} (${pct.toFixed(0)} % limitu 64 MiB)`);
	}
	console.log(
		`[links] · mapa přesměrování ${(goneBytes / 1024 / 1024).toFixed(1)} MB `
		+ `(${((goneBytes / bundle) * 100).toFixed(0)} % bundlu) — největší modul, první kandidát na přesun`
	);
} else {
	console.log('[links] · dist/server není — rozpočet bundlu se přeskočil');
}

if (orphans.length) {
	fail(
		`${orphans.length} z ${modelPages.size} stránek modelek je sirotek (žádný odkaz ` +
		`z rozcestníku): ${orphans.slice(0, 10).join(', ')} — chybí je v adresáři /models/?`
	);
} else console.log(`[links] ✓ všech ${modelPages.size} stránek modelek má odkaz z rozcestníku`);

process.exit(failed ? 1 : 0);
