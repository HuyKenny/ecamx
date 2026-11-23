/**
 * Worker entry (`main` in `wrangler.jsonc`, D95).
 *
 * Workers Free allows 10 ms CPU per request. Measured 23. 11. 2026: a warm
 * `/live/{slug}/` redirect costs 0–3 ms, but the first request of an isolate
 * 6–25 ms, most of it Astro's start-up (`createApp()`, manifest, route
 * matching) — and crawler hits on old model URLs are mostly first requests.
 * So `/live/*` (the only hot Worker path: dynamic live pages + redirects of
 * gone pages) goes straight to `catchAll()`; Astro's handler is imported
 * lazily, only for everything else (`/go/`, `/api/stream/`, `/status/`, other
 * catch-all paths). Static files never reach this code (assets layer first).
 *
 * During the build the same entry serves the prerender phase — then
 * everything goes to Astro (`isPrerender`), or static `/live/` pages would not
 * be rendered.
 */
// @ts-ignore virtual module of @astrojs/cloudflare (vite-plugin-config.js)
import { isPrerender } from 'virtual:astro-cloudflare:config';
import { catchAll, type Assets } from './lib/catch-all';

type Handler = { handle(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> };
let astro: Promise<Handler> | null = null;

export default {
	async fetch(request: Request, env: { ASSETS?: Assets }, ctx: ExecutionContext): Promise<Response> {
		if (!isPrerender && (request.method === 'GET' || request.method === 'HEAD')) {
			const url = new URL(request.url);
			if (url.pathname.startsWith('/live/')) return catchAll(url, env.ASSETS);
		}
		astro ??= import('@astrojs/cloudflare/handler') as Promise<Handler>;
		return (await astro).handle(request, env, ctx);
	},
};
