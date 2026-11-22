/**
 * Karta modelky — JEDNA šablona pro build i prohlížeč (D82).
 *
 * Do 17. 11. 2026 byla karta v `ModelCard.astro` a klientský kód si ji
 * „klonoval" ze sousední karty a přepisoval atributy (záchranné karty, D67).
 * Teď mřížku plní prohlížeč z živého snímku, takže kartu musí umět vyrobit
 * i on — a dvě kopie šablony by se rozešly. Proto čistá funkce nad malým
 * tvarem dat, bez katalogu (`labels.ts` je pár kB).
 *
 * Pravidla, která se nemění:
 *  - **z karty se ven nechodí** (D71): jediný odkaz vede na `/live/{p}/`,
 *  - pevný poměr náhledu → CLS 0,
 *  - `.thumb-wrap` + `img[data-preview]` čte hover náhled a záchrana obrázku.
 */
import { NETWORK_LABELS, countryName, facetLabel } from './labels.ts';
import { CARD_UI, type Lang } from './i18n.ts';

export interface CardData {
	/** síť */
	n: string;
	/** jméno pro zobrazení (username) */
	u: string;
	/** cesta stránky bez `/live/` */
	p: string;
	/** slug (klíč `síť:slug` pro živý stav) */
	s: string;
	/** náhled */
	t: string;
	tf?: string;
	v?: number;
	h?: 1;
	nw?: 1;
	ty?: 1;
	pr?: 1;
	c?: string;
	a?: number;
	pv?: string;
	/** až 2 tagy (slugy kategorií) */
	tg?: string[];
	/** 1 = karta ze starého buildu, o které nevíme, jestli vysílá */
	stale?: 1;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Jen https adresa smí do `src` (feed občas pošle `http://` nebo nic). */
const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) ? u : '');

function tagLabel(slug: string): string {
	return facetLabel(slug, slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
}

export function viewersText(v: number): string {
	return v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k` : v.toLocaleString('en-US');
}

/** HTML jedné karty. `eager` = prvních pár karet nad ohybem (LCP). */
/** Název země ve španělštině (D94) přes Intl — v prohlížeči i v Node zdarma. */
let esRegions: Intl.DisplayNames | null = null;
function countryEs(code: string): string {
	try {
		esRegions ??= new Intl.DisplayNames(['es'], { type: 'region' });
		return esRegions.of(code.toUpperCase()) ?? countryName(code);
	} catch {
		return countryName(code);
	}
}

export function cardHtml(d: CardData, opts: { eager?: boolean; priority?: boolean; lang?: Lang } = {}): string {
	const lang = opts.lang ?? 'en';
	const ui = CARD_UI[lang];
	const label = NETWORK_LABELS[d.n] ?? d.n;
	const age = d.a && d.a >= 18 && d.a <= 80 ? d.a : null;
	const meta = [label, d.c ? (lang === 'es' ? countryEs(d.c) : countryName(d.c)) : null, age].filter(Boolean).join(' · ');
	const href = `/live/${encodeURIComponent(d.p)}/`;
	const thumb = safeUrl(d.t);
	const fb = safeUrl(d.tf);
	const pv = safeUrl(d.pv);
	const badges = [
		d.h ? '<span class="sticker sticker-hd">HD</span>' : '',
		d.nw ? `<span class="sticker sticker-new">${ui.new}</span>` : '',
		d.ty ? `<span class="sticker sticker-toy" title="${ui.toyTitle}">${ui.toy}</span>` : '',
	].join('');
	// Tagy jsou anglické popisky kategorií — na španělské stránce se nezobrazují.
	const tags = (lang === 'es' ? [] : d.tg ?? []).slice(0, 2)
		.map((t) => `<span class="card-tag">${esc(tagLabel(t))}</span>`).join('');
	const live = d.stale ? '' : d.pr
		? `<span class="live-pill live-pill-private">${ui.private}</span>`
		: `<span class="live-pill" data-live-badge>${ui.live}</span>`;
	const viewers = !d.stale && d.v && d.v > 0
		? `<span class="viewer-pill" data-viewers>${viewersText(d.v)}<span class="sr-only">${ui.watching}</span></span>`
		: '';
	return `<article class="card${d.stale ? ' is-stale' : ''}" data-network="${esc(d.n)}" data-k="${esc(d.n)}:${esc(d.s)}">`
		+ `<div class="thumb-wrap">`
		+ (thumb
			? `<img src="${esc(thumb)}" alt="${esc(d.u)} ${ui.alt}" width="320" height="180"`
				+ ` loading="${opts.eager ? 'eager' : 'lazy'}" decoding="async"`
				+ (opts.priority ? ' fetchpriority="high"' : '')
				+ ` referrerpolicy="no-referrer"`
				+ (pv ? ` data-preview="${esc(pv)}"` : '')
				+ (fb ? ` data-thumb-fallback="${esc(fb)}"` : '')
				+ '>'
			: '<span class="thumb-empty" aria-hidden="true"></span>')
		+ `<span class="thumb-top">${live}${badges}</span>`
		+ viewers
		+ `</div>`
		+ `<div class="card-meta">`
		+ `<span class="net-dot net-${esc(d.n)}" aria-hidden="true">${esc(label.charAt(0))}</span>`
		+ `<div class="card-text">`
		+ `<p class="card-name"><a href="${href}" class="stretch">${esc(d.u)}</a></p>`
		+ `<p class="card-sub">${esc(meta)}</p>`
		+ (tags ? `<p class="card-tags">${tags}</p>` : '')
		+ `</div></div></article>`;
}
