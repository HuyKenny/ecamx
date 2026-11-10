/**
 * Společné pomocníky pro všechny úlohy cron Workeru.
 *
 * Worker je schválně **bez `nodejs_compat`** — `fetch`, WebCrypto, KV binding
 * a `TextEncoder` stačí, a menší bundle znamená rychlejší studený start.
 */

/**
 * Vazby a proměnné, které Worker dostane. Psané ručně, protože `wrangler types`
 * generuje typy pro APLIKAČNÍ worker (`dist/server/wrangler.json`), ne pro
 * tenhle — a `KVNamespace` i `ScheduledController` jsou v generovaném
 * `worker-configuration.d.ts` globální, takže žádná nová závislost není
 * potřeba. Podrobnosti v `docs/DECISIONS.md` (D77).
 */
export interface Env {
	/** Namespace `ecamx-registry` — stejný jako pro registry a `demand`. */
	KV: KVNamespace;
	/** Fine-grained PAT na `HuyKenny/ecamx` (Actions: read + write). */
	GITHUB_TOKEN: string;
	/** Bot token z `/home/kenny/Discord/.env`. */
	DISCORD_TOKEN: string;
	/** Kanál pro hlášení; když chybí, použije se `DEFAULT_CHANNEL`. */
	DISCORD_CHANNEL_ID?: string;
	/** Master klíč portfolia pro Bing Webmaster Tools (`SubmitUrlBatch`). */
	BING_WEBMASTER_API_KEY: string;
	/**
	 * Celý JSON service accountu pro Search Console (`~/.config/gsc/service-account.json`,
	 * ~2,4 kB — vejde se do jednoho secretu, limit je 5 kB). Scope je jen
	 * `webmasters.readonly`, takže umí číst a nic víc.
	 */
	GSC_SERVICE_ACCOUNT: string;
	/** Token pro ruční spuštění přes `POST /run`. */
	MANUAL_TOKEN: string;
}

/** #obecné na „Huy Place" — stejná konstanta jako v `bin/ecamx-deploy-watch.py`. */
export const DEFAULT_CHANNEL = "1519455311558082752";
export const SITE = "https://ecamx.com/";
export const REPO = "HuyKenny/ecamx";
/** Workflow se spouští JMÉNEM SOUBORU, ne polem `name:`. */
export const WORKFLOW_FILE = "deploy.yml";

/** Klíč v KV pro stav hlídače. Tvar 1:1 s `~/ai/tmp/ecamx-deploy-watch.json`. */
export const STATE_KEY = "deploy-watch-state";

export interface WatchState {
	/** ISO čas posledního nakopnutí — brání kicku častěji než 1×/h. */
	kicked?: string;
	/** ISO čas posledního poplachu — brání opakování téže zprávy. */
	last_alert?: string;
	/** Je otevřený incident? Podle toho se posílá „zase to jede". */
	open?: boolean;
}

export async function loadState(env: Env): Promise<WatchState> {
	// `cacheTtl` 30 s (povolené minimum): bez něj by dvě kola cronu čtoucí
	// vteřinu po sobě viděla tentýž stav. KV ale NENÍ zámek — je to jen
	// best-effort pojistka proti zdvojení, stejně jako `flock` na Malině.
	return (await env.KV.get<WatchState>(STATE_KEY, { type: "json", cacheTtl: 30 })) ?? {};
}

export async function saveState(env: Env, state: WatchState): Promise<void> {
	await env.KV.put(STATE_KEY, JSON.stringify(state));
}

/** `fetch` s časovým limitem. Cron má wall clock 15 min, ale viset se nemá. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), ms);
	try {
		return await fetch(url, { ...init, signal: ctrl.signal });
	} finally {
		clearTimeout(t);
	}
}

/** Zpráva do Discordu. Vrací `true` jen když ji Discord opravdu přijal. */
export async function discord(env: Env, text: string): Promise<boolean> {
	const channel = env.DISCORD_CHANNEL_ID || DEFAULT_CHANNEL;
	const res = await fetchWithTimeout(`https://discord.com/api/v10/channels/${channel}/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${env.DISCORD_TOKEN}`,
			"Content-Type": "application/json",
			"User-Agent": "ecamx-cron/1.0",
		},
		body: JSON.stringify({ content: text.slice(0, 1900) }),
	});
	if (res.status === 429) {
		// Jeden retry podle `Retry-After` — Discord rate limit je běžný a ztratit
		// kvůli němu poplach je horší než počkat.
		const after = Number(res.headers.get("retry-after") ?? "1");
		await new Promise((r) => setTimeout(r, Math.min(after, 10) * 1000));
		const retry = await fetchWithTimeout(`https://discord.com/api/v10/channels/${channel}/messages`, {
			method: "POST",
			headers: {
				Authorization: `Bot ${env.DISCORD_TOKEN}`,
				"Content-Type": "application/json",
				"User-Agent": "ecamx-cron/1.0",
			},
			body: JSON.stringify({ content: text.slice(0, 1900) }),
		});
		return retry.ok;
	}
	return res.ok;
}

/** Strukturovaný řádek do logu — `wrangler tail` se pak dá diffovat s logem Maliny. */
export function logf(task: string, data: object): void {
	console.log(JSON.stringify({ task, ...data }));
}
