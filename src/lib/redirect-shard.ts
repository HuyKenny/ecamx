/**
 * Do kterého shardu mapa přesměrování patří. **Musí být stejná v syncu
 * i ve Workeru** — kdyby se rozešly, Worker by hledal v souboru, který
 * neexistuje, a všechny zaniklé stránky by spadly na záložní adresář.
 *
 * Proč shardy (23. 9. 2026, D76): mapa má 195 706 slugů → 379 cílů a jako
 * vložený JS literál byla **87 % bundlu Workeru** (6,0 z 6,9 MB). Ten literál
 * se parsuje při každém studeném startu isolate, takže ho platil každý
 * návštěvník, i když se přesměrování týká jen zlomku cest. Rozdělením na
 * soubory se bundle zmenší na ~0,9 MB a stáhne se jen shard, který je potřeba.
 *
 * Klíčem je **první znak slugu**, ne hash: slugy vznikají slugifikací (malá
 * písmena, číslice, pomlčky), takže je to přirozeně rozložené a zároveň
 * čitelné při ladění (`gone/s.json`). Hash by rozdělení vyrovnal líp, ale
 * musel by být bit po bitu stejný v Node i ve V8 — zbytečné riziko.
 *
 * Naměřeno na dnešní mapě: 36 shardů, největší `s` má 21 520 záznamů.
 *
 * **D95 (Workers Free, 10 ms CPU):** shard `s` měl 240 kB a jeho `JSON.parse`
 * stál ~2,5 ms při každém studeném isolate — u crawleru na starých URL skoro
 * při každém requestu. Teď první znak + 32 kyblíčků podle hashe (`s07.json`,
 * ~30 kB, ~1 150 souborů). Starý tvar ze syncu (`s.json`) převede
 * `scripts/build-redirects.ts` před každým buildem (i rychlým).
 */
/** Buckets per first character (D95). */
export const SUB_SHARDS = 32;

export function shardOf(slug: string): string {
	const c = slug.charCodeAt(0);
	let first: string;
	if (c >= 97 && c <= 122) first = slug[0]!; // a–z
	else if (c >= 48 && c <= 57) first = slug[0]!; // 0–9
	else if (c >= 65 && c <= 90) first = slug[0]!.toLowerCase(); // A–Z sloučíme s malými
	else first = '_'; // Pomlčka, podtržítko, diakritika, cokoli nečekaného.
	// FNV-1a přes UTF-16 jednotky: `Math.imul` a `charCodeAt` dávají v Node
	// i ve Workeru (obojí V8) bit po bitu totéž.
	let h = 0x811c9dc5;
	for (let i = 0; i < slug.length; i++) {
		h ^= slug.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return first + String(h % SUB_SHARDS).padStart(2, "0");
}
