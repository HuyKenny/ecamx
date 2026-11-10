/**
 * Port `scripts/ecamx/indexnow.py` — pingy do vyhledávačů.
 *
 * Proč to má cenu: **Bing nese 97 % naší viditelnosti** (233 prokliků za
 * 28 dní proti 8 z Googlu) a `indexable-pages.txt` / sitemapa jsou jeho
 * hlavní zdroj objevování. Google Indexing API se sem záměrně neportuje —
 * na běžné stránky nepatří (bere jen `JobPosting` a `BroadcastEvent`) a pokus
 * s ním v září 2026 nedopadl.
 *
 * Dva režimy jako v Pythonu:
 *   `bing`        — Bing Webmaster `SubmitUrlBatch`, denní kvóta **100 URL**
 *   `indexnow-all`— api.indexnow.org (Bing + Yandex + Seznam + Naver), bez kvóty
 *
 * Posílá se **čerstvé a žádané**, ne celý web: protokol je pro obsah, který se
 * změnil. Cooldown 14 dní (Bing) resp. 7 dní (IndexNow) + řazení podle
 * poptávky dává „nové nicky hned, zbytek v rotaci".
 */

import { fetchWithTimeout, logf, type Env } from "./shared.ts";

const SITE = "https://ecamx.com";
/** Veřejný klíč IndexNow — je i v `public/{key}.txt`, tajný není. */
const INDEXNOW_KEY = "f4a301ba902585321f130e28badef0c1";
/** Klíč v KV. Tvar 1:1 s `~/ai/tmp/ecamx-indexnow-state.json` (migrovatelný). */
const STATE_KEY = "indexnow-state";

type Channel = "bing" | "indexnow";
/** `{ kanál: { url: "RRRR-MM-DD" } }` — datum posledního odeslání. */
interface State { bing?: Record<string, string>; indexnow?: Record<string, string> }

/** Něco, co umí vrátit data; v dry režimu se nikam neposílá. */
export interface SubmitResult {
	channel: Channel;
	considered: number;
	fresh: number;
	picked: number;
	sent: number;
	first: string[];
	skippedReason?: string;
}

async function loadState(env: Env): Promise<State> {
	return (await env.KV.get<State>(STATE_KEY, { type: "json", cacheTtl: 30 })) ?? {};
}

/**
 * Seznam kandidátů. Bere `indexable-pages.txt` (celý indexovatelný katalog),
 * a když na webu ještě není, padá na sitemapu — stejně jako Python. Sitemapa
 * je od D75 schválně jen stabilní část, takže by samotná discovery ochudila.
 */
async function submittableUrls(): Promise<string[]> {
	try {
		const res = await fetchWithTimeout(`${SITE}/indexable-pages.txt`, {}, 60_000);
		if (res.ok) {
			const text = await res.text();
			const paths = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"));
			if (paths.length) return [...paths.map((p) => `${SITE}${p}`), ...(await hubUrls())];
		}
	} catch { /* spadne se na sitemapu */ }
	return sitemapUrls();
}

/** Rozcestníky ze sitemapy — ty tam zůstaly i po zúžení. */
async function hubUrls(): Promise<string[]> {
	return (await sitemapUrls()).filter((u) => !u.includes("/live/"));
}

async function sitemapUrls(): Promise<string[]> {
	const urls: string[] = [];
	const read = async (url: string): Promise<string[]> => {
		const res = await fetchWithTimeout(url, {}, 120_000);
		if (!res.ok) return [];
		const xml = await res.text();
		return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
	};
	try {
		const index = await read(`${SITE}/sitemap.xml`);
		for (const u of index) {
			if (u.endsWith(".xml")) urls.push(...(await read(u)));
			else urls.push(u);
		}
	} catch { /* prázdný seznam je lepší než pád — stejně se nic nepošle */ }
	return urls;
}

/** Poptávka z KV (`demand.py`), kvůli řazení. */
async function demandMap(env: Env): Promise<Record<string, Record<string, number>>> {
	return (await env.KV.get<Record<string, Record<string, number>>>("demand", { type: "json", cacheTtl: 300 })) ?? {};
}

/** Priorita: nejdřív měřená poptávka, pak typ stránky. */
function score(url: string, demand: Record<string, Record<string, number>>): number {
	const m = /\/live\/([^/]+)\/$/.exec(url);
	if (m) {
		const d = demand[m[1]!] ?? {};
		// Imprese znamenají, že stránka už rankuje — nejsilnější signál.
		// Bing se počítá stejně jako Google: dnes je to jediný vyhledávač,
		// který nám reálně posílá lidi.
		return Math.max((d.volume ?? 0) / 10, (d.impressions ?? 0) * 5, (d.bing_impressions ?? 0) * 5);
	}
	if (/^https:\/\/ecamx\.com\/(cams|country|site)\/[^/]+\/$/.test(url)) return 5;
	if (url.replace(/\/$/, "") === SITE || /\/(girls|guys|couples|trans|models|cams)\/$/.test(url)) return 8;
	return 1;
}

interface Pick { urls: string[]; considered: number; fresh: number }

function pick(
	all: string[], demand: Record<string, Record<string, number>>, state: State,
	channel: Channel, limit: number, cooldownDays: number,
): Pick {
	const seen = state[channel] ?? {};
	// ISO datum se dá porovnávat jako řetězec — stejně to dělá Python.
	const cutoff = new Date(Date.now() - cooldownDays * 86_400_000).toISOString().slice(0, 10);
	const fresh = all.filter((u) => (seen[u] ?? "") < cutoff);
	fresh.sort((a, b) => score(b, demand) - score(a, demand));
	return { urls: fresh.slice(0, limit), considered: all.length, fresh: fresh.length };
}

/**
 * Odešle dávku. **Vrací počet OPRAVDU přijatých URL** — a tady se Worker
 * schválně rozchází s Pythonem, který u Binga kontroluje jen stavový kód:
 * `SubmitUrlBatch` totiž vrací **200 i při vyčerpané kvótě** (denní limit je
 * 100 URL, 101. dostane `ErrorCode 2` v těle). Python tak neodeslané URL
 * označil za odeslané a 14 dní je nezkusil znovu — tichá ztráta discovery.
 * Tělo se proto parsuje a `ErrorCode != 0` se bere jako chyba.
 */
async function submit(channel: Channel, urls: string[], env: Env, dry: boolean): Promise<number> {
	if (dry || !urls.length) return 0;
	const today = new Date().toISOString().slice(0, 10);
	let sent = 0;
	const chunkSize = channel === "bing" ? 100 : 10_000;
	for (let i = 0; i < urls.length; i += chunkSize) {
		const chunk = urls.slice(i, i + chunkSize);
		let ok = false;
		try {
			if (channel === "bing") {
				const res = await fetchWithTimeout(
					`https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=${env.BING_WEBMASTER_API_KEY}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ siteUrl: `${SITE}/`, urlList: chunk }),
					}, 120_000);
				ok = res.ok;
				if (ok) {
					// Kvóta se pozná jen z těla, ne ze stavového kódu.
					const body = await res.json().catch(() => null) as { ErrorCode?: number; Message?: string } | null;
					if (body && body.ErrorCode && body.ErrorCode !== 0) {
						logf("indexnow", { channel, quotaError: body.ErrorCode, message: body.Message?.slice(0, 200) });
						ok = false;
					}
				} else {
					logf("indexnow", { channel, http: res.status, body: (await res.text()).slice(0, 200) });
				}
			} else {
				const res = await fetchWithTimeout("https://api.indexnow.org/indexnow", {
					method: "POST",
					headers: { "Content-Type": "application/json; charset=utf-8" },
					body: JSON.stringify({
						host: "ecamx.com", key: INDEXNOW_KEY,
						keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: chunk,
					}),
				}, 180_000);
				// 200 = přijato, 202 = přijato, klíč se ještě validuje.
				ok = res.status === 200 || res.status === 202;
				if (!ok) logf("indexnow", { channel, http: res.status, body: (await res.text()).slice(0, 200) });
			}
		} catch (e) {
			logf("indexnow", { channel, error: (e as Error).name });
			break;
		}
		if (!ok) break; // přerušit, ať se uloží jen to, co opravdu odešlo
		sent += chunk.length;
	}
	if (sent) {
		const state = await loadState(env);
		const seen = (state[channel] ??= {});
		for (const u of urls.slice(0, sent)) seen[u] = today;
		await env.KV.put(STATE_KEY, JSON.stringify(state));
	}
	return sent;
}

export async function run(env: Env, channel: Channel, limit: number, dry = false): Promise<SubmitResult> {
	const all = await submittableUrls();
	const demand = await demandMap(env);
	const state = await loadState(env);
	const cooldown = channel === "bing" ? 14 : 7;
	const p = pick(all, demand, state, channel, limit, cooldown);
	const sent = await submit(channel, p.urls, env, dry);
	const result: SubmitResult = {
		channel, considered: p.considered, fresh: p.fresh, picked: p.urls.length,
		sent, first: p.urls.slice(0, 3),
	};
	logf("indexnow", { ...result });
	return result;
}
