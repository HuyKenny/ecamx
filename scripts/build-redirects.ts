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
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_MERGES, CATEGORY_TO_COUNTRY, canonicalTerm } from '../src/lib/taxonomy.ts';
import { shardOf } from '../src/lib/redirect-shard.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = join(ROOT, 'seed', 'legacy-redirects.txt');
const OUT = join(ROOT, 'public', '_redirects');

/** Strop Cloudflare pro statická pravidla. */
const HARD_LIMIT = 2000;

const log = (m: string) => console.log(`[redirects] ${m}`);

const legacy = existsSync(LEGACY) ? readFileSync(LEGACY, 'utf8').trimEnd() : '';

/**
 * **Cíl každého pravidla musí být stránka, která existuje — na jeden skok**
 * (D85, SEO audit 17. 11. 2026). Dřív stálo 39 WP pravidel na sloučených
 * kategoriích (`/webcam_category/bigcock/` → `/cams/bigcock/` → `/cams/big-cock/`),
 * stránkování mířilo na zrušené `/x/N/` a ~140 cílů neexistovalo vůbec
 * (301 → 302 → `/cams/`, tedy soft 404 se ztrátou síly odkazu).
 * Platné stránky bere z `src/data/facets.json` (výstup syncu, běží před námi).
 */
const FACETS_FILE = join(ROOT, 'src', 'data', 'facets.json');
const ff = existsSync(FACETS_FILE)
	? JSON.parse(readFileSync(FACETS_FILE, 'utf8')) as Record<string, Array<{ slug: string }>>
	: null;
const PAGES = new Set<string>(['/', '/cams/', '/country/', '/site/', '/girls/', '/guys/', '/couples/', '/trans/', '/models/', '/finder/']);
if (ff) {
	for (const k of ['categories', 'curated', 'ethnicities', 'hairColors', 'bodyTypes']) for (const f of ff[k] ?? []) PAGES.add(`/cams/${f.slug}/`);
	for (const f of ff.countries ?? []) PAGES.add(`/country/${f.slug}/`);
	for (const f of ff.networks ?? []) PAGES.add(`/site/${f.slug}/`);
}

function resolve(dst: string): string {
	// Stránkování mřížek je zrušené (D83) → základ výpisu.
	let d = dst.replace(/^\/page\/\d+\/$/, '/').replace(/^(\/.+?\/)\d+\/$/, '$1');
	const cat = /^\/cams\/([a-z0-9-]+)\/$/.exec(d);
	if (cat) {
		const slug = cat[1]!;
		const merged = CATEGORY_MERGES[slug] ?? slug;
		const country = CATEGORY_TO_COUNTRY[slug] ?? CATEGORY_TO_COUNTRY[merged];
		if (country) d = `/country/${country}/`;
		else d = `/cams/${CATEGORY_MERGES[slug] ?? canonicalTerm(slug) ?? slug}/`;
	}
	if (!ff || PAGES.has(d)) return d;
	// Cíl dnes neexistuje → nejbližší rozcestník PŘÍMO (jeden skok, 301).
	const hub = /^\/(cams|country|site)\//.exec(d);
	return hub ? `/${hub[1]}/` : d;
}

const out: string[] = [];
const sources = new Set<string>();
let rewritten = 0, dropped = 0;
const push = (src: string, dst: string, code: string) => {
	const to = resolve(dst);
	if (to !== dst) rewritten++;
	if (to === src || sources.has(src)) { dropped++; return; }
	sources.add(src);
	out.push(`${src} ${to} ${code}`);
};
for (const line of legacy.split('\n')) {
	const m = /^(\/\S*)\s+(\/\S*)\s+(\d{3})\s*$/.exec(line.trim());
	if (m) push(m[1]!, m[2]!, m[3]!);
	else if (line.startsWith('#') || !line.trim()) out.push(line);
	else out.push(line);
}
out.push('', '# Sloučené synonymní kategorie (D84/D85, src/lib/taxonomy.ts CATEGORY_MERGES).');
for (const [from, to] of Object.entries(CATEGORY_MERGES)) push(`/cams/${from}/`, `/cams/${to}/`, '301');
out.push('', '# Kategorie, které jsou zemí (D85, CATEGORY_TO_COUNTRY).');
for (const [from, code] of Object.entries(CATEGORY_TO_COUNTRY)) push(`/cams/${from}/`, `/country/${code}/`, '301');

// Guard: žádný cíl nesmí být zdrojem jiného pravidla (řetěz přesměrování).
const chains = out.map((l) => l.split(/\s+/)).filter((p) => p.length >= 3 && sources.has(p[1]!));
if (chains.length) {
	console.error(`[redirects] CHYBA: ${chains.length} řetězů přesměrování, např. ${chains.slice(0, 3).map((c) => c.join(' ')).join(' | ')}`);
	process.exit(1);
}
const rules = sources.size;

writeFileSync(OUT, [
	...out,
	'',
	'# Zaniklé stránky modelek řeší Worker (src/pages/[...path].ts) — tady nejsou',
	'# schválně: limit 2 000 pravidel by je uřízl a URL by padaly na 404 (D35).',
	'',
].join('\n'));
log(`cíle: ${rewritten} přepsáno na jeden skok, ${dropped} vynecháno (cíl = zdroj nebo duplicita)`);

log(`${rules} legacy pravidel (limit ${HARD_LIMIT}); zaniklé modelky obsluhuje Worker`);
if (rules > HARD_LIMIT) {
	console.error(`[redirects] CHYBA: ${rules} > ${HARD_LIMIT}, Cloudflare přebytek zahodí`);
	process.exit(1);
}

/**
 * Shardy mapy zaniklých stránek (`public/gone/`) do tvaru, který čte Worker
 * (`shardOf()`, D95: první znak + 32 kyblíčků). Sync je píše po prvním znaku
 * a rychlý režim CI je bere z artefaktu posledního syncu — proto se převádí
 * tady, před každým buildem. Idempotentní: už převedené shardy jen přepíše.
 */
{
	const dir = join(ROOT, 'public', 'gone');
	if (existsSync(dir)) {
		const all: Record<string, string> = {};
		let files = 0;
		for (const name of readdirSync(dir)) {
			if (!name.endsWith('.json')) continue;
			Object.assign(all, JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, string>);
			files++;
		}
		const out = new Map<string, Record<string, string>>();
		for (const [slug, to] of Object.entries(all)) {
			const k = shardOf(slug);
			(out.get(k) ?? out.set(k, {}).get(k)!)[slug] = to;
		}
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		let max = 0;
		for (const [k, m] of out) {
			const body = JSON.stringify(m);
			max = Math.max(max, body.length);
			writeFileSync(join(dir, `${k}.json`), body);
		}
		log(`gone/: ${Object.keys(all).length} přesměrování, ${files} → ${out.size} shardů (největší ${(max / 1024).toFixed(0)} kB)`);
	}
}
