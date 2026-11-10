/**
 * Hrají naše vlastní přehrávače (BongaCams, Cam4)? Měřeno v prohlížeči.
 *
 * Proč to existuje
 * ----------------
 * 27. 8. 2026 dostal BongaCams místo iframu (ten je na EasyListu, D56) vlastní
 * `<video>` s HLS z jejich feedu (D62). Na téhle cestě může tiše selhat pět
 * věcí naráz — adresa z buildu je stará, playlist vrátí 200 a přitom je prázdný,
 * knihovna se nenačte, prohlížeč neumí H.264, nebo se autoplay zablokuje.
 * Z kódu se to nepozná; ze stránky ano.
 *
 * Co kontroluje
 * -------------
 *  1. Na stránce BongaCams modelky je `<video data-hls>` s adresou na bcvcdn.
 *  2. Stáhne se playlist i aspoň jeden segment (tedy stream opravdu teče).
 *  3. Přehrávání se rozjede samo (`currentTime` roste) — pokud to prostředí
 *     umí; hlásí se zvlášť, protože headless Chromium nemusí mít H.264.
 *  4. **Fallback**: při rozbité adrese `<video>` zmizí a odkryje se odkaz do
 *     pokoje. Mrtvý přehrávač je horší než žádný.
 *  5. **Povýšená stránka** (D67): stránka se stavěla jako offline, ale modelka
 *     vysílá — stream se musí rozjet SÁM. Do 29. 8. se jen odkrylo tlačítko
 *     a Kenny na to narazil: „stream neběží a musíme zmáčknout play."
 *  6. **Náhrada** (D67): na stránce modelky, která zrovna dovysílala, se místo
 *     hlášky „just ended the stream" rozjede stream někoho jiného ze stejné
 *     sítě — a proužek nad ním poctivě říká, že je to někdo jiný. Tenhle případ
 *     jde změřit jen proti živému webu, protože potřebuje `/api/online/`.
 *
 * Vynucená cesta přes hls.js není formalita: 28. 8. ji shodila nová CSP,
 * protože knihovna dává `<video>` MediaSource přes `blob:` a `media-src` ho
 * nepovoloval. Nativní přehrávání (Safari, Chrome na Androidu) přitom hrálo
 * dál, takže by se to poznalo až na desktopu — a v konzoli se to neprojevilo.
 *
 * Použití
 * -------
 *   pnpm build
 *   (cd dist/client && python3 -m http.server 8791 --bind 127.0.0.1 &)
 *   node scripts/check-hls-player.mjs [adresa] [síť]
 *
 * Síť je `bongacams` (výchozí) nebo `cam4`. Případy „povýšená stránka"
 * a „náhrada" se pouštějí jen ve výchozím běhu — nejsou o síti, ale o stránce.
 *
 * Do CI to nepatří — potřebuje prohlížeč, postavené `dist/` a živou modelku.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8791';
const LIVE = !BASE.includes('127.0.0.1');
/**
 * Sítě s vlastním `<video>` místo cizího rámce.
 *
 * `stale` říká, jestli má smysl zkoušet adresu z buildu: u BongaCams jich
 * 40 minut po syncu hrálo 14 z 25 (D62), u Cam4 byla 12 h stará mrtvá u 8 z 8,
 * takže si stránka bere čerstvou z `/api/stream/` rovnou (D70) — a test nesmí
 * stránku zahodit jen proto, že adresa v HTML už nehraje.
 */
const NETS = {
	bongacams: { host: /bcvcdn\.com/, label: 'bcvcdn.com', buildUrlUsable: true },
	cam4: { host: /-hls\.xcdnpro\.com/, label: 'xcdnpro.com', buildUrlUsable: false },
};
const NET = process.argv[3] ?? 'bongacams';
const CFG = NETS[NET];
if (!CFG) { console.error(`neznámá síť ${NET}; znám ${Object.keys(NETS).join(', ')}`); process.exit(1); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/usr/bin/chromium';

/**
 * Stránku bere z TESTOVANÉHO webu, ne z lokálních dat.
 *
 * Původně se modelka vybírala z `src/data/models.json` — a když mezitím
 * dovysílala (za 27 minut jich skončí 18 %), test měřil offline stránku
 * a hlásil pět chyb, které s přehrávačem nesouvisely. Rozcestník sítě ukazuje,
 * co je živé právě teď, takže se vybírá odtud a ověřuje se, že stránka
 * přehrávač opravdu má.
 */
async function pickPage(browser) {
	const p = await browser.newPage();
	await p.goto(`${BASE}/site/${NET}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	const links = await p.evaluate(() => [...document.querySelectorAll('[data-grid] .card:not([hidden]) a.stretch')]
		.slice(0, 12).map((a) => a.getAttribute('href')));
	for (const href of links) {
		await p.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		const src = await p.evaluate(() => document.querySelector('video[data-hls]')?.getAttribute('data-hls') ?? '');
		if (!src.includes(CFG.label)) continue;
		// Karta může být „živá" jen podle buildu — playlist skončené modelky
		// vrací HTTP 200 a 25 bajtů bez jediné varianty (past 85). Bez tohohle
		// test měřil mrtvý stream a hlásil pět chyb, které s kódem nesouvisely.
		// U sítě, kde se adresa z buildu stejně zahazuje, se to nekontroluje.
		// **Síť, která adresu z buildu zahazuje, se musí ověřit na `/api/stream/`.**
		// Tady dřív test stránku vzal bez jakékoli kontroly živosti — a protože
		// mřížka na `/site/cam4/` je z buildu starého až 8 h, vybral pravidelně
		// modelku, která už dovysílala (7. 9. 2026 `salixbby`, `{"offline":true}`)
		// a pak hlásil osm chyb v přehrávači, který byl v pořádku. Autorita je
		// tentýž endpoint, ze kterého adresu bere i stránka (D70).
		if (!CFG.buildUrlUsable) {
			const nick = await p.evaluate(() =>
				document.querySelector('[data-player]')?.getAttribute('data-slug')
				?? document.querySelector('video[data-hls]')?.getAttribute('data-slug') ?? '');
			if (!nick) continue;
			const live = await fetch(`${BASE}/api/stream/${NET}/${encodeURIComponent(nick)}/`)
				.then((r) => r.json()).catch(() => ({}));
			if (!live.url) continue;
			const fresh = await fetch(live.url).then((r) => r.text()).catch(() => '');
			if (!fresh.includes('#EXT-X-STREAM-INF')) continue;
			await p.close();
			return href;
		}
		const m3u8 = await fetch(src).then((r) => r.text()).catch(() => '');
		if (m3u8.includes('#EXT-X-STREAM-INF')) { await p.close(); return href; }
	}
	await p.close();
	throw new Error(`na /site/${NET}/ není ani jedna karta se stránkou, která má HLS přehrávač`);
}

const browser = await puppeteer.launch({
	executablePath: CHROME,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const url = BASE + await pickPage(browser);
let bad = 0;
const ok = (m) => console.log(`  ✓  ${m}`);
const fail = (m) => { bad++; console.log(`  ✗  ${m}`); };

/**
 * Jeden průchod stránkou. `breakHls` podstrčí rozbitou adresu, `forceLib`
 * předstírá prohlížeč bez nativního HLS (tedy desktopový Chrome).
 *
 * Proč `forceLib`: Chromium na Malině hlásí
 * `canPlayType('application/vnd.apple.mpegurl') === 'maybe'` a HLS přehraje
 * **sám**, bez knihovny. Bez vynucení by se cesta přes `hls.js` — ta, kterou
 * uvidí většina návštěvníků — nikdy neotestovala.
 */
async function run(breakHls, forceLib = false) {
	const p = await browser.newPage();
	const seen = { playlist: 0, chunks: 0, segment: 0, lib: 0 };
	// JEDEN handler na všechno: druhé `on('request')` by se s prvním pralo
	// o tentýž požadavek („Request is already handled").
	await p.setRequestInterception(true);
	p.on('request', (req) => {
		const u = req.url();
		// Obnova adresy z živého feedu by test zamlžila — statický server ji
		// stejně nemá, tak se odpoví prázdnem.
		if (u.includes('/api/online/')) {
			return req.respond({ status: 200, contentType: 'application/json', body: '{}' });
		}
		if (CFG.host.test(u)) {
			if (breakHls) return req.respond({ status: 404, body: 'nope' });
			// Podle přípony, ne podle názvu: BongaCams má `playlist.m3u8`
			// a `chunks.m3u8`, Cam4 obojí pojmenované `index.m3u8` (a variantu
			// ještě s `?tkn=`). Na názvy se to vázalo do 30. 8. a u Cam4 to
			// hlásilo „playlist se nestáhl vůbec", i když stream hrál.
			if (/\.m3u8(\?|$)/.test(u)) {
				if (u.includes('chunks.m3u8')) seen.chunks++; else seen.playlist++;
			} else seen.segment++;
		}
		if (/hls\.light/.test(u)) seen.lib++;
		req.continue();
	});
	await p.evaluateOnNewDocument(() => {
		try { localStorage.setItem('ecamx_age_ok', '1'); localStorage.setItem('ecamx_consent', 'granted'); } catch {}
	});
	if (forceLib) {
		await p.evaluateOnNewDocument(() => { HTMLMediaElement.prototype.canPlayType = () => ''; });
	}
	await p.goto(url, { waitUntil: 'networkidle2', timeout: 120_000 });
	await p.evaluate(() => new Promise((r) => setTimeout(r, 9000)));
	const state = await p.evaluate(() => {
		const v = document.querySelector('video[data-hls]');
		const hit = document.querySelector('[data-hls-fallback]');
		return {
			video: !!v,
			src: v?.getAttribute('data-hls') ?? '',
			time: v?.currentTime ?? 0,
			ready: v?.readyState ?? -1,
			fallbackShown: !!hit && !hit.hidden,
			h264: typeof MediaSource !== 'undefined'
				&& MediaSource.isTypeSupported('video/mp4; codecs="avc1.640c28,mp4a.40.2"'),
		};
	});
	await p.close();
	return { seen, state };
}

console.log(`[hls] ${NET} — ${url}`);

/** Společné posouzení jednoho průchodu. */
function judge(what, r, expectLib) {
	console.log(`[hls] ${what}:`);
	if (!r.state.src.includes(CFG.label)) fail(`v <video> není adresa na ${CFG.label}: ${r.state.src.slice(0, 60)}`);
	else ok(`<video data-hls> míří na ${r.state.src.split('/')[2]}`);
	if (expectLib && !r.seen.lib) fail('hls.js se nenačetl, i když prohlížeč HLS neumí');
	else if (expectLib) ok('hls.js načten (lazy chunk)');
	else ok('prohlížeč umí HLS nativně → knihovna se správně netáhla');
	if (!r.seen.playlist) fail('playlist se nestáhl vůbec');
	else if (!r.seen.segment) fail(`playlist stažen (${r.seen.playlist}×), ale ŽÁDNÝ segment — stream neteče`);
	else ok(`stream teče: manifestů ${r.seen.playlist + r.seen.chunks}×, segmentů ${r.seen.segment}`);
	if (r.state.time > 0) ok(`přehrávání běží samo (currentTime ${r.state.time.toFixed(1)} s)`);
	else if (!r.state.h264) console.log('  ~  přehrávání neověřeno: tenhle Chromium nemá H.264 (segmenty se ale stahují)');
	else fail(`stream se nerozjel (readyState ${r.state.ready})`);
	if (r.state.fallbackShown) fail('odkaz místo přehrávače je odkrytý, i když stream jede');
}

judge('tenhle prohlížeč', await run(false), false);
judge('vynucená cesta přes hls.js (jako desktopový Chrome)', await run(false, true), true);

console.log('[hls] fallback při rozbité adrese:');
const broken = await run(true);
if (broken.state.video) fail('<video> zůstalo na stránce, i když stream nejde');
else ok('<video> zmizelo');
if (!broken.state.fallbackShown) fail('neodkryl se odkaz do pokoje — na stránce je díra');
else ok('odkryl se odkaz do pokoje');

/**
 * Stránka modelky, která dovysílala, musí hrát někoho jiného (D67).
 *
 * Která to je, se dopředu neví — vybírá se pokusem: projdou se karty na
 * rozcestníku Chaturbate (síť s nejvyšší prioritou, D63, a s embedem u každé
 * modelky) a hledá se první stránka, na které živá kontrola opravdu zhasla.
 * Vybírat podle feedu by nestačilo: chybět ve zkráceném feedu ještě neznamená
 * být offline (D11/D66), takže by se testovala stránka, kde se nic neděje.
 */
async function substituteCase() {
	const p = await browser.newPage();
	await p.evaluateOnNewDocument(() => {
		try { localStorage.setItem('ecamx_age_ok', '1'); localStorage.setItem('ecamx_consent', 'granted'); } catch {}
	});
	await p.goto(`${BASE}/site/chaturbate/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	const links = await p.evaluate(() => [...document.querySelectorAll('[data-grid] .card a.stretch')]
		.slice(0, 40).map((a) => a.getAttribute('href')));

	for (const href of links) {
		await p.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		await p.evaluate(() => new Promise((r) => setTimeout(r, 6000)));
		const st = await p.evaluate(() => {
			const note = document.querySelector('[data-substitute-note]');
			const off = document.querySelector('[data-player-offline]');
			const msg = document.querySelector('[data-offline-msg]');
			const frame = document.querySelector('[data-player]');
			return {
				note: !!note && !note.hidden,
				offline: !!off && !off.hidden,
				text: note?.querySelector('[data-substitute-text]')?.textContent ?? '',
				name: frame?.dataset.name ?? '',
				media: !!frame?.querySelector('iframe, video'),
				msgShown: !!msg && !msg.hasAttribute('hidden'),
				out: [...document.querySelectorAll('a[href^="/go/"]')].length,
			};
		});
		if (!st.note && !st.offline) continue;   // pořád vysílá → další

		console.log(`[hls] náhrada na ${href}:`);
		if (st.offline && !st.note) {
			fail('modelka dovysílala a místo náhrady se ukázala hláška — přesně to, co Kenny nechtěl');
			await p.close();
			return;
		}
		if (st.media) ok('v ploše přehrávače běží někdo jiný');
		else fail('proužek o náhradě je vidět, ale v ploše není ani iframe, ani video');
		if (st.text.includes('now playing') && st.name && st.text.startsWith(st.name)) {
			ok(`proužek říká pravdu: „${st.text}"`);
		} else fail(`proužek neříká, že hraje někdo jiný: „${st.text}"`);
		if (st.msgShown) fail('přes běžící stream zůstala hláška „isn\'t streaming right now"');
		else ok('hláška o offline je schovaná');
		if (st.out) ok(`odkaz na profil původní modelky pořád vede přes /go/ (${st.out}×)`);
		else fail('na stránce nezůstal jediný odkaz přes /go/ — přišli bychom o provizi');
		await p.close();
		return;
	}
	await p.close();
	console.log('  ~  mezi 40 kartami Chaturbate zrovna žádná nedovysílala — náhrada nezměřena');
}

/**
 * Stránka stavěná jako offline, jejíž modelka vysílá, musí stream pustit sama.
 *
 * Čekat, až taková stránka vznikne přirozeně, nejde — je to náhoda mezi buildem
 * a načtením. Feedu se proto podstrčí, že ta konkrétní modelka je online; celý
 * zbytek cesty (živá kontrola → `ecamx:model-online` → `startEmbed('auto')`)
 * je pak pravý kód z produkce.
 */
async function upgradeCase() {
	const p = await browser.newPage();
	await p.evaluateOnNewDocument(() => {
		try { localStorage.setItem('ecamx_age_ok', '1'); localStorage.setItem('ecamx_consent', 'granted'); } catch {}
	});

	/**
	 * Najít offline stavěnou stránku, jejíž PŘEHRÁVAČ patří síti s autoplayem.
	 *
	 * Síť se musí číst z bloku `data-player`, ne z celého HTML: dole na stránce
	 * jsou karty souvisejících modelek z jiných sítí, takže hledání
	 * `data-network="chaturbate"` v celém dokumentu vybralo stránku BongaCams
	 * a test pak podstrkoval feed sítě, o kterou vůbec nejde (a spadl na
	 * vlastní chybě). BongaCams se navíc vynechává právem: jede přes HLS
	 * a v archivu je adresa mrtvá (D62), takže tam se přehrávač nenabízí.
	 */
	let target = null;
	for (const letter of ['a', 'b', 'c', 'd']) {
		const idx = await (await fetch(`${BASE}/models/${letter}/`)).text();
		const slugs = [...new Set([...idx.matchAll(/\/live\/([a-z0-9-]+)\//g)].map((m) => m[1]))].slice(0, 30);
		for (const slug of slugs) {
			const html = await (await fetch(`${BASE}/live/${slug}/`)).text();
			if (!html.includes('data-offline-msg')) continue;          // stavěná jako živá
			const i = html.indexOf('data-player');
			if (i < 0) continue;
			const block = html.slice(i, i + 600);
			if (!block.includes('data-autoplay')) continue;            // síť bez ověřeného autoplaye
			if (!/data-embed=/.test(block)) continue;                  // HLS archiv: adresa je mrtvá
			const net = /data-network="([a-z0-9]+)"/.exec(block)?.[1];
			const nick = /data-slug="([^"]+)"/.exec(block)?.[1];
			if (net && nick) { target = { page: slug, slug: nick, net }; break; }
		}
		if (target) break;
	}
	if (!target) {
		console.log('  ~  nenašel jsem offline stavěnou stránku sítě s autoplayem — povýšení nezměřeno');
		await p.close();
		return;
	}

	await p.setRequestInterception(true);
	p.on('request', async (req) => {
		const u = req.url();
		if (u.includes(`/api/online/${target.net}/`) && !u.includes('cards=')) {
			const d = await (await fetch(u)).json();
			d.online = { ...d.online, [target.slug]: 42 };   // „vysílá"
			return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
		}
		req.continue();
	});
	await p.goto(`${BASE}/live/${target.page}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	await p.evaluate(() => new Promise((r) => setTimeout(r, 6000)));
	const st = await p.evaluate(() => {
		const f = document.querySelector('[data-player]');
		const btn = document.querySelector('[data-play]');
		const msg = document.querySelector('[data-offline-msg]');
		return {
			iframe: !!f?.querySelector('iframe'),
			playVisible: !!btn && !btn.hidden && btn.offsetParent !== null,
			msgShown: !!msg && !msg.hasAttribute('hidden'),
			hit: !!f?.querySelector('.player-hit:not([hidden])'),
		};
	});
	await p.close();

	console.log(`[hls] povýšení offline stránky (/live/${target.page}/, ${target.net}):`);
	if (st.iframe) ok('stream se rozjel sám, bez mačkání play');
	else fail('v ploše není přehrávač — stránka čeká na klik, přesně to Kenny nechtěl');
	if (st.playVisible) fail('tlačítko Play zůstalo viditelné přes běžící stream');
	else ok('tlačítko Play je pryč');
	if (st.msgShown) fail('hláška „isn\'t streaming right now" zůstala nad běžícím streamem');
	else ok('hláška o offline je schovaná');
	// Vrstvu nad videem má jen Chaturbate (`STREAM_LINK`) — u ostatních sítí
	// nese affiliate ID sama adresa embedu, takže tam co vracet není.
	if (target.net !== 'chaturbate') console.log('  ~  klikací vrstvu tahle síť nemá (STREAM_LINK je jen chaturbate)');
	else if (st.hit) ok('klikací vrstva nad streamem je zpátky (klik nese provizi)');
	else fail('klikací vrstva se po vložení rámce nevrátila — klik do videa nevydělá nic');
}

// Povýšení a náhrada nejsou o síti, ale o stránce — pouští se jen v základním
// běhu, ať se při kontrole druhé sítě neměří dvakrát totéž.
if (LIVE && NET === 'bongacams') { await upgradeCase(); await substituteCase(); }
else if (!LIVE) console.log('[hls] povýšení ani náhradu proti statickému serveru změřit nedá (chybí /api/online/)');
else console.log(`[hls] povýšení a náhradu měří výchozí běh (bez argumentu ${NET})`);

await browser.close();
console.log(bad ? `\n${bad} problém(y)` : '\nvšechno v pořádku');
process.exit(bad ? 1 : 0);
