/**
 * D98 guard: the `/status/` pages served from shells (`src/lib/status-render.ts`) must be byte-identical to the
 * SSR pages (`src/pages/status/`). Fetches the live snapshot and every status page, rebuilds the dynamic parts with
 * `statusParts()` and checks that each one appears verbatim in the served page. With `--save DIR` it stores the
 * pages with the dynamic parts masked; `--compare DIR` diffs the masked pages against an earlier save (the static
 * shell must not change). Run from Malina (the zone WAF challenges datacenter IPs):
 *
 *   node --experimental-strip-types scripts/check-status-parts.ts [--save DIR | --compare DIR]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { statusIndexParts, statusParts } from '../src/lib/status-parts.ts';
import type { LiveMeta, PFile } from '../src/lib/live-static.ts';

const BASE = process.env.ECAMX_BASE ?? 'https://ecamx.com';
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux aarch64) ecamx-check-status/1.0' };
const args = process.argv.slice(2);
const save = args[0] === '--save' ? args[1] : null;
const compare = args[0] === '--compare' ? args[1] : null;

async function get(path: string): Promise<{ text: string; date: number; status: number }> {
	const r = await fetch(BASE + path, { headers: UA, redirect: 'manual' });
	return { text: await r.text(), date: Date.parse(r.headers.get('date') ?? '') || Date.now(), status: r.status };
}

// NETWORK_IDS of the deployed build (= FACETS.networks), read from its sitemap — local src/data may be stale.
const hubs = await (await fetch(BASE + '/sitemap-hubs.xml', { headers: UA })).text();
const ids = new Set([...hubs.matchAll(/\/status\/([a-z0-9]+)\/</g)].map((m) => m[1]!));
let bad = 0;
for (let attempt = 1; attempt <= 3; attempt++) {
	bad = 0;
	const [meta, pools] = await Promise.all([get('/livedata/meta.json'), get('/livedata/p/all.json')]);
	const snap = JSON.parse(meta.text) as LiveMeta;
	const pf = JSON.parse(pools.text) as PFile;
	const pages: Array<[string, string, string[]]> = [];
	const idx = await get('/status/');
	const ip = statusIndexParts(ids, snap, idx.date);
	pages.push(['/status/', idx.text, [ip.rows, `<meta name="ecamx-built" content="${ip.built}">`]]);
	for (const net of ids) {
		const pg = await get(`/status/${net}/`);
		if (pg.status !== 200) { console.log(`${net}: HTTP ${pg.status}`); bad++; continue; }
		const p = statusParts(net, ids, snap, pf, pg.date);
		pages.push([`/status/${net}/`, pg.text, [p.top, p.others, `<script type="application/ld+json">${p.ld}</script>`, `<meta name="ecamx-built" content="${p.built}">`].filter((x) => !x.endsWith('"null">'))]);
	}
	for (const [path, html, parts] of pages) {
		const miss = parts.filter((x) => x && !html.includes(x));
		if (miss.length) { bad++; console.log(`${path}: ${miss.length} part(s) differ, first: ${miss[0]!.slice(0, 160)}`); }
		let masked = html;
		parts.forEach((x, i) => { if (x) masked = masked.split(x).join(`<!--PART${i}-->`); });
		const file = path.replace(/\//g, '_') + '.html';
		if (save) { mkdirSync(save, { recursive: true }); writeFileSync(`${save}/${file}`, masked); }
		if (compare) {
			const old = readFileSync(`${compare}/${file}`, 'utf8');
			if (old !== masked) {
				bad++;
				let i = 0;
				while (i < old.length && old[i] === masked[i]) i++;
				console.log(`${path}: static shell differs at ${i}: old «${old.slice(i - 40, i + 80)}» new «${masked.slice(i - 40, i + 80)}»`);
			}
		}
	}
	console.log(`attempt ${attempt}: ${pages.length} pages, ${bad} problem(s)`);
	// The SSR isolate memoises the snapshot for 60 s: a publish in between is a false alarm → retry.
	if (!bad) break;
	await new Promise((r) => setTimeout(r, 20_000));
}
process.exit(bad ? 1 : 0);
