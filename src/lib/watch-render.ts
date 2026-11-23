/**
 * Dynamic page of a live model without a static page (D95): the prerendered
 * shell `/watch-shell/` with its `data-w-*` slots filled by `HTMLRewriter`.
 * Same content and rules as the old SSR `/watch/[p].astro` (D82, D84, D86) —
 * only no Astro render in the Worker (10 ms CPU on Workers Free).
 */
import { env } from 'cloudflare:workers';
import { embedUrl, goLink } from './affiliate';
import { NETWORK_LABELS, countryName, facetLabel } from './labels';
import { viewersText } from './card';
import { countryPhrase } from './taxonomy';
import { SITE_NAME } from './site';
import { withSecurityHeaders } from './security-headers';
import type { WRec } from './live-static';

/** Stream starts right away (Kenny 17. 11., D84) — every network with a frame. */
const AUTOPLAY_SAFE = new Set(['chaturbate', 'camsoda', 'stripchat', 'imlive', 'streamate', 'livejasmin', 'xlovecam']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function renderWatch(
	rec: WRec,
	assets: { fetch(req: Request): Promise<Response> },
	origin: URL,
	csp: string,
): Promise<Response | null> {
	const shell = await assets.fetch(new Request(new URL('/watch-shell/', origin)));
	if (!shell.ok || !shell.body) return null;

	const label = NETWORK_LABELS[rec.n] ?? rec.n;
	const get = (k: string) => String((env as unknown as Record<string, string>)[k] ?? '');
	let embed = '';
	try { embed = embedUrl(rec.n as never, rec.u, get, rec.e ?? null); } catch { embed = ''; }
	const iframe = /^https:\/\//.test(embed) ? embed : '';
	/** Cam4 and BongaCams play HLS in our `<video>` (D62/D70); the script fetches a fresh URL. */
	const hls = embed.startsWith('hls:') ? embed.slice(4) : '';
	const chatEmbed = rec.n === 'chaturbate' && !!iframe;
	const cta = goLink(rec.n as never, rec.u, 'profile');
	const u = rec.u;
	const title = `${u} Live Cam on ${label} — Watch Free | ${SITE_NAME}`;
	const desc = `${u} is live on ${label} right now${rec.c ? ` from ${countryPhrase(countryName(rec.c))}` : ''}. Watch the stream free on eCamx, no signup — plus who else is live like her.`;
	const tags = (rec.tg ?? []).map((t) =>
		`<a class="pill" href="/cams/${esc(t)}/">${esc(facetLabel(t, t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())))}</a>`).join('');

	const vals: Record<string, string> = {
		u,
		n: rec.n,
		key: `${rec.n}:${rec.s}`,
		topKey: rec.k || 'all',
		poster: rec.t,
		alt: `${u} live on ${label}`,
		embed: iframe,
		autoplay: iframe && AUTOPLAY_SAFE.has(rec.n) && !rec.pr ? '1' : '',
		hls,
		playLabel: `Play ${u}'s stream`,
		watchU: `Watch ${u} live`,
		openU: `Open ${u}'s stream on ${label}`,
		sideP: `Chat, tips and private shows with ${u} happen on ${label} — free account, no card needed to watch.`,
		chat: goLink(rec.n as never, rec.u, 'chat'),
		chatU: `Chat with ${u} →`,
		likeU: `Live now like ${u}`,
		cta,
		ctaText: `Chat & tip ${u} on ${label} →`,
		netDot: `net-${rec.n}`,
		netLetter: label.charAt(0),
		viewers: rec.v ? `${viewersText(rec.v)} watching` : '',
		line: `${label}${rec.c ? ` · ${countryName(rec.c)}` : ''}${rec.a ? ` · ${rec.a}` : ''}`,
		j: rec.j ? `“${rec.j}”` : '',
		tags,
		disclaimer: `Free to watch. eCamx earns a commission if you buy tokens on ${label} — it costs you nothing extra.`,
		similarH: `Live now, similar to ${u}`,
		theater: chatEmbed ? 'is-chat' : '',
	};
	const cond: Record<string, boolean> = {
		hls: !!hls,
		iframe: !hls && !!iframe,
		link: !hls && !iframe,
		side: !chatEmbed,
		chatSimilar: chatEmbed,
		pr: !!rec.pr,
		v: !!rec.v,
		j: !!rec.j,
		tags: !!tags,
	};

	const rw = new HTMLRewriter()
		.on('title', { element(el) { el.setInnerContent(title); } })
		.on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', {
			element(el) { el.setAttribute('content', desc); },
		})
		.on('meta[property="og:title"], meta[name="twitter:title"]', { element(el) { el.setAttribute('content', title); } })
		.on('[data-w-if]', {
			element(el) {
				if (!cond[el.getAttribute('data-w-if') ?? '']) el.remove();
				else el.removeAttribute('data-w-if');
			},
		})
		.on('[data-w-text]', {
			element(el) {
				el.setInnerContent(vals[el.getAttribute('data-w-text') ?? ''] ?? '');
				el.removeAttribute('data-w-text');
			},
		})
		.on('[data-w-html]', {
			element(el) {
				el.setInnerContent(vals[el.getAttribute('data-w-html') ?? ''] ?? '', { html: true });
				el.removeAttribute('data-w-html');
			},
		})
		.on('[data-w-attr]', {
			element(el) {
				for (const pair of (el.getAttribute('data-w-attr') ?? '').split(',')) {
					const [attr, key] = pair.split(':');
					if (!attr || !key) continue;
					const v = vals[key];
					if (v) el.setAttribute(attr, v); else el.removeAttribute(attr);
				}
				el.removeAttribute('data-w-attr');
			},
		})
		.on('[data-w-class]', {
			element(el) {
				const c = vals[el.getAttribute('data-w-class') ?? ''];
				if (c) el.setAttribute('class', `${el.getAttribute('class') ?? ''} ${c}`.trim());
				el.removeAttribute('data-w-class');
			},
		})
		.on('[data-live-grid]', {
			element(el) {
				el.setAttribute('data-q', vals.topKey!);
				el.setAttribute('data-x', vals.key!);
			},
		});

	const headers = withSecurityHeaders(new Headers({
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'public, max-age=60',
		'x-robots-tag': 'noindex, follow',
	}), csp);
	return rw.transform(new Response(shell.body, { status: 200, headers }));
}
