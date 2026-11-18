/**
 * Přehrávač statické stránky modelky (`src/pages/live/[slug].astro`).
 *
 * Do D88 inline `<script>` stránky. Od D88 (přepínání streamů, `zap.ts`)
 * se stránka může vyměnit bez načtení — proto `init()` čte VŽDY aktuální DOM
 * a jde spustit znovu (`ecamx:zapped`). Listenery na `document` se registrují
 * jednou a pracují s aktuálním stavem; HLS se před výměnou ruší
 * (`ecamx:zap-before`), jinak by odpojené `<video>` dál stahovalo segmenty.
 *
 * Historie rozhodnutí u jednotlivých částí: D13/D14 (klik a Heavy Ad
 * Intervention), D19 (offline stránka povýšená na živou), D62/D70 (HLS),
 * D63/D67 (náhrada za dovysílanou modelku), D84 (EasyList pojistka),
 * D86 (Chaturbate `mountEmbed`).
 */
import { mountEmbed, NARROW_MQ } from '../lib/fit-embed';

// `gtag` je globál z `is:inline` stubu v <head> (AGENTS.md bod 31); měření
// nesmí nikdy rozbít přehrávač, proto try/catch.
const ga = (name: string, params?: Record<string, unknown>) => {
	try { (window as unknown as { gtag?: Function }).gtag?.('event', name, params); }
	catch { /* přehrávač má přednost před měřením */ }
};

type HlsLike = { destroy(): void };

let frame: HTMLElement | null = null;
let play: HTMLButtonElement | null = null;
let started = false;
let stickyObserver: IntersectionObserver | null = null;
const hlsInstances: HlsLike[] = [];

/**
 * Stránka stavěná offline, Chaturbate mezitím vysílá → stejné divadlo jako
 * u stránky stavěné online (D86): jejich rámec s chatem přes celou šířku,
 * bez našeho postranního sloupce. Bez toho povýšená stránka dostala jen
 * video (`fitEmbed` bez `.is-chat`) — Kenny 18. 11.: „nezobrazuje se
 * s chatem". Pod 900 px jede dál jen video, sloupec tam zůstává.
 */
function useChatTheater(box: HTMLElement): void {
	const theater = box.closest<HTMLElement>('.theater');
	if (!theater || matchMedia(NARROW_MQ).matches) return;
	theater.classList.add('is-chat');
	theater.querySelector('.theater-side')?.remove();
}

/**
 * Pustí rámec s přehrávačem do plochy. `click` = tlačítko, `auto` = stránka
 * stavěná jako offline, kterou živá kontrola povýšila (jen sítě
 * v `AUTOPLAY_SAFE`, jinak se jen odkryje tlačítko).
 */
function startEmbed(mode: 'click' | 'auto'): void {
	const box = frame;
	if (started || !box) return;
	const src = box.dataset.embed;
	if (!src) return;
	started = true;
	const el = document.createElement('iframe');
	el.title = box.dataset.title ?? 'Live webcam';
	el.allowFullscreen = true;
	el.referrerPolicy = 'strict-origin-when-cross-origin';
	el.setAttribute('allow', 'autoplay; fullscreen');
	el.setAttribute('scrolling', 'no');
	// `replaceChildren()` smete i klikací vrstvu nad streamem — vrátí se
	// a odkryje, jinak by klik do videa na povýšené stránce nevydělal nic.
	const hit = box.querySelector<HTMLElement>('.player-hit');
	box.replaceChildren(el);
	if (box.dataset.network === 'chaturbate') useChatTheater(box);
	mountEmbed(el, box, src);
	if (hit) { hit.hidden = false; box.appendChild(hit); }
	if (mode === 'click') {
		el.setAttribute('tabindex', '-1');
		el.focus({ preventScroll: true });
	}
	// Pojistka pro sítě na EasyListu (D84): druhý `load` rámce po víc než 8 s
	// = Chrome ho nahradil chybovou stránkou; klik ho vloží znovu s interakcí.
	if (mode === 'auto' && (box.dataset.network === 'livejasmin' || box.dataset.network === 'xlovecam')) {
		let loads = 0;
		const t0 = performance.now();
		el.addEventListener('load', () => {
			loads++;
			if (loads < 2 || performance.now() - t0 < 8000) return;
			const again = document.createElement('button');
			again.type = 'button';
			again.className = 'play-overlay';
			again.innerHTML = '<span class="play-icon" aria-hidden="true">▶</span><span>Tap to keep watching</span>';
			again.addEventListener('click', () => {
				box.replaceChildren(el.cloneNode() as HTMLIFrameElement);
			}, { once: true });
			box.appendChild(again);
			ga('player_intervention', { network: box.dataset.network });
		});
	}
	ga('player_start', { network: box.dataset.network, model: box.dataset.model, mode });
}

/**
 * HLS na `<video data-hls>` (BongaCams, Cam4 — D62/D70). HTTP 200 neznamená
 * stream (prázdný playlist = nula variant), adresa zastarává (jednou se
 * zkusí čerstvá z `/api/stream/`), a mrtvý přehrávač je horší než žádný
 * (při neúspěchu zmizí a odkryje se odkaz do pokoje).
 */
function startHls(hlsVideo: HTMLVideoElement, onFail?: () => void): void {
	const fallback = document.querySelector<HTMLElement>('[data-hls-fallback]');
	const user = hlsVideo.dataset.nick ?? '';
	const net = hlsVideo.dataset.network ?? '';
	let refreshed = false;

	const giveUp = () => {
		hlsVideo.remove();
		if (onFail) onFail();
		else if (fallback) fallback.hidden = false;
	};

	const freshSrc = async (): Promise<string | null> => {
		if (refreshed || !user) return null;
		refreshed = true;
		try {
			const r = await fetch(`/api/stream/${net}/${encodeURIComponent(user)}/`,
				{ signal: AbortSignal.timeout(8000) });
			const data = await r.json() as { url?: string; offline?: boolean };
			return data?.url ?? null;
		} catch { return null; }
	};

	// Cam4: adresa z buildu je vždycky mrtvá (změřeno 8 z 8), rovnou čerstvá.
	const firstSrc = async (): Promise<string | null> =>
		(net === 'cam4' ? await freshSrc() : null) ?? hlsVideo.dataset.hls ?? null;

	const played = () => ga('player_auto', { network: net, model: hlsVideo.dataset.model, mode: 'hls' });

	if (hlsVideo.canPlayType('application/vnd.apple.mpegurl')) {
		const native = (src: string) => {
			hlsVideo.src = src;
			hlsVideo.play().catch(() => { /* politika autoplaye, ovládání zůstává */ });
		};
		hlsVideo.addEventListener('error', () => {
			void freshSrc().then((src) => (src ? native(src) : giveUp()));
		});
		hlsVideo.addEventListener('playing', played, { once: true });
		void firstSrc().then((src) => (src ? native(src) : giveUp()));
	} else {
		void (async () => {
			const { default: Hls } = await import('hls.js/light');
			if (!Hls.isSupported()) return giveUp();
			// 240p na začátek; víc si vezme samo podle velikosti přehrávače.
			const hls = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 12 });
			hlsInstances.push(hls);
			const retry = () => {
				void freshSrc().then((src) => {
					if (!src) return giveUp();
					hls.loadSource(src);
				});
			};
			hls.on(Hls.Events.MANIFEST_PARSED, () => {
				if (!hls.levels.length) return retry();
				hlsVideo.play().catch(() => { /* ovládání zůstává divákovi */ });
			});
			hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal: boolean }) => { if (data.fatal) retry(); });
			hlsVideo.addEventListener('playing', played, { once: true });
			hls.attachMedia(hlsVideo);
			const src = await firstSrc();
			if (!src) return giveUp();
			hls.loadSource(src);
		})();
	}
}

/**
 * **Modelka dovysílala → pustí se někdo jiný ze stejné sítě** (D63/D67).
 * Nadpis, drobečky ani JSON-LD se nemění — stránka je pořád o modelce,
 * kvůli které sem člověk přišel; proužek nad přehrávačem to říká nahlas.
 */
function onModelOffline(ev: Event): void {
	const box = document.querySelector<HTMLElement>('[data-player]');
	if (!box) return;
	const { network } = (ev as CustomEvent<{ network: string; slug: string }>).detail;
	// Jméno a slug z rámce, ne z `define:vars` (CSP, past 94).
	const pageName = box.dataset.name ?? 'She';
	const pageSlug = box.dataset.slug ?? '';
	const pageModel = box.dataset.model ?? '';
	const note = document.querySelector<HTMLElement>('[data-substitute-note]');
	const text = note?.querySelector<HTMLElement>('[data-substitute-text]');
	const offlineBlock = document.querySelector<HTMLElement>('[data-player-offline]');

	// Mrtvý rámec pryč vždycky — i kdyby náhrada nedopadla (D63).
	for (const el of box.querySelectorAll('iframe, video, .play-overlay, .player-hit')) el.remove();
	const giveUpAll = () => { if (offlineBlock) offlineBlock.hidden = false; };

	void (async () => {
		let cards: Array<{ s: string; n: string; t: string; v: number; e: string }> = [];
		try {
			const r = await fetch(`/api/online/${network}/?cards=8`, { signal: AbortSignal.timeout(6000) });
			cards = ((await r.json()) as { cards?: typeof cards })?.cards ?? [];
		} catch { /* feed nedojel — spadne to na hlášku */ }

		// BongaCams nemá adresu ve feedu (4,4 MB) — čerstvá pro max. 3 modelky
		// (`/api/` sdílí rate limit s `/go/`, D49).
		let pick = cards.find((c) => c.e && c.s !== pageSlug);
		if (!pick && network === 'bongacams') {
			for (const c of cards.filter((x) => x.s !== pageSlug).slice(0, 3)) {
				try {
					const r = await fetch(`/api/stream/${network}/${encodeURIComponent(c.n)}/`,
						{ signal: AbortSignal.timeout(6000) });
					const u = ((await r.json()) as { url?: string })?.url;
					if (u) { pick = { ...c, e: `hls:${u}` }; break; }
				} catch { /* další modelka */ }
			}
		}
		// Mezitím se mohla stránka vyměnit (zap) — pak už sem nic nepatří.
		if (!box.isConnected) return;
		if (!pick) return giveUpAll();

		const done = () => {
			if (text) text.textContent = `${pageName} just ended — now playing ${pick.n}.`;
			if (note) note.hidden = false;
			document.querySelector<HTMLElement>('[data-offline-msg]')?.setAttribute('hidden', '');
			ga('player_substitute', { network, model: pageModel || pick.s });
		};

		if (pick.e.startsWith('hls:')) {
			const v = document.createElement('video');
			v.className = 'absolute inset-0 h-full w-full bg-black object-contain';
			v.dataset.hls = pick.e.slice(4);
			v.dataset.nick = pick.n;
			v.dataset.network = network;
			v.muted = true; v.autoplay = true; v.playsInline = true; v.controls = true;
			v.preload = 'none';
			box.appendChild(v);
			startHls(v, giveUpAll);
			done();
		} else {
			const el = document.createElement('iframe');
			el.title = `${pick.n} live webcam`;
			el.allowFullscreen = true;
			el.referrerPolicy = 'strict-origin-when-cross-origin';
			el.setAttribute('allow', 'autoplay; fullscreen');
			el.setAttribute('scrolling', 'no');
			box.appendChild(el);
			mountEmbed(el, box, pick.e);
			done();
		}
	})();
}

function init(): void {
	frame = null; play = null; started = false;
	stickyObserver?.disconnect();
	stickyObserver = null;
	const playerBox = document.querySelector<HTMLElement>('[data-player]');
	if (!playerBox) return;

	// Lepivé CTA se odkryje, až přehrávač vyjede z obrazovky (místo je
	// rezervované v CSS, CLS 0).
	const stickyCta = document.querySelector<HTMLElement>('[data-sticky-cta]');
	if (stickyCta && 'IntersectionObserver' in window) {
		stickyObserver = new IntersectionObserver(([entry]) => {
			stickyCta.classList.toggle('is-on', !entry!.isIntersecting);
		}, { rootMargin: '-64px 0px 0px 0px' });
		stickyObserver.observe(playerBox);
	}

	frame = document.querySelector<HTMLElement>('[data-player][data-embed]');
	play = frame?.querySelector<HTMLButtonElement>('[data-play]') ?? null;
	play?.addEventListener('click', () => startEmbed('click'), { once: true });

	const pageVideo = document.querySelector<HTMLVideoElement>('video[data-hls]');
	if (pageVideo) startHls(pageVideo);

	// Rámec renderovaný ze serveru (sítě v AUTOPLAY_SAFE): měří se `load`.
	const autoFrame = document.querySelector<HTMLIFrameElement>('[data-player]:not([data-embed]) iframe');
	if (autoFrame?.parentElement) mountEmbed(autoFrame, autoFrame.parentElement, autoFrame.getAttribute('src') ?? '');
	if (autoFrame) {
		const host = autoFrame.closest<HTMLElement>('[data-player]');
		autoFrame.addEventListener('load', () => {
			ga('player_auto', { network: host?.dataset.network, model: host?.dataset.model, mode: 'auto' });
		}, { once: true });
		const net = host?.dataset.network ?? '';
		if (host && (net === 'livejasmin' || net === 'xlovecam')) {
			let loads = 0;
			const t0 = performance.now();
			autoFrame.addEventListener('load', () => {
				loads++;
				if (loads < 2 || performance.now() - t0 < 8000 || host.querySelector('.play-overlay')) return;
				const again = document.createElement('button');
				again.type = 'button';
				again.className = 'play-overlay';
				again.innerHTML = '<span class="play-icon" aria-hidden="true">▶</span><span>Tap to keep watching</span>';
				again.addEventListener('click', () => {
					autoFrame.replaceWith(autoFrame.cloneNode() as HTMLIFrameElement);
					again.remove();
				}, { once: true });
				host.appendChild(again);
				ga('player_intervention', { network: net });
			});
		}
	}
}

const w = window as unknown as { __ecamxModelPage?: boolean };
if (!w.__ecamxModelPage) {
	w.__ecamxModelPage = true;
	// Stránka stavěná jako offline, ale modelka vysílá (D19).
	document.addEventListener('ecamx:model-online', () => {
		if (frame?.hasAttribute('data-autoplay')) startEmbed('auto');
		else if (play) play.hidden = false;
	});
	document.addEventListener('ecamx:model-offline', onModelOffline);
	document.addEventListener('ecamx:zap-before', () => {
		for (const h of hlsInstances.splice(0)) { try { h.destroy(); } catch { /* už pryč */ } }
	});
	document.addEventListener('ecamx:zapped', init);
	init();
}
