/**
 * Jednorázový bootstrap registry z historie starého WordPressu.
 *
 * Bez něj by první profilové stránky vznikly až po pěti denních bězích syncu
 * (STREAK_FOR_PAGE). WP ale drží 9 měsíců historie: `post_date` = kdy se modelka
 * poprvé objevila, `post_modified` = kdy naposledy. Z toho se dá streak odvodit
 * rovnou a web může startovat s plnou sadou profilů.
 *
 * Vstup:  seed/models-seed.tsv  (export z wp_posts, sloupce: slug, síť, date, modified)
 * Výstup: seed/registry.json
 *
 *   node --experimental-strip-types scripts/seed-registry.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN = join(ROOT, 'seed', 'models-seed.tsv');
const OUT = join(ROOT, 'seed', 'registry.json');

/** Názvy taxonomie ve WP → naše NetworkId. */
const SERVICE_TO_NETWORK: Record<string, string> = {
	chaturbate: 'chaturbate',
	camsoda: 'camsoda',
	cam4: 'cam4',
	'amateur-tv': 'amateur',
	bongacams: 'bongacams',
	xlovecam: 'xlovecam',
	livejasmin: 'livejasmin',
};

if (!existsSync(IN)) {
	console.error(`[seed] chybí ${IN}\nExport z WP:\n` +
		`  mysql -N -B wordpress -e "SELECT p.post_name, t.slug, p.post_date, p.post_modified ..." > seed/models-seed.tsv`);
	process.exit(1);
}

const registry: Record<string, {
	first: string; last: string; streak: number; peak: number; network: string;
}> = {};

let skipped = 0;
let total = 0;

for (const line of readFileSync(IN, 'utf8').split('\n')) {
	if (!line.trim()) continue;
	const [slug, service, dateRaw, modifiedRaw] = line.split('\t');
	const network = SERVICE_TO_NETWORK[service];
	if (!slug || !network || !dateRaw || !modifiedRaw) { skipped++; continue; }
	total++;

	const first = dateRaw.slice(0, 10);
	const last = modifiedRaw.slice(0, 10);
	const lifespanDays = Math.max(0,
		Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000));

	/**
	 * Syntetický streak z životnosti. Nechceme rozdat profil každé modelce, která
	 * se kdy mihla — jen těm, co se na webu drží. Práh v syncu je 5, takže:
	 *   90+ dní  → 8  (jistě dostane stránku)
	 *   30+ dní  → 5  (těsně projde)
	 *   7+ dní   → 3  (dozraje za dva běhy)
	 *   méně     → 1
	 */
	const streak =
		lifespanDays >= 90 ? 8 :
		lifespanDays >= 30 ? 5 :
		lifespanDays >= 7 ? 3 : 1;

	registry[`${network}:${slug}`] = { first, last, streak, peak: 0, network };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(registry));

const byStreak = Object.values(registry).reduce<Record<number, number>>((a, e) => {
	a[e.streak] = (a[e.streak] ?? 0) + 1; return a;
}, {});
console.log(`[seed] načteno ${total} řádků (${skipped} přeskočeno)`);
console.log(`[seed] registry: ${Object.keys(registry).length} záznamů → ${OUT}`);
for (const s of Object.keys(byStreak).sort((a, b) => Number(b) - Number(a))) {
	console.log(`   streak ${s}: ${byStreak[Number(s)]} modelek${Number(s) >= 5 ? '  ← dostane profil' : ''}`);
}
