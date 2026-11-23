/**
 * Odchozí přesměrování na affiliate URL — logika je v `src/lib/go.ts` (D97),
 * v produkci tuhle cestu obslouží rovnou `src/worker.ts` bez Astra.
 */
import type { APIRoute } from 'astro';
// Astro 7 zrušilo `Astro.locals.runtime.env`; Worker secrets se berou odsud.
import { env as workerEnv } from 'cloudflare:workers';
import { goRedirect } from '../../../lib/go';

export const prerender = false;

export const GET: APIRoute = ({ params, url, request, locals }) => {
	const ctx = (locals as { cfContext?: ExecutionContext }).cfContext;
	return goRedirect(params, url, request, workerEnv, ctx ? (p) => ctx.waitUntil(p) : undefined);
};
