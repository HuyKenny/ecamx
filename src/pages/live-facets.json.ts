/**
 * Facet keys the site has pages for, plus category slugs a card may link to —
 * read by the live publisher (`scripts/live-publish.ts`, D95), which runs in
 * Actions without the catalogue and must publish exactly the grids the pages
 * ask for. Prerendered at build (static asset, no Worker).
 */
import type { APIRoute } from 'astro';
import { ALLOWED_FACETS, CATEGORY } from '../lib/live-grid';

export const prerender = true;

export const GET: APIRoute = () => new Response(JSON.stringify({ keys: [...ALLOWED_FACETS].sort(), cat: [...CATEGORY].sort() }), {
	headers: { 'content-type': 'application/json; charset=utf-8' },
});
