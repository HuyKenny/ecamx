/**
 * Port denní části `scripts/ecamx/demand.py measure` — měření poptávky.
 *
 * Proč to existuje: KV klíč `demand` řídí **retenci**. Stránka s měřenou
 * poptávkou se nikdy nesmaže ani nepřesměruje (`demandFor >= DEMAND_KEEP`,
 * D35/D53) a otevírá indexovatelnost hned. Když se přestane plnit, web začne
 * zahazovat pozice, které si vydobyl — a nikdo si toho nevšimne, dokud
 * návštěvnost neklesne.
 *
 * **Měří se na VŠECH vyhledávačích, ne jen na Googlu** (D53): Google dává
 * ~5 impresí denně, kdežto Bing má v indexu 52 380 URL a přinesl 1 048 kliků —
 * **2 001 stránek drží jedině Bing** a překryv s GSC je 1 %. Proto mají oba
 * zdroje vlastní pole a `bing_*` NIKDY nepřepisuje `googlevá`.
 *
 * **Co se sem NEportovalo: týdenní Ahrefs.** Dvěma důvody:
 *   1. Kandidáty bere z celého `registry` v KV — a to jsou megabajty
 *      (v D63 se musel `registry-gone` zhušťovat, protože měl 26 MB proti
 *      limitu 25 MB). Načíst to do isolate je zbytečné riziko.
 *   2. Denní běh registry vůbec nepotřebuje: `--limit 0` znamená prázdnou
 *      frontu a objem se jednou naměřený v KV drží dál.
 * Ahrefs tak zůstává na Malině (`50 5 * * 1`) — co se přestane obnovovat, je
 * jen `raw_volume`, ne retence.
 */

import { fetchWithTimeout, logf, type Env } from "./shared.ts";

const SITE = "https://ecamx.com/";
/** Poptávka se drží 480 dní (maximum, co GSC dá) — dotaz na nick žije dýl než stránka. */
const GSC_LOOKBACK_DAYS = 480;
const MAX_DEMAND_BYTES = 20 * 1024 * 1024;

interface Rec {
	nick?: string; volume?: number; raw_volume?: number; global_volume?: number; kd?: number;
	impressions?: number; clicks?: number; position?: number;
	bing_impressions?: number; bing_clicks?: number; bing_position?: number;
	measured?: string;
}
type Demand = Record<string, Rec>;

export interface DemandResult {
	gsc: { pages: number; impressions: number };
	bing: { pages: number; impressions: number; clicks: number } | null;
	known: number;
	keep: number;
	written: boolean;
	/** Proč se nepodařilo načíst Bing — jinak se chyba ztratí v logu. */
	bingError?: string;
	top: Array<{ page: string; volume: number; impressions: number }>;
}

function b64url(bytes: Uint8Array<ArrayBuffer>): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlText(text: string): string {
	return b64url(new TextEncoder().encode(text));
}

/**
 * `-----BEGIN PRIVATE KEY-----` … → DER bajty pro `crypto.subtle.importKey`.
 *
 * Návratový typ je `Uint8Array<ArrayBuffer>` schválně: `crypto.subtle` bere
 * `BufferSource` a holé `Uint8Array` je v dnešních TS licích
 * `Uint8Array<ArrayBufferLike>`, což zahrnuje i `SharedArrayBuffer` — a ten
 * WebCrypto odmítá. Konkrétní `ArrayBuffer` ten problém nemá.
 */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
	const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
	const raw = atob(body);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/**
 * Access token pro Search Console. Service account podepíše RS256 JWT
 * (`crypto.subtle` umí `RSASSA-PKCS1-v1_5` a klíč je PKCS#8) a vymění ho
 * u Google za token. Je to ~40 řádků a **žádný refresh token**: v Google
 * „Testing" režimu refresh token expiruje týdně, service account tuhle past
 * nemá.
 */
async function gscToken(env: Env): Promise<string> {
	const sa = JSON.parse(env.GSC_SERVICE_ACCOUNT) as { client_email: string; private_key: string };
	const now = Math.floor(Date.now() / 1000);
	const data = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${
		b64urlText(JSON.stringify({
			iss: sa.client_email,
			scope: "https://www.googleapis.com/auth/webmasters.readonly",
			aud: "https://oauth2.googleapis.com/token",
			iat: now, exp: now + 3600,
		}))}`;
	const key = await crypto.subtle.importKey(
		"pkcs8", pemToDer(sa.private_key),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
	);
	const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data));
	const assertion = `${data}.${b64url(new Uint8Array(sig))}`;

	const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
	}, 30_000);
	if (!res.ok) {
		// `invalid_grant` se sám nespraví (klíč zrušený, scope odebrán) — proto
		// se hlasitě vyhodí a volající pošle hlášku. Tichý výpadek tady znamená
		// tichou ztrátu retence.
		throw new Error(`GSC token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}
	const body = await res.json() as { access_token?: string };
	if (!body.access_token) throw new Error("GSC token bez access_token");
	return body.access_token;
}

const SLUG_OK = /^[A-Za-z0-9_.-]{1,64}$/;
/**
 * `/live/<slug>/` z URL → `<slug>`.
 *
 * **Pozor na `split`:** v Pythonu je druhý argument počet ROZDĚLENÍ, v JS je to
 * limit počtu PRVKŮ výsledku. `url.split("/live/", 1)[1]` je proto v JS
 * `undefined` (a v Pythonu funguje) — na tomhle spadl první běh Workeru
 * s „Cannot read properties of undefined". Je to stejná rodina jako past 118
 * (Latin-1): předpoklad přenesený z jiného jazyka.
 */
const slugOf = (url: string): string | null => {
	const i = url.indexOf("/live/");
	if (i < 0) return null;
	const slug = url.slice(i + 6).split("?")[0]!.replace(/^\/|\/$/g, "");
	return SLUG_OK.test(slug) ? slug : null;
};

/** `/live/<slug>/` → imprese a kliky z Googlu. */
async function gscPages(env: Env): Promise<Record<string, { impressions: number; clicks: number; position: number }>> {
	const token = await gscToken(env);
	const end = new Date();
	const start = new Date(end.getTime() - GSC_LOOKBACK_DAYS * 86_400_000);
	const res = await fetchWithTimeout(
		`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				startDate: start.toISOString().slice(0, 10),
				endDate: end.toISOString().slice(0, 10),
				dimensions: ["page"], rowLimit: 25000, dataState: "all",
			}),
		}, 180_000);
	if (!res.ok) throw new Error(`GSC HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = await res.json() as { rows?: Array<{ keys: string[]; impressions: number; clicks: number; position: number }> };
	const out: Record<string, { impressions: number; clicks: number; position: number }> = {};
	for (const row of data.rows ?? []) {
		const slug = slugOf(row.keys[0] ?? "");
		if (!slug) continue;
		out[slug] = {
			impressions: Math.round(row.impressions), clicks: Math.round(row.clicks),
			position: Math.round(row.position * 10) / 10,
		};
	}
	return out;
}

/**
 * `/live/<slug>/` → imprese a kliky z Bingu.
 *
 * `GetPageStats` vrací **týdenní přihrádky**, takže jeden slug přijde víckrát
 * a musí se sčítat. Pozice se bere jako **minimum** (nejlepší dosažená), ne
 * průměr průměrů.
 */
async function bingPages(env: Env): Promise<Record<string, { impressions: number; clicks: number; position: number | null }>> {
	if (!env.BING_WEBMASTER_API_KEY) return {};
	const res = await fetchWithTimeout(
		`https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?apikey=${env.BING_WEBMASTER_API_KEY}&siteUrl=${encodeURIComponent(SITE)}`,
		{}, 180_000);
	if (!res.ok) throw new Error(`Bing HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = await res.json() as { d?: Array<Record<string, unknown>> };
	const out: Record<string, { impressions: number; clicks: number; position: number | null }> = {};
	for (const row of data.d ?? []) {
		const slug = slugOf(String(row.Query ?? ""));
		if (!slug) continue;
		const rec = (out[slug] ??= { impressions: 0, clicks: 0, position: null });
		rec.impressions += Number(row.Impressions ?? 0);
		rec.clicks += Number(row.Clicks ?? 0);
		const pos = Number(row.AvgImpressionPosition ?? 0);
		if (pos && (rec.position === null || pos < rec.position)) rec.position = pos;
	}
	return out;
}

export async function run(env: Env, dry = false): Promise<DemandResult> {
	const old = (await env.KV.get<Demand>("demand", { type: "json", cacheTtl: 30 })) ?? {};
	const out: Demand = { ...old };

	const gsc = await gscPages(env);
	for (const [slug, v] of Object.entries(gsc)) {
		out[slug] = { ...(out[slug] ?? {}), impressions: v.impressions, clicks: v.clicks, position: v.position };
	}

	let bing: Record<string, { impressions: number; clicks: number; position: number | null }> | null = null;
	let bingError: string | undefined;
	try {
		bing = await bingPages(env);
		// Bing má VLASTNÍ pole a GSC NEPŘEPISUJE. Jinak by se nedalo poznat,
		// který vyhledávač stránku drží — a to je přesně ta informace, kvůli
		// které tenhle skript existuje (D53).
		for (const [slug, v] of Object.entries(bing)) {
			const rec: Rec = { ...(out[slug] ?? {}), bing_impressions: v.impressions, bing_clicks: v.clicks };
			if (v.position !== null) rec.bing_position = Math.round(v.position * 10) / 10;
			out[slug] = rec;
		}
	} catch (e) {
		// Výpadek Bingu nesmí zahodit GSC data — zapíše se aspoň to.
		// Chyba jde i do výsledku: bez toho se ztratí v logu a `bing: null`
		// nikomu neřekne, co se stalo.
		bingError = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300);
		logf("demand", { bingError });
	}

	const keep: Demand = {};
	for (const [page, v] of Object.entries(out)) {
		if ((v.volume ?? 0) > 0 || (v.impressions ?? 0) > 0 || (v.bing_impressions ?? 0) > 0) keep[page] = v;
	}

	const top = Object.entries(keep)
		.sort((a, b) => (b[1].volume ?? 0) - (a[1].volume ?? 0))
		.slice(0, 10)
		.map(([page, v]) => ({ page, volume: v.volume ?? 0, impressions: v.impressions ?? 0 }));

	const result: DemandResult = {
		gsc: { pages: Object.keys(gsc).length, impressions: Object.values(gsc).reduce((a, v) => a + v.impressions, 0) },
		bing: bing ? {
			pages: Object.keys(bing).length,
			impressions: Object.values(bing).reduce((a, v) => a + v.impressions, 0),
			clicks: Object.values(bing).reduce((a, v) => a + v.clicks, 0),
		} : null,
		known: Object.keys(out).length, keep: Object.keys(keep).length,
		written: false, top, ...(bingError ? { bingError } : {}),
	};

	// **Fail-safe proti zápisu prázdna.** Python se jistí tím, že bez registry
	// skončí — Worker registry nečte, takže by tu pojistku ztratil. Kdyby oba
	// zdroje vrátily nula a zapsalo se `{}`, web by přišel o retenci (D35)
	// a všechny stránky bez jiné opory by začaly mizet.
	if (!result.keep && Object.keys(old).length) {
		logf("demand", { ...result, refused: "oba zdroje prázdné, stará data se nepřepisují" });
		throw new Error(`demand: zdroje vrátily 0 stránek, ale v KV je ${Object.keys(old).length} — nezapisuji`);
	}

	if (dry) {
		logf("demand", { ...result, dry: true });
		return result;
	}
	const payload = JSON.stringify(keep);
	if (payload.length > MAX_DEMAND_BYTES) throw new Error(`demand je ${payload.length} B — nad stropem KV`);
	await env.KV.put("demand", payload);
	result.written = true;
	logf("demand", result);
	return result;
}
