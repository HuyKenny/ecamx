/**
 * `/api/live/is/` — retired 23. 11. 2026 (D95); `zap.ts` reads the
 * `/livedata/w/` shard instead. Constant "don't know" for old cached pages.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => new Response('{"live":null}', {
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'public, max-age=3600',
		'x-content-type-options': 'nosniff',
		'x-robots-tag': 'noindex',
	},
});
