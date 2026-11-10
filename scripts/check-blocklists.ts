/**
 * Hlídá, jestli naše odchozí URL nejsou na blokovacích seznamech.
 *
 * Proč to existuje: 16. 8. 2026 jsem přepsal Chaturbate embed na
 * `chaturbate.com/in/`, což je v EasyList (`||chaturbate.com/in/`). Chrome podle
 * filtrovacího seznamu takový iframe označí za reklamu a jakmile přenese víc než
 * 4 MB, **sám ho odstraní** (Heavy Ad Intervention). Živý stream to utáhne za
 * pár sekund, takže z přehrávače zbyla hláška „Tato reklama používala příliš
 * mnoho zdrojů". Nasadil jsem to, aniž bych to poznal — proto tenhle guard.
 *
 * Rozlišuje dvě váhy:
 *   IFRAME → CHYBA. Blokovaný nebo za reklamu označený rámec = rozbitý obsah.
 *   ODKAZ  → varování. Skrytý affiliate odkaz je daň affiliate modelu; obcházet
 *            volbu uživatele nebudeme, ale chceme o tom vědět.
 *
 *   node --experimental-strip-types scripts/check-blocklists.ts
 *   node --experimental-strip-types scripts/check-blocklists.ts --offline   (přeskočí)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// `affiliate.ts` si z `data.ts` bere jen typ, takže katalog se sem netáhne;
// seznam sítí proto ze `cam-networks.ts` a popup seznam z malého modulu.
import { deepLink } from '../src/lib/affiliate.ts';
import { POPUP_BLOCKED_NETWORKS } from '../src/lib/popup-blocked.ts';
import { NETWORKS } from './cam-networks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'client');

const LISTS = [
	'https://easylist.to/easylist/easylist.txt',
	'https://easylist.to/easylist/easyprivacy.txt',
];

const log = (m: string) => console.log(`[blocklists] ${m}`);

if (process.argv.includes('--offline')) { log('--offline → přeskakuji'); process.exit(0); }
if (!existsSync(DIST)) { console.error('[blocklists] dist/client neexistuje — nejdřív `pnpm build`'); process.exit(1); }

// ── co web reálně volá ──────────────────────────────────────────────────────

const html: string[] = [];
(function walk(dir: string) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith('.html')) html.push(p);
	}
})(DIST);

/** Kanonická podoba URL bez query — na seznamech se matchuje host+cesta. */
function key(u: string): string | null {
	try {
		const url = new URL(u.replace(/&amp;/g, '&'));
		if (!url.protocol.startsWith('http')) return null;
		return url.host + url.pathname.replace(/\/[^/]*$/, '/');
	} catch { return null; }
}

/**
 * Sítě, u kterých už víme, že jejich embed host je na seznamu, a nemáme za něj
 * náhradu. Guard je proto jen ohlásí a nespadne — jeho úkolem je chytat NOVÉ
 * regrese, ne blokovat deploy kvůli něčemu, co neumíme opravit.
 *
 * Pro uživatele s blokátorem tyhle přehrávače nenaběhnou; krytí je odkaz
 * „Player not loading? Open … directly" pod přehrávačem. Jiné doménové tvary
 * by musely přijít z affiliate panelu té sítě — nevymýšlíme je.
 */
const KNOWN_BLOCKED: Record<string, string> = {
	'ptcdw.com': 'LiveJasmin embed, ||ptcdw.com^ v EasyList — alternativu nemáme',
	'www.xlovecam.com': 'XLoveCam embed, ||xlovecam.com^$third-party v EasyList',
};

const iframes = new Set<string>();
const links = new Set<string>();
// Vzorek musí být dost velký, aby zachytil i menší sítě: XLoveCam má 430
// modelek a LiveJasmin 435 z ~8 000, takže při 400 stránkách se do vzorku
// vůbec nedostaly a guard je přehlédl.
for (const f of html.slice(0, 4000)) {
	const body = readFileSync(f, 'utf8');
	for (const m of body.matchAll(/<iframe[^>]+src="(https?:\/\/[^"]+)"/g)) {
		const k = key(m[1]); if (k) iframes.add(k);
	}
	// Přehrávač se vkládá klikem, takže je v data-embed, ne v src.
	for (const m of body.matchAll(/data-embed="(https?:\/\/[^"]+)"/g)) {
		const k = key(m[1]); if (k) iframes.add(k);
	}
	for (const m of body.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*rel="nofollow sponsored/g)) {
		const k = key(m[1]); if (k) links.add(k);
	}
}
log(`z ${Math.min(html.length, 4000)} stránek: ${iframes.size} cílů pro iframe, ${links.size} affiliate cest`);

// ── seznamy ─────────────────────────────────────────────────────────────────

let rules: string[] = [];
for (const url of LISTS) {
	try {
		// `accept-encoding: identity` schválně: undici v Node 22 padá na
		// assertion `!this.paused` při gzip streamu téhle velikosti (78k řádků),
		// a je to neodchytitelná chyba v parseru, ne výjimka.
		const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
		rules.push(...text.split('\n'));
		log(`${url.split('/').pop()}: ${text.split('\n').length} řádků`);
	} catch (e) {
		// Nedostupný seznam nesmí shodit deploy — to by z externí služby udělalo
		// závislost nasazení. Varovat a pokračovat.
		console.error(`[blocklists] VAROVÁNÍ: ${url} se nepodařilo stáhnout (${e}) — kontrola je nekompletní`);
	}
}
if (!rules.length) { log('žádný seznam k dispozici → nic nekontroluji'); process.exit(0); }

/**
 * Zjednodušený matcher. Nedělá plnou syntaxi Adblock Plus — zajímají nás dva
 * druhy pravidel, které nás reálně pálí: blokovací (`||host/cesta`) a skrývací
 * na href (`##a[href^="…"]`). Výjimky (`@@`) se vyhazují.
 *
 * Modifikátory se ale musí brát v potaz, jinak to hlásí nesmysly: bez nich
 * `||chaturbate.com^$popup,domain=xxxbios.com` „zakazoval" i náš `/embed/`,
 * přitom platí jen pro popupy na cizím webu.
 */
function matches(target: string): string[] {
	const hits: string[] = [];
	for (const raw of rules) {
		const line = raw.trim();
		if (!line || line.startsWith('!') || line.startsWith('@@')) continue;

		if (line.startsWith('||')) {
			const [head, optsRaw = ''] = line.slice(2).split('$');
			const pattern = head.split('^')[0];
			if (!pattern) continue;
			// `||xlovecam.com` matchuje i `www.xlovecam.com` — bez tohohle guard
			// prohlásil náš XLoveCam embed za čistý, přesně ten typ slepého místa,
			// kvůli kterému vznikl.
			const slash = pattern.indexOf('/');
			const pHost = slash === -1 ? pattern : pattern.slice(0, slash);
			const pPath = slash === -1 ? '' : pattern.slice(slash);
			const tSlash = target.indexOf('/');
			const tHost = tSlash === -1 ? target : target.slice(0, tSlash);
			const tPath = tSlash === -1 ? '' : target.slice(tSlash);
			const hostOk = tHost === pHost || tHost.endsWith('.' + pHost);
			if (!hostOk || !tPath.startsWith(pPath)) continue;
			const opts = optsRaw.split(',').filter(Boolean);
			// popup/popunder se iframu ani odkazu netýká
			if (opts.includes('popup')) continue;
			// `domain=a.com|b.com` platí jen na těch webech; `~a.com` je naopak
			// výjimka, takže pravidlo na nás platí.
			const dom = opts.find((o) => o.startsWith('domain='));
			if (dom) {
				const list = dom.slice(7).split('|');
				const positive = list.filter((d) => !d.startsWith('~'));
				if (positive.length && !positive.includes('ecamx.com')) continue;
			}
			hits.push(line);
			continue;
		}

		if (line.includes('[href^="')) {
			// `foo.com##a[href^=…]` platí jen na foo.com; nás zajímají obecná.
			const scope = line.split('##')[0];
			if (scope && !scope.split(',').includes('ecamx.com')) continue;
			const m = line.match(/\[href\^="https?:\/\/([^"]+)"/);
			if (m && target.startsWith(m[1])) hits.push(line);
		}
	}
	return hits;
}

// ── verdikt ─────────────────────────────────────────────────────────────────

/**
 * Reportuje se po hostech, ne po URL: cesty obsahují nick modelky, takže by
 * jinak vznikly desítky skoro stejných řádků. Matchuje se ale pořád proti
 * skutečné cestě, ne proti zkrácenému hostu — pravidla míří i na cesty.
 */
function report(label: string, targets: Set<string>, fatal: boolean): boolean {
	const byHost = new Map<string, string[]>();
	for (const t of targets) {
		const host = t.split('/')[0];
		const arr = byHost.get(host);
		if (arr) { if (arr.length < 5) arr.push(t); } else byHost.set(host, [t]);
	}
	console.log(`\n  ${label}`);
	let bad = false;
	for (const [host, samples] of [...byHost].sort()) {
		const hits = [...new Set(samples.flatMap(matches))];
		if (!hits.length) { console.log(`  ✓ ${host}`); continue; }
		const known = KNOWN_BLOCKED[host];
		if (fatal && known) {
			console.log(`  ~ ${host}  ZNÁMÉ: ${known}`);
			continue;
		}
		if (fatal) bad = true;
		console.log(`  ${fatal ? '✗' : '!'} ${host}  (${samples[0]})`);
		for (const h of hits.slice(0, 2)) console.log(`      ${h}`);
	}
	return bad;
}

/**
 * Kontrola popupů — schválně oddělená od `matches()`, které `$popup` přeskakuje
 * (rámce ani odkazů „na místě" se netýká).
 *
 * Blokovače (uBlock, AdGuard, Brave) považují za popup i odkaz s
 * `target="_blank"`. Když má cílová doména plošné `$popup` pravidlo, taková
 * záložka se návštěvníkovi otevře a **hned zavře** — proklik je mrtvý a
 * v našich datech vypadá jako by k němu došlo. Proto se u takové sítě naviguje
 * ve stejném tabu (`POPUP_BLOCKED_NETWORKS` v `src/lib/data.ts`).
 *
 * Guard tady porovnává SEZNAM se skutečností, ne s dojmem: pro každou síť si
 * odvodí cílový host z `deepLink()` a hlásí obojí směr — síť, která pravidlo
 * získala a pořád otevírá nový tab (rozbité prokliky), i síť, které pravidlo
 * zmizelo a zbytečně opouštíme náš tab. Odchozí URL v HTML jsou first-party
 * `/go/…`, takže z `dist/` se tohle vyčíst NEDÁ — musí se to počítat z kódu.
 * Viz D62.
 */
function popupCheck(): boolean {
	console.log('\n  POPUP (nový tab, který blokovač zabije)');
	// Hodnoty jsou jen na to, aby URL vznikla; do sítě se nic neposílá.
	const fake = (k: string) => `x-${k.toLowerCase()}`;
	let bad = false;
	for (const { id: net } of NETWORKS) {
		let host: string;
		try { host = new URL(deepLink(net as never, 'testuser', 'card', fake)).host; }
		catch { continue; }
		// Plošné pravidlo = `$popup` na celé doméně, tedy bez cesty za hostem.
		// Úzká pravidla (`||cam4.com/?$popup`) naše odkazy netrefí.
		const blanket = rules.some((raw) => {
			const line = raw.trim();
			if (!line.startsWith('||') || line.startsWith('@@')) return false;
			const [head, optsRaw = ''] = line.slice(2).split('$');
			if (!optsRaw.split(',').includes('popup')) return false;
			const pattern = head.split('^')[0];
			if (pattern.includes('/') || pattern.includes('*')) return false;
			// Za `^` nesmí nic zbýt: `||cam4.com^*&utm_source=$popup` míří na
			// konkrétní adresu, ne na celou doménu, a naše odkazy netrefí.
			// (Bez téhle podmínky guard hlásil cam4 — přesně ta chyba, kterou
			// má odchytávat, jen obráceně.)
			const rest = head.slice(pattern.length);
			if (rest !== '' && rest !== '^') return false;
			if (!(host === pattern || host.endsWith('.' + pattern))) return false;
			const dom = optsRaw.split(',').find((o) => o.startsWith('domain='));
			if (dom) {
				const positive = dom.slice(7).split('|').filter((d) => !d.startsWith('~'));
				if (positive.length && !positive.includes('ecamx.com')) return false;
			}
			return true;
		});
		const sameTab = POPUP_BLOCKED_NETWORKS.has(net);
		if (blanket && !sameTab) {
			bad = true;
			console.log(`  ✗ ${net} (${host}) má plošné $popup pravidlo, ale odkaz otevírá nový tab`);
			console.log('      → přidej síť do POPUP_BLOCKED_NETWORKS v src/lib/popup-blocked.ts');
		} else if (!blanket && sameTab) {
			bad = true;
			console.log(`  ✗ ${net} (${host}) plošné $popup pravidlo nemá — nový tab si můžeme vzít zpátky`);
			console.log('      → uber síť z POPUP_BLOCKED_NETWORKS v src/lib/popup-blocked.ts');
		} else {
			console.log(`  ✓ ${net} (${host}) ${sameTab ? 'stejný tab' : 'nový tab'}`);
		}
	}
	return bad;
}

const failed = report('IFRAME (rozbitý rámec = rozbitý obsah)', iframes, true);
report('AFFILIATE ODKAZY (skryté = daň affiliate modelu, jen varování)', links, false);
const popupBad = popupCheck();

if (failed) {
	console.error(
		'\n[blocklists] CHYBA: iframe míří na cestu z blokovacího seznamu.\n' +
		'  Chrome ji označí za reklamu a po 4 MB přenosu rámec odstraní.\n' +
		'  Najdi pro tu síť embed endpoint, který na seznamu není (viz D13).'
	);
	process.exit(1);
}
if (popupBad) {
	console.error(
		'\n[blocklists] CHYBA: seznam POPUP_BLOCKED_NETWORKS nesedí se seznamy.\n' +
		'  Odkaz s target="_blank" na doménu s plošným $popup pravidlem blokovač\n' +
		'  zabije — záložka se otevře a hned zavře, proklik je ztracený (D62).'
	);
	process.exit(1);
}
log('✓ žádný iframe nemíří na blokovanou cestu, popup seznam sedí');
