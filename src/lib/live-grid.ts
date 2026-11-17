/**
 * Výběr živých karet ze snímku pro mřížky (D82). Čistá logika bez I/O —
 * volá ji `/api/live/grid/` a dynamická stránka modelky ve Workeru.
 *
 * Fasety mají stejné klíče, jaké skládá cron (`workers/cron/live.ts`):
 * `all`, `g:female`, `t:latina`, `m:bbw`, `e:`/`h:`/`b:` (etnicita, vlasy,
 * postava), `c:co` (země), `n:chaturbate` (síť).
 */
import facets from '../data/facets.json';
import type { LiveRec } from './live-snapshot-types.ts';
import type { CardData } from './card.ts';
import { weightOf, payingScore, DEFAULT_WEIGHT } from './network-weight.ts';

/** Kategorie, na které smí karta odkazovat tagem (existující stránky). */
const f = facets as unknown as Record<string, { slug: string }[]>;
const CATEGORY = new Set<string>([
	...(f.categories ?? []).map((c) => c.slug),
	...(f.curated ?? []).map((c) => c.slug),
]);

export const FACET_RE = /^(all|rail|[gtmehbcn]:[a-z0-9-]{1,60})$/;

/**
 * Klíče faset, které na webu EXISTUJÍ (D85). API dřív bralo jakýkoli slug,
 * každý nesmysl se spočítal nad ~12k záznamy a uložil do edge cache — snadný
 * způsob, jak ji zahltit. `facets.json` je výstup syncu, tedy pravda buildu.
 */
const ff = facets as unknown as Record<string, Array<{ slug: string }>>;
export const ALLOWED_FACETS = new Set<string>(['all', 'rail', ...[
	['t', 'categories'], ['m', 'curated'], ['e', 'ethnicities'], ['h', 'hairColors'],
	['b', 'bodyTypes'], ['c', 'countries'], ['g', 'genders'], ['n', 'networks'],
].flatMap(([pre, list]) => (ff[list!] ?? []).map((x) => `${pre}:${x.slug}`))]);
/** Všechny sítě (filtr `s=`). */
export const NETWORK_IDS = new Set((ff.networks ?? []).map((n) => n.slug));
/** Povolené velikosti dotazu — klient si pak ořízne sám (méně klíčů v cache). */
const N_STEPS = [6, 12, 24, 48, 60, 120];
export const roundN = (n: number) => N_STEPS.find((x) => x >= n) ?? 120;

export function matches(r: LiveRec, key: string): boolean {
	if (key === 'all' || key === 'rail') return true;
	if (key.startsWith('n:')) return r.n === key.slice(2);
	return r.f.includes(key);
}

export function toCardData(r: LiveRec): CardData {
	const tg: string[] = [];
	for (const k of r.f) {
		if (tg.length >= 2) break;
		if ((k.startsWith('t:') || k.startsWith('m:')) && CATEGORY.has(k.slice(2)) && !tg.includes(k.slice(2))) {
			tg.push(k.slice(2));
		}
	}
	return {
		n: r.n, u: r.u, p: r.p, s: r.s, t: r.t,
		...(r.tf ? { tf: r.tf } : {}),
		...(r.v ? { v: r.v } : {}),
		...(r.h ? { h: 1 as const } : {}),
		...(r.nw ? { nw: 1 as const } : {}),
		...(r.ty ? { ty: 1 as const } : {}),
		...(r.pr ? { pr: 1 as const } : {}),
		...(r.c ? { c: r.c } : {}),
		...(r.a ? { a: r.a } : {}),
		...(r.pv ? { pv: r.pv } : {}),
		...(tg.length ? { tg } : {}),
	};
}

/**
 * Prokládání sítí — stejné pravidlo jako `diversify()` v `data.ts` (váhy
 * z `network-weight.ts`, D63), jen nad řádky snímku. Vstup je seřazený podle
 * diváků (tak ho ukládá cron).
 */
export function diversifyRecs(list: LiveRec[], limit: number): LiveRec[] {
	const by = new Map<string, LiveRec[]>();
	for (const r of list) {
		const q = by.get(r.n);
		if (q) q.push(r); else by.set(r.n, [r]);
	}
	for (const [net, q] of by) {
		if (weightOf(net) <= DEFAULT_WEIGHT) continue;
		q.sort((a, b) => (payingScore({ viewers: b.v, toy: !!b.ty }) - payingScore({ viewers: a.v, toy: !!a.ty }))
			|| ((b.v ?? 0) - (a.v ?? 0)));
	}
	const queues = [...by.entries()].sort((a, b) => weightOf(b[0]) - weightOf(a[0]));
	const cursor = new Array(queues.length).fill(0);
	const out: LiveRec[] = [];
	let progress = true;
	while (out.length < limit && progress) {
		progress = false;
		for (let i = 0; i < queues.length && out.length < limit; i++) {
			const [net, q] = queues[i]!;
			for (let n = weightOf(net); n > 0 && out.length < limit; n--) {
				const r = q[cursor[i]];
				if (!r) break;
				cursor[i]++;
				out.push(r);
				progress = true;
			}
		}
	}
	return out;
}

export interface PickOpts {
	/** povolené sítě (prázdné = všechny) */
	sites?: Set<string>;
	/** vynechat tuhle modelku (`síť:slug`) — „podobné" na profilu */
	exclude?: string;
}

/**
 * Karty pro jednu fasetu: veřejné pokoje první, soukromé show až když
 * veřejných není dost (v přehrávači je u nich zeď, D41).
 */
export function pick(m: LiveRec[], key: string, limit: number, o: PickOpts = {}): { cards: CardData[]; total: number } {
	const hits = m.filter((r) =>
		matches(r, key)
		&& (!o.sites?.size || o.sites.has(r.n))
		&& (!o.exclude || `${r.n}:${r.s}` !== o.exclude));
	const open = hits.filter((r) => !r.pr);
	let chosen = key === 'rail'
		? open.slice(0, limit) // postranní panel: prostě nejsledovanější
		: diversifyRecs(open, limit);
	if (chosen.length < limit) chosen = chosen.concat(hits.filter((r) => r.pr).slice(0, limit - chosen.length));
	return { cards: chosen.map(toCardData), total: hits.length };
}

/** Druh fasety v katalogu (`FacetKind` v `data.ts`) → prefix klíče snímku. */
const PREFIX: Record<string, string> = { money: 'm', tag: 't', ethnicity: 'e', hairColor: 'h', bodyType: 'b' };
export function facetKey(kind: string, slug: string): string {
	return `${PREFIX[kind] ?? 't'}:${slug}`;
}

/**
 * Dotaz pro přednačtení v <head> — MUSÍ se skládat stejně jako
 * `buildQuery()` v `src/scripts/live.ts` (pořadí mřížek, doplňovací `all`,
 * panel), jinak prohlížeč přednačtenou odpověď nepoužije.
 */
export function liveQueryFor(grids: Array<[string, number]>, railN = 10): string {
	const parts = new Map<string, number>();
	for (const [k, n] of grids) parts.set(k, Math.max(parts.get(k) ?? 0, n));
	const maxN = Math.max(0, ...grids.map(([, n]) => n));
	if (grids.length && !parts.has('all')) parts.set('all', maxN);
	parts.set('rail', railN);
	return [...parts].map(([k, n]) => `${k}~${n}`).slice(0, 6).join(',');
}
