/**
 * Jak se mřížka chová v prvních vteřinách — měřeno v prohlížeči.
 *
 * Proč to existuje
 * ----------------
 * Kenny 28. 8. 2026: „když navštívím web, hned se mi některé streamy skryjí
 * a objeví se jiné." Změřeno na produkci: z 60 karet se 13 vyměnilo ~400 ms po
 * načtení, protože data z buildu jsou až 2 h stará a za tu dobu část modelek
 * dovysílá (za 27 min přežije 82 % pokojů, a nedá se předpovědět kterých —
 * délka vysílání ani publikum to nepředpovídají).
 *
 * Výměnu **nelze odstranit**, jen zrychlit a zjemnit. Tenhle skript hlídá obojí
 * a k tomu dvě věci, které s tím souvisejí:
 *
 *  1. **Kdy** oprava dopadne (strop je 400 ms; naměřeno 58–337 ms podle toho,
 *     jak rychle dojedou feedy — před opravou to bylo 400–663 ms).
 *  2. Že se **počet karet nezmění** a **přeživší karty se neposunou** (D57).
 *  3. Kde na stránce začíná mřížka na telefonu (má být nad ohybem, do 600 px).
 *  4. Jaký podíl karet má Chaturbate (D63: ~třetina a první karta).
 *  5. CLS = 0.
 *  6. **Kolik viditelných karet OPRAVDU vysílá** (D67). Tohle tu do 29. 8.
 *     chybělo a je to jediné číslo, které Kenny vidí: na 13,9 h starém buildu
 *     bylo z 60 karet potvrzeně živých 12, tedy čtyři z pěti kliků skončily na
 *     „just ended the stream" — a test přesto hlásil „všechno v pořádku".
 *
 *  7. **Že v mřížce nejsou prázdné náhledy.** Kenny 29. 8.: „Cam4 nefunguje" —
 *     na `/site/cam4/` mělo 8 ze 40 karet prázdné místo místo obrázku, protože
 *     `snapshots.xcdnpro.com` vrací pro část modelek 404 s `text/html` a to
 *     prohlížeč u obrázku zahodí (ORB). Homepage to skoro neukáže (1 z 60),
 *     proto jde guard zamířit i na rozcestník sítě.
 *
 * Použití
 * -------
 *   pnpm build
 *   (cd dist/client && python3 -m http.server 8791 --bind 127.0.0.1 &)
 *   node scripts/check-grid.mjs [http://127.0.0.1:8791] [cesta]
 *
 * Cesta je volitelná (výchozí `/`); kontroly poměru sítí a ohybu dávají smysl
 * jen na homepage, na rozcestníku se přeskočí:
 *   node scripts/check-grid.mjs https://ecamx.com /site/cam4/
 *
 * Proti statickému serveru chybí `/api/online/`, takže se výměna nezmění —
 * pro body 3–5 to stačí. Plné měření (bod 1 a 2) dává smysl proti produkci:
 *   node scripts/check-grid.mjs https://ecamx.com
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8791';
const PATH = process.argv[3] ?? '/';
const HOME = PATH === '/';
const LIVE = !BASE.includes('127.0.0.1');
const CHROME = '/usr/bin/chromium';
/**
 * Do kolika ms od načtení má být mřížka opravená.
 *
 * Průchod se spouští buď jakmile dojedou všechny feedy, nebo nejpozději na
 * `FIRST_PASS_MS = 300` (Layout.astro) — podle toho, co nastane dřív. Naměřeno
 * na produkci 28. 8.: 168 ms, když feedy stihnou, 337 ms, když se čeká na strop.
 * Rozpočet je proto strop plus render, ne to rychlejší z obou čísel.
 * Před opravou to bylo 400–663 ms.
 */
const FIX_BUDGET_MS = 400;
/** Kam nejhlouběji smí na 390px telefonu začínat první karta. */
const FOLD_BUDGET_PX = 600;
/**
 * **Karta, o které VÍME, že nevysílá, nesmí zůstat vidět.**
 *
 * Původně tu byl práh „aspoň 80 % karet potvrzeně živých". Na homepage to
 * sedělo (82 %), ale na `/site/cam4/` to spadlo na 33 % — a při ověření se
 * ukázalo, že to není chyba webu: **z 27 nedoložených karet jich 19 podle
 * feedu staženého z Maliny vysílá.** Cam4 servíruje jiný roster podle IP
 * volajícího (D66), takže „chybí v odpovědi Workeru" u něj nic nedokazuje
 * a víc než třetinu doložit nejde ani teoreticky.
 *
 * Měří se proto to, co je skutečně vada: karta, kterou feed **vyvrací** —
 * chybí v odpovědi u sítě, kde absence něco znamená (chaturbate, bongacams,
 * amateur). Takovou měl živý průchod schovat. Podíl doložených se vypisuje
 * jako informace a hlídá se jen proti úplnému výpadku feedů.
 */
const MAX_DISPROVEN = 1;
const MIN_PROVEN_SHARE = 0.25;

let bad = 0;
const ok = (m) => console.log(`  ✓  ${m}`);
const fail = (m) => { bad++; console.log(`  ✗  ${m}`); };

const browser = await puppeteer.launch({
	executablePath: CHROME,
	args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const p = await browser.newPage();
await p.emulate({
	viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
	userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
});
await p.evaluateOnNewDocument(() => {
	try { localStorage.setItem('ecamx_age_ok', '1'); localStorage.setItem('ecamx_consent', 'granted'); } catch {}
	window.__cls = 0;
	new PerformanceObserver((l) => {
		for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
	}).observe({ type: 'layout-shift', buffered: true });
	// Kdy se karta poprvé vyměnila. Sleduje se DOM, ne časovač ve skriptu
	// stránky — jinak by se měřil kód, ne to, co člověk vidí.
	window.__firstSwap = null;
	addEventListener('DOMContentLoaded', () => {
		const grid = document.querySelector('[data-grid]');
		if (!grid) return;
		const t0 = performance.now();
		new MutationObserver((recs) => {
			if (window.__firstSwap !== null) return;
			for (const r of recs) {
				if (r.type === 'childList' && (r.addedNodes.length || r.removedNodes.length)) {
					window.__firstSwap = performance.now() - t0;
					return;
				}
			}
		}).observe(grid, { childList: true });
	});
});

const snap = () => p.evaluate(() => {
	const cards = [...document.querySelectorAll('[data-grid] .card')];
	const vis = cards.filter((c) => !c.hidden && c.offsetParent !== null);
	return {
		total: cards.length,
		visible: vis.length,
		ids: vis.map((c) => c.querySelector('a.stretch')?.getAttribute('href') ?? '?'),
		nets: vis.reduce((a, c) => { const n = c.dataset.network; a[n] = (a[n] || 0) + 1; return a; }, {}),
		first: vis[0]?.dataset.network ?? null,
		// `síť:slug` každé viditelné karty — proti tomuhle se ověřuje feed.
		keys: vis.map((c) => c.querySelector('[data-live-badge]')?.dataset.liveBadge ?? '?'),
	};
});

console.log(`[grid] ${BASE}${PATH}  (390×844)`);
await p.goto(`${BASE}${PATH}?g=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
const before = await snap();
await p.evaluate(() => new Promise((r) => setTimeout(r, 6000)));
const after = await snap();
const m = await p.evaluate(() => ({
	swap: window.__firstSwap,
	cls: window.__cls,
	// Kde na stránce začíná první karta — bez scrollování.
	fold: (() => {
		const c = document.querySelector('[data-grid] .card:not([hidden])');
		if (!c) return null;
		const r = c.getBoundingClientRect();
		return r.top + scrollY;
	})(),
}));

// 1) kdy dopadla oprava
if (m.swap === null) {
	console.log(`  ~  k výměně karet nedošlo${LIVE ? '' : ' (statický server nemá /api/online/)'}`);
} else if (m.swap <= FIX_BUDGET_MS) ok(`oprava mřížky dopadla za ${Math.round(m.swap)} ms`);
else fail(`oprava mřížky dopadla až za ${Math.round(m.swap)} ms (rozpočet ${FIX_BUDGET_MS})`);

// 2) mřížka nesmí zhubnout ani přeskládat přeživší
const gone = before.ids.filter((i) => !after.ids.includes(i));
const moved = after.ids.filter((id, i) => before.ids[i] !== undefined
	&& before.ids[i] !== id && after.ids.includes(before.ids[i])).length;
if (after.visible !== before.visible) {
	fail(`viditelných karet ubylo: ${before.visible} → ${after.visible}`);
} else ok(`viditelných karet pořád ${after.visible}`);
if (moved) fail(`${moved} přeživších karet se posunulo na jinou pozici (D57 to zakazuje)`);
else ok(`přeživší karty se neposunuly (vyměněno ${gone.length})`);

// 3) nad ohybem
if (m.fold === null) fail('v mřížce není žádná viditelná karta');
else if (m.fold <= FOLD_BUDGET_PX) ok(`první karta začíná na ${Math.round(m.fold)} px`);
else fail(`první karta až na ${Math.round(m.fold)} px (rozpočet ${FOLD_BUDGET_PX})`);

// 4) podíl Chaturbate — jen na homepage; na rozcestníku sítě je z definice jiný
if (!HOME) {
	console.log(`  ~  poměr sítí se na ${PATH} nekontroluje`);
} else {
const cb = after.nets.chaturbate ?? 0;
const share = Math.round((100 * cb) / Math.max(1, after.visible));
if (share >= 25 && share <= 45) ok(`Chaturbate má ${cb} z ${after.visible} karet (${share} %)`);
else fail(`Chaturbate má ${cb} z ${after.visible} karet (${share} %) — čekáno 25–45 %`);
if (after.first === 'chaturbate') ok('první karta je Chaturbate');
else fail(`první karta je ${after.first}, ne chaturbate`);
// Síť, kterou build do mřížky proložil, z ní po živém průchodu nesmí zmizet
// úplně — jinak agregátor deseti webů ukazuje sedm (změřeno 28. 8.).
const gonoNets = Object.keys(before.nets).filter((n) => !after.nets[n]);
const thin = Object.entries(after.nets).filter(([, n]) => n < 2).map(([k]) => k);
if (gonoNets.length) fail(`z mřížky zmizely sítě: ${gonoNets.join(', ')}`);
else if (thin.length > 2) fail(`sítě skoro zmizely z mřížky: ${thin.join(', ')}`);
else ok(`v mřížce zůstalo ${Object.keys(after.nets).length} sítí ze ${Object.keys(before.nets).length}`);
}

// 7) prázdné náhledy
// Lazy obrázky se donutí načíst až TEĎ — dřív by to zkreslilo CLS i měření
// ohybu, protože by se stahovalo všech 60 najednou.
const thumbs = await p.evaluate(async () => {
	for (const i of document.querySelectorAll('[data-grid] .card:not([hidden]) img')) i.loading = 'eager';
	window.scrollTo(0, document.body.scrollHeight);
	await new Promise((r) => setTimeout(r, 9000));
	const cards = [...document.querySelectorAll('[data-grid] .card:not([hidden])')];
	const bad = cards.filter((c) => {
		const i = c.querySelector('.thumb-wrap img');
		return !i || (i.complete && i.naturalWidth === 0);
	});
	return {
		total: cards.length,
		bad: bad.length,
		nets: bad.reduce((a, c) => { const n = c.dataset.network ?? '?'; a[n] = (a[n] || 0) + 1; return a; }, {}),
	};
});
if (!thumbs.bad) ok(`všech ${thumbs.total} viditelných karet má náhled`);
else fail(`${thumbs.bad} z ${thumbs.total} karet je bez náhledu (${Object.entries(thumbs.nets).map(([k, v]) => `${k} ${v}`).join(', ')})`);

// 6) kolik karet opravdu vysílá
if (!LIVE) {
	console.log('  ~  podíl živých karet se proti statickému serveru změřit nedá');
} else {
	const feeds = await p.evaluate(async (keys) => {
		const nets = [...new Set(keys.map((k) => k.split(':')[0]))].filter((n) => n && n !== '?');
		const out = {};
		await Promise.all(nets.map(async (n) => {
			try {
				const r = await fetch(`/api/online/${n}/?probe=${Date.now()}`);
				const d = await r.json();
				// `absenceUnproven` rozhoduje, jestli chybějící modelka něco
				// dokazuje — je to tatáž vlastnost, podle které se řídí web.
				if (d?.online) out[n] = { online: d.online, unproven: !!d.absenceUnproven };
			} catch { /* síť bez feedu: nedokazuje nic */ }
		}));
		return out;
	}, after.keys);

	let proven = 0;
	const disproven = [];
	for (const k of after.keys) {
		const i = k.indexOf(':');
		const [net, slug] = [k.slice(0, i), k.slice(i + 1)];
		const f = feeds[net];
		if (f?.online[slug] !== undefined) { proven++; continue; }
		if (f && !f.unproven) disproven.push(k);
	}
	const builtAt = Date.parse(await p.evaluate(() =>
		document.querySelector('meta[name="ecamx-built"]')?.content ?? ''));
	const hours = Number.isNaN(builtAt) ? 0 : (Date.now() - builtAt) / 3_600_000;
	const share = proven / Math.max(1, after.visible);

	if (disproven.length <= MAX_DISPROVEN) {
		ok(`žádná karta, o které by feed říkal, že nevysílá${disproven.length ? ` (kromě ${disproven.length})` : ''}`);
	} else {
		fail(`${disproven.length} karet feed vyvrací, a přesto jsou vidět: ${disproven.slice(0, 3).join(', ')}`);
	}
	const info = `doloženo živých ${proven} z ${after.visible} (${Math.round(share * 100)} %), stránka ${hours.toFixed(1)} h stará`;
	if (share >= MIN_PROVEN_SHARE) console.log(`  ~  ${info}; zbytek jsou sítě, kde absence nic nedokazuje (D66)`);
	else fail(`${info} — tak nízko to jde jen když feedy nedojely`);
}

// 5) CLS
if (m.cls < 0.005) ok(`CLS ${m.cls.toFixed(4)}`);
else fail(`CLS ${m.cls.toFixed(4)} — mřížka nesmí posouvat obsah`);

await browser.close();
console.log(bad ? `\n${bad} problém(y)` : '\nvšechno v pořádku');
process.exit(bad ? 1 : 0);
