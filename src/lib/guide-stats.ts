/**
 * Live numbers inside guide text (D91). A guide writes `{{live:chaturbate}}`
 * and the build puts in the rounded count from the last sync, so the text
 * stays true without anyone editing it (D26/D28/D48).
 *
 *   {{live:all}}         live rooms across all networks, `approx()` (13,500+)
 *   {{live:<network>}}   live rooms on one network
 *   {{share:<network>}}  that network's share of all live rooms, in %
 *   {{networks}}         how many networks we track (AGENTS 76)
 *
 * An unknown placeholder fails the build — a guide must never ship `{{…}}`.
 */
import { META, NETWORK_LABELS, NETWORK_SLUGS } from './data';
import { approx } from './seo';

function value(key: string): string {
	const all = META.modelCount;
	if (key === 'networks') return String(META.networks.length);
	const [kind, arg] = key.split(':');
	if (kind === 'live' && arg === 'all') return approx(all);
	const net = META.networks.find((n) => n.id === arg);
	if (kind === 'live' && net) return approx(net.count);
	if (kind === 'share' && net) return `${Math.round((net.count / Math.max(all, 1)) * 100)}%`;
	// A network that is out of the catalogue this build: say so in words,
	// never a zero that reads like a measurement.
	if ((kind === 'live' || kind === 'share') && arg && NETWORK_LABELS[arg]) return 'a few';
	throw new Error(`guide placeholder {{${key}}} is unknown`);
}

export function fillStats(text: string): string {
	return text.replace(/\{\{\s*([a-z]+(?::[a-z0-9]+)?)\s*\}\}/g, (_, key: string) => value(key));
}

/**
 * A network can drop out of a build (its feed failed, D51). Its `/site/{net}/`
 * and `/status/{net}/` pages then don't exist and `check-links` stops the
 * build — so guide links to a missing network fall back to the hub instead.
 */
export function safeHref(href: string): string {
	const m = /^\/(site|status)\/([a-z0-9]+)\//.exec(href);
	return m && !NETWORK_SLUGS.has(m[2]!) ? `/${m[1]}/` : href;
}

export function safeNetworkLinks(html: string): string {
	return html.replace(/href="([^"]+)"/g, (_, href: string) => `href="${safeHref(href)}"`);
}
