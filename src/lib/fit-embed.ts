/**
 * Chaturbate embed (D86) — dvě vlastnosti, se kterými musíme počítat:
 * 1. Embed s chatem má pevné desktopové rozvržení. Jede jen v divadle
 *    s chatem (`.theater.is-chat`) a od 900 px. Jinak jen video
 *    (`embed_video_only=1`) a chat obstará CTA pod přehrávačem. Stránka
 *    stavěná offline, kde modelka mezitím začala vysílat, si `.is-chat`
 *    přepne sama (`useChatTheater` v `model-page.ts`, 18. 11.).
 * 2. Jejich stránka v rámci má min. ~500 px výšky a vlastní `overflow: scroll`
 *    (cizí doména, `scrolling="no"` ji nezastaví). V nižším rámci se pak dá
 *    scrollovat. Rámec proto vykreslíme v logické výšce ≥ 500 px
 *    a `transform: scale` ho zmenší přesně do přehrávače.
 */
export const NARROW_MQ = '(max-width: 899px)';
const CB_MIN_H = 500;
const isCb = (src: string) => /^https:\/\/chaturbate\.com\/embed\//.test(src);

export function fitEmbed(src: string, chatLayout: boolean): string {
	if (!isCb(src) || src.includes('embed_video_only')) return src;
	const narrow = typeof matchMedia === 'function' && matchMedia(NARROW_MQ).matches;
	if (chatLayout && !narrow) return src;
	return src + (src.includes('?') ? '&' : '?') + 'embed_video_only=1';
}

function scaleToFit(el: HTMLIFrameElement, host: HTMLElement): void {
	const apply = () => {
		const w = host.clientWidth, h = host.clientHeight;
		if (!w || !h) return;
		const s = Math.min(1, h / CB_MIN_H);
		Object.assign(el.style, {
			inset: '0 auto auto 0',
			width: `${w / s}px`,
			height: `${h / s}px`,
			transform: s < 1 ? `scale(${s})` : '',
			transformOrigin: '0 0',
		});
	};
	apply();
	if ('ResizeObserver' in window) new ResizeObserver(apply).observe(host);
}

/** Nastaví `src` rámce (případně jen video) a u Chaturbate zmenšení. */
export function mountEmbed(el: HTMLIFrameElement, host: HTMLElement, src: string): void {
	const fitted = fitEmbed(src, !!host.closest('.theater.is-chat'));
	if (el.getAttribute('src') !== fitted) el.src = fitted;
	if (isCb(src)) scaleToFit(el, host);
}
