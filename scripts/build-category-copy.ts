/**
 * Jednorázové zpracování popisků kategorií ze starého WordPressu.
 *
 * Vstup:  seed/term-descriptions.json (190 textů, medián 559 slov)
 * Výstup: src/content/category-copy.json (jen ty, které sedí na aktuální facety)
 *
 * Co se opravuje:
 *  - `**text**` se ve WP renderovalo doslova i s hvězdičkami (150 z 190 textů)
 *  - literální \r\n mezi bloky
 *  - emoji v <h2> — u AI generovaných SEO textů je to nejnápadnější otisk
 *  - HTML se propouští jen na bezpečnou whitelistu značek
 *
 *   node --experimental-strip-types scripts/build-category-copy.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN = join(ROOT, 'seed', 'term-descriptions.json');
const FACETS = join(ROOT, 'src', 'data', 'facets.json');
const OUT = join(ROOT, 'src', 'content', 'category-copy.json');

interface Seed { taxonomy: string; slug: string; count: number; description: string }

const ALLOWED = new Set(['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'br']);

/** Odstraní emoji a piktogramy — v nadpisech je má 183 z 190 textů. */
function stripEmoji(s: string): string {
	return s
		.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
		.replace(/\s{2,}/g, ' ');
}

function clean(html: string): string {
	let s = html;

	// literální \r\n z WP exportu
	s = s.replace(/\\r\\n/g, '\n').replace(/\r/g, '');

	// rozbitý markdown — závorky jsou párové, takže regex stačí
	s = s.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
	// osamocené hvězdičky, které by po náhradě zbyly
	s = s.replace(/\*\*/g, '');

	// zahodit všechny značky mimo whitelist (i s atributy — nic z nich nepotřebujeme)
	s = s.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (m, tag: string) => {
		const t = tag.toLowerCase();
		if (!ALLOWED.has(t)) return '';
		return m.startsWith('</') ? `</${t}>` : `<${t}>`;
	});

	// emoji jen v nadpisech — v běžném textu jich skoro nic není a nevadí
	s = s.replace(/<h2>(.*?)<\/h2>/gs, (_m, inner: string) => `<h2>${stripEmoji(inner).trim()}</h2>`);

	return s.replace(/\n{3,}/g, '\n\n').trim();
}

const seeds: Seed[] = JSON.parse(readFileSync(IN, 'utf8'));
const facets = JSON.parse(readFileSync(FACETS, 'utf8'));

// Slugy, které dnes reálně mají stránku pod /cams/ nebo jako gender.
const live = new Set<string>();
for (const k of ['categories', 'ethnicities', 'hairColors', 'bodyTypes']) {
	for (const f of facets[k] ?? []) live.add(f.slug);
}
const genders = new Set<string>((facets.genders ?? []).map((f: any) => f.slug));

const out: Record<string, string> = {};
let skipped = 0;
for (const s of seeds) {
	const target = s.taxonomy === 'webcam_gender' ? genders : live;
	if (!target.has(s.slug)) { skipped++; continue; }
	const body = clean(s.description);
	// Krátké útržky nemají cenu vykreslovat.
	if (body.replace(/<[^>]+>/g, '').trim().length < 400) { skipped++; continue; }
	out[s.slug] = body;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));

const words = Object.values(out).map((h) => h.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length);
console.log(`[copy] vstup ${seeds.length}, použito ${Object.keys(out).length}, zahozeno ${skipped}`);
console.log(`[copy] slov: min ${Math.min(...words)} / medián ${words.sort((a, b) => a - b)[words.length >> 1]} / max ${Math.max(...words)}`);
console.log(`[copy] zbylé <strong>: ${Object.values(out).filter((h) => h.includes('<strong>')).length} textů`);
console.log(`[copy] zbylé ** : ${Object.values(out).filter((h) => h.includes('**')).length} textů (musí být 0)`);
console.log(`[copy] → ${OUT}`);
