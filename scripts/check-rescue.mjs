/**
 * Zachrání se mřížka, když data z buildu zestárnou? Měřeno v prohlížeči.
 *
 * Proč to existuje
 * ----------------
 * Kenny 29. 8. 2026: „chci aby fungoval stream když na ně kliknu." Změřeno na
 * produkci na 8,3 h starém buildu: z 60 karet v HTML byly potvrzeně živé **2**
 * (3 %), Chaturbate 0 z 20. Od D67 si proto mřížka nad 3 h stáří dotáhne karty
 * z živého feedu.
 *
 * Jenže **na čerstvé produkci se ta cesta nespustí** — a to je správně: záchrana
 * má podmínku „stránka starší 3 h A živých je míň než polovina". `check-grid.mjs`
 * tedy měří jen ten dobrý případ. Tenhle skript dělá druhou půlku: podstrčí
 * stránce starou značku buildu **a prořídí feed, ze kterého se pozná živost
 * karet z buildu**, na 5 % — tím se přesně nasimuluje stará stránka. Feed
 * s `?cards=` (zdroj záchrany) projde nedotčený, jinak by se testovala vlastní
 * podvržená data místo produkce.
 *
 * Co musí vyjít
 * -------------
 *  1. Po průchodu **vysílá skoro každá viditelná karta** (naměřeno 60 z 60).
 *  2. **Žádná karta nevede ven.** Od D71 nemá odchozí odkaz vůbec žádná karta —
 *     tlačítko „Chat →" za týden neudělalo ani jeden proklik, zatímco klik do
 *     streamu na stránce modelky jich měl 27 z 36. Do 29. 8. navíc mířila
 *     záchranná karta na
 *     `/live/{slug}/?r={síť}&n={nick}` a když u nás stránka nebyla, Worker
 *     poslal člověka rovnou do pokoje partnera — čtvrtina záchranných kliků
 *     (změřeno: chaturbate 19 z 20 stránek máme, stripchat 12 z 20). Kenny to
 *     zakázal, takže karty teď vznikají jen pro modelky se stránkou a odkaz
 *     je čistý `/live/{page}/`. CTA „Chat →" má dál `p=rescue`, to je vědomý
 *     klik ven (jinak by se měřil jako `card` — past 75).
 *  3. Přeživší karty se neposunuly (D57) a CLS je 0.
 *  4. Náhledy karet nad ohybem se opravdu načetly — CSP `img-src` musí znát
 *     i hosty sítí, které v buildu neměly ani jednu kartu (past 105).
 *
 * Použití
 * -------
 *   node scripts/check-rescue.mjs [https://ecamx.com]
 *
 * Potřebuje prohlížeč a živý web; proti statickému serveru nemá co měřit.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'https://ecamx.com';
const OLD = new Date(Date.now() - 10 * 3600_000).toISOString();
const browser = await puppeteer.launch({
	executablePath: '/usr/bin/chromium',
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
});
await p.setRequestInterception(true);
p.on('request', async (req) => {
	const u = req.url();
	if (req.resourceType() === 'document') {
		const r = await fetch(u, { headers: { 'User-Agent': 'ecamx-check/1.0' } });
		let html = await r.text();
		html = html.replace(/(<meta name="ecamx-built" content=")[^"]*(")/, `$1${OLD}$2`);
		return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
	}
	// Feed BEZ `cards` = ten, ze kterého se pozná živost karet z buildu.
	// Prořídíme ho na 5 %, čímž se nasimuluje stará stránka: většina karet
	// přestane být doložitelně živá. Feed S `cards` (zdroj záchrany) projde
	// nedotčený, jinak by se testovala naše vlastní podvržená data.
	if (u.includes('/api/online/') && !u.includes('cards=') && !u.includes('verify=')) {
		const r = await fetch(u, { headers: { 'User-Agent': 'ecamx-check/1.0' } });
		const d = await r.json();
		const keys = Object.keys(d.online ?? {});
		const keep = keys.filter((_, i) => i % 20 === 0);
		d.online = Object.fromEntries(keep.map((k) => [k, d.online[k]]));
		return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
	}
	req.continue();
});

await p.goto(`${BASE}/?r=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
const before = await p.evaluate(() => [...document.querySelectorAll('[data-grid] .card')]
	.filter((c) => !c.hidden).map((c) => c.querySelector('[data-live-badge]')?.dataset.liveBadge ?? '?'));
await p.evaluate(() => new Promise((r) => setTimeout(r, 12000)));

const st = await p.evaluate(async () => {
	const cards = [...document.querySelectorAll('[data-grid] .card')].filter((c) => !c.hidden);
	const keys = cards.map((c) => c.querySelector('[data-live-badge]')?.dataset.liveBadge ?? '?');
	const nets = [...new Set(keys.map((k) => k.split(':')[0]))].filter((n) => n && n !== '?');
	const feeds = {};
	await Promise.all(nets.map(async (n) => {
		try { feeds[n] = (await (await fetch(`/api/online/${n}/?verify=${Date.now()}`)).json()).online ?? {}; }
		catch { feeds[n] = {}; }
	}));
	const proven = keys.filter((k) => {
		const i = k.indexOf(':');
		return feeds[k.slice(0, i)]?.[k.slice(i + 1)] !== undefined;
	});
	return {
		keys, visible: cards.length, proven: proven.length, cls: window.__cls,
		rescued: cards.filter((c) => c.classList.contains('is-swapped')).length,
		nets: keys.reduce((a, k) => { const n = k.split(':')[0]; a[n] = (a[n] || 0) + 1; return a; }, {}),
		links: cards.slice(0, 3).map((c) => c.querySelector('a.stretch')?.getAttribute('href')),
		// Jen karty nad ohybem — u lazy obrázků níž je naturalWidth 0 i v pořádku.
		broken: cards.slice(0, 6).filter((c) => { const i = c.querySelector('.thumb-wrap img'); return i && i.complete && i.naturalWidth === 0; }).length,
		// Karta z feedu se pozná podle `data-rescued`; její odkaz je čistý
		// `/live/`, k nerozeznání od karty z buildu — a přesně to je cíl.
		fromFeed: cards.filter((c) => c.dataset.rescued).length,
		// Cokoli, co z karty vede mimo náš web nebo přes `/go/` bez kliknutí.
		outbound: cards.map((c) => c.querySelector('a.stretch')?.getAttribute('href') ?? '')
			.filter((h) => !h.startsWith('/live/')),
		rescueHrefs: cards.filter((c) => c.dataset.rescued)
			.map((c) => c.querySelector('a.stretch')?.getAttribute('href') ?? ''),
	};
});

const moved = st.keys.filter((k, i) => before[i] !== undefined && before[i] !== k && st.keys.includes(before[i])).length;
const swapped = st.keys.filter((k) => !before.includes(k)).length;
const share = st.proven / Math.max(1, st.visible);

let bad = 0;
const ok = (m) => console.log(`  ✓  ${m}`);
const fail = (m) => { bad++; console.log(`  ✗  ${m}`); };

console.log(`[rescue] ${BASE} — stránka podstrčena jako 10 h stará, feed živosti prořídlý na 5 %`);
console.log(`         viditelných ${st.visible}, vyměněno ${swapped}, z feedu ${st.fromFeed}`);

// 1) hlavní věc: po záchraně musí drtivá většina karet opravdu vysílat
if (share >= 0.8) ok(`potvrzeně vysílá ${st.proven} z ${st.visible} (${Math.round(share * 100)} %)`);
else fail(`potvrzeně vysílá jen ${st.proven} z ${st.visible} (${Math.round(share * 100)} %) — čekáno aspoň 80 %`);

// 2) záchrana se spustila, měří se jako `rescue` a NIC nevede ven
if (!st.fromFeed) fail('nepřibyla ani jedna karta z feedu — záchrana se nespustila');
else ok(`${st.fromFeed} karet z feedu`);
if (st.outbound.length) fail(`${st.outbound.length} karet nevede na /live/: ${st.outbound.slice(0, 3).join(', ')}`);
else ok('každá karta vede na naši stránku /live/, žádná ven');

// Odkaz musí opravdu existovat — karta pro modelku bez stránky by skončila
// na abecedním rozcestníku a člověk by nenašel, na co klikl.
const sample = st.rescueHrefs.slice(0, 8);
const codes = await Promise.all(sample.map(async (h) => {
	try { return (await fetch(BASE + h, { redirect: 'manual' })).status; } catch { return 0; }
}));
const notOk = codes.filter((c) => c !== 200).length;
if (!sample.length) console.log('  ~  žádná záchranná karta k ověření adresy');
else if (!notOk) ok(`${sample.length} ověřených adres záchranných karet vrací 200`);
else fail(`${notOk} z ${sample.length} adres záchranných karet nevrací 200 (${codes.join(', ')})`);

// 3) mřížka se pod rukou nesmí hýbat (D57)
if (st.visible !== before.length) fail(`viditelných karet ubylo: ${before.length} → ${st.visible}`);
else ok(`viditelných karet pořád ${st.visible}`);
if (moved) fail(`${moved} přeživších karet se posunulo (D57 to zakazuje)`);
else ok('přeživší karty se neposunuly');
if (st.cls < 0.005) ok(`CLS ${st.cls.toFixed(4)}`);
else fail(`CLS ${st.cls.toFixed(4)} — záchranné karty nesmí posouvat obsah`);

// 4) náhledy se musí načíst (CSP zná hosty všech sítí, past 105)
if (st.broken) fail(`${st.broken} karet nad ohybem má prázdný náhled — nejspíš CSP img-src`);
else ok('náhledy nad ohybem se načetly');

// 5) Chaturbate vydělává nejvíc, záchrana ho nesmí ředit (D63)
const cb = st.nets.chaturbate ?? 0;
const cbShare = Math.round((100 * cb) / Math.max(1, st.visible));
if (cbShare >= 25 && cbShare <= 45) ok(`Chaturbate má ${cb} z ${st.visible} karet (${cbShare} %)`);
else fail(`Chaturbate má ${cb} z ${st.visible} karet (${cbShare} %) — čekáno 25–45 %`);
console.log(`         sítě: ${Object.entries(st.nets).map(([k, v]) => `${k} ${v}`).join(', ')}`);

await browser.close();
console.log(bad ? `\n${bad} problém(y)` : '\nvšechno v pořádku');
process.exit(bad ? 1 : 0);
