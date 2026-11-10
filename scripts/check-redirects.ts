/**
 * Kam odchozí odkaz OPRAVDU dovede.
 *
 * Proč to existuje: 26. 8. 2026 Kenny nahlásil, že „BongaCams proklik hází
 * chybu". Ruční audit všech jedenácti sítí našel dvě chyby, které z kódu nejsou
 * vidět a `auditEarnings()` je nezachytí (ten hlídá TVAR odkazu proti feedu při
 * syncu, ne to, kde odkaz skončí):
 *
 *  - BongaCams mířil na `chat-popup` místo pokoje → obecná titulka, u datacentra
 *    Cloudflare challenge;
 *  - MyFreeCams končil u **každé** modelky na `myfreecams.com/?cam=30352` —
 *    nabídka u CrakRevenue ignoruje `model=`. Síť je od té doby vypnutá.
 *
 * Tenhle skript z toho auditu dělá opakovatelnou kontrolu: vezme živý nick,
 * projde `/go/{síť}/{nick}/`, sleduje přesměrování a ověří, že na cílové stránce
 * ta modelka opravdu je.
 *
 * **Nespouštět při každém deployi.** Jedenáct affiliate prokliků každé dvě
 * hodiny by vypadalo jako klikací fraud; jede to týdně cronem a ručně.
 *
 *   node --experimental-strip-types scripts/check-redirects.ts [--site https://ecamx.com]
 */
import { NETWORKS } from './cam-networks.ts';

const SITE = process.argv.includes('--site')
	? process.argv[process.argv.indexOf('--site') + 1]
	: 'https://ecamx.com';
// Ne falešný Chrome: Cloudflare WAF dává zastaralým verzím Chrome challenge (403).
const UA = 'MalinaCron/1.0 (ecamx check-redirects)';

/**
 * White label a jiné legitimní případy, kdy cílová URL nick neobsahuje v tom
 * tvaru, ve kterém ho posíláme. Streamate jede pod značkou Jerkmate.
 */
const HOST_OK: Record<string, RegExp> = {
	streamate: /jerkmate\.com\/cam\//i,
};

/**
 * Cíle, které NIKDY nesmí být za odchozím odkazem. Jsou to stránky pro rámce
 * a vyskakovací okna, ne pro nový tab — a taková stránka se mimo svůj kontext
 * běžně sama zavře. Přesně to Kenny 27. 8. viděl jako „otevře se záložka a hned
 * se zavře" (BongaCams `chat-popup`, opraveno v D59). Kontroluje se u všech
 * sítí, protože z kódu se to nepozná a projeví se to až návštěvníkovi.
 */
const NEVER_TARGET = /chat-popup|[?&/]popup|\/embed(\/|\?|$)|iframe/i;

/** Botové testy a challenge — z Maliny se přes ně ověřit nedá, není to chyba. */
const BOT_WALL = /validate\.perfdrive\.com|Just a moment|cf-browser-verification|Attention Required/i;

/**
 * Nick k testu se bere **z nasazené stránky sítě**, ne z lokálního katalogu:
 * testovat se má to, na co člověk na webu doopravdy klikne. Ze `/site/{síť}/`
 * se vytáhne první odkaz `/go/{síť}/{nick}/`, tedy přesně ten tvar nicku, který
 * web posílá. (Lokální `models.json` by lhal dvakrát: může být starší než
 * produkce a nemusí obsahovat sítě, které rozpočet stránek zrovna odložil.)
 */
async function deployedNick(net: string): Promise<string | null> {
	try {
		const res = await fetch(`${SITE}/site/${net}/`, { headers: { 'user-agent': UA },
			signal: AbortSignal.timeout(45_000) });
		if (!res.ok) return null;
		const html = await res.text();
		const m = html.match(new RegExp(`/go/${net}/([^/"]+)/`));
		return m ? decodeURIComponent(m[1]) : null;
	} catch { return null; }
}

/**
 * Tvar NAŠÍ odchozí URL, kde ho známe z feedu té sítě. Kontroluje se zvlášť od
 * cílové stránky, protože „skončí to u správné modelky" neodhalí, že jsme
 * poslali na špatný DRUH stránky: BongaCams `chat-popup` nick obsahoval, ale
 * v novém tabu z něj vylezla obecná titulka (D59).
 */
const SHAPE: Record<string, { must: RegExp; why: string }> = {
	bongacams: {
		must: /csurl=https%3A%2F%2Fbongacams\.com%2F(?!chat-popup|profile)/i,
		why: 'csurl musí mířit na pokoj (`/{Nick}`), ne na `chat-popup` — viz D59',
	},
	chaturbate: {
		must: /chaturbate\.com\/in\/\?.*\btour=/i,
		why: 'provizi přiřadí jen `/in/?tour=…` (D13)',
	},
};

let failed = false;
const rows: string[] = [];

for (const net of NETWORKS.map((n) => n.id)) {
	const nick = await deployedNick(net);
	if (!nick) { rows.push(`  ?  ${net.padEnd(11)} na /site/${net}/ není odkaz — nešlo otestovat`); continue; }
	const url = `${SITE}/go/${net}/${encodeURIComponent(nick)}/?p=profile`;

	// 1a) cíl nesmí být stránka pro okno nebo rámec — platí pro všechny sítě
	const peek = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual',
		signal: AbortSignal.timeout(30_000) }).catch(() => null);
	const firstHop = peek?.headers.get('location') ?? '';
	if (NEVER_TARGET.test(firstHop)) {
		failed = true;
		rows.push(`  ✗  ${net.padEnd(11)} ${nick}: cíl je stránka pro okno/rámec, ne pro nový tab`);
		rows.push(`     ${' '.repeat(11)} ${firstHop.slice(0, 96)}`);
		continue;
	}

	// 1b) tvar naší URL (než se vůbec někam pojede)
	const shape = SHAPE[net];
	if (shape) {
		const target = firstHop;
		if (!shape.must.test(target)) {
			failed = true;
			rows.push(`  ✗  ${net.padEnd(11)} ${nick}: špatný tvar odkazu — ${shape.why}`);
			rows.push(`     ${' '.repeat(11)} ${target.slice(0, 96)}`);
			continue;
		}
	}

	let status = 0, finalUrl = '', body = '';
	try {
		const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en' },
			redirect: 'follow', signal: AbortSignal.timeout(45_000) });
		status = res.status;
		finalUrl = res.url;
		body = (await res.text()).slice(0, 60_000);
	} catch (e) {
		rows.push(`  ?  ${net.padEnd(11)} ${nick}: síť neodpověděla (${(e as Error).name})`);
		continue;
	}
	const low = nick.toLowerCase();
	const found = finalUrl.toLowerCase().includes(low) || body.toLowerCase().includes(low)
		|| HOST_OK[net]?.test(finalUrl);
	if (found) {
		rows.push(`  ✓  ${net.padEnd(11)} ${nick} → ${finalUrl.slice(0, 70)}`);
	} else if (BOT_WALL.test(body) || status === 403) {
		rows.push(`  ?  ${net.padEnd(11)} ${nick}: botová zeď (${status}) — z prohlížeče to projít může`);
	} else {
		failed = true;
		rows.push(`  ✗  ${net.padEnd(11)} ${nick}: na cílové stránce NENÍ → ${finalUrl.slice(0, 70)}`);
	}
}

console.log(`[redirects] ${SITE} — kam vede odchozí odkaz u každé sítě:`);
for (const r of rows) console.log(r);
if (failed) {
	console.error('\n[redirects] CHYBA: aspoň jedna síť pošle člověka jinam, než na koho klikl.');
	console.error('  Zkontroluj `deepLink()` v src/lib/affiliate.ts a co posílá feed té sítě');
	console.error('  (u CrakRevenue může být rozbitá jejich nabídka — tak padlo MyFreeCams, D59).');
}
process.exit(failed ? 1 : 0);
