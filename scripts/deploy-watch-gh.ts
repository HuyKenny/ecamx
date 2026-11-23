/**
 * Deploy watchdog (`workers/cron/deploy-watch.ts`, D56) run from GitHub
 * Actions (a step of `.github/workflows/live.yml`) instead of the cron Worker
 * `ecamx-cron` — Workers Free leaves the account's 5 cron triggers to the hub
 * (D95). Same module, same thresholds; only the bindings are shimmed:
 * KV `ecamx-registry` via the REST API (state is written only when the
 * watchdog acts, a handful of writes a month), `GITHUB_TOKEN` = the workflow
 * token (actions: write → it can dispatch `deploy.yml`).
 *
 *   node --experimental-strip-types scripts/deploy-watch-gh.ts [--dry-run]
 */
import { run } from '../workers/cron/deploy-watch.ts';
import type { Env } from '../workers/cron/shared.ts';

// The zone WAF challenges datacenter clients; `x-malina-warm` passes (same as
// the deploy smoke test). Only for our own site, never logged.
const warm = process.env.MALINA_WARM_TOKEN;
if (warm) {
	const orig = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (!/^https:\/\/(www\.)?ecamx\.com\//.test(url)) return orig(input, init);
		const headers = new Headers(init?.headers);
		headers.set('x-malina-warm', warm);
		return orig(input, { ...init, headers });
	}) as typeof fetch;
}

const acc = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN, ns = process.env.CF_KV_NAMESPACE_ID;
const kvUrl = (key: string) => `https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;

const KV = {
	async get(key: string, opts?: { type?: string } | string): Promise<unknown> {
		if (!acc || !token || !ns) return null;
		const r = await fetch(kvUrl(key), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
		if (!r.ok) return null;
		const text = await r.text();
		const type = typeof opts === 'string' ? opts : opts?.type;
		return type === 'json' ? JSON.parse(text) : text;
	},
	async put(key: string, value: string): Promise<void> {
		if (!acc || !token || !ns) throw new Error('KV credentials missing');
		const r = await fetch(kvUrl(key), { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: value, signal: AbortSignal.timeout(20_000) });
		if (!r.ok) throw new Error(`KV put ${r.status}`);
	},
};

const env = {
	KV,
	GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
	DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? '',
	DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID || undefined,
} as unknown as Env;

const result = await run(env, process.argv.includes('--dry-run'));
console.log(JSON.stringify(result));
