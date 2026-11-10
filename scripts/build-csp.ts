/**
 * Sestaví Content-Security-Policy z toho, co postavený web OPRAVDU načítá.
 *
 * Proč to existuje
 * ----------------
 * Do 28. 8. 2026 měl web jen částečnou CSP (`object-src`, `base-uri`,
 * `form-action`, `frame-ancestors`). Chyběly ty direktivy, které něco brání:
 * `script-src`, `frame-src`, `img-src`, `media-src`, `connect-src`. Důvod byl
 * dobrý — nedaly se nasadit naslepo, protože web tahal cizí skript
 * (`cdn.a00s.net`, widget Amateur.tv) a rámce šesti sítí. Widget je pryč (D63),
 * takže zbyl jediný cizí skript: Google Analytics.
 *
 * **Seznam hostů se neopisuje, měří se.** Ručně psaný allowlist zastará při
 * první nové síti a projeví se to až rozbitým přehrávačem u návštěvníka.
 * Tenhle skript projde `dist/client/**\/*.html`, vytáhne z něj hosty rámců,
 * obrázků, videí a hashe inline skriptů — a z nich složí hlavičku. Když se
 * přidá síť s novým CDN, CSP se rozšíří sama při dalším buildu.
 *
 * Kam se to zapisuje
 * ------------------
 *  1. `dist/client/_headers` — hlavičky statických stránek (assets layer).
 *  2. `dist/server/**\/*.mjs` — do Workeru se stejná hodnota vloží za
 *     zástupný řetězec `__ECAMX_CSP__`, protože na Worker routy (`/api/`,
 *     `/go/`, 404 z catch-allu) `_headers` NEPLATÍ. Bez toho by 404 stránka
 *     byla jediná HTML odpověď na webu bez CSP.
 *
 * Pouští se po buildu (`package.json` → `postbuild`), stejně jako
 * `build-redirects.ts` běží před ním.
 *
 *   node --experimental-strip-types scripts/build-csp.ts
 */
import { THUMBNAIL_HOSTS } from '../src/lib/thumbnail-hosts.ts';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'dist', 'client');
const SERVER = join(ROOT, 'dist', 'server');
const PLACEHOLDER = '__ECAMX_CSP__';

/** Hosty, které do HTML nepatří, ale prohlížeč je stejně potřebuje. */
const EXTRA = {
	/** GA stub i knihovna; `connect-src` je cíl měřicích hitů. */
	script: ['https://www.googletagmanager.com'],
	connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com',
		'https://www.googletagmanager.com'],
	/**
	 * GA posílá měřicí pixel jako obrázek — a k tomu hosty, na které se
	 * náhledy PŘESMĚROVÁVAJÍ. CSP kontroluje cíl přesměrování, ne jen adresu
	 * v HTML: náhledy Amateur.tv jdou z `www.amateur.tv/captures/…` na
	 * `f-stream-captures.a0s.net` a bez tohohle je prohlížeč zablokoval
	 * (nalezeno 28. 8. při první kontrole na produkci). Ze zdroje se to
	 * vyčíst nedá, proto ručně a s odkazem, kde se to vzalo.
	 */
	img: ['https://www.google-analytics.com', 'https://www.googletagmanager.com',
		'https://f-stream-captures.a0s.net',
		// Náhledy záchranných karet (D67) přicházejí z feedu až za běhu, takže
		// v HTML nejsou. Kdyby se seznam bral jen z něj, síť, která zrovna
		// neměla v buildu ani jednu kartu, by měla u záchranných karet prázdné
		// obrázky — a poznalo by se to až u návštěvníka.
		...THUMBNAIL_HOSTS.map((h) => `https://${h}`)],
	/**
	 * HLS BongaCams (D62). Je tu natvrdo, i když se to obvykle najde i v HTML:
	 * kdyby v jednom buildu náhodou nebyla ani jedna živá modelka té sítě,
	 * `media-src` by se zúžil a přehrávač by se rozbil při dalším buildu, ne
	 * při tomhle — tedy chyba, kterou nikdo nespojí s příčinou.
	 */
	media: [
		'https://*.bcvcdn.com',
		// Cam4 od D70 taky hraje v našem `<video>`; shard se liší podle modelky.
		'https://*.xcdnpro.com',
	],
};

/**
 * Kolik různých inline skriptů čekáme. Dnes dva: blokující v `<head>`
 * (věková lišta, souhlas, filtr sítí, `--watch-rows`) a GA stub. Kdyby jich
 * najednou bylo víc, hlavička by nabobtnala a hlavně by to znamenalo, že někdo
 * přidal inline skript, o kterém nikdo neví — proto se na tom padá.
 */
const MAX_INLINE = 6;
/** Pojistka proti tomu, aby se do allowlistu dostal seznam z chybného parsingu. */
const MAX_HOSTS = 40;

const fail = (m: string): never => { console.error(`[csp] CHYBA: ${m}`); process.exit(1); };

if (!existsSync(CLIENT)) fail('dist/client neexistuje — nejdřív `pnpm build`');

// ── posbírat, co web reálně načítá ──────────────────────────────────────────

const html: string[] = [];
(function walk(dir: string) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith('.html')) html.push(p);
	}
})(CLIENT);

const inlineHashes = new Set<string>();
const frameHosts = new Set<string>();
const imgHosts = new Set<string>();
const mediaHosts = new Set<string>();
const externalScripts = new Set<string>();

const hostOf = (u: string): string | null => {
	try {
		const url = new URL(u.replace(/&amp;/g, '&'));
		return url.protocol === 'https:' ? `https://${url.host}` : null;
	} catch { return null; }
};

for (const file of html) {
	const text = readFileSync(file, 'utf8');

	// Inline skripty (bez `src`). Hash se počítá z PŘESNÉHO obsahu elementu.
	for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
		const body = m[1];
		// JSON-LD není skript ke spuštění — CSP se ho netýká.
		if (/type=["']application\/ld\+json["']/.test(m[0])) continue;
		if (!body.trim()) continue;
		inlineHashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
	}
	for (const m of text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) {
		const h = hostOf(m[1]);
		if (h) externalScripts.add(h);
	}
	// Rámce: `src` i `data-embed` (ten se do `iframe.src` vkládá až po kliknutí).
	for (const m of text.matchAll(/<iframe[^>]*\bsrc=["']([^"']+)["']/g)) {
		const h = hostOf(m[1]); if (h) frameHosts.add(h);
	}
	for (const m of text.matchAll(/\bdata-embed=["']([^"']+)["']/g)) {
		const h = hostOf(m[1]); if (h) frameHosts.add(h);
	}
	for (const m of text.matchAll(/<img[^>]*\bsrc=["'](https:[^"']+)["']/g)) {
		const h = hostOf(m[1]); if (h) imgHosts.add(h);
	}
	for (const m of text.matchAll(/\bdata-hls=["'](https:[^"']+)["']/g)) {
		const h = hostOf(m[1]);
		// Shard v adrese se mění u BongaCams (D62) i u Cam4 (D70) — naměřeny
		// dva hosty `stackvaults-hls` a `cam4-hls` — takže se povoluje celá
		// doména místo konkrétního hostu.
		if (h) {
			mediaHosts.add(
				h.endsWith('.bcvcdn.com') ? 'https://*.bcvcdn.com'
					: h.endsWith('.xcdnpro.com') ? 'https://*.xcdnpro.com' : h);
		}
	}
	for (const m of text.matchAll(/<video[^>]*\bposter=["'](https:[^"']+)["']/g)) {
		const h = hostOf(m[1]); if (h) imgHosts.add(h);
	}
}

if (inlineHashes.size > MAX_INLINE) {
	fail(`inline skriptů je ${inlineHashes.size} (čekáno max ${MAX_INLINE}) — někdo přidal skript, `
		+ 'o kterém plán CSP neví. Buď ho přesuň do souboru, nebo zvedni MAX_INLINE vědomě.');
}
for (const [name, set] of [['frame', frameHosts], ['img', imgHosts], ['media', mediaHosts]] as const) {
	if (set.size > MAX_HOSTS) fail(`${name}-src má ${set.size} hostů — to vypadá na chybu parsingu`);
}

// Cizí skript smí být jedině GA. Widget Amateur.tv (`cdn.a00s.net`) byl 28. 8.
// odstraněn právě proto, aby tahle podmínka mohla platit — kdyby se vrátil,
// build spadne tady a ne až u návštěvníka.
const allowedScript = new Set(EXTRA.script);
const rogue = [...externalScripts].filter((h) => !allowedScript.has(h) && !h.startsWith('https://ecamx.com'));
if (rogue.length) fail(`cizí skript ve stránkách: ${rogue.join(', ')} — CSP ho nepovolí, dokud to někdo vědomě nepřidá`);

// ── složit hlavičku ─────────────────────────────────────────────────────────

/**
 * Spojí hosty do direktivy. Prázdná direktiva je v CSP chyba (prohlížeč ji
 * bere jako by tam nic nebylo), takže z prázdna musí být `'none'`.
 */
const join1 = (...xs: (string[] | Set<string>)[]) => {
	const all = [...new Set(xs.flatMap((x) => [...x]))].sort();
	return all.length ? all.join(' ') : "'none'";
};

const CSP = [
	"default-src 'none'",
	`script-src 'self' ${join1(EXTRA.script, inlineHashes)}`,
	// `style-src` musí zůstat `'unsafe-inline'`: filtr sítí vyrábí <style>
	// za běhu blokujícím skriptem v <head> (D58) a na dynamicky vložený
	// element hash nesedne. Styly jsou proti skriptům nesrovnatelně menší
	// riziko a web nemá jediný HTML sink (žádné innerHTML, ověřeno).
	"style-src 'self' 'unsafe-inline'",
	`img-src 'self' data: ${join1(imgHosts, EXTRA.img)}`,
	// `blob:` je podmínka funkčnosti hls.js: knihovna nedává `<video>` adresu
	// playlistu, ale MediaSource přes `URL.createObjectURL`. Bez toho prohlížeč
	// přehrávač tiše zablokuje — nativní HLS (Safari, Chrome na Androidu) hraje
	// dál, takže se to pozná jen na desktopu. Nalezeno 28. 8. regresním testem
	// `check-hls-player.mjs`, ne v konzoli.
	`media-src 'self' blob: ${join1(mediaHosts, EXTRA.media)}`,
	// hls.js si transmuxer pouští ve workeru vytvořeném z blobu.
	"worker-src 'self' blob:",
	`frame-src ${join1(frameHosts)}`,
	`connect-src 'self' ${join1(EXTRA.connect, mediaHosts, EXTRA.media)}`,
	"font-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
	'upgrade-insecure-requests',
].join('; ');

// ── zapsat do _headers ──────────────────────────────────────────────────────

const headersPath = join(CLIENT, '_headers');
if (!existsSync(headersPath)) fail('dist/client/_headers neexistuje');
const headers = readFileSync(headersPath, 'utf8');
const line = /^(\s*)Content-Security-Policy:.*$/m;
if (!line.test(headers)) fail('v _headers není řádek Content-Security-Policy');
writeFileSync(headersPath, headers.replace(line, (_m, indent: string) => `${indent}Content-Security-Policy: ${CSP}`));

// ── a do Workeru ────────────────────────────────────────────────────────────

let patched = 0;
(function walkServer(dir: string) {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) { walkServer(p); continue; }
		if (!p.endsWith('.mjs') && !p.endsWith('.js')) continue;
		const t = readFileSync(p, 'utf8');
		if (!t.includes(PLACEHOLDER)) continue;
		writeFileSync(p, t.split(PLACEHOLDER).join(CSP));
		patched++;
	}
})(SERVER);
if (!patched) fail(`v dist/server nikde není ${PLACEHOLDER} — 404 z Workeru by šla bez CSP`);

console.log(`[csp] ✓ ${inlineHashes.size} inline skriptů, ${frameHosts.size} rámců, `
	+ `${imgHosts.size} obrázkových hostů, ${mediaHosts.size} media; zapsáno do _headers a ${patched}× do Workeru`);
console.log(`[csp]   ${CSP.slice(0, 160)}…`);
