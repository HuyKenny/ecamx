/**
 * Worker entry (`main` in `wrangler.jsonc`, D95).
 *
 * Workers Free allows 10 ms CPU per request. Measured 23. 11. 2026: a warm
 * `/live/{slug}/` redirect costs 0–3 ms, but the first request of an isolate
 * 6–25 ms, most of it Astro's start-up (`createApp()`, manifest, route
 * matching) — and crawler hits on old model URLs are mostly first requests.
 * So `/live/*` (the only hot Worker path: dynamic live pages + redirects of
 * gone pages) goes straight to `catchAll()`; Astro's handler is imported
 * lazily, only for everything else (`/api/stream/`, `/status/`, other
 * catch-all paths). `/go/{network}/{user}/` (the affiliate exit, the only
 * path that earns money) skips Astro too since D97: through Astro a cold
 * isolate cost 10–17 ms (measured 23. 11. 2026), on Free that is error 1102. Static files never reach this code (assets layer first).
 *
 * During the build the same entry serves the prerender phase — then
 * everything goes to Astro (`isPrerender`), or static `/live/` pages would not
 * be rendered.
 */
// @ts-ignore virtual module of @astrojs/cloudflare (vite-plugin-config.js)
import { isPrerender } from 'virtual:astro-cloudflare:config';
import { catchAll, type Assets } from './lib/catch-all';
import { goRedirect } from './lib/go';

type Handler = { handle(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> };
let astro: Promise<Handler> | null = null;
const GO = /^\/go\/([^/]+)\/([^/]+)\/$/;

function safeDecode(s: string): string | null {
	try {
		return decodeURIComponent(s);
	} catch {
		return null;
	}
}

export default {
	async fetch(request: Request, env: { ASSETS?: Assets }, ctx: ExecutionContext): Promise<Response> {
		if (!isPrerender && (request.method === 'GET' || request.method === 'HEAD')) {
			const url = new URL(request.url);
			if (url.pathname.startsWith('/live/')) return catchAll(url, env.ASSETS);
			// Same shape Astro matches (trailingSlash: 'always'); anything else
			// (no slash, extra segments) still goes through Astro.
			const go = GO.exec(url.pathname);
			if (go) {
				const network = safeDecode(go[1]);
				const user = safeDecode(go[2]);
				if (network !== null && user !== null) {
					return goRedirect({ network, user }, url, request, env, (p) => ctx.waitUntil(p));
				}
			}
		}
		astro ??= import('@astrojs/cloudflare/handler') as Promise<Handler>;
		return (await astro).handle(request, env, ctx);
	},
};
