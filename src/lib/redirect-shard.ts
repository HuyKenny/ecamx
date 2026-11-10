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
 */
export function shardOf(slug: string): string {
	const c = slug.charCodeAt(0);
	if (c >= 97 && c <= 122) return slug[0]!; // a–z
	if (c >= 48 && c <= 57) return slug[0]!; // 0–9
	if (c >= 65 && c <= 90) return slug[0]!.toLowerCase(); // A–Z sloučíme s malými
	// Pomlčka, podtržítko, diakritika, cokoli nečekaného.
	return '_';
}
