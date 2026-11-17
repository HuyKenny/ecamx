/**
 * Živý stav v prohlížeči (D82) — nahrazuje ~900 řádků „záchranné" logiky
 * z Layoutu (rezervy, `floor`, `absenceUnproven`, záchranné karty D57–D67).
 *
 * Proč to jde jednodušeji: od 17. 11. 2026 skládá cron Worker á 5 minut
 * snímek z KOMPLETNÍCH feedů všech sítí. Mřížka se proto nemusí dohadovat,
 * které statické karty ještě žijí — prostě si řekne o ty, které vysílají
 * teď (`/api/live/grid/`), a vykreslí je stejnou šablonou jako build
 * (`cardHtml`). Statické karty z buildu zůstávají v HTML pro crawler a jako
 * záloha, když snímek není čerstvý nebo API neodpoví.
 *
 * Zásady, které platí dál:
 *  - CLS 0: mřížka má od začátku N slotů a ty se jen naplní (D29),
 *  - po zobrazení se nic nepřeskládává (D57) — výměna proběhne jednou, než
 *    se mřížka ukáže, nebo vůbec,
 *  - výpadek NIKDY nezhasne kartu ani přehrávač (chyba 1 v plánu D82).
 */
import { cardHtml, viewersText, type CardData } from '../lib/card';
import { NETWORK_LABELS } from '../lib/labels';

const ga = (name: string, params?: Record<string, unknown>) => {
	try { (window as unknown as { gtag?: Function }).gtag?.('event', name, params); } catch { /* měření až druhé */ }
};

const SITES_KEY = 'ecamx-sites';
function storedSites(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(SITES_KEY) || '[]');
		return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string' && /^[a-z0-9]{1,20}$/.test(x)) : [];
	} catch { return []; }
}

interface GridResp {
	age: number | null;
	fresh: boolean;
	failed: string[];
	total?: Record<string, number>;
	g: Record<string, CardData[]>;
}

// `let`: po výměně stránky bez načtení (D88, `zap.ts`) se sbírají znovu.
let grids = Array.from(document.querySelectorAll<HTMLElement>('[data-live-grid]'));
const rail = document.querySelector<HTMLElement>('[data-rail]');
/** Jak dlouho smí mřížka čekat na data, než ukáže statické karty. */
const WAIT_MS = 1600;

function buildQuery(sites: string[]): string {
	const parts = new Map<string, number>();
	for (const g of grids) {
		const k = g.dataset.q ?? 'all';
		const n = Number(g.dataset.n ?? 24);
		parts.set(k, Math.max(parts.get(k) ?? 0, n));
	}
	// Doplňovací seznam pro úzké fasety (kde vysílá míň modelek než slotů).
	const maxN = Math.max(0, ...grids.map((g) => Number(g.dataset.n ?? 0)));
	if (grids.length && !parts.has('all')) parts.set('all', maxN);
	if (rail) parts.set('rail', Number(rail.dataset.n ?? 10));
	const q = [...parts].map(([k, n]) => `${k}~${n}`).slice(0, 6).join(',');
	const x = grids.find((g) => g.dataset.x)?.dataset.x;
	// Ručně, ne přes URLSearchParams: ten zakóduje `:` a `,` a URL by se
	// pak neshodovala s přednačtením v <head> (`Layout.astro`, `liveQuery`).
	// Všechny znaky jsou z [a-z0-9:~,-], takže kódovat není co.
	// `v=` jen mění URL: do 17. 11. 2026 zóna přepisovala Browser TTL na rok,
	// takže prohlížeče měly starou odpověď uloženou pod původní adresou.
	let url = `/api/live/grid/?v=2&q=${q}`;
	if (sites.length) url += `&s=${[...sites].sort().join(',')}`;
	if (x) url += `&x=${encodeURIComponent(x)}`;
	return url;
}

async function fetchLive(url: string): Promise<GridResp | null> {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!r.ok) return null;
		return await r.json() as GridResp;
	} catch { return null; }
}

function fillGrid(grid: HTMLElement, data: GridResp): boolean {
	const key = grid.dataset.q ?? 'all';
	const n = Number(grid.dataset.n ?? 24);
	const own = data.g[key] ?? [];
	// Bez čerstvých dat nic neměnit: statická karta je lepší než prázdno.
	if (!data.fresh || !own.length && !(data.g.all ?? []).length) return false;
	const cards: CardData[] = own.slice(0, n);
	if (cards.length < n && grid.dataset.fill !== 'no') {
		const have = new Set(cards.map((c) => `${c.n}:${c.s}`));
		for (const c of data.g.all ?? []) {
			if (cards.length >= n) break;
			if (!have.has(`${c.n}:${c.s}`)) { cards.push(c); have.add(`${c.n}:${c.s}`); }
		}
	}
	const eager = Number(grid.dataset.eager ?? 0);
	grid.innerHTML = cards.map((c, i) => cardHtml(c, { eager: i < eager, priority: i === 0 && eager > 0 })).join('');
	const shown = own.length;
	if (shown < Math.min(n, 4)) ga('grid_sparse', { shown, target: n, facet: key });
	return true;
}

function fillRail(data: GridResp): void {
	if (!rail || !data.fresh) return;
	const list = data.g.rail ?? [];
	// Sloty jsou v HTML `<span>` (prázdné odkazy na `/` by v každé stránce
	// tvořily 10 bezobsažných odkazů, D85); tady se nahradí skutečnými.
	const slots = Array.from(rail.querySelectorAll<HTMLElement>('.rail-item'));
	slots.forEach((slot, i) => {
		const c = list[i];
		if (!c) { slot.hidden = true; return; }
		const a = document.createElement('a');
		a.className = 'rail-item';
		a.href = `/live/${encodeURIComponent(c.p)}/`;
		const img = Object.assign(document.createElement('img'), {
			alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', src: c.t,
		});
		const name = document.createElement('span');
		name.className = 'rail-name';
		name.textContent = c.u;
		const sub = document.createElement('span');
		sub.className = 'rail-sub';
		sub.textContent = NETWORK_LABELS[c.n] ?? c.n;
		name.appendChild(sub);
		const v = document.createElement('span');
		v.className = 'rail-v';
		v.textContent = c.v ? viewersText(c.v) : '';
		a.appendChild(img); a.appendChild(name); a.appendChild(v);
		slot.replaceWith(a);
	});
}

async function hydrate(sites: string[], first: boolean): Promise<void> {
	if (!grids.length && !rail) return;
	let shownStatic = false;
	const timer = first ? window.setTimeout(() => {
		// Pojistka: data nedorazila včas → ukázat, co je v HTML.
		shownStatic = true;
		for (const g of grids) g.classList.add('is-ready');
	}, WAIT_MS) : 0;
	const data = await fetchLive(buildQuery(sites));
	clearTimeout(timer);
	if (!data) {
		ga('live_feed_fail', { reason: 'api' });
		for (const g of grids) g.classList.add('is-ready');
		return;
	}
	if (data.failed?.length) ga('live_feed_fail', { network: data.failed.join(','), reason: 'network' });
	fillRail(data);
	// Počet živých v hlavičce stránky: číslo ze snímku, ne z buildu.
	const total = data.fresh ? data.total?.all : undefined;
	const chip = document.querySelector<HTMLElement>('[data-live-total]');
	if (chip && total && !sites.length) chip.textContent = `${total.toLocaleString('en-US')} live`;
	for (const g of grids) {
		// Když už se ukázaly statické karty, pozdní výměna by se hýbala pod
		// rukou (D57) — povolená jen do 4 s od načtení.
		if (shownStatic && performance.now() > 4000) { g.classList.add('is-ready'); continue; }
		fillGrid(g, data);
		g.classList.add('is-ready');
	}
}

document.documentElement.classList.add('live-js');
void hydrate(storedSites(), true);

// ── filtr podle sítě (D58) ────────────────────────────────────────────────
// Volbu aplikuje blokující skript v <head> stylem (statické karty), tady se
// jen přepíše styl a mřížky se znovu naplní z API jen s vybranými sítěmi.
{
	const bar = document.querySelector<HTMLElement>('[data-grid-filters]');
	const paint = (sites: string[]) => {
		for (const b of bar?.querySelectorAll<HTMLElement>('[data-site]') ?? []) {
			const id = b.dataset.site ?? '';
			const on = id ? sites.includes(id) : !sites.length;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-pressed', String(on));
		}
		let tag = document.querySelector<HTMLStyleElement>('style[data-site-filter]');
		if (!sites.length) { tag?.remove(); return; }
		if (!tag) { tag = document.createElement('style'); tag.dataset.siteFilter = ''; document.head.appendChild(tag); }
		tag.textContent = `.card${sites.map((x) => `:not([data-network="${x}"])`).join('')}{display:none}`;
	};
	if (bar) {
		paint(storedSites());
		bar.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement | null)?.closest?.('[data-site]') as HTMLElement | null;
			if (!btn) return;
			const id = btn.dataset.site ?? '';
			let sites = storedSites();
			sites = !id ? [] : sites.includes(id) ? sites.filter((x) => x !== id) : [...sites, id];
			try { localStorage.setItem(SITES_KEY, JSON.stringify(sites)); } catch { /* privátní režim */ }
			paint(sites);
			ga('filter_apply', { sites: sites.join(',') || 'all' });
			void hydrate(sites, false);
		});
	}
}

// ── stránka modelky: vysílá právě teď? ────────────────────────────────────
// Stránka (statická i dynamická) nese `[data-live-scope]` s odznakem
// `data-live-badge="síť:slug"`. Přehrávač řídí skript stránky; tady se mu jen
// ohlásí stav (`ecamx:model-offline` / `ecamx:model-online`, D63/D68).
function checkModelLive(): void {
	const badge = document.querySelector<HTMLElement>('[data-live-scope] [data-live-badge]');
	const [net, slug] = (badge?.dataset.liveBadge ?? '').split(':');
	if (badge && net && slug) {
		void fetch(`/api/online/${net}/`, { signal: AbortSignal.timeout(8000) })
			.then((r) => r.json() as Promise<{ online?: Record<string, number>; stale?: boolean; truncated?: boolean }>)
			.then((d) => {
				// Nečerstvá nebo neúplná odpověď nic nedokazuje — nechat build.
				if (!d?.online || d.stale || d.truncated) return;
				const viewers = d.online[slug];
				const scope = badge.closest<HTMLElement>('[data-live-scope]')!;
				if (viewers === undefined) {
					badge.textContent = 'Offline';
					badge.classList.remove('bg-live');
					badge.classList.add('bg-ink-700');
					scope.querySelector<HTMLElement>('[data-viewers]')?.setAttribute('hidden', '');
					document.dispatchEvent(new CustomEvent('ecamx:model-offline', { detail: { network: net, slug } }));
					return;
				}
				badge.textContent = 'Live now';
				badge.classList.add('bg-live');
				badge.classList.remove('bg-ink-700');
				const v = scope.querySelector<HTMLElement>('[data-viewers]');
				if (v && viewers > 0) { v.hidden = false; v.textContent = `${viewers.toLocaleString('en-US')} watching`; }
				const offlineMsg = document.querySelector<HTMLElement>('[data-offline-msg]');
				if (offlineMsg) {
					ga('offline_upgraded', { network: net, model: slug });
					offlineMsg.hidden = true;
					document.dispatchEvent(new CustomEvent('ecamx:model-online'));
					for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-cta-offline]')) {
						if (a.dataset.liveHref) a.href = a.dataset.liveHref;
						if (a.dataset.liveText) a.textContent = a.dataset.liveText;
					}
					for (const n of document.querySelectorAll('[data-cta-offline-note]')) n.setAttribute('hidden', '');
				}
			})
			.catch(() => { /* zůstává stav z buildu */ });
	}
}
checkModelLive();

// Výměna stránky bez načtení (D88): nové mřížky naplnit, stav modelky znovu.
document.addEventListener('ecamx:zapped', () => {
	grids = Array.from(document.querySelectorAll<HTMLElement>('main [data-live-grid]'));
	void hydrate(storedSites(), true);
	checkModelLive();
});

// ── CTA „Open {síť}" na recenzi sítě: mířit na někoho, kdo teď vysílá ──────
{
	const a = document.querySelector<HTMLAnchorElement>('[data-cta-retarget]');
	const m = a && /^\/go\/([a-z0-9]+)\//.exec(new URL(a.href, location.href).pathname);
	if (a && m) {
		void fetchLive(`/api/live/grid/?v=2&q=n:${m[1]}~1`).then((d) => {
			const c = d?.fresh ? d.g[`n:${m[1]}`]?.[0] : undefined;
			if (c) a.href = `/go/${m[1]}/${encodeURIComponent(c.u)}/?p=network`;
		});
	}
}
