/**
 * Live snapshot → static JSON files of the assets-only Worker `ecamx-live`
 * (D95). Runs in GitHub Actions (`.github/workflows/live.yml`) every ~5 min;
 * replaces the cron Worker `ecamx-cron` (`workers/cron/live.ts`, D82) that
 * wrote the snapshot to KV.
 *
 *   node --experimental-strip-types scripts/live-publish.ts [--out live-out] [--dry-run]
 *
 * Then `wrangler deploy -c wrangler.live.jsonc` uploads only the files that
 * changed (asset hashes) and serves them at `ecamx.com/livedata/*` — no
 * Worker script runs for them. File layout and shapes: `src/lib/live-static.ts`.
 *
 * Rules carried over from the cron Worker:
 *  - **a failing network never empties its models**: its rows are carried over
 *    from the previous publish for up to 30 min (`nets[id].ok = false`), and
 *    clients then hide nothing for that network;
 *  - all networks failed (or nothing fetched) → exit 1, publish nothing, the
 *    previous deploy keeps serving;
 *  - logs are public (public repo): no URLs, no keys, only counts.
 *
 * Presence (D82): `presence:YYYY-MM-DD` in KV `ecamx-registry` gets this
 * hour's bit once per UTC hour (≤ 24 KV writes/day). `meta.json` remembers
 * which hours are done, so no KV read is needed to know that.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NETWORKS, type Model, type NetworkId } from './cam-networks.ts';
import { canonicalTerm, canonicalCountry } from '../src/lib/taxonomy.ts';
import { MONEY_CATEGORIES, matchesMoney } from '../src/lib/money-categories.ts';
import { weightOf, payingScore, DEFAULT_WEIGHT } from '../src/lib/network-weight.ts';
import { embedUrl } from '../src/lib/affiliate.ts';
import {
	G_DEPTH, P_DEPTH, RAIL_N, LIVE_BASE, W_DIR, W_LEGACY, W_SHARDS, categoryTags, facetFile, roundRobin, shardOf, toCard,
	type GFile, type LiveMeta, type NetState, type OnlineFile, type PFile, type WRec,
} from '../src/lib/live-static.ts';
import type { CardData } from '../src/lib/card.ts';

const SITE = 'https://ecamx.com';
const UA = 'ecamx-live/1.0 (+https://ecamx.com)';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'live-out';

/** Same opt-out code as the sync (pitfall 60). */
const OPT_OUT_CODE = /(?:^|[^a-z])ecamx[\s-]?out(?:[^a-z]|$)/i;
/** Pages per network — the live state has no file budget, take everything. */
const MAX_PAGES: Partial<Record<NetworkId, number>> = {
	chaturbate: 24, stripchat: 80, streamate: 25, imlive: 5, xlovecam: 6,
};
const CONCURRENCY = 4;
/** A failed network keeps its previous rows this long. */
const CARRY_MS = 30 * 60_000;
const ONLINE_CARDS = 40;

const log = (msg: string) => console.log(`[live] ${msg}`);

/**
 * Our own site from a GitHub runner: the zone WAF challenges datacenter
 * HTTP/1.1 clients (BotWall, 7. 11. 2026) and lets `x-malina-warm` through —
 * the same header the deploy smoke test sends. Never logged.
 */
const SITE_HEADERS: Record<string, string> = {
	'user-agent': UA,
	'cache-control': 'no-cache',
	...(process.env.MALINA_WARM_TOKEN ? { 'x-malina-warm': process.env.MALINA_WARM_TOKEN } : {}),
};

async function getJson<T>(url: string, ms = 15_000): Promise<T | null> {
	try {
		const r = await fetch(url, { headers: SITE_HEADERS, signal: AbortSignal.timeout(ms) });
		return r.ok ? await r.json() as T : null;
	} catch { return null; }
}

type Row = Omit<Model, 'network'>;

async function fetchNetwork(net: (typeof NETWORKS)[number]): Promise<Row[]> {
	const size = net.pagination?.pageSize ?? 0;
	const pages = net.pagination ? (MAX_PAGES[net.id] ?? net.pagination.maxPages) : 1;
	const out: Row[] = [];
	const seen = new Set<string>();
	for (let p = 0; p < pages; p++) {
		const { url, init } = net.buildRequest(process.env, p * size);
		const headers = new Headers((init as RequestInit | undefined)?.headers);
		if (!headers.has('user-agent')) headers.set('user-agent', UA);
		const res = await fetch(url, { ...(init as RequestInit), headers, signal: AbortSignal.timeout(25_000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = net.extract(await res.json());
		for (const r of raw) {
			const m = net.map(r);
			if (!m?.slug || seen.has(m.slug)) continue;
			seen.add(m.slug);
			out.push(m);
		}
		if (!size || raw.length < size) break;
	}
	return out;
}

function facetsOf(m: Row): string[] {
	const f = new Set<string>();
	for (const t of m.tags) {
		const c = canonicalTerm(t);
		if (c) f.add('t:' + c);
	}
	for (const [pre, v] of [['e', m.ethnicity], ['h', m.hairColor], ['b', m.bodyType]] as const) {
		const c = v ? canonicalTerm(v) : null;
		if (c) f.add(`${pre}:${c}`);
	}
	for (const c of MONEY_CATEGORIES) if (matchesMoney(m, c.rule)) f.add('m:' + c.slug);
	const c = canonicalCountry(m.country);
	if (c) f.add('c:' + c);
	if (m.gender) f.add('g:' + m.gender);
	return [...f];
}

/** Which model pages exist statically — `public/live-pages.json` of the last build. */
interface PageIndex { has: Map<string, 'p' | 'x'>; taken: Set<string> }
async function loadPageIndex(): Promise<PageIndex | null> {
	const j = await getJson<{ nets: Record<string, { p: string[]; x: string[] }> }>(`${SITE}/live-pages.json`);
	if (!j) return null;
	const has = new Map<string, 'p' | 'x'>();
	const taken = new Set<string>();
	for (const [net, { p, x }] of Object.entries(j.nets ?? {})) {
		for (const s of p) { has.set(`${net}:${s}`, 'p'); taken.add(s); }
		for (const s of x) { has.set(`${net}:${s}`, 'x'); taken.add(`${s}-${net}`); }
	}
	return { has, taken };
}

function topKey(f: string[], g?: string): string {
	return f.find((k) => k.startsWith('m:') || k.startsWith('t:')) ?? (g ? `g:${g}` : 'all');
}

function toRec(m: Row, net: NetworkId, pages: PageIndex | null, used: Set<string>, category: Set<string>): WRec | null {
	if (!m.thumbnail) return null;
	const kind = pages?.has.get(`${net}:${m.slug}`);
	let p: string;
	let st: 1 | undefined;
	if (kind) {
		p = kind === 'p' ? m.slug : `${m.slug}-${net}`;
		st = 1;
	} else {
		// No static page: bare slug unless someone else has it, else with the network.
		p = pages?.taken.has(m.slug) || used.has(m.slug) ? `${m.slug}-${net}` : m.slug;
	}
	used.add(p);
	const f = facetsOf(m);
	const r: WRec = { n: net, u: m.username, s: m.slug, p, t: m.thumbnail, f, k: topKey(f, m.gender ?? undefined) };
	if (st) r.st = st;
	if (m.viewers != null) r.v = m.viewers;
	if (m.thumbnailFallback) r.tf = m.thumbnailFallback;
	if (m.gender) r.g = m.gender;
	if (m.age) r.a = m.age;
	const c = canonicalCountry(m.country);
	if (c) r.c = c;
	if (m.isHd) r.h = 1;
	if (m.isNew) r.nw = 1;
	if (m.toy) r.ty = 1;
	if (m.status === 'private') r.pr = 1;
	if (m.embedRef) r.e = m.embedRef;
	if (m.subject) r.j = m.subject.slice(0, 100);
	if (m.previewVideo) r.pv = m.previewVideo;
	const tg = categoryTags(f, category);
	if (tg.length) r.tg = tg;
	return r;
}

function matches(r: WRec, key: string): boolean {
	return key === 'all' || r.f.includes(key);
}

/** One network's rows in the order a single-network pick uses (D63 weights). */
function netOrder(list: WRec[], net: string): WRec[] {
	if (weightOf(net) <= DEFAULT_WEIGHT) return list;
	return [...list].sort((a, b) => (payingScore({ viewers: b.v, toy: !!b.ty }) - payingScore({ viewers: a.v, toy: !!a.ty }))
		|| ((b.v ?? 0) - (a.v ?? 0)));
}

const card = (r: WRec): CardData => toCard(r, r.tg ?? []);

function groups(hits: WRec[]): { order: string[]; open: Map<string, WRec[]>; priv: Map<string, WRec[]> } {
	const order: string[] = [];
	const open = new Map<string, WRec[]>();
	const priv = new Map<string, WRec[]>();
	for (const r of hits) {
		if (!open.has(r.n)) { order.push(r.n); open.set(r.n, []); priv.set(r.n, []); }
		(r.pr ? priv : open).get(r.n)!.push(r);
	}
	for (const n of order) open.set(n, netOrder(open.get(n)!, n));
	return { order, open, priv };
}

async function main(): Promise<void> {
	const t0 = Date.now();
	const [pages, facetsDoc, prevMeta] = await Promise.all([
		loadPageIndex(),
		getJson<{ keys: string[]; cat: string[] }>(`${SITE}/live-facets.json`),
		getJson<LiveMeta>(`${SITE}${LIVE_BASE}/meta.json?t=${Date.now()}`),
	]);

	// ── fetch every network ────────────────────────────────────────────────
	const fetched = new Map<NetworkId, Row[]>();
	const nets: Record<string, NetState> = {};
	const queue = [...NETWORKS];
	async function worker() {
		for (let net = queue.shift(); net; net = queue.shift()) {
			const missing = net.requiredEnv.filter((k) => !process.env[k]);
			const prevTs = prevMeta?.nets[net.id]?.ts ?? 0;
			if (missing.length) { nets[net.id] = { ok: false, ts: prevTs, count: 0, err: `missing ${missing.join(',')}` }; continue; }
			try {
				const list = await fetchNetwork(net);
				// Under half of `minExpected` is a broken feed, not an empty site.
				if (list.length < net.minExpected / 2) throw new Error(`only ${list.length} rows`);
				fetched.set(net.id, list);
				nets[net.id] = { ok: true, ts: Date.now(), count: list.length };
			} catch (e) {
				// `fetch` puts the URL (with keys) into the message — never log it.
				const msg = String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 80);
				nets[net.id] = { ok: false, ts: prevTs, count: 0, err: msg };
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	// Without the page index a model with a static `slug-net` page would get the
	// bare `slug` path — possibly another model's static page. Keep the last
	// good snapshot instead (clients fall back to static cards after 30 min).
	if (!pages) {
		console.error('::error::live-pages.json not readable — nothing published, the previous snapshot keeps serving');
		process.exit(1);
	}

	// Allowed facet keys of the build; fallback (first run, build without the
	// file) = everything with ≥ 20 live members.
	const category = new Set(facetsDoc?.cat ?? []);

	// ── rows ───────────────────────────────────────────────────────────────
	const used = new Set<string>();
	const m: WRec[] = [];
	const carry = NETWORKS.filter((n) => !fetched.has(n.id) && Date.now() - (prevMeta?.nets[n.id]?.ts ?? 0) < CARRY_MS).map((n) => n.id as string);
	let carried: WRec[] = [];
	if (carry.length) {
		// The previous rows of a failed network live in the published shards.
		// The legacy 64-shard copy: fewer requests, same rows.
		const shards = await Promise.all(Array.from({ length: W_LEGACY.shards }, (_, i) =>
			getJson<Record<string, WRec>>(`${SITE}${LIVE_BASE}/${W_LEGACY.dir}/${String(i).padStart(2, '0')}.json?t=${Date.now()}`)));
		carried = shards.flatMap((s) => Object.values(s ?? {})).filter((r) => carry.includes(r.n));
	}
	for (const net of NETWORKS) {
		const list = fetched.get(net.id);
		if (list) {
			for (const x of list) {
				if (x.subject && OPT_OUT_CODE.test(x.subject)) continue;
				const r = toRec(x, net.id, pages, used, category);
				if (r) m.push(r);
			}
		} else {
			for (const r of carried) if (r.n === net.id) { used.add(r.p); m.push(r); }
			nets[net.id]!.count = m.filter((r) => r.n === net.id).length;
		}
	}
	m.sort((a, b) => (b.v ?? -1) - (a.v ?? -1));

	for (const [id, st] of Object.entries(nets)) {
		st.pr = 0; st.w = 0; st.wn = 0;
		for (const r of m) {
			if (r.n !== id) continue;
			if (r.pr) st.pr++;
			if (r.v && r.v > 0) { st.w += r.v; st.wn++; }
		}
	}
	const failed = Object.entries(nets).filter(([, v]) => !v.ok).map(([k]) => k);
	const summary = Object.fromEntries(Object.entries(nets).map(([k, v]) => [k, v.ok ? v.count : `FAIL ${v.err} (kept ${v.count})`]));
	log(`rows ${m.length}, page index ${pages ? pages.has.size : 'missing'}, facets ${facetsDoc ? facetsDoc.keys.length : 'fallback'}, ${Date.now() - t0} ms`);
	log(JSON.stringify(summary));
	if (!fetched.size || !m.length) {
		console.error('::error::no network fetched — nothing published, the previous snapshot keeps serving');
		process.exit(1);
	}

	const ts = Date.now();
	let keys = facetsDoc?.keys;
	if (!keys?.length) {
		const cnt = new Map<string, number>();
		for (const r of m) for (const f of r.f) cnt.set(f, (cnt.get(f) ?? 0) + 1);
		keys = ['all', ...[...cnt].filter(([, n]) => n >= 20).map(([k]) => k)];
	}
	const fileKeys = [...new Set(['all', ...keys.filter((k) => k !== 'rail' && !k.startsWith('n:') && /^(all|[gtmehbc]:[a-z0-9-]{1,60})$/.test(k))])];

	// ── files ──────────────────────────────────────────────────────────────
	const files = new Map<string, string>();
	const put = (path: string, body: unknown) => files.set(path, JSON.stringify(body));

	for (const key of fileKeys) {
		const hits = key === 'all' ? m : m.filter((r) => matches(r, key));
		const { order, open, priv } = groups(hits);
		const tn: Record<string, number> = {};
		for (const n of order) tn[n] = open.get(n)!.length + priv.get(n)!.length;
		let def = roundRobin(order.map((n) => [n, open.get(n)!] as [string, WRec[]]), G_DEPTH, weightOf);
		if (def.length < G_DEPTH) def = def.concat(hits.filter((r) => r.pr).slice(0, G_DEPTH - def.length));
		const g: GFile = { v: 1, ts, failed, total: hits.length, tn, c: def.map(card) };
		if (key === 'all') g.rail = m.filter((r) => !r.pr).slice(0, RAIL_N).map(card);
		put(`g/${facetFile(key)}.json`, g);
		const pools: Record<string, CardData[]> = {};
		for (const n of order) pools[n] = [...open.get(n)!, ...priv.get(n)!.slice(0, P_DEPTH)].slice(0, P_DEPTH).map(card);
		put(`p/${facetFile(key)}.json`, { v: 1, ts, failed, tn, order, nets: pools } satisfies PFile);
	}

	const env = (k: string) => String(process.env[k] ?? '');
	for (const net of NETWORKS) {
		const recs = m.filter((r) => r.n === net.id);
		const online: Record<string, number> = {};
		for (const r of recs) online[r.s] = r.v ?? 0;
		const cards: OnlineFile['cards'] = [];
		for (const r of recs) {
			if (cards.length >= ONLINE_CARDS) break;
			if (r.pr) continue;
			let e = '';
			try { e = embedUrl(net.id as never, r.u, env, r.e ?? null); } catch { e = ''; }
			cards.push({ s: r.s, n: r.u, t: r.t, v: r.v ?? 0, e, ...(r.tf ? { f: r.tf } : {}) });
		}
		const st = nets[net.id]!;
		put(`online/${net.id}.json`, { v: 1, network: net.id, ts, ok: st.ok, nts: st.ts, count: recs.length, online, cards } satisfies OnlineFile);
	}

	// Every shard file exists even when empty (a 404 would read as "no data").
	for (const [dir, n] of [[W_DIR, W_SHARDS], [W_LEGACY.dir, W_LEGACY.shards]] as const) {
		const shards: Record<string, Record<string, WRec>> = {};
		for (let i = 0; i < n; i++) shards[String(i).padStart(n > 100 ? 3 : 2, '0')] = {};
		for (const r of m) shards[shardOf(r.p, n)]![r.p] = r;
		for (const [k, v] of Object.entries(shards)) put(`${dir}/${k}.json`, v);
	}

	// ── presence (≤ 24 KV writes/day) ──────────────────────────────────────
	const now = new Date(ts);
	const day = now.toISOString().slice(0, 10);
	const bit = 1 << now.getUTCHours();
	let ph = prevMeta?.ph?.day === day ? { ...prevMeta.ph } : { day, mask: 0 };
	if (!(ph.mask & bit) && !DRY) {
		if (await recordPresence(day, bit, m, nets)) ph = { day, mask: ph.mask | bit };
	}
	put('meta.json', { v: 1, ts, nets, ph } satisfies LiveMeta);

	if (DRY) {
		let bytes = 0;
		for (const v of files.values()) bytes += v.length;
		log(`dry run: ${files.size} files, ${(bytes / 1e6).toFixed(1)} MB — nothing written`);
		return;
	}
	rmSync(OUT, { recursive: true, force: true });
	let bytes = 0;
	for (const [path, body] of files) {
		const full = join(OUT, 'livedata', path);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, body);
		bytes += body.length;
	}
	// Same origin, so no CORS. Short browser TTL: the files change every run.
	writeFileSync(join(OUT, '_headers'), [
		'/livedata/*',
		'  Cache-Control: public, max-age=30',
		'  X-Content-Type-Options: nosniff',
		'  X-Robots-Tag: noindex',
		'',
	].join('\n'));
	log(`wrote ${files.size} files, ${(bytes / 1e6).toFixed(1)} MB, ${failed.length ? `failed: ${failed.join(',')}` : 'all networks ok'}`);
}

/** OR this hour's bit into `presence:{day}` (KV `ecamx-registry`, REST). */
async function recordPresence(day: string, bit: number, m: WRec[], nets: Record<string, NetState>): Promise<boolean> {
	const acc = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN, ns = process.env.CF_KV_NAMESPACE_ID;
	if (!acc || !token || !ns) { log('presence: no KV credentials, skipped'); return false; }
	const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(`presence:${day}`)}`;
	try {
		const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
		const cur: Record<string, number> = r.ok ? await r.json() as Record<string, number> : {};
		if (!r.ok && r.status !== 404) throw new Error(`read ${r.status}`);
		for (const x of m) {
			if (!nets[x.n]?.ok) continue; // carried-over rows must not claim presence
			const k = `${x.n}:${x.s}`;
			cur[k] = (cur[k] ?? 0) | bit;
		}
		// 9 days covers a week-long build outage; KV expires it afterwards.
		const w = await fetch(`${url}?expiration_ttl=${9 * 86_400}`, {
			method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(cur), signal: AbortSignal.timeout(30_000),
		});
		if (!w.ok) throw new Error(`write ${w.status}`);
		log(`presence: ${day} hour ${Math.log2(bit)} written (${Object.keys(cur).length} keys)`);
		return true;
	} catch (e) {
		log(`presence: failed (${String((e as Error)?.message ?? e).slice(0, 60)}) — retried next run`);
		return false;
	}
}

await main();
