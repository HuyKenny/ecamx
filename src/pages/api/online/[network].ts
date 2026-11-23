/**
 * `/api/online/{net}/` — retired 23. 11. 2026 (D95). The same data is the
 * static file `/livedata/online/{net}.json` (no Worker), read through
 * `fetchOnline()` in `src/lib/live-client.ts`, which keeps this contract.
 *
 * Kept as a constant "we don't know" for HTML cached before the switch:
 * `truncated` + `absenceUnproven` make every old client hide nothing.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ params }) => new Response(JSON.stringify({
	network: String(params.network ?? '').replace(/[^a-z0-9]/g, '').slice(0, 20),
	count: 0, truncated: true, absenceUnproven: true, stale: true, floor: 0, age: null, online: {},
}), {
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'public, max-age=3600',
		'x-content-type-options': 'nosniff',
		'x-robots-tag': 'noindex',
	},
});
