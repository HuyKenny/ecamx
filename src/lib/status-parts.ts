/**
 * Markup of the dynamic parts of `/status/` and `/status/{network}/` (D98) — pure, no Workers APIs, so
 * `scripts/check-status-parts.ts` can diff it against the live SSR page. Same values, markup and escaping as
 * `src/pages/status/[network].astro` and `index.astro` (change both together).
 */
import { NETWORK_LABELS } from './labels.ts';
import { netFresh, type LiveMeta, type PFile } from './live-static.ts';

/** Astro's text escaping (`escapeHTML`): & < > ' ". */
const esc = (s: string) => s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!);
/** Astro's attribute escaping (`toAttributeString`). */
const attr = (s: string) => s.replace(/&/g, '&#38;').replace(/"/g, '&#34;');
const fmt = (n: number) => n.toLocaleString('en-US');

/** One network row with its state, as in both SSR pages (`py` differs: hub 3, network page 2). */
const statusRow = (snap: LiveMeta, id: string, count: number, now: number, py: string, linkClass: string, text: string) =>
	`<li class="flex items-center justify-between ${py}">` +
	`<a href="${attr(`/status/${id}/`)}" class="${linkClass}">${text}</a>` +
	`<span class="${netFresh(snap, id, now) ? 'text-emerald-400' : 'text-amber-400'}">` +
	`${esc(netFresh(snap, id, now) ? `up · ${fmt(count)} live` : 'feed not reached')}</span></li>`;

export type StatusParts = { ld: string; top: string; others: string; built: string | null };

/** `/status/{net}/`: JSON-LD, the block after the H1 (verdict, numbers, top rooms) and "Other cam sites". */
export function statusParts(net: string, networkIds: Set<string>, snap: LiveMeta | null, pools: PFile | null, now: number): StatusParts {
	const label = NETWORK_LABELS[net] ?? net;
	const state = snap?.nets[net];
	const fresh = !!snap && netFresh(snap, net, now);
	const mins = (ts: number) => Math.max(0, Math.round((now - ts) / 60_000));
	const recs = pools?.nets[net] ?? [];
	const live = state?.count ?? pools?.tn[net] ?? 0;
	const privateNow = state?.pr ?? 0;
	const watching = state?.w ?? 0;
	const viewers = { length: state?.wn ?? 0 };
	const top = recs.filter((r) => !r.pr).slice(0, 8);
	const others = snap ? Object.entries(snap.nets).filter(([id]) => id !== net && networkIds.has(id))
		.sort((a, b) => b[1].count - a[1].count) : [];
	const checkedAt = state ? new Date(state.ts).toISOString().slice(11, 16) : null;

	const verdict = !snap
		? { tone: 'unknown', head: 'Status unavailable right now', text: 'Our live check has no recent data. That says nothing about the site itself — try opening it directly.' }
		: fresh
			? { tone: 'up', head: `${label} is up`, text: `Our check ${mins(state!.ts)} min ago (${checkedAt} UTC) found ${fmt(live)} live rooms on ${label}.` }
			: { tone: 'warn', head: `We couldn't reach ${label}'s feed`, text: `Our last successful check was ${state ? `${mins(state.ts)} min ago` : 'a while ago'}. That can be a problem on ${label}'s side or on ours — if the site loads for you, it is up.` };
	const faq = [
		{ q: `Is ${label} down right now?`, a: `${verdict.head}. ${verdict.text}` },
		{ q: `Why won't ${label} load for me?`, a: `If our check sees live rooms, the site is up and the problem is local: an age-verification page, a network that blocks adult sites (work, school, some mobile carriers), or a stale browser cache. Try another network or a private window.` },
	];
	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
	};
	const tone = ({ up: 'border-emerald-500/40 bg-emerald-500/10', warn: 'border-amber-500/40 bg-amber-500/10', unknown: 'border-ink-700 bg-ink-900' } as Record<string, string>)[verdict.tone];

	let topHtml = `<div class="${attr(`mt-5 rounded-lg border p-5 ${tone}`)}" role="status"><p class="text-xl font-bold text-ink-50">${esc(verdict.head)}</p><p class="mt-1 text-ink-200">${esc(verdict.text)}</p></div>`;
	if (fresh) {
		const cell = (dt: string, dd: string) => `<div class="rounded-md border border-ink-800 p-3"><dt class="text-ink-400">${dt}</dt><dd class="text-lg font-bold text-ink-50">${esc(dd)}</dd></div>`;
		topHtml += `<dl class="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">${cell('Live rooms', fmt(live))}${cell('In a private show', fmt(privateNow))}${cell('People watching', viewers.length ? fmt(watching) : 'not published')}</dl>`;
	}
	if (top.length > 0) {
		topHtml += `<section class="mt-8" aria-labelledby="top-h"><h2 id="top-h" class="mb-3 text-lg font-bold">Live on ${esc(label)} at our last check</h2>` +
			`<ul class="flex flex-wrap gap-2">${top.map((c) => `<li><a href="${attr(`/live/${c.p}/`)}" class="pill">${esc(c.u)}</a></li>`).join('')}</ul>` +
			`<p class="mt-3 text-sm"><a href="${attr(`/site/${net}/`)}" class="text-accent underline">See every live ${esc(label)} room →</a></p></section>`;
	}
	const othersHtml = others.length > 0
		? `<section class="mt-8" aria-labelledby="oth-h"><h2 id="oth-h" class="mb-3 text-lg font-bold">Other cam sites</h2><ul class="divide-y divide-ink-800 text-sm">` +
			others.map(([id, s]) => statusRow(snap!, id, s.count, now, 'py-2', 'text-ink-200 hover:text-white', esc(NETWORK_LABELS[id] ?? id))).join('') +
			`</ul></section>`
		: '';

	return { ld: JSON.stringify(jsonLd).replace(/</g, '\\u003c'), top: topHtml, others: othersHtml, built: snap ? new Date(snap.ts).toISOString() : null };
}

/** `/status/` hub: the list (or the "no data" line). */
export function statusIndexParts(networkIds: Set<string>, snap: LiveMeta | null, now: number): { rows: string; built: string | null } {
	const rows = snap ? Object.entries(snap.nets).filter(([id]) => networkIds.has(id))
		.sort((a, b) => b[1].count - a[1].count) : [];
	const html = rows.length
		? `<ul class="mt-6 divide-y divide-ink-800">${rows.map(([id, s]) =>
			statusRow(snap!, id, s.count, now, 'py-3', 'font-semibold text-ink-50 hover:underline', `Is ${esc(NETWORK_LABELS[id] ?? id)} down?`)).join('')}</ul>`
		: '<p class="mt-6 text-ink-300">Our live check has no recent data right now — that says nothing about the sites themselves.</p>';
	return { rows: html, built: snap ? new Date(snap.ts).toISOString() : null };
}
