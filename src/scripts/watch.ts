/**
 * Přehrávač dynamické stránky modelky (`src/pages/watch/[p].astro`, D82).
 * Sítě s ověřeným autoplayem pustí stream hned, ostatní po kliknutí
 * (Heavy Ad Intervention, D13/D14). Když modelka mezitím dovysílá
 * (`ecamx:model-offline` z `live.ts`), přehrávač zmizí a zůstane poster
 * + podobné živé.
 *
 * D88: stránka se může vyměnit bez načtení (`zap.ts`) — `init()` čte aktuální
 * DOM a spouští se znovu na `ecamx:zapped`; HLS se ruší na `ecamx:zap-before`.
 */
import { mountEmbed } from '../lib/fit-embed';

type HlsLike = { destroy(): void };
const hlsInstances: HlsLike[] = [];

function start(box: HTMLElement, play: HTMLButtonElement | null): void {
	const src = box.dataset.embed;
	if (!src || box.querySelector('iframe')) return;
	const f = document.createElement('iframe');
	f.allow = 'autoplay; fullscreen';
	f.setAttribute('scrolling', 'no');
	f.setAttribute('allowfullscreen', '');
	f.referrerPolicy = 'no-referrer-when-downgrade';
	f.className = 'absolute inset-0 h-full w-full';
	box.appendChild(f);
	mountEmbed(f, box, src);
	play?.remove();
	try { (window as unknown as { gtag?: Function }).gtag?.('event', 'player_start', { page_type: 'model_dynamic' }); } catch { /* měření */ }
}

/**
 * Cam4 / BongaCams: HLS v našem `<video>` (D62, D70). Cam4 adresa z feedu
 * rychle stárne, proto se nejdřív bere čerstvá z `/api/stream/`; BongaCams
 * zkusí adresu ze snímku (max. 5 min stará) a při chybě čerstvou.
 */
function startHls(video: HTMLVideoElement): void {
	const net = video.dataset.network ?? '';
	const nick = video.dataset.nick ?? '';
	let refreshed = false;
	const fresh = async (): Promise<string | null> => {
		if (refreshed) return null;
		refreshed = true;
		try {
			const r = await fetch(`/api/stream/${net}/${encodeURIComponent(nick)}/`, { signal: AbortSignal.timeout(8000) });
			return ((await r.json()) as { url?: string }).url ?? null;
		} catch { return null; }
	};
	// Adresa ze snímku jen z hostů sítí — stejná kontrola jako v `/api/stream/` (D85).
	const SAFE = /^https:\/\/[a-z0-9.-]+\.(bcvcdn|xcdnpro)\.com\//i;
	const snapSrc = SAFE.test(video.dataset.src ?? '') ? video.dataset.src! : null;
	const first = async () => (net === 'cam4' ? await fresh() : null) ?? snapSrc;
	if (video.canPlayType('application/vnd.apple.mpegurl')) {
		video.addEventListener('error', () => { void fresh().then((u) => { if (u) { video.src = u; void video.play().catch(() => {}); } }); });
		void first().then((u) => { if (u) { video.src = u; void video.play().catch(() => {}); } });
	} else {
		void (async () => {
			const { default: Hls } = await import('hls.js/light');
			if (!Hls.isSupported() || !video.isConnected) return;
			const h = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 12 });
			hlsInstances.push(h);
			const retry = () => { void fresh().then((u) => { if (u) h.loadSource(u); }); };
			h.on(Hls.Events.MANIFEST_PARSED, () => { if (!h.levels.length) return retry(); void video.play().catch(() => {}); });
			h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal: boolean }) => { if (d.fatal) retry(); });
			h.attachMedia(video);
			const u = await first();
			if (u) h.loadSource(u);
		})();
	}
}

function init(): void {
	const box = document.querySelector<HTMLElement>('[data-watch-player]');
	if (!box) return;
	const play = document.querySelector<HTMLButtonElement>('[data-watch-play]');
	play?.addEventListener('click', () => start(box, play));
	if (box.dataset.autoplay) start(box, play);
	const video = document.querySelector<HTMLVideoElement>('video[data-watch-hls]');
	if (video) startHls(video);
}

const w = window as unknown as { __ecamxWatchPage?: boolean };
if (!w.__ecamxWatchPage) {
	w.__ecamxWatchPage = true;
	document.addEventListener('ecamx:model-offline', () => {
		const box = document.querySelector<HTMLElement>('[data-watch-player]');
		if (!box) return;
		box.querySelector('iframe')?.remove();
		const video = box.querySelector<HTMLVideoElement>('video[data-watch-hls]');
		if (video) { video.pause(); video.removeAttribute('src'); }
		const play = document.querySelector<HTMLButtonElement>('[data-watch-play]');
		if (play) {
			play.disabled = true;
			play.querySelector('span:last-child')!.textContent = 'She just ended the stream — pick someone below';
		}
	});
	document.addEventListener('ecamx:zap-before', () => {
		for (const h of hlsInstances.splice(0)) { try { h.destroy(); } catch { /* už pryč */ } }
	});
	document.addEventListener('ecamx:zapped', init);
	init();
}
