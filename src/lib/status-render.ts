/**
 * `/status/` and `/status/{network}/` without Astro (D98, Workers Free 10 ms CPU).
 *
 * The SSR pages cost 10–32 ms CPU per request through Astro (measured 23. 11. 2026). Now `src/worker.ts` serves
 * them from the prerendered shells `/status-shell/…` (`src/pages/status-shell/`), whose `data-s` slots are filled
 * here with HTMLRewriter; the markup comes from `status-parts.ts`. The SSR pages in `src/pages/status/` stay as the
 * fallback (no shell, odd paths). Data: `/livedata/meta.json` + `p/all.json` via `LIVE_DATA` (memoised per isolate).
 */
import { readMeta, readPools } from './live-data';
import { withSecurityHeaders } from './security-headers';
import { statusIndexParts, statusParts } from './status-parts';

type Assets = { fetch(req: Request): Promise<Response> };

async function shell(assets: Assets, url: URL, path: string): Promise<Response | null> {
	const res = await assets.fetch(new Request(new URL(path, url)));
	return res.ok && res.body ? res : null;
}

function respond(rw: HTMLRewriter, body: Response, csp: string): Response {
	// Same headers as the SSR page: Astro's `text/html`, withSecurityHeaders + 60 s cache.
	const headers = withSecurityHeaders(new Headers({ 'content-type': 'text/html' }), csp);
	headers.set('cache-control', 'public, max-age=60');
	return rw.transform(new Response(body.body, { status: 200, headers }));
}

function fill(slots: Record<string, string>, built: string | null): HTMLRewriter {
	let rw = new HTMLRewriter();
	// Without a snapshot the shell keeps the build time, as the SSR Layout does.
	if (built) rw = rw.on('meta[name="ecamx-built"]', { element(el) { el.setAttribute('content', built); } });
	for (const [name, html] of Object.entries(slots)) {
		rw = rw.on(`[data-s="${name}"]`, {
			element(el) {
				if (html) el.replace(html, { html: true });
				else el.remove();
			},
		});
	}
	return rw;
}

/** `/status/{net}/` — `net` must be a lowercase id from NETWORK_IDS (the caller checks). */
export async function renderStatus(net: string, networkIds: Set<string>, assets: Assets, url: URL, csp: string): Promise<Response | null> {
	const sh = await shell(assets, url, `/status-shell/${net}/`);
	if (!sh) return null;
	const [snap, pools] = await Promise.all([readMeta(), readPools('all')]);
	const p = statusParts(net, networkIds, snap, pools, Date.now());
	const rw = fill({ top: p.top, others: p.others }, p.built).on('script[data-s="ld"]', {
		element(el) {
			el.setInnerContent(p.ld, { html: true });
			el.removeAttribute('data-s');
		},
	});
	return respond(rw, sh, csp);
}

/** `/status/` hub. */
export async function renderStatusIndex(networkIds: Set<string>, assets: Assets, url: URL, csp: string): Promise<Response | null> {
	const sh = await shell(assets, url, '/status-shell/');
	if (!sh) return null;
	const p = statusIndexParts(networkIds, await readMeta(), Date.now());
	return respond(fill({ rows: p.rows }, p.built), sh, csp);
}
