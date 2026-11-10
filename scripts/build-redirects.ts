/**
 * Sestaví `public/_redirects` — od 19. 8. 2026 **jen** ze staré WordPress mapy
 * (`seed/legacy-redirects.txt`, viz D7).
 *
 * Zaniklé stránky modelek (`src/data/gone.json`) tu SCHVÁLNĚ nejsou. `_redirects`
 * má tvrdý limit **2 000 pravidel** a Cloudflare přebytek tiše zahodí — zaniklých
 * stránek bylo 2 085, takže se 414 z nich nevešlo a ty URL padaly na 404.
 * A protože se přesměrování musela do limitu vejít, sync je přiděloval jen
 * stránkám nad prahem `INDEX_MIN_DAYS`; živých modelek pod prahem je ale 5 878
 * z 8 168, takže jejich URL se v okamžiku konce vysílání měnilo v tvrdou 404.
 * Změřeno v GSC: 729 z 837 stránek modelek, které kdy měly imprese, vracelo 404
 * — 89 % impresí webu.
 *
 * Teď je mapa v Workeru (`src/pages/[...path].ts` + `src/lib/gone.ts`), kde
 * žádný limit není. Tenhle skript proto jen přenese legacy pravidla a ověří,
 * že se pořád vejdou. Viz docs/DECISIONS.md D35.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = join(ROOT, 'seed', 'legacy-redirects.txt');
const OUT = join(ROOT, 'public', '_redirects');

/** Strop Cloudflare pro statická pravidla. */
const HARD_LIMIT = 2000;

const log = (m: string) => console.log(`[redirects] ${m}`);

const legacy = existsSync(LEGACY) ? readFileSync(LEGACY, 'utf8').trimEnd() : '';
const rules = legacy.split('\n').filter((l) => l.startsWith('/')).length;

writeFileSync(OUT, [
	legacy,
	'',
	'# Zaniklé stránky modelek řeší Worker (src/pages/[...path].ts) — tady nejsou',
	'# schválně: limit 2 000 pravidel by je uřízl a URL by padaly na 404 (D35).',
	'',
].join('\n'));

log(`${rules} legacy pravidel (limit ${HARD_LIMIT}); zaniklé modelky obsluhuje Worker`);
if (rules > HARD_LIMIT) {
	console.error(`[redirects] CHYBA: ${rules} > ${HARD_LIMIT}, Cloudflare přebytek zahodí`);
	process.exit(1);
}
