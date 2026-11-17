/**
 * Přehrávač dynamické stránky modelky (`src/pages/watch/[p].astro`, D82).
 * Rámec se vkládá až po kliknutí (Heavy Ad Intervention, D13/D14).
 * Když modelka mezitím dovysílá (`ecamx:model-offline` z `live.ts`),
 * přehrávač zmizí a zůstane poster + podobné živé.
 */
const box = document.querySelector<HTMLElement>('[data-watch-player]');
const play = document.querySelector<HTMLButtonElement>('[data-watch-play]');

function start(): void {
	const src = box?.dataset.embed;
	if (!box || !src) return;
	const f = document.createElement('iframe');
	f.src = src;
	f.allow = 'autoplay; fullscreen';
	f.setAttribute('allowfullscreen', '');
	f.referrerPolicy = 'no-referrer-when-downgrade';
	f.className = 'absolute inset-0 h-full w-full';
	box.appendChild(f);
	play?.remove();
	try { (window as unknown as { gtag?: Function }).gtag?.('event', 'player_start', { page_type: 'model_dynamic' }); } catch { /* měření */ }
}
play?.addEventListener('click', start);
// Sítě s ověřeným autoplayem pustí stream hned (jako statický profil, D68).
if (box?.dataset.autoplay) start();

document.addEventListener('ecamx:model-offline', () => {
	box?.querySelector('iframe')?.remove();
	if (play) {
		play.disabled = true;
		play.querySelector('span:last-child')!.textContent = 'She just ended the stream — pick someone below';
	}
});

/**
 * Cam4 / BongaCams: HLS v našem `<video>` (D62, D70). Cam4 adresa z feedu
 * rychle stárne, proto se nejdřív bere čerstvá z `/api/stream/`; BongaCams
 * zkusí adresu ze snímku (max. 5 min stará) a při chybě čerstvou.
 */
const video = document.querySelector<HTMLVideoElement>('video[data-watch-hls]');
if (video) {
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
	const first = async () => (net === 'cam4' ? await fresh() : null) ?? video.dataset.src ?? null;
	if (video.canPlayType('application/vnd.apple.mpegurl')) {
		video.addEventListener('error', () => { void fresh().then((u) => { if (u) { video.src = u; void video.play().catch(() => {}); } }); });
		void first().then((u) => { if (u) { video.src = u; void video.play().catch(() => {}); } });
	} else {
		void (async () => {
			const { default: Hls } = await import('hls.js/light');
			if (!Hls.isSupported()) return;
			const h = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 12 });
			const retry = () => { void fresh().then((u) => { if (u) h.loadSource(u); }); };
			h.on(Hls.Events.MANIFEST_PARSED, () => { if (!h.levels.length) return retry(); void video.play().catch(() => {}); });
			h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal: boolean }) => { if (d.fatal) retry(); });
			h.attachMedia(video);
			const u = await first();
			if (u) h.loadSource(u);
		})();
	}
	document.addEventListener('ecamx:model-offline', () => { video.pause(); video.removeAttribute('src'); });
}
