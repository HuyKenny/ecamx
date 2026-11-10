/**
 * Smaže `dist/server/.prerender`, pokud tam je.
 *
 * **Pozor, co tenhle skript JE a co NENÍ** — 23. 9. 2026 jsem ho zavedl
 * s odůvodněním, které se ukázalo být špatné, a chyba se táhla do D76:
 *
 * Tvrdil jsem, že Worker nese 25,3 MB `.prerender/` v každém uploadu. To bylo
 * změřené na `dist/`, který tu zůstal po **neúspěšném** lokálním buildu — ten
 * se zasekl na `/index.html` (chybějící `PUBLIC_CRAKREVENUE_AFF_ID`) a adresář
 * po sobě nechal. **Úspěšný build `.prerender` nenechává**, což je doložené
 * dvakrát: v CI na téhle větě („`.prerender` tam není — není co mazat“)
 * a tím, že nasazený Worker měl `Total Upload: 7167 KiB`, ne 33,8 MB.
 *
 * Takže tohle **není oprava ničeho, co se dělo**. Je to pojistka pro případ,
 * že by Astro začal `.prerender` nechávat i po úspěšném buildu — pak by se
 * do uploadu přidalo ~25 MB mrtvé váhy a tenhle skript to spolkne. Guard
 * v `check-links.ts` na přítomnost `.prerender` padá, takže se to neztratí
 * potichu ani ve chvíli, kdy by skript neběžel.
 *
 * **Maže se až ZA `build-csp.ts`, ne před ním.** Ten skenuje `dist/server/**`
 * a hledá hosty a hashe inline skriptů pro CSP; kdyby soubory zmizely dřív,
 * změnila by se množina hostů, ze kterých se CSP skládá — a to je přesně ta
 * změna, kterou nechceme udělat mimochodem.
 *
 * Skutečná váha, kterou tenhle soubor řeší jen okrajově, je popsána v D77:
 * mapa přesměrování byla 6,4 z 7,0 MB bundlu a odstěhovala se do shardovaných
 * assetů. Viz `docs/DECISIONS.md`.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'server');
const PRERENDER = join(SERVER, '.prerender');

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Velikost adresáře včetně podadresářů. */
function dirBytes(dir) {
	let sum = 0;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) sum += dirBytes(p);
		else if (e.isFile()) sum += statSync(p).size;
	}
	return sum;
}

if (!existsSync(SERVER)) {
	console.log('[strip] dist/server není — build neproběhl, nic nemažu');
	process.exit(0);
}

if (!existsSync(PRERENDER)) {
	// **Normální stav po úspěšném buildu**, ne chyba.
	console.log('[strip] .prerender tam není (po úspěšném buildu to je správně)');
	process.exit(0);
}

const before = dirBytes(SERVER);
const freed = dirBytes(PRERENDER);
rmSync(PRERENDER, { recursive: true, force: true });
const after = dirBytes(SERVER);

console.log(
	`[strip] .prerender smazán: ${mb(freed)} pryč, ` +
	`bundle Workeru ${mb(before)} → ${mb(after)} (limit 64 MiB nekomprimovaně)`
);
