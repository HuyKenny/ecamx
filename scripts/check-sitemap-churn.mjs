/**
 * **Slibuje sitemapa URL, které tam budou i příští build?**
 *
 * Proč to existuje (7. 9. 2026): kolotoč stránek je strukturální — registry zná
 * **193 414** modelek, stránku má 17 000 a kdo právě vysílá, tu stránku dostane
 * (Kennyho pravidlo: klik z karty nesmí odejít z webu). Každý běh se tedy
 * o slugy přihlásí tisíce vracejících se modelek a stejný počet právě offline
 * stránek musí jít pryč — naměřeno **10 750 kandidátů na 5 364 míst**.
 *
 * Do 7. 9. sitemapa slibovala všech ~15 900 indexovatelných URL, a **5 037
 * z nich (31,6 %) do dvou hodin odpovídalo 302** (vzorek 25 z 25). Od D75 jde
 * do sitemapy jen `stable` — stránka s měřenou poptávkou nebo se `seen` nad
 * prahem odvozeným z rozpočtu.
 *
 * Test má dvě části:
 *   1. **Invarianty z posledního syncu** (`src/data/`) — běží vždycky.
 *   2. **Churn proti produkci** — porovná sitemapu z lokálního buildu s tou
 *      nasazenou. Smysl to dává až mezi dvěma buildy STEJNÉHO kódu; hned po
 *      nasazení změny řazení je rozdíl velký právem, protože se změnila
 *      pravidla, ne stabilita.
 *
 * Použití:  node scripts/check-sitemap-churn.mjs [https://ecamx.com]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src', 'data');
const BASE = (process.argv[2] ?? '').replace(/\/$/, '');

const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const meta = read('meta.json');
const rows = [...read('models.json'), ...read('archive.json')];

let bad = 0;
const ok = (m) => console.log(`  ✓  ${m}`);
const fail = (m) => { bad++; console.log(`  ✗  ${m}`); };
const note = (m) => console.log(`  ~  ${m}`);

console.log(`[sitemap] build ${meta.generatedAt} — ${rows.length} stránek modelek, `
	+ `práh stability seen>=${meta.seenCut}`);

const sitemap = rows.filter((m) => m.indexable && m.stable);
const demand = rows.filter((m) => (m.demand ?? 0) >= 1);

// 1. **Stránka, která něco vydělává, nesmí ze sitemapy vypadnout NIKDY.**
//    Tohle je pojistka, kterou si žádá paměť `seo-dr0-sitemapa-neni-discovery`:
//    zúžení sitemapy deindexuje, takže práh se nesmí zvednout nad nic, co má
//    imprese. `demand` je právě „má imprese v GSC nebo na Bingu, nebo měřený
//    objem na nick" (D53).
const lostDemand = demand.filter((m) => !(m.indexable && m.stable));
if (lostDemand.length) fail(`${lostDemand.length} stránek s poptávkou NENÍ v sitemapě `
	+ `(např. ${lostDemand.slice(0, 3).map((m) => m.page).join(', ')})`);
else ok(`všech ${demand.length} stránek s měřenou poptávkou je v sitemapě`);

// 2. Sitemapa je podmnožina indexovatelných — `stable` smí ubírat, ne přidávat.
const notIndexable = sitemap.filter((m) => !m.indexable);
if (notIndexable.length) fail(`${notIndexable.length} URL v sitemapě není indexovatelných`);
else ok('sitemapa je podmnožina indexovatelných stránek');

// 3. Práh musí něco odříznout, ale ne všechno. Nula = filtr neběží (a jsme zpátky
//    u lživé sitemapy), sto procent = zůstala by jen poptávka a nové stránky by
//    se do indexu nikdy nedostaly.
const share = (sitemap.length / rows.length) * 100;
if (meta.seenCut <= 0) fail('práh stability je 0 — filtr fakticky neběží');
else if (share > 80) fail(`v sitemapě je ${share.toFixed(0)} % katalogu — filtr nic neodřízl`);
else if (share < 5) fail(`v sitemapě je jen ${share.toFixed(0)} % katalogu — práh je moc vysoko`);
else ok(`v sitemapě ${sitemap.length} z ${rows.length} stránek (${share.toFixed(0)} %), `
	+ `z toho ${demand.length} díky poptávce`);

// 4. Churn proti nasazenému buildu.
if (!BASE) {
	note('bez adresy webu se churn proti produkci neměří');
} else {
	const xml = async (u) => {
		const r = await fetch(u);
		if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
		return [...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
	};
	const index = await xml(`${BASE}/sitemap.xml`);
	const prod = new Set();
	for (const f of index.filter((u) => u.includes('models-'))) {
		for (const u of await xml(f)) {
			const m = /\/live\/([^/]+)\//.exec(u);
			if (m) prod.add(decodeURIComponent(m[1]));
		}
	}
	const local = new Set(sitemap.map((m) => m.page));
	const lost = [...local].filter((p) => !prod.has(p));
	const pct = (lost.length / Math.max(local.size, 1)) * 100;
	console.log(`  ·  lokálně ${local.size} URL, na produkci ${prod.size}`);

	// Vzorek ověří, jestli „chybí v sitemapě" znamená i „nevrací 200".
	const sample = lost.slice(0, 12);
	let redirects = 0;
	for (const p of sample) {
		const r = await fetch(`${BASE}/live/${encodeURIComponent(p)}/`, { redirect: 'manual' });
		if (r.status !== 200) redirects++;
	}
	if (pct > 10) {
		fail(`${lost.length} URL (${pct.toFixed(1)} %) je v lokální sitemapě, ale ne v nasazené`
			+ (sample.length ? ` — ze vzorku ${sample.length} jich ${redirects} nevrací 200` : ''));
		note('po změně pravidel stability je velký rozdíl v pořádku — porovnávej dva buildy stejného kódu');
	} else {
		ok(`churn proti produkci ${pct.toFixed(1)} % (${lost.length} URL)`);
	}
}

console.log(bad ? `\n${bad} problém(y)` : '\nvšechno v pořádku');
process.exit(bad ? 1 : 0);
