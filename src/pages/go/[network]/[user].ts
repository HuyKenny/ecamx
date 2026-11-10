/**
 * Odchozí přesměrování na affiliate URL. Druhá (a jediná další) dynamická route
 * na webu vedle `/api/online/[network]`.
 *
 * Proč vůbec existuje — čtyři důvody, každý sám by asi nestačil:
 *
 * 1. **Klíč z veřejného HTML.** Amateur.tv používá jeden a týž string jako
 *    affiliate ID i jako credential k feedu (`api.a00s.net/...?a=KEY`). Dokud
 *    byl odkaz statický, ležel ten klíč v HTML na 582 stránkách a kdokoli s ním
 *    mohl tahat jejich feed na náš účet. Teď se URL skládá až tady, ze secretu.
 * 2. **Měření.** Do teď se `placement` dostal jen k Chaturbate a LiveJasminu,
 *    ostatních 5 sítí ho v `deepLink()` zahazovalo — nešlo poznat, jestli
 *    vydělává karta, profil nebo sticky lišta. Tady ho vidíme u všech.
 * 3. **Affiliate logika na jednom místě**, takže rotace ID nebo změna programu
 *    je jedna změna, ne rebuild 9 000 stránek.
 * 4. Menší HTML (~70 B na kartu, a karet je na mřížkové stránce 180).
 *
 * **Vedlejší efekt, který je potřeba říct nahlas:** kosmetické filtry
 * blokátorů schovávaly odkazy podle cílové URL
 * (`##a[href^="https://chaturbate.com/in/?"]`, totéž pro `rpwmct.com`), takže
 * u dvou nejdůležitějších sítí CTA části návštěvníků vůbec nesvítilo. Na
 * first-party `/go/` to pravidlo nesedí. Text odkazu ale zůstává pravdivý
 * včetně jména sítě a přiznání provize — nic se nemaskuje.
 *
 * **Riziko:** tímhle stojí peníze na Workeru. Free plán má 100 000 požadavků
 * za den (dnes jich jsou jednotky) a `/go/*` NESMÍ spadnout pod rate limit
 * určený pro `/api/*`, jinak by se rate-limitoval proklik.
 */
import type { APIRoute } from 'astro';
// Astro 7 zrušilo `Astro.locals.runtime.env`; Worker secrets se berou odsud
// a mají názvy BEZ prefixu `PUBLIC_` (ten platí jen pro build-time env).
import { env as workerEnv } from 'cloudflare:workers';
import { deepLink, profileLink, type EnvGet, type Placement } from '../../../lib/affiliate';
import type { NetworkId } from '../../../lib/data';

/**
 * Serverové měření prokliku (`go_click_server`).
 *
 * Proč: klientské `go_click` chodí přes gtag.js, který na adult webu velká část
 * návštěvníků blokuje. Tenhle hit jde z Workeru, takže blokátor na něj nedosáhne
 * a **rozdíl mezi `go_click` a `go_click_server` je změřená míra blokování** —
 * dosud jen tušená. Viz D31.
 *
 * Tři pravidla, která se tu nesmí porušit:
 *
 * 1. **Nesmí to sáhnout na přesměrování.** Odesílá se přes `waitUntil` až po
 *    vrácení odpovědi a celé je to v `try`. Když MP spadne, proklik o tom neví.
 * 2. **Musí to respektovat souhlas** (D45). Jinak by zadní cesta rušila to, co
 *    lišta na webu slíbila: v EU/EHP/UK se hit pošle jen s `ecamx_consent=granted`,
 *    mimo ně se neposílá, když je `denied`. Zemi bere z hlavičky `cf-ipcountry`,
 *    tedy z autority Cloudflare, ne z časové zóny jako klient.
 * 3. **Žádné náhodné `client_id`.** Bez něj by GA4 počítala nového uživatele na
 *    každý klik a metrika „users" by byla smetí. Bere se `ecamx_cid` (naše
 *    first-party cookie, kterou blokátory nesundají), a když není, hit se
 *    nepošle vůbec.
 */
const MEASUREMENT_ID = 'G-JSSZP2XFBL';

/** EU + EHP + UK. Souhlas je tady opt-in, jinde stačí zveřejnění (D45). */
const CONSENT_REQUIRED = new Set([
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
	'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
	'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB',
]);

function cookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
	}
	return null;
}

/**
 * `session_id` z cookie `_ga_<container>`, aby se serverový hit přilepil ke
 * stejné návštěvě jako klientské události. Když cookie není (GA blokované),
 * vynechá se — GA4 si sezení založí sama.
 */
function sessionId(header: string | null): string | null {
	const raw = cookie(header, `_ga_${MEASUREMENT_ID.replace(/^G-/, '')}`);
	// Tvar: GS1.1.<session_id>.<počet>.<…>
	const m = raw?.match(/^GS\d+\.\d+\.(\d+)\./);
	return m ? m[1] : null;
}

export const prerender = false;

/**
 * Povolené sítě. **Třetí místo se seznamem sítí** (vedle `NetworkId`
 * v `data.ts` a `IDX_NETWORKS` v `search-index.ts`) — kdo přidá síť jen jinam,
 * dostane na jejích prokliku 404 a přijde o provizi, tiše. Ověřeno 25. 8. 2026
 * na nových sítích z CrakRevenue: stránky se vygenerovaly, CTA vedla na `/go/`
 * a Worker vracel 404, dokud se seznam nedoplnil.
 */
const NETWORKS = new Set<NetworkId>([
	'chaturbate', 'camsoda', 'cam4', 'amateur', 'bongacams', 'xlovecam', 'livejasmin',
	'stripchat', 'streamate', 'imlive',
]);

/**
 * Povolený tvar nicku. Ověřeno na všech 9 202 modelkách v katalogu: mimo
 * alfanumeriku se v nicích objevuje jen `-` a `_`, nejdelší má 32 znaků.
 * Tečka je tu jen jako rezerva pro sítě, které ji povolují.
 *
 * Tohle je zároveň ochrana proti open redirectu: cílová URL se skládá ze
 * šablony v `deepLink()`, nikdy z uživatelského vstupu, a nick projde přes
 * `encodeURIComponent`. Bez validace by ale šlo posílat `../` a podobné žerty,
 * tak ať to spadne co nejdřív.
 */
const USERNAME = /^[A-Za-z0-9_.-]{1,64}$/;

// POZOR: tenhle seznam a union `Placement` v `src/lib/affiliate.ts` jsou DVĚ
// místa. Kdo přidá hodnotu jen do jednoho, dostane tichý fallback na `card`
// a měření placementu začne lhát bez jediné chybové hlášky.
const PLACEMENTS = new Set<Placement>([
	'card', 'grid', 'profile', 'player', 'offline', 'network', 'finder', 'watchlist',
	'sticky', 'rescue',
]);

const notFound = () =>
	new Response('Not found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
	});

export const GET: APIRoute = ({ params, url, request, locals }) => {
	const network = (params.network ?? '') as NetworkId;
	const user = params.user ?? '';
	if (!NETWORKS.has(network) || !USERNAME.test(user)) return notFound();

	const raw = url.searchParams.get('p') ?? 'card';
	const placement = (PLACEMENTS.has(raw as Placement) ? raw : 'card') as Placement;

	const env: EnvGet = (k) => String((workerEnv as unknown as Record<string, unknown>)[k] ?? '');

	// Offline stránka posílá na profil, ne do (prázdného) pokoje.
	const target = placement === 'offline'
		? profileLink(network, user, env)
		: deepLink(network, user, placement, env);

	// Když chybí secret, vznikla by URL bez affiliate ID — tedy proklik zdarma
	// pro síť. Radši 404 a hlasitá chyba v observability než tichá ztráta.
	if (!target || target.includes('=&') || target.endsWith('=')) {
		console.error(`[go] chybí affiliate ID pro ${network} — proklik zahozen`);
		return notFound();
	}

	// ── měření (nikdy nesmí ovlivnit odpověď) ─────────────────────────────────
	try {
		const cookies = request.headers.get('cookie');
		const consent = cookie(cookies, 'ecamx_consent');
		const country = (request.headers.get('cf-ipcountry') ?? '').toUpperCase();
		const allowed = consent === 'granted'
			|| (consent !== 'denied' && !CONSENT_REQUIRED.has(country));
		const cid = cookie(cookies, 'ecamx_cid');
		const secret = env('GA4_MP_API_SECRET');
		if (allowed && cid && secret) {
			const session = sessionId(cookies);
			const hit = fetch(
				`https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}` +
				`&api_secret=${encodeURIComponent(secret)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						client_id: cid,
						events: [{
							name: 'go_click_server',
							params: {
								network,
								placement,
								// Bez tohohle GA4 hit nepočítá do zapojení a sezení
								// vypadá jako bez interakce.
								engagement_time_msec: 1,
								...(session ? { session_id: session } : {}),
							},
						}],
					}),
					// Bez timeoutu drží `waitUntil` invokaci naživu, dokud Google
					// neodpoví — a to se na free plánu počítá do času Workeru.
					// Měření za to nestojí.
					signal: AbortSignal.timeout(3000),
				},
			).catch(() => { /* měření nesmí shodit proklik */ });
			// `waitUntil` drží Worker naživu po odeslání odpovědi. Bez něj by se
			// request ukončil dřív, než hit odejde.
			(locals as { cfContext?: ExecutionContext }).cfContext?.waitUntil(hit);
		}
	} catch (e) {
		console.error('[go] měření selhalo, proklik pokračuje:', e);
	}

	return new Response(null, {
		status: 302,
		headers: {
			location: target,
			// Přesměrování se nesmí cachovat: nese placement a mohlo by se
			// „přilepit" na jiný kontext.
			'cache-control': 'private, no-store',
			'x-robots-tag': 'noindex, nofollow',
			// Sítě potřebují vědět, že klik jde od nás, ale ne kterou stránku
			// návštěvník čte — origin stačí.
			'referrer-policy': 'strict-origin-when-cross-origin',
			'x-content-type-options': 'nosniff',
		},
	});
};
