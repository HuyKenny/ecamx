/**
 * Obecný klientský kód webu (vytaženo z `Layout.astro` 17. 11. 2026, D82):
 * věková lišta + souhlas, měření prokliků, záchrana náhledu, hover náhled,
 * sledování modelek, mobilní panel. Živý stav mřížek je v `live.ts`.
 *
 * Logika je beze změny proti Layoutu (D45, D46, D52, D69) — jen bydlí
 * v souboru, aby ji sdílely statické i dynamické stránky.
 */
import { liveFor, readWatch, toggleWatch, watchedNetworks } from '../lib/watchlist';

/**
 * Tentýž slugify jako sync a finder. `/api/online/` je klíčované slugem,
 * ale watchlist si drží `username` (potřebný pro `/go/`), takže se musí
 * převést. Kopie je tu vědomě: modul nesmí tahat `data.ts` (13 MB katalogu).
 */
function slugOf(nick: string): string {
	return nick.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
}

// ── věková lišta ──────────────────────────────────────────────────────
// O tom, JESTLI se lišta zobrazí, rozhoduje blokující skript v <head>
// (třída `age-ok` na <html>) — tenhle modul je odložený a rozhodoval by
// až po prvním vykreslení. Tady zůstává jen odkliknutí.
/**
 * Uložení volby o analytice. `granted` natáhne gtag.js hned a GA zpracuje
 * frontu z `dataLayer` (takže `page_view` nezmizí), `denied` nechá
 * knihovnu nenačtenou — nic se neodešle.
 */
function setConsent(value: 'granted' | 'denied') {
	try { localStorage.setItem('ecamx-consent', value); } catch { /* privátní režim */ }
	const w = window as unknown as {
		gtag?: Function; __ecamxLoadGa?: () => void;
	};
	// Volba musí být čitelná i pro Worker na `/go/` — localStorage tam
	// nedosáhne. Proto cookie: bez ní by serverové měření (`go_click_server`)
	// nevědělo, že návštěvník právě odmítl, a zadní cestou by rušilo to,
	// co lišta slíbila. Viz D45 a src/pages/go/[network]/[user].ts.
	setCookie('ecamx_consent', value);
	if (value === 'granted') {
		w.gtag?.('consent', 'update', { analytics_storage: 'granted' });
		w.__ecamxLoadGa?.();
		ensureCid();
	} else {
		// Odmítnutí znamená i zahodit identifikátor, ne ho jen přestat používat.
		setCookie('ecamx_cid', '', 0);
	}
}

/** First-party cookie, rok, `Lax` (proklik na `/go/` je same-site navigace). */
function setCookie(name: string, value: string, days = 365) {
	const age = days > 0 ? `max-age=${days * 86400}` : 'max-age=0';
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; ${age}; SameSite=Lax; Secure`;
}

function getCookie(name: string): string | null {
	const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return m ? decodeURIComponent(m[1]) : null;
}

/**
 * `client_id` pro serverové měření. **Náhodné ID na každý klik nejde** —
 * GA4 by z každého prokliku udělala nového uživatele. Je to naše
 * first-party cookie, takže ji blokátor googletagmanageru nesundá, a
 * právě proto serverový hit vidí i kliky, které klientské GA nezachytí.
 */
function ensureCid() {
	if (getCookie('ecamx_cid')) return;
	const rand = crypto?.randomUUID?.()
		?? `${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
	setCookie('ecamx_cid', rand);
}

// Mimo EU souhlas potřeba není, takže se stav nastaví hned při načtení —
// jinak by serverové měření vidělo jen ty, kdo na lištu klikli.
{
	const c = (window as unknown as { __ecamxConsent?: { needed: boolean } }).__ecamxConsent;
	if (c && !c.needed && getCookie('ecamx_consent') !== 'denied') {
		setCookie('ecamx_consent', 'granted');
		ensureCid();
	}
}

// „Essential only" — věk potvrzený, analytika odmítnutá. Lišta zmizí
// stejně jako u souhlasu, jinak by odmítnutí bylo trestané.
document.getElementById('consent-decline')?.addEventListener('click', () => {
	setConsent('denied');
	document.documentElement.classList.add('age-ok');
	try { localStorage.setItem('ecamx-age-ok', '1'); } catch { /* privátní režim */ }
});

document.getElementById('age-dismiss')?.addEventListener('click', () => {
	document.documentElement.classList.add('age-ok');
	try { localStorage.setItem('ecamx-age-ok', '1'); } catch { /* privátní režim */ }
	// Tam, kde je potřeba souhlas, je tohle tlačítko „Accept & continue".
	// Mimo EU je volba uložená taky, ať je stav explicitní.
	setConsent('granted');
});

// ── měření ────────────────────────────────────────────────────────────
// `gtag` je globální díky `is:inline` stubu v <head> (AGENTS.md bod 31).
// Měření nesmí NIKDY rozbít stránku, proto to má vlastní try/catch:
// když blokátor gtag zahodí, tohle musí projít bez chyby.
const ga = (name: string, params?: Record<string, unknown>) => {
	try { (window as unknown as { gtag?: Function }).gtag?.('event', name, params); }
	catch { /* měření je až druhé v řadě po funkčnosti webu */ }
};

// `card` se renderuje na SEDMI typech stránek a na elementu není nic, co
// by je rozlišilo — proto se typ bere z cesty.
const pageType = (() => {
	const p = location.pathname;
	if (p === '/') return 'home';
	if (p === '/cams/') return 'category_hub';
	if (p.startsWith('/live/')) return 'model';
	if (p.startsWith('/cams/')) return 'category';
	if (p.startsWith('/country/')) return 'country';
	if (p.startsWith('/site/')) return 'network';
	if (['/girls/', '/guys/', '/couples/', '/trans/'].includes(p)) return 'gender';
	return 'other';
})();

/** Slug modelky, jejíž stránku právě čteme (jinak prázdné). */
const pageModel = pageType === 'model'
	? decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '')
	: '';

// Odchozí proklik. JEDEN delegovaný listener pokryje všech 11 míst, kde se
// `/go/` odkaz renderuje (7× karta, similar grid, hlavní CTA, sticky lišta,
// network CTA) — a hlavně ZERO nového markupu na kartě. Karet je na mřížce
// 180 a stránek modelek přes 10 000, takže 20 B na kartu = 3,6 kB na
// stránku; přesně proto vzniklo `/go/` (D17) a proto tu je delegace místo
// atributů, stejně jako u `error` listeneru níž.
//
// GA4 tenhle klik sám nezaznamená: jeho vestavěné „outbound clicks" se
// spouští jen na CIZÍ doménu a `/go/` je first-party. Bez téhle události
// o proklicích nevíme nic.
//
// Href se čte AŽ PŘI KLIKU, ne při načtení, protože se za běhu mění:
// network CTA se přesměrovává na živou modelku (viz `data-cta-retarget`
// níž) a offline stránka přepíná `?p=offline` na `?p=profile`, když
// modelka naskočí (D19).
document.addEventListener('click', (e) => {
	const a = (e.target as HTMLElement | null)?.closest?.('a[href^="/go/"]') as HTMLAnchorElement | null;
	if (!a) return;

	const [, , network = '', user = ''] = a.pathname.split('/');
	const placement = new URLSearchParams(a.search).get('p') ?? 'card';

	// `?p=` samo nerozliší dvě věci: `profile` posílá hlavní CTA i sticky
	// lišta, `player` posílá textový odkaz „Player not loading?" i tlačítko
	// „Open full screen". Bez `slot` by se to slilo do jednoho čísla.
	const slot = a.closest('.sticky-cta') ? 'sticky'
		// Vrstva nad streamem. Musí být PŘED `btn-ghost`/`underline`,
		// jinak by se slila s ostatními odkazy u přehrávače a nešlo by
		// poznat, jestli klik do videa vůbec někdo dělá.
		: a.classList.contains('player-hit') ? 'stream'
		: a.classList.contains('btn-ghost') ? 'fullscreen'
		: a.classList.contains('underline') ? 'fallback_text'
		: a.classList.contains('btn-cta') ? 'main'
		: 'other';

	const card = a.closest('.card');
	// Offline se pozná dvěma cestami: u karty ji zhasl live refresh,
	// u profilu to říká `data-cta-offline` ze serveru.
	const offline = card?.classList.contains('is-offline')
		|| a.hasAttribute('data-cta-offline');

	ga('go_click', {
		network,
		placement,
		slot,
		page_type: pageType,
		live_state: offline ? 'offline' : 'live',
		// Na stránce modelky ji známe z cesty; z karty se vezme z odkazu
		// dovnitř, protože `username` (nick u sítě) není totéž co `page`
		// (naše URL) — viz komentář u `page` v src/lib/data.ts.
		model: pageModel
			|| card?.querySelector<HTMLAnchorElement>('a[href^="/live/"]')?.pathname.split('/')[2]
			|| user,
	});
});

document.getElementById('age-dismiss')?.addEventListener('click', () => ga('age_accept'));

// ── náhled, který se nenačetl ─────────────────────────────────────────
// Cam4 a Amateur.tv mají v URL podpis s expirací, takže fallback je
// povinný (AGENTS.md bod 6). Dřív to byl inline `onerror` na každém
// obrázku: 116 B × 180 karet = 21 kB na jednu mřížkovou stránku, znak
// za znak stejných. Jeden delegovaný listener to zvládne za 120 B —
// a hlavně díky tomu může vzniknout CSP bez `'unsafe-hashes'`.
// POZOR: `error` NEBUBLÁ, musí se poslouchat v capture fázi.
document.addEventListener('error', (e) => {
	const el = e.target as HTMLElement | null;
	if (!(el instanceof HTMLImageElement)) return;
	// Nejdřív náhrada té samé modelky (Cam4 posílá profilovku, D69).
	const alt = el.dataset.thumbFallback;
	if (alt && el.src !== alt) { delete el.dataset.thumbFallback; el.src = alt; return; }
	if (el.dataset.fallbackDone) return;          // ať se to nezacyklí
	const wrap = el.closest('.thumb-wrap');
	el.dataset.fallbackDone = '1';
	if (wrap) {
		el.src = '/mascot-sleep.webp';
		wrap.classList.add('is-placeholder');
	} else {
		// Rozmazaný poster na offline stránce — bez náhrady, prostě zmizí.
		el.remove();
	}
}, true);

// ── náhled se rozhýbe při najetí ──────────────────────────────────────
// CamSoda posílá hotovou MP4 smyčku (`vthumb`); u ostatních sítí je
// náhled živý snímek, takže stačí ho obnovovat a vypadá to stejně.
// Video element se vyrábí až na hoveru — 120 <video> v mřížce by byla
// hloupost. Na dotyku se nespouští nic: hover tam neexistuje a data
// jsou drahá.
const canPreview =
	window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
	!window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
	!(navigator as any).connection?.saveData;

if (canPreview) {
	let timer: number | undefined;
	let active: HTMLElement | null = null;

	// Původní URL náhledu si držíme tady, ne v data atributu — na kartu
	// je to 70 B a karet jsou na stránce stovky.
	let originalSrc: string | null = null;

	const stop = () => {
		if (timer) { clearInterval(timer); timer = undefined; }
		if (!active) return;
		active.querySelector('video')?.remove();
		const img = active.querySelector('img');
		if (img && originalSrc) img.src = originalSrc;
		originalSrc = null;
		active = null;
	};

	const start = (card: HTMLElement) => {
		if (active === card) return;
		stop();
		const wrap = card.querySelector<HTMLElement>('.thumb-wrap');
		const img = card.querySelector<HTMLImageElement>('img[data-preview], .thumb-wrap img');
		if (!wrap || !img) return;
		active = wrap;
		originalSrc = img.src;

		const mp4 = img.dataset.preview;
		if (mp4) {
			const v = document.createElement('video');
			v.src = mp4; v.muted = true; v.loop = true;
			v.playsInline = true; v.preload = 'auto';
			v.addEventListener('playing', () => v.classList.add('is-playing'), { once: true });
			wrap.appendChild(v);
			v.play().catch(() => v.remove()); // autoplay může být zakázané
			return;
		}
		// Bez MP4: obnovovat živý JPEG. Ne rychleji — snímek se stejně
		// na CDN neobnovuje častěji a je to cizí přenos.
		timer = window.setInterval(() => {
			if (!originalSrc) return;
			img.src = originalSrc + (originalSrc.includes('?') ? '&' : '?') + 'cb=' + Date.now();
		}, 900);
	};

	document.addEventListener('pointerover', (e) => {
		const card = (e.target as HTMLElement)?.closest?.('.card') as HTMLElement | null;
		if (card) start(card); else stop();
	});
	document.addEventListener('pointerleave', stop, true);
}

// ── watchlist („tvoje modelky") ───────────────────────────────────────
/**
 * Sledování je čistě klientské — proč, viz `src/lib/watchlist.ts`.
 * Tady je jen obsluha tlačítka a odznak v hlavičce.
 */
{
	const link = document.querySelector<HTMLElement>('[data-watch-link]');
	const countEl = document.querySelector<HTMLElement>('[data-watch-count]');

	const paintToggle = (btn: HTMLElement, on: boolean) => {
		btn.classList.toggle('is-on', on);
		btn.setAttribute('aria-pressed', String(on));
		const label = btn.querySelector<HTMLElement>('[data-watch-label]');
		// Text se jen přepíše, prvek se nepřidává ani neubírá — jinak by
		// tlačítko měnilo šířku a posouvalo řádek.
		if (label) label.textContent = on ? 'Following' : 'Follow';
	};

	// Delegovaně: tlačítko je na profilu i v řádcích finderu, které se
	// vykreslují až za běhu.
	document.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement | null)?.closest?.('[data-watch-toggle]') as HTMLElement | null;
		if (!btn) return;
		e.preventDefault();
		const page = btn.dataset.page ?? '';
		const network = btn.dataset.network ?? '';
		const username = btn.dataset.username ?? '';
		if (!page || !network || !username) return;
		const { watched, count } = toggleWatch({ page, network, username });
		paintToggle(btn, watched);
		document.documentElement.classList.toggle('has-follows', count > 0);
		if (countEl && !watched && count === 0) { countEl.hidden = true; countEl.textContent = ''; }
		ga(watched ? 'watch_add' : 'watch_remove', {
			network, model: page, placement: btn.dataset.watchSource ?? 'profile',
		});
	});

	// Stav tlačítek po načtení. Tlačítka jsou v HTML od začátku, mění se
	// jen jejich text a třída — nic se nezjevuje (past 52).
	const watched = new Set(readWatch().map((w) => w.page));
	const paintAll = () => {
		const now = new Set(readWatch().map((w) => w.page));
		for (const btn of document.querySelectorAll<HTMLElement>('[data-watch-toggle]')) {
			if (btn.dataset.page && now.has(btn.dataset.page)) paintToggle(btn, true);
		}
	};
	paintAll();
	// Výměna stránky bez načtení (D88, `zap.ts`).
	document.addEventListener('ecamx:zapped', paintAll);

	/**
	 * Odznak „N z tvých je live". Ptáme se **jen sítí, které v seznamu
	 * opravdu jsou** — kdo sleduje tři modelky z Chaturbate, zaplatí jeden
	 * request, ne sedm. Stahování i 60s cache řeší `liveFor()` — sdílí ho
	 * s `/my/`, jinak by se tam tentýž feed stáhl dvakrát.
	 */
	if (link && countEl && watched.size) {
		const list = readWatch();
		void liveFor(watchedNetworks(list), list.map((w) => slugOf(w.username))).then((live) => {
			const liveNow = list.filter((w) => live.viewers(w.network, slugOf(w.username)) !== undefined);
			if (!liveNow.length) return;
			countEl.textContent = String(liveNow.length);
			countEl.hidden = false;
			link.classList.add('is-live');
			link.title = `${liveNow.length} of the models you follow are live now`;
		});
	}
}

// ── mobilní panel kanálů ───────────────────────────────────────────────────
{
	const root = document.documentElement;
	for (const btn of document.querySelectorAll('[data-rail-toggle]')) {
		btn.addEventListener('click', () => {
			const open = root.classList.toggle('rail-open');
			document.querySelector('.topbar [data-rail-toggle]')?.setAttribute('aria-expanded', String(open));
		});
	}
	// Klik mimo panel (do ztmavené plochy) ho zavře.
	document.addEventListener('click', (e) => {
		if (!root.classList.contains('rail-open')) return;
		const t = e.target as HTMLElement;
		if (t.closest('.rail') || t.closest('[data-rail-toggle]')) return;
		root.classList.remove('rail-open');
	});
	addEventListener('keydown', (e) => { if (e.key === 'Escape') root.classList.remove('rail-open'); });
}
