/**
 * „Next ▶" — přepínání streamů bez načtení stránky (D88, Kenny 18. 11. 2026:
 * „listování na další stream, když stream skončí").
 *
 * - Tlačítko `[data-zap-next]` ve `watch-bar` (statická i dynamická stránka),
 *   klávesa `N`, klik na řádek v pravém sloupci „Live now like…".
 * - Další modelka = první nenavštívená z fasety podobných (`data-zap-q`)
 *   v `/api/live/grid/`, doplněná z `all`.
 * - Výměna: stáhne se `/live/{p}/` (statická nebo `/watch/`, obojí v edge
 *   cache), vymění se `<main>`, titulek, canonical, robots a JSON-LD,
 *   `history.pushState`. Skripty se znovu inicializují přes `ecamx:zapped`
 *   (`model-page.ts`, `watch.ts`, `live.ts`, `site.ts`); skript stránky, který
 *   tu ještě nebyl (statická ↔ `/watch/`), se doplní a spustí sám.
 * - Konec streamu během sledování: dotaz `/api/live/is/` každé 2 min →
 *   odpočet 5 s na další (Zrušit = dnešní náhrada / hláška, D63/D67).
 *   Stránka otevřená jako offline (příchod z Googlu) se sama nepřepíná.
 * - Selhání čehokoli = obyčejná navigace na `/live/{p}/`.
 */

interface Card { n: string; u: string; p: string; s: string }

const ga = (name: string, params?: Record<string, unknown>) => {
	try { (window as unknown as { gtag?: Function }).gtag?.('event', name, params); }
	catch { /* měření nesmí rozbít přepínání */ }
};

const SEEN_KEY = 'ecamx:zap-seen';
const POLL_MS = 120_000;
const COUNTDOWN_S = 5;

function seen(): string[] {
	try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]; } catch { return []; }
}
function remember(p: string): void {
	try {
		const list = seen().filter((x) => x !== p);
		list.push(p);
		sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-100)));
	} catch { /* soukromé okno — fronta se jen může zopakovat */ }
}

const btn = () => document.querySelector<HTMLButtonElement>('[data-zap-next]');
/** `síť:slug` aktuální modelky (z tlačítka). */
const currentKey = () => btn()?.dataset.zapX ?? '';

let queue: Card[] = [];
let queueFor = '';
let busy = false;
let pollTimer = 0;
let ended = false;

async function nextCard(): Promise<Card | null> {
	const b = btn();
	if (!b) return null;
	const x = b.dataset.zapX ?? '';
	const q = b.dataset.zapQ || 'all';
	const cur = new URL(location.href).pathname.split('/')[2] ?? '';
	const skip = new Set([...seen(), cur]);
	queue = queue.filter((c) => !skip.has(c.p));
	if (!queue.length || queueFor !== q) {
		const parts = q === 'all' ? 'all~24' : `${q}~24,all~24`;
		try {
			const r = await fetch(`/api/live/grid/?v=2&q=${parts}&x=${encodeURIComponent(x)}`, { signal: AbortSignal.timeout(6000) });
			const d = await r.json() as { fresh?: boolean; g?: Record<string, Card[]> };
			if (d.fresh && d.g) {
				const all = [...(d.g[q] ?? []), ...(q === 'all' ? [] : d.g.all ?? [])];
				const uniq = new Map(all.map((c) => [c.p, c]));
				queue = [...uniq.values()].filter((c) => !skip.has(c.p) && `${c.n}:${c.s}` !== x);
				queueFor = q;
			}
		} catch { /* bez fronty to Next vzdá (níž) */ }
	}
	return queue.shift() ?? null;
}

function swapHead(doc: Document): void {
	document.title = doc.title;
	const sels = ['link[rel="canonical"]', 'meta[name="robots"]', 'meta[name="description"]',
		'meta[property="og:title"]', 'meta[property="og:url"]', 'meta[property="og:description"]',
		'meta[property="og:image"]', 'meta[name="twitter:title"]', 'meta[name="twitter:image"]'];
	for (const sel of sels) {
		const a = document.head.querySelector(sel);
		const b = doc.head.querySelector(sel);
		if (a && b) a.replaceWith(b.cloneNode(true));
		else if (a) a.remove();
		else if (b) document.head.appendChild(b.cloneNode(true));
	}
	for (const s of document.head.querySelectorAll('script[type="application/ld+json"]')) s.remove();
	for (const s of doc.head.querySelectorAll('script[type="application/ld+json"]')) document.head.appendChild(s.cloneNode(true));
}

/**
 * Moduly, které už v téhle stránce běžely. Vlastní evidence, ne dotaz do DOM:
 * `<script>` vložený přes `innerHTML` s novým `<main>` je mrtvý (nespustí se),
 * a přesto by ho dotaz našel a skript by se nedoplnil.
 */
const loaded = new Set<string>();
for (const s of document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
	loaded.add(new URL(s.getAttribute('src')!, location.href).pathname);
}

/** Skripty, které nová stránka potřebuje a tahle je ještě nenačetla. */
function loadMissingScripts(doc: Document): void {
	for (const s of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
		const src = s.getAttribute('src');
		if (!src) continue;
		const path = new URL(src, location.href).pathname;
		if (loaded.has(path)) continue;
		loaded.add(path);
		const n = document.createElement('script');
		n.type = 'module';
		n.src = src;
		document.body.appendChild(n);
	}
}

async function zapTo(card: Card, mode: 'click' | 'key' | 'auto' | 'list'): Promise<void> {
	if (busy) return;
	busy = true;
	const url = `/live/${encodeURIComponent(card.p)}/`;
	const from = currentKey();
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'text/html' } });
		const path = new URL(r.url).pathname;
		// Přesměrování (modelka mezitím dovysílala → 302 do kategorie) nebo
		// chyba = obyčejná navigace, ať člověk skončí tam, kam vede odkaz.
		if (!r.ok || !path.startsWith('/live/')) throw new Error('not a model page');
		const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
		const main = document.querySelector('main#main');
		const next = doc.querySelector('main#main');
		if (!main || !next || !next.querySelector('[data-zap-next]')) throw new Error('unexpected page');

		document.dispatchEvent(new CustomEvent('ecamx:zap-before'));
		stopPoll();
		main.innerHTML = next.innerHTML;
		swapHead(doc);
		history.pushState({ zap: 1 }, '', path);
		remember(card.p);
		if (main.getBoundingClientRect().top < -40) window.scrollTo({ top: 0 });
		loadMissingScripts(doc);
		document.dispatchEvent(new CustomEvent('ecamx:zapped'));
		ga('zap', { from, to: `${card.n}:${card.s}`, mode });
		ga('page_view', { page_location: location.href, page_title: document.title });
	} catch {
		location.assign(url);
	} finally {
		busy = false;
	}
}

async function next(mode: 'click' | 'key' | 'auto'): Promise<void> {
	const b = btn();
	if (b) b.setAttribute('aria-busy', 'true');
	const card = await nextCard();
	if (b) b.removeAttribute('aria-busy');
	if (!card) {
		// Fronta prázdná (výpadek API) → aspoň na seznam živých.
		location.assign('/');
		return;
	}
	await zapTo(card, mode);
}

// ── konec streamu během sledování ──────────────────────────────────────────

function stopPoll(): void {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = 0;
	document.querySelector('.zap-overlay')?.remove();
}

function startPoll(): void {
	stopPoll();
	ended = false;
	const key = currentKey();
	// Jen stránka, která se otevřela jako živá (odznak „Live now" z buildu
	// nebo `/watch/`) — offline stránku obsluhuje náhrada (D67).
	const badge = document.querySelector<HTMLElement>('[data-live-scope] .bg-live[data-live-badge]');
	if (!key || !badge) return;
	pollTimer = window.setInterval(() => {
		if (document.hidden || ended || busy) return;
		void fetch(`/api/live/is/?k=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(6000) })
			.then((r) => r.json() as Promise<{ live: boolean | null }>)
			.then((d) => { if (d.live === false && currentKey() === key) void streamEnded(key); })
			.catch(() => { /* příště */ });
	}, POLL_MS);
}

async function streamEnded(key: string): Promise<void> {
	if (ended) return;
	ended = true;
	stopPoll();
	const [network, slug] = key.split(':');
	const fallback = () => document.dispatchEvent(new CustomEvent('ecamx:model-offline', { detail: { network, slug } }));
	const card = await nextCard();
	const box = document.querySelector<HTMLElement>('[data-player], [data-watch-player]');
	if (!card || !box || currentKey() !== key) { fallback(); return; }
	const name = btn()?.dataset.zapName ?? 'She';

	const ov = document.createElement('div');
	ov.className = 'zap-overlay';
	ov.setAttribute('role', 'status');
	const p1 = document.createElement('p');
	p1.className = 'text-lg font-bold';
	p1.textContent = `${name} ended the stream`;
	const p2 = document.createElement('p');
	p2.className = 'mt-1 text-sm text-ink-400';
	const count = document.createElement('span');
	count.textContent = String(COUNTDOWN_S);
	p2.appendChild(document.createTextNode(`Next: ${card.u} in `));
	p2.appendChild(count);
	p2.appendChild(document.createTextNode(' s'));
	const row = document.createElement('span');
	row.className = 'mt-4 flex flex-wrap justify-center gap-2';
	const go = Object.assign(document.createElement('button'), { type: 'button', className: 'btn-cta', textContent: 'Watch now ▶' });
	const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn-ghost', textContent: 'Cancel' });
	row.appendChild(go); row.appendChild(cancel);
	ov.appendChild(p1); ov.appendChild(p2); ov.appendChild(row);
	box.appendChild(ov);

	let left = COUNTDOWN_S;
	const t = window.setInterval(() => {
		left--;
		count.textContent = String(left);
		if (left <= 0) { clearInterval(t); void zapTo(card, 'auto'); }
	}, 1000);
	go.addEventListener('click', () => { clearInterval(t); void zapTo(card, 'click'); });
	cancel.addEventListener('click', () => {
		clearInterval(t);
		ov.remove();
		queue.unshift(card);
		ga('zap_cancel', { from: key });
		fallback();
	});
}

// ── zapojení ───────────────────────────────────────────────────────────────

function init(): void {
	const b = btn();
	if (!b) return;
	b.hidden = false;
	startPoll();
}

const w = window as unknown as { __ecamxZap?: boolean };
if (!w.__ecamxZap) {
	w.__ecamxZap = true;
	document.addEventListener('click', (e) => {
		const t = e.target as HTMLElement | null;
		if (t?.closest?.('[data-zap-next]')) { e.preventDefault(); void next('click'); return; }
		// Řádek v pravém sloupci „Live now like…" — přepnout na místě.
		const me = e as MouseEvent;
		if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return;
		const a = t?.closest?.('.theater-side a[href^="/live/"]') as HTMLAnchorElement | null;
		const card = a?.closest<HTMLElement>('[data-network]');
		if (!a || !btn()) return;
		const p = a.pathname.split('/')[2];
		if (!p) return;
		e.preventDefault();
		const [n = '', s = ''] = (card?.dataset.k ?? '').split(':');
		void zapTo({ p: decodeURIComponent(p), n, s, u: '' }, 'list');
	});
	document.addEventListener('keydown', (e) => {
		if (e.key !== 'n' && e.key !== 'N') return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
		if (!btn()) return;
		void next('key');
	});
	// Zpět/vpřed v historii: stránka se načte celá (jednoduché a spolehlivé).
	// Jen při změně cesty — kotva (`#similar`) vyvolá `popstate` taky.
	let shownPath = location.pathname;
	document.addEventListener('ecamx:zapped', () => { shownPath = location.pathname; });
	addEventListener('popstate', () => { if (location.pathname !== shownPath) location.reload(); });
	document.addEventListener('ecamx:zapped', init);
	init();
}
