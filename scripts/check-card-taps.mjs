/**
 * Kam vede klepnutí do karty v mřížce — měřeno v prohlížeči, ne odhadem.
 *
 * Proč to existuje
 * ----------------
 * 27. 8. 2026: „když kliknu na cam, tak mě to přesměruje a hned mi to vypne."
 * Karta tehdy měla dva odkazy — plochu na naši stránku a tlačítko „Chat →" ven —
 * a to tlačítko sedělo uvnitř náhledu, takže se na dotyku dalo trefit omylem.
 * Z kódu se to nepozná: CSS je v pořádku, chyba je v geometrii. Proto se měří.
 * Viz D61.
 *
 * **Od 3. 9. 2026 karta odchozí odkaz nemá vůbec** (D71): za sedm dní neudělal
 * ani jeden proklik, zatímco klik do streamu na stránce modelky jich měl 27
 * z 36. Test proto hlídá silnější vlastnost — z karty se **nedá** odejít ven,
 * ať člověk klepne kamkoli. Kdyby se odchozí odkaz do karty vrátil, spadne to
 * tady, ne až v číslech za měsíc.
 *
 * Co kontroluje
 * -------------
 * Dotyk (390 px):  18 bodů po ploše karty — každý, který trefí odkaz, musí vést
 *                  na `/live/`; nikdy na `/go/` ani ven. Počet diváků je vidět,
 *                  CLS = 0.
 * Myš (640–1440):  totéž při najetí myší, kdy se dřív odkrývala pilulka —
 *                  a navíc že střed karty pořád vede na stránku modelky.
 *
 * Past prostředí: headless Chromium na Malině hlásí `hover: none` a
 * `pointer: none` a `Emulation.setEmulatedMedia` s tím nepohne. Myší větev se
 * proto vynutí přepsáním media queries v DORUČENÉM CSS (`hover: hover` → `all`,
 * `hover: none` → podmínka, která nikdy neplatí). Bez toho se i na 1440 px měří
 * dotyková větev a test „projde" na nesprávném stylu.
 *
 * Použití
 * -------
 *   pnpm build
 *   (cd dist/client && python3 -m http.server 8791 --bind 127.0.0.1 &)
 *   node scripts/check-card-taps.mjs [http://127.0.0.1:8791]
 *
 * Do CI to nepatří — potřebuje prohlížeč a postavené `dist/`. Ručně po každé
 * změně karty, `.stretch` nebo poměru stran náhledu.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8791';
const CHROME = '/usr/bin/chromium';
const TOUCH_PATHS = ['/', '/cams/bbw/'];
const MOUSE_WIDTHS = [1440, 1024, 768, 640];
const rows = [];
let bad = 0;
const fail = (msg) => { bad++; rows.push(`  ✗  ${msg}`); };
const ok = (msg) => rows.push(`  ✓  ${msg}`);

const browser = await puppeteer.launch({
	executablePath: CHROME,
	args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/** Věková lišta ani souhlas nesmí zakrývat mřížku — tohle není jejich test. */
const seed = () => { try { localStorage.setItem('ecamx_age_ok', '1'); localStorage.setItem('ecamx_consent', 'granted'); } catch {} };

// ── dotyk ───────────────────────────────────────────────────────────────────
for (const path of TOUCH_PATHS) {
	const p = await browser.newPage();
	await p.emulate({
		viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	});
	await p.evaluateOnNewDocument(() => {
		window.__cls = 0;
		new PerformanceObserver((l) => {
			for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
		}).observe({ type: 'layout-shift', buffered: true });
	});
	await p.evaluateOnNewDocument(seed);
	await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 120_000 });
	await p.evaluate(() => new Promise((r) => setTimeout(r, 2500)));

	const m = await p.evaluate(() => {
		const card = document.querySelector('[data-grid] .card:not([hidden])');
		if (!card) return null;
		// Bez posunu leží spodek karty pod okrajem okna a `elementFromPoint`
		// vrátí null — vypadalo by to jako chyba webu, přitom je to chyba měření.
		card.scrollIntoView({ block: 'center' });
		const g = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height, w: b.width }; };
		const cb = g(card);
		const probes = [];
		for (const fy of [0.15, 0.35, 0.5, 0.65, 0.8, 0.92]) {
			for (const fx of [0.2, 0.5, 0.85]) {
				const a = document.elementFromPoint(cb.l + cb.w * fx, cb.t + cb.h * fy)?.closest('a');
				const href = a?.getAttribute('href') ?? '';
				probes.push({ fx, fy, href, out: href.startsWith('/go/') });
			}
		}
		return { card: cb, viewer: g(card.querySelector('.viewer-count')), probes, cls: window.__cls };
	});
	await p.close();
	rows.push(`\ndotyk 390 px — ${path}`);
	if (!m) { fail('v mřížce není žádná viditelná karta'); continue; }

	// Z karty se nesmí dát odejít ven, ať člověk klepne kamkoli.
	const leaks = m.probes.filter((q) => q.out);
	if (leaks.length) {
		fail(`${leaks.length} z 18 bodů karty vede VEN (D71: karta nemá mít odchozí odkaz):`);
		for (const q of leaks) rows.push(`     ${(q.fx * 100).toFixed(0)} %, ${(q.fy * 100).toFixed(0)} % → ${q.href}`);
	} else ok('žádný z 18 bodů karty nevede ven');

	// A hlavně: klepnutí musí někam vést. Karta, kde půlka plochy nedělá nic,
	// je horší než karta s tlačítkem.
	const dead = m.probes.filter((q) => !q.href);
	if (dead.length > 3) fail(`${dead.length} z 18 bodů karty nevede nikam — plocha není proklikávací`);
	else ok(`${18 - dead.length} z 18 bodů karty vede na /live/`);

	if (m.viewer && m.viewer.b > m.card.b + 0.5) fail('počet diváků leží mimo kartu');
	else ok('počet diváků je čitelný');

	if (m.cls >= 0.005) fail(`CLS ${m.cls.toFixed(4)} — mřížka nesmí nic posunout`);
	else ok(`CLS ${m.cls.toFixed(4)}`);
}

// ── myš ─────────────────────────────────────────────────────────────────────
rows.push('\nmyš (media queries vynucené přepsáním doručeného CSS)');
for (const w of MOUSE_WIDTHS) {
	const p = await browser.newPage();
	await p.setViewport({ width: w, height: 900 });
	await p.setRequestInterception(true);
	p.on('request', async (req) => {
		if (!/\.css(\?|$)/.test(req.url())) return req.continue();
		try {
			const css = (await (await fetch(req.url())).text())
				.replaceAll('(hover:hover)', 'all').replaceAll('(hover: hover)', 'all')
				.replaceAll('(hover:none)', '(hover:jen-dotyk)').replaceAll('(hover: none)', '(hover:jen-dotyk)');
			req.respond({ status: 200, contentType: 'text/css', body: css });
		} catch { req.continue(); }
	});
	await p.evaluateOnNewDocument(seed);
	await p.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 120_000 });
	const m = await p.evaluate(async () => {
		const card = document.querySelector('[data-grid] .card:not([hidden])');
		if (!card) return null;
		card.scrollIntoView({ block: 'center' });
		const b = card.getBoundingClientRect();
		// Najet myší: kdyby se odchozí pilulka vrátila, odkryje se právě teď.
		card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 300));
		const probes = [];
		for (const fy of [0.15, 0.5, 0.8, 0.92]) {
			for (const fx of [0.2, 0.5, 0.85]) {
				const a = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy)?.closest('a');
				const href = a?.getAttribute('href') ?? '';
				probes.push({ fx, fy, href, out: href.startsWith('/go/') });
			}
		}
		const mid = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('a');
		return { probes, mid: mid?.getAttribute('href') ?? '' };
	});
	await p.close();
	if (!m) { fail(`${w} px: v mřížce není žádná viditelná karta`); continue; }
	const leaks = m.probes.filter((q) => q.out);
	if (leaks.length) fail(`${w} px: ${leaks.length} bodů vede ven (${leaks[0].href})`);
	else if (!m.mid.startsWith('/live/')) fail(`${w} px: střed karty vede na „${m.mid || 'nikam'}", ne na /live/`);
	else ok(`${w} px: ani po najetí myší nevede z karty nic ven, střed míří na ${m.mid}`);
}

await browser.close();
console.log(rows.join('\n'));
console.log(bad ? `\n${bad} problém(y)` : '\nvšechno v pořádku');
process.exit(bad ? 1 : 0);
