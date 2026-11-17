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
