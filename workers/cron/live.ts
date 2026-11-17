/**
 * `live-snapshot` — kdo právě vysílá, na VŠECH sítích, každých 5 minut.
 *
 * Proč (D82): do 17. 11. 2026 se živý stav skládal z deseti per-síť dotazů
 * přímo z prohlížeče (`/api/online/{síť}/`), a ty kvůli starému CPU stropu
 * free plánu (10 ms) viděly jen výřez: Chaturbate top 300 z ~6 000, BongaCams
 * 150 z ~1 000, sítě z CrakRevenue top 100. Chybějící modelka tak u 7 z 10
 * sítí neznamenala nic (`absenceUnproven`) a mřížky ukazovaly zombie karty.
 * Účet je přitom od září na Workers Paid — stačí feedy stáhnout CELÉ jednou
 * za 5 minut tady a web čte jen hotový snímek z KV.
 *
 * Změřeno 17. 11. z Maliny: 10 sítí = ~12 600 modelek, ~20 MB JSONu,
 * `JSON.parse` dohromady ~165 ms. Cena cronu á 5 min ≈ 8 640 běhů × ~0,3 s CPU
 * ≈ 2,6 M ms/měs ≈ 0,05 $ (CPU účtu je nad zahrnutým limitem). Na druhé straně
 * odpadá 10 upstream fetchů s parsováním při každém zobrazení stránky.
 *
 * **Výpadek sítě nikdy nevyprázdní její modelky.** Když síť spadne, zůstanou
 * její záznamy z minulého snímku a `nets[id].ok = false` + čas posledního
 * úspěchu. Klient pak u té sítě nic neskrývá (dřív odpověď `{online:{}}`
 * zhasla celou síť i s přehrávači — chyba 1 v plánu).
 */

import { NETWORKS, slugify, type Model, type NetworkId } from "../../scripts/cam-networks.ts";
import { canonicalTerm, canonicalCountry } from "../../src/lib/taxonomy.ts";
import { MONEY_CATEGORIES, matchesMoney } from "../../src/lib/money-categories.ts";
import type { Env } from "./shared.ts";
import { SNAPSHOT_KEY, type LiveRec, type NetState, type Snapshot } from "../../src/lib/live-snapshot-types.ts";

export { SNAPSHOT_KEY };

/** Stejný kód jako opt-out v syncu (past 60). */
const OPT_OUT_CODE = /(?:^|[^a-z])ecamx[\s-]?out(?:[^a-z]|$)/i;

/**
 * Kolik stránek si od které sítě říct navíc proti buildu. Build měl stropy
 * kvůli rozpočtu souborů (Stripchat 800); živý stav žádný rozpočet nemá,
 * takže bereme všechno, co síť vrátí.
 */
const MAX_PAGES: Partial<Record<NetworkId, number>> = {
	chaturbate: 24, stripchat: 80, streamate: 25, imlive: 5, xlovecam: 6,
};

/** Kolik sítí stahovat současně — 128 MB paměti isolate, BongaCams má 4 MB JSON. */
const CONCURRENCY = 3;

const UA = "ecamx-live/1.0 (+https://ecamx.com)";

async function fetchNetwork(net: (typeof NETWORKS)[number], env: Record<string, string>): Promise<Omit<Model, "network">[]> {
	const size = net.pagination?.pageSize ?? 0;
	const pages = net.pagination ? (MAX_PAGES[net.id] ?? net.pagination.maxPages) : 1;
	const out: Omit<Model, "network">[] = [];
	const seen = new Set<string>();
	for (let p = 0; p < pages; p++) {
		const { url, init } = net.buildRequest(env as unknown as NodeJS.ProcessEnv, p * size);
		const headers = new Headers((init as RequestInit).headers);
		if (!headers.has("user-agent")) headers.set("user-agent", UA);
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

function facetsOf(m: Omit<Model, "network">): string[] {
	const f = new Set<string>();
	for (const t of m.tags) {
		const c = canonicalTerm(t);
		if (c) f.add("t:" + c);
	}
	const e = m.ethnicity ? canonicalTerm(m.ethnicity) : null;
	if (e) f.add("e:" + e);
	const h = m.hairColor ? canonicalTerm(m.hairColor) : null;
	if (h) f.add("h:" + h);
	const b = m.bodyType ? canonicalTerm(m.bodyType) : null;
	if (b) f.add("b:" + b);
	for (const c of MONEY_CATEGORIES) if (matchesMoney(m, c.rule)) f.add("m:" + c.slug);
	const c = canonicalCountry(m.country);
	if (c) f.add("c:" + c);
	if (m.gender) f.add("g:" + m.gender);
	return [...f];
}

/** Které stránky existují staticky — z `public/live-pages.json` posledního buildu. */
interface PageIndex { has: Map<string, "p" | "x">; taken: Set<string> }

async function loadPageIndex(): Promise<PageIndex | null> {
	try {
		const r = await fetch("https://ecamx.com/live-pages.json", {
			headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000),
		});
		if (!r.ok) return null;
		const j = await r.json() as { nets: Record<string, { p: string[]; x: string[] }> };
		const has = new Map<string, "p" | "x">();
		const taken = new Set<string>();
		for (const [net, { p, x }] of Object.entries(j.nets ?? {})) {
			for (const s of p) { has.set(`${net}:${s}`, "p"); taken.add(s); }
			for (const s of x) { has.set(`${net}:${s}`, "x"); taken.add(`${s}-${net}`); }
		}
		return { has, taken };
	} catch {
		return null;
	}
}

function toRec(m: Omit<Model, "network">, net: NetworkId, pages: PageIndex | null, used: Set<string>): LiveRec | null {
	if (!m.thumbnail) return null;
	const key = `${net}:${m.slug}`;
	const kind = pages?.has.get(key);
	let p: string;
	let st: 1 | undefined;
	if (kind) {
		p = kind === "p" ? m.slug : `${m.slug}-${net}`;
		st = 1;
	} else {
		// Bez statické stránky: holý slug, pokud ho nemá nikdo jiný (statická
		// stránka cizí modelky nebo dříve přidělený SSR záznam), jinak se sítí.
		p = pages?.taken.has(m.slug) || used.has(m.slug) ? `${m.slug}-${net}` : m.slug;
	}
	used.add(p);
	const r: LiveRec = { n: net, u: m.username, s: m.slug, p, t: m.thumbnail, f: facetsOf(m) };
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
	if (m.status === "private") r.pr = 1;
	if (m.embedRef) r.e = m.embedRef;
	if (m.subject) r.j = m.subject.slice(0, 140);
	if (m.previewVideo) r.pv = m.previewVideo;
	if (m.onlineSeconds) r.os = m.onlineSeconds;
	if (m.languages?.length) r.l = m.languages.slice(0, 4);
	return r;
}

export async function run(env: Env, dry = false): Promise<unknown> {
	const t0 = Date.now();
	const secrets = env as unknown as Record<string, string>;
	const prev = await env.KV.get<Snapshot>(SNAPSHOT_KEY, { type: "json" }).catch(() => null);
	const pages = await loadPageIndex();

	const fetched = new Map<NetworkId, Omit<Model, "network">[]>();
	const nets: Record<string, NetState> = {};
	const queue = [...NETWORKS];
	async function worker() {
		for (let net = queue.shift(); net; net = queue.shift()) {
			const missing = net.requiredEnv.filter((k) => !secrets[k]);
			if (missing.length) {
				nets[net.id] = { ok: false, ts: prev?.nets[net.id]?.ts ?? 0, count: 0, err: `chybí secret ${missing.join(",")}` };
				continue;
			}
			try {
				const list = await fetchNetwork(net, secrets);
				// Pod polovinou `minExpected` je to rozbitý feed, ne prázdná síť.
				if (list.length < net.minExpected / 2) throw new Error(`jen ${list.length} záznamů`);
				fetched.set(net.id, list);
				nets[net.id] = { ok: true, ts: Date.now(), count: list.length };
			} catch (e) {
				// Bez URL — `fetch` ji dává do zprávy a jsou v ní klíče.
				const msg = String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 80);
				nets[net.id] = { ok: false, ts: prev?.nets[net.id]?.ts ?? 0, count: 0, err: msg };
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	const used = new Set<string>();
	const m: LiveRec[] = [];
	for (const net of NETWORKS) {
		const list = fetched.get(net.id);
		if (list) {
			for (const x of list) {
				if (x.subject && OPT_OUT_CODE.test(x.subject)) continue;
				const r = toRec(x, net.id, pages, used);
				if (r) m.push(r);
			}
		} else if (prev) {
			// Síť spadla: držet její poslední stav (max 30 min), ať karty nezhasnou.
			const lastOk = prev.nets[net.id]?.ts ?? 0;
			if (Date.now() - lastOk < 30 * 60_000) {
				for (const r of prev.m) if (r.n === net.id) { used.add(r.p); m.push(r); }
				nets[net.id].count = m.filter((r) => r.n === net.id).length;
			}
		}
	}
	// Nejsledovanější první; sítě bez počtů diváků dostanou střed pole,
	// o prokládání sítí rozhoduje až čtenář (`diversify`).
	m.sort((a, b) => (b.v ?? -1) - (a.v ?? -1));

	const snap: Snapshot = { v: 1, ts: Date.now(), nets, m };
	const body = JSON.stringify(snap);
	const summary = {
		models: m.length,
		bytes: body.length,
		pagesIndex: pages ? pages.has.size : null,
		ms: Date.now() - t0,
		nets: Object.fromEntries(Object.entries(nets).map(([k, v]) => [k, v.ok ? v.count : `FAIL ${v.err}`])),
	};
	const failed = Object.entries(nets).filter(([, v]) => !v.ok);
	// Všechno spadlé = nepřepisovat dobrý snímek prázdným.
	if (!dry && m.length && failed.length < NETWORKS.length) {
		await env.KV.put(SNAPSHOT_KEY, body);
		await recordPresence(env, m, nets).catch((e) =>
			console.error(JSON.stringify({ task: "live-presence", error: String((e as Error)?.message ?? e) })));
	}
	console.log(JSON.stringify({ task: "live-snapshot", dry, ...summary }));
	return summary;
}

/**
 * Hodinový záznam přítomnosti (D82): KV `presence:YYYY-MM-DD` (UTC) =
 * `{ "síť:slug": maska 24 bitů po hodinách }`. Zapisuje se jen v prvním běhu
 * každé hodiny (24 zápisů/den). Noční sync z toho dopočítá `seen`, `last`
 * a rozvrh `hours` — dřív je odhadoval ze dvou buildů denně, které GitHub
 * navíc zpožďoval o hodiny, takže rozvrh i práh indexace stály na vzorku
 * dvou časů dne (plán D82, bod 3).
 *
 * Bity se nastavují jen u sítí, které se v tomhle běhu opravdu stáhly
 * (`ok`) — podržená data spadlé sítě by jinak tvrdila přítomnost.
 */
export async function recordPresence(env: Env, m: LiveRec[], nets: Record<string, NetState>, now = new Date()): Promise<void> {
	if (now.getUTCMinutes() >= 5) return;
	const day = now.toISOString().slice(0, 10);
	const bit = 1 << now.getUTCHours();
	const key = `presence:${day}`;
	const cur = (await env.KV.get<Record<string, number>>(key, { type: "json" })) ?? {};
	for (const r of m) {
		if (!nets[r.n]?.ok) continue;
		const k = `${r.n}:${r.s}`;
		cur[k] = (cur[k] ?? 0) | bit;
	}
	// 9 dní stačí na dohnání i týdenního výpadku buildu; pak KV sám uklidí.
	await env.KV.put(key, JSON.stringify(cur), { expirationTtl: 9 * 86_400 });
}
