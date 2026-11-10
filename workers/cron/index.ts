/**
 * `ecamx-cron` — periodické úlohy ecamx.com, které dřív běžely na Malině.
 *
 * Proč vlastní Worker a ne appka: Astro adaptér `scheduled` neumí (v jeho kódu
 * se slovo nevyskytuje), takže cron trigger nemá kam pověsit. V účtu je víc
 * takových workerů (`qrflowy-redirect`, `hlidamo`), tenhle je první
 * s cron triggerem — proto se cesta ověřuje ručně (`wrangler dev
 * --test-scheduled`), ne podle vzoru.
 *
 * **Úlohy se mapují podle `event.cron`, ne `switch`em na literál.** Překlep
 * v `wrangler.cron.jsonc` se tak projeví jako hlasitá chyba v logu, ne jako
 * cron, který se spouští a nic nedělá.
 *
 * | cron (UTC)      | úloha        | nahrazuje (Malina)                    |
 * |-----------------|--------------|---------------------------------------|
 * | `*​/30 * * * *`  | deploy-watch | `bin/ecamx-deploy-watch.py` (záloha) |
 *
 * **Pingy do vyhledávačů z Cloudflare nejdou.** Bing Webmaster API vrací
 * `ErrorCode 17 ThrottleIP` a api.indexnow.org `429 TooManyRequests` —
 * obojí na sdílené egress IP Cloudflaru, ne na nás: týž požadavek z Maliny
 * ve stejnou minutu projde (ověřeno 28. 9. 2026). Proto `indexnow.py` i
 * `demand.py` **zůstávají na Malině** a tady mají jen ruční `/run` — kód je
 * hotový a ověřený na výběru URL i na GSC, kdyby se to jednou změnilo.
 *
 * Pozor na časovou zónu: **cron triggery jsou UTC**, kdežto crontab Maliny je
 * `Europe/Prague`. Původní `20 5` místního času je v létě `20 3` UTC. Fixní
 * UTC čas znamená, že v zimě se běh posune o hodinu — na tom nic nezávisí
 * (obě strany se rozhodují podle UTC data), a **nemá se to „opravovat" dvěma
 * výměnami cronu ročně**.
 */

import { run as deployWatch } from "./deploy-watch.ts";
import { run as indexnow } from "./indexnow.ts";
import { run as demand } from "./demand.ts";
import type { Env } from "./shared.ts";

/** Úlohy, které Worker umí. Klíč je přesný výraz z `triggers.crons`. */
const TASKS: Record<string, (env: Env) => Promise<unknown>> = {
	"*/30 * * * *": (env) => deployWatch(env),
};

/** Ruční spuštění podle jména (pro `/run?task=`). */
/** `limit` jen zužuje dávku (ostrý test na pár URL), nikdy ji nezvětší. */
const BY_NAME: Record<string, (env: Env, dry: boolean, limit?: number) => Promise<unknown>> = {
	"deploy-watch": (env, dry) => deployWatch(env, dry),
	"bing": (env, dry, limit) => indexnow(env, "bing", Math.min(limit ?? 100, 100), dry),
	"indexnow": (env, dry, limit) => indexnow(env, "indexnow", Math.min(limit ?? 2000, 2000), dry),
	"demand": (env, dry) => demand(env, dry),
};

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const task = TASKS[event.cron];
		if (!task) {
			// Hlasitě: znamená to překlep v konfiguraci, ne „nic se nedělo".
			console.error(JSON.stringify({
				task: "unknown-cron", cron: event.cron,
				known: Object.keys(TASKS),
				hint: "dopiš úlohu do TASKS, nebo trigger vyndej z wrangler.cron.jsonc",
			}));
			return;
		}
		// `ctx.waitUntil` schválně nepoužíváme: cron má vlastní časové okno
		// a práce musí doběhnout v něm, ne po odpovědi.
		await task(env);
	},

	/**
	 * Ruční spuštění — **v produkci cron vyvolat nejde** (dokumentace zná jen
	 * lokální `/cdn-cgi/local/scheduled`), takže bez tohohle by se úloha před
	 * zapnutím triggeru nedala porovnat s Malinou.
	 *
	 *   POST /run?task=deploy-watch&dry=1   → plán, žádné vedlejší účinky
	 *   POST /run?task=deploy-watch         → naostro
	 */
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== "/run") {
			return new Response("ecamx-cron\n", { status: 200 });
		}
		if (request.method !== "POST") return new Response("jen POST\n", { status: 405 });

		// Porovnání konstantním časem — token je krátký a hádání by mělo být
		// drahé. `timingSafeEqual` potřebuje stejnou délku, proto se délka
		// kontroluje předem.
		const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
		if (!(await tokenMatches(given, env.MANUAL_TOKEN))) {
			return new Response("ne\n", { status: 401 });
		}

		const name = url.searchParams.get("task") ?? "";
		const fn = BY_NAME[name];
		if (!fn) {
			return Response.json({ error: `neznámá úloha ${name}`, known: Object.keys(BY_NAME) }, { status: 404 });
		}
		const dry = url.searchParams.get("dry") === "1";
		const rawLimit = Number(url.searchParams.get("limit"));
		const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
		try {
			const result = await fn(env, dry, limit);
			return Response.json({ task: name, dry, result });
		} catch (e) {
			return Response.json({ task: name, error: (e as Error).message }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;

/** Porovnání tokenu v konstantním čase. */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
	if (!expected || given.length !== expected.length) return false;
	const enc = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(given)),
		crypto.subtle.digest("SHA-256", enc.encode(expected)),
	]);
	const x = new Uint8Array(a), y = new Uint8Array(b);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}
