/**
 * `/api/live/grid/` — retired 23. 11. 2026 (D95). Grids read static files
 * under `/livedata/` (`src/lib/live-client.ts`); no Worker runs for them.
 *
 * Kept as a constant answer for HTML cached before the switch: "no fresh
 * data" makes the old client keep its static cards (D82 rule: an outage never
 * blanks a grid). No KV, no parsing — well under 1 ms.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => new Response('{"age":null,"fresh":false,"failed":[],"g":{}}', {
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'public, max-age=3600',
		'x-content-type-options': 'nosniff',
		'x-robots-tag': 'noindex',
	},
});
