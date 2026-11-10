/**
 * Sítě, jejichž odchozí odkaz se otevírá **ve stejném tabu**, ne v novém.
 *
 * Vlastní malý modul schválně: guard `scripts/check-blocklists.ts` tenhle
 * seznam potřebuje, ale `data.ts` importovat NESMÍ — ten s sebou táhne celý
 * katalog (13 MB JSONu, past 64). Šablony si to dál berou z `data.ts`, který to
 * jen reexportuje.
 *
 * Důvod je měřený, ne estetický: EasyList má na `bongacams.com` pravidlo
 * `||bongacams.com^$popup,third-party` a blokovače (uBlock, AdGuard, Brave)
 * považují za popup i odkaz s `target="_blank"`. Návštěvníkovi se pak záložka
 * otevře a **hned zavře** — proklik je mrtvý a v datech přitom vypadá jako
 * uskutečněný. Ověřeno 27. 8. 2026 proti EasyListu: z jedenácti našich sítí má
 * plošné `$popup` pravidlo na celé doméně jedině BongaCams; ostatní mají jen
 * úzká pravidla na cesty a subdomény, která naše odkazy netrefí
 * (`chaturbate.com*popunder`, `cam4.com/?`, `imlive.com/wmaster.ashx?`,
 * `crt.livejasmin.com`).
 *
 * Cena: návštěvníkovi nezůstane náš tab otevřený. Klientská událost `go_click`
 * se při navigaci pryč nemusí stihnout odeslat, ale měření drží
 * `go_click_server` ve Workeru (D46), takže data nechybí a nic se nepočítá
 * dvakrát (past 32).
 *
 * Obě strany hlídá `scripts/check-blocklists.ts`. Viz D62.
 */
export const POPUP_BLOCKED_NETWORKS = new Set<string>(['bongacams']);

/** `target` pro odchozí odkaz. `undefined` = stejný tab (viz výše). */
export function outTargetFor(network: string): '_blank' | undefined {
	return POPUP_BLOCKED_NETWORKS.has(network) ? undefined : '_blank';
}
