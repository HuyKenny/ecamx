/**
 * Sync katalogu: stáhne 7 cam sítí, znormalizuje, uklidí taxonomie, rozhodne
 * které stránky vzniknou, a zapíše JSON do src/data/, odkud si to Astro vezme
 * v getStaticPaths.
 *
 * Běží v Cloudflare Builds (běžný Node kontejner, žádný 10ms limit Workeru).
 *
 *   pnpm sync              plný běh
 *   pnpm sync:dry          bez zápisu, malý vzorek
 *   node --experimental-strip-types scripts/sync-cams.ts --dry-run
 *
 * Filozofie: selhat HLASITĚ. Když síť vrátí míň modelek než `minExpected` nebo
 * spadne, build musí padnout — jinak se tiše nasadí poloprázdný katalog a nikdo
 * si toho týden nevšimne.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	NETWORKS, stripLoneSurrogates,
	type NetworkDef, type Model, type NetworkId,
} from './cam-networks.ts';
import {
	canonicalTerm, canonicalLanguage, ageBucket, AGE_BUCKETS,
	isPublishableCategory, THRESHOLDS,
} from './taxonomy-cleanup.ts';
// BongaCams posílá zemi jako volný text psaný performerkou → normalizovat na ISO2.
import { canonicalCountry, modelLetter } from '../src/lib/taxonomy.ts';
import { shardOf } from '../src/lib/redirect-shard.ts';
import { GRID, NETWORK_GRID, DIRECTORY_SIZE, MAX_GRID_PAGES } from '../src/lib/paging.ts';
import {
	MONEY_CATEGORIES, matchesMoney, MIN_MEMBERS, MIN_LIVE, GIRLS_SHARE_MIN,
} from '../src/lib/money-categories.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'src', 'data');
const PUBLIC_DIR = join(ROOT, 'public');
const REGISTRY_FILE = join(ROOT, 'seed', 'registry.json');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
/** Nesahat na produkční KV — registry se čte i píše do seed/registry.json. */
const NO_KV = args.has('--no-kv');
const LIMIT = (() => {
	const i = process.argv.indexOf('--limit');
	return i >= 0 ? parseInt(process.argv[i + 1], 10) : 0;
})();

const log = (m: string) => console.log(`[sync] ${m}`);

// ── env ─────────────────────────────────────────────────────────────────────

function loadEnvFile(path: string): void {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!process.env[m[1]]) process.env[m[1]] = v;
	}
}
// V CI přijdou proměnné z prostředí; lokálně ze sdíleného creds souboru.
loadEnvFile('/home/kenny/ai/credentials/.ecamx-credentials.env');
loadEnvFile(join(ROOT, '.env'));

// ── registry (stabilita profilových URL napříč buildy) ──────────────────────

interface RegistryEntry {
	/** ISO datum prvního výskytu. */
	first: string;
	/** ISO datum posledního výskytu. */
	last: string;
	/** V kolika RŮZNÝCH dnech jsme ji viděli. Tohle rozhoduje o indexaci. */
	seen: number;
	/** Kolik dní po sobě vysílá právě teď. Jen informativní. */
	streak: number;
	/** Nejvyšší zaznamenaný počet diváků — hrubý proxy popularity. */
	peak: number;
	network: NetworkId;
	/**
	 * Přidělený URL slug. Jednou přidělený se UŽ NEMĚNÍ, i když se objeví
	 * populárnější modelka se stejným nickem — jinak by URL putovaly mezi
	 * modelkami a Google by dostával pokaždé jiný obsah na stejné adrese.
	 */
	page?: string;
	/**
	 * Cíl 301, když stránka zanikla. Zároveň funguje jako pojistka proti
	 * blikání: co jednou odešlo, se vrací jen tím, že modelka zase vysílá.
	 */
	gone?: string;
	/**
	 * Poslední známý stav. Feedy vrací JEN právě online modelky, takže bez
	 * tohohle by offline stránku nebylo z čeho vykreslit — a přitom právě ta
	 * je cílem longtail dotazu na nick.
	 */
	snap?: Model;
	/**
	 * Kdy vysílá — **12 dvouhodinových přihrádek** v UTC, base36, jeden znak
	 * na přihrádku (`0`–`z`, tedy strop 35).
	 *
	 * Proč dvouhodinové a ne po hodinách: sync jede cronem `0 *\/2 * * *`, takže
	 * hodinové přihrádky by měly polovinu navždy nulovou a „usually online"
	 * by lhalo. Dvouhodinová přihrádka dostane právě jeden vzorek denně.
	 *
	 * Je to jediný údaj o modelce, který **nemáme odkud opsat** — vzniká
	 * měřením v čase. Právě tím se dá odlišit od sítě samotné i od konkurence.
	 */
	hours?: string;
}
type Registry = Record<string, RegistryEntry>;

/** Po zmizení si stránka drží místo tolik dní (Kennyho zadání 16. 8. 2026). */
const GRACE_DAYS = 45;
/**
 * Retence stránky BEZ měřené poptávky. Kratší než `GRACE_DAYS` schválně:
 * změřeno 25. 8. 2026 proti KV `demand`, že z 2 410 archivních stránek má
 * poptávku jen **602** — zbylých 1 808 jsou soubory, které nikdo nikdy neviděl
 * ani v Googlu, ani na Bingu, a přitom drží místo pod stropem 20 000 souborů
 * free plánu. Stránka s poptávkou tímhle NEPROJDE: chrání ji `wanted()`
 * a nemaže se nikdy (D53).
 */
const GRACE_DAYS_NO_DEMAND = parseInt(process.env.GRACE_DAYS_NO_DEMAND || '14', 10);
/** Jak dlouho po zániku stránky držíme přesměrování, než se slug uvolní. */
const REDIRECT_DAYS = 180;
/**
 * Strop stránek modelek. Free plán Cloudflare dovolí 20 000 souborů na
 * deployment; zbytek webu (kategorie, země, sítě, stránkování, adresář,
 * právní) je ~970 a nějaké místo musí zbýt na assety. CI tvrdě zastaví na
 * 19 000, takže 17 000 stránek modelek = ~17 970 souborů a přes tisíc rezervy.
 *
 * Zvednuto z 14 000 na 17 000 (19. 8. 2026): strop byl vyčerpaný na kus
 * a přitom je to hlavní zásoba pozic, jakou web má — GSC ukazuje 88 % kliků
 * na stránkách modelek a Ahrefs 201 220 hledání/měs na nicky v katalogu při
 * KD 0–24. Řadí se podle poptávky, takže když strop dojde, vypadne stránka,
 * kterou nikdo nehledá. Dá se přebít env proměnnou pro test menšího buildu.
 *
 * **Sníženo zpět na 16 000 (19. 8. odpoledne):** k těmhle stránkám přibylo
 * 674 archivních z `src/lib/legacy-pages.ts`, které se do stropu nepočítají
 * (staví se až při buildu ze seed souboru). 17 000 + 674 + rozcestníky by se
 * dostalo na dohled limitu 19 000 souborů, na kterém CI zastaví. Rozdíl
 * vypadne z nejmíň hledaných stránek — řazení je podle poptávky.
 */
/**
 * **Strop stránek modelek. Od 7. 9. 2026 ho drží minuty CI, ne Cloudflare.**
 *
 * Do 7. 9. bylo 17 000, protože Workers Free dovolí **20 000 souborů** na verzi
 * a CI zastavovalo na 19 000. Ověřeno v API, že účet má `workers_paid` ($5/měs):
 * na tom plánu je limit **100 000 souborů**, tedy 5× víc. Strop tam už není.
 *
 * Zavazující je teď rozpočet GitHub Actions (2 000 min/měs na ÚČET, dělí se
 * s rankizo a rankmat — past 101). Změřeno na 12 skutečných bězích: **medián
 * 11,8 min** při 17 000 stránkách, z toho ~2,3 min je pevná část. Marginál je
 * tedy ~9,5 min na 17 000 stránek a run vychází na
 * `2,3 + N × 9,5/17000` minut.
 *
 * Proč právě 22 000: tolik je potřeba, aby eviction klesla na nulu. Změřeno
 * 7. 9.: 11 636 živých + **10 750 kandidátů na archiv** = 22 386 stránek, které
 * si o místo hlásí. Strop 17 000 z toho odřezával ~5 400 KAŽDÝ běh (D75), takže
 * stránka nestihla nasbírat poptávku, než zmizela. 22 000 pokryje 98 % a stojí
 * ~14,6 min/běh → projekce ~1 460 min z 2 000 při třech bězích denně, plus
 * ~255 min pro ostatní dvě repa. Rezerva ~280 min.
 *
 * **28. 9. 2026: 22 000 → 25 000 (D79).** Kandidátů přibylo: 11 161 živých
 * + 12 855 na archiv = 24 016, takže strop odřezával **2 016 stránek každý
 * běh**. Návštěvnost webu je šíře nick stránek na Bingu (~1 proklik na
 * stránku měsíčně), takže odřezaná stránka = ztracený proklik. Cena: ~+1,7 min
 * na běh, při dvou bězích denně ~+100 min/měs (projekce ~1 000 z 2 000).
 * Dál to bez změny `GRACE_DAYS` nemá smysl — a tu drží limit KV registry
 * (19,6 MB z 25, 75 %).
 *
 * Kdo tohle chce zvednout dál, ať si NEJDŘÍV pustí
 * `python3 ~/ai/bin/ecamx-actions-check.py --dry-run` a podívá se na projekci.
 * Přeteklo to už dvakrát (srpen: ~2 032 min → GitHub vypnul joby na dva dny).
 */
const MAX_MODEL_PAGES = parseInt(process.env.MAX_MODEL_PAGES || '25000', 10);
/**
 * Do indexu jde modelka až po tolika různých dnech, kdy jsme ji viděli.
 * Zbytek dostane stránku, ale `noindex, follow` — klik zůstane u nás a Google
 * nedostane tisíce jepičích URL. Starý web zabilo 26 830 thin stránek, tohle
 * je pojistka proti opakování. Ladí se podle GSC (viz docs/DECISIONS.md D8).
 */
const INDEX_MIN_DAYS = parseInt(process.env.INDEX_MIN_DAYS || '3', 10);

/**
 * Registry je rozdělená na DVA klíče v KV, protože limit 25 MB platí na jednu
 * HODNOTU, ne na namespace:
 *
 *   `registry`       – živé a archivní záznamy (mají `snap`, `hours`, stránku)
 *   `registry-gone`  – zaniklé stránky, tedy jen přesměrování
 *
 * Změřeno 19. 8. 2026, když pokrytí Chaturbate naskočilo na plné: hodnota měla
 * **22,02 MB z 25 (84 %)** a **53 % z toho byla přesměrování** — 71 180 záznamů
 * po 164 B. Všechna mladší 30 dnů, takže zkrácení `REDIRECT_DAYS` by tehdy
 * neuvolnilo ani bajt; problém nebyl v retenci, ale v tom, že dvě různé věci
 * bydlely v jedné hodnotě.
 *
 * Rozdělení je samomigrující: co se načte ze starého klíče, se při zápisu
 * rozdělí. Kód nad tím pracuje s JEDNÍM objektem, aby se retenční logika
 * (D35/D40) nemusela sahat.
 */
const KV_ACTIVE = 'registry';
const KV_RETIRED = 'registry-gone';

/**
 * **Přesměrování se ukládají zhuštěně.** 28. 8. 2026 měla ta hodnota
 * **26,17 MB z 25 MB limitu** a sync přestal ukládat — noční běh CI spadl.
 *
 * Zkrátit retenci by zase nepomohlo: **všech 140 531 záznamů bylo mladších
 * 30 dnů** (změřeno, stejně jako 19. 8.), takže `REDIRECT_DAYS` nemá co uříznout.
 * Přibývá jich ~4 500 denně, jak modelky přicházejí a odcházejí.
 *
 * Zaniklá stránka je přitom jen přesměrování — nepotřebuje `streak`, nepotřebuje
 * síť (ta je v klíči) a nepotřebuje datum jako řetězec. Zhuštěný tvar:
 *
 *   { v: 3, base: '2025-01-01', t: [cíle…], r: { klíč: [first, last, seen, peak, cílIdx, page?, hours?] } }
 *
 * `first`/`last` jsou dny od `base`, `cílIdx` je index do tabulky cílů (359
 * různých hodnot na 140 tisíc záznamů) a `page` se vynechává, když se rovná
 * nicku z klíče. Ze 186 B na záznam je ~48 B, tedy 26,2 MB → ~7 MB.
 *
 * Čte se **obojí**: starý plochý tvar i nový. Kdo sahá na `registry-gone` mimo
 * sync (`~/ai/scripts/ecamx/demand.py`), musí umět rozbalit taky.
 */
const RETIRED_FORMAT = 3;
const RETIRED_BASE = Date.UTC(2025, 0, 1);
const dayNum = (iso: string): number =>
	Math.round((Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) - RETIRED_BASE) / 86_400_000);
const dayIso = (n: number): string =>
	new Date(RETIRED_BASE + n * 86_400_000).toISOString().slice(0, 10);

type PackedRetired = {
	v: number; base: string; t: string[];
	r: Record<string, [number, number, number, number, number, (string | 0)?, string?]>;
};

function packRetired(reg: Registry): PackedRetired {
	const targets: string[] = [];
	const index = new Map<string, number>();
	const r: PackedRetired['r'] = {};
	for (const [key, e] of Object.entries(reg)) {
		const gone = e.gone ?? '';
		let ti = index.get(gone);
		if (ti === undefined) { ti = targets.length; targets.push(gone); index.set(gone, ti); }
		const nick = key.slice(key.indexOf(':') + 1);
		const row: PackedRetired['r'][string] =
			[dayNum(e.first), dayNum(e.last), e.seen, e.peak, ti];
		// `page` se vynechává, když je to prostý nick z klíče — to je většina.
		const page = e.page && e.page !== nick ? e.page : 0;
		if (page || e.hours) row.push(page);
		if (e.hours) row.push(e.hours);
		r[key] = row;
	}
	return { v: RETIRED_FORMAT, base: '2025-01-01', t: targets, r };
}

function unpackRetired(raw: unknown): Registry {
	if (!raw || typeof raw !== 'object') return {};
	const p = raw as Partial<PackedRetired> & Registry;
	// Starý plochý tvar — načte se beze změny a při zápisu se převede sám.
	if (p.v !== RETIRED_FORMAT || !p.r) return raw as Registry;
	const out: Registry = {};
	for (const [key, row] of Object.entries(p.r)) {
		const nick = key.slice(key.indexOf(':') + 1);
		const [first, last, seen, peak, ti, page, hours] = row;
		out[key] = {
			first: dayIso(first),
			last: dayIso(last),
			seen,
			// Zaniklé stránce je `streak` k ničemu a při návratu se stejně
			// počítá od začátku — proto se neukládá.
			streak: 1,
			peak,
			network: key.slice(0, key.indexOf(':')) as NetworkId,
			page: page || nick,
			gone: p.t?.[ti] ?? '/',
			...(hours ? { hours } : {}),
		};
	}
	return out;
}

const RETIRED_FILE = REGISTRY_FILE.replace(/\.json$/, '-gone.json');

function kvUrl(key: string): string {
	const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID } = process.env;
	return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}` +
		`/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`;
}

async function kvRead(key: string): Promise<Registry | null> {
	const res = await fetch(kvUrl(key), {
		headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}` },
	});
	if (res.ok) return await res.json() as Registry;
	if (res.status === 404) return null;
	throw new Error(`KV read ${key} selhalo: HTTP ${res.status}`);
}

async function loadRegistry(): Promise<Registry> {
	const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
	if (!NO_KV && CF_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_API_TOKEN) {
		const [active, retiredRaw] = await Promise.all([kvRead(KV_ACTIVE), kvRead(KV_RETIRED)]);
		if (!active && !retiredRaw) { log('registry v KV zatím není — začínáme na čisto'); return {}; }
		const retired = unpackRetired(retiredRaw);
		// Aktivní má přednost: kdyby se záznam objevil v obou (modelka se vrátila),
		// platí ten bez `gone`.
		log(
			`registry načteno z KV: ${Object.keys(active ?? {}).length} aktivních + ` +
			`${Object.keys(retired).length} přesměrování`
		);
		return { ...retired, ...(active ?? {}) };
	}
	const local = existsSync(REGISTRY_FILE)
		? JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')) as Registry : null;
	const localGone = existsSync(RETIRED_FILE)
		? unpackRetired(JSON.parse(readFileSync(RETIRED_FILE, 'utf8'))) : null;
	if (local || localGone) {
		log('registry načteno z lokálního souboru');
		return { ...(localGone ?? {}), ...(local ?? {}) };
	}
	log('registry neexistuje — začínáme na čisto');
	return {};
}

/**
 * Pole, která se do snapshotu NEUKLÁDAJÍ.
 *
 * Registry je JEDEN objekt v KV a ten má **hard limit 25 MB**. Měřeno 18. 8. 2026:
 * payload 23,47 MB, tedy 1,53 MB do stropu, a přibývá ~336 záznamů na sync
 * (12 synců denně) — bez zásahu by `saveRegistry()` selhalo během pár dní
 * a s ním by spadla stabilita profilových URL, kvůli které registry existuje (D3).
 *
 * Snapshot žral 12,64 MB z těch 23,47. Tyhle položky jsou buď **nikde nečtené**
 * (`blockedCountries`, `streamTypes`, `sexualPreference`, `appearance`), nebo
 * **platné jen pro živou modelku** — a snapshot se používá výhradně na archivní
 * (offline) stránce, kde by `viewers`, `onlineSeconds`, `status` a `goalText`
 * z minula lhaly a `previewVideo` je stejně prošlý odkaz (Cam4 URL expirují).
 * Reálný zisk: 2,79 MB.
 */
const SNAP_OMIT = [
	'blockedCountries', 'streamTypes', 'sexualPreference', 'appearance',
	'previewVideo', 'viewers', 'onlineSeconds', 'status', 'goalText',
] as const;

function trimSnap(m: Model): Model {
	const out = { ...m } as Record<string, unknown>;
	for (const k of SNAP_OMIT) delete out[k];
	return out as unknown as Model;
}

/**
 * Snapshot má smysl jen u modelky, která může dostat archivní stránku — a ta
 * se přiděluje až od `INDEX_MIN_DAYS` viděných dnů (viz archiveKeys). U zbytku
 * je to mrtvá váha: 5 889 záznamů = 5,18 MB. Je to bezpečné a samoopravné,
 * protože snapshot se ukládá znovu při každém výskytu modelky ve feedu.
 */
function pruneSnapshots(reg: Registry): number {
	let freed = 0;
	for (const e of Object.values(reg)) {
		if (e.snap && e.seen < INDEX_MIN_DAYS) { delete e.snap; freed++; }
		// Rozvrh má smysl jen u modelky, která má stránku, kde ho lze ukázat.
		if (e.hours && !e.page) { delete e.hours; freed++; }
	}
	return freed;
}

/** Limit jednoho KV zápisu. Nad ním Cloudflare zápis odmítne. */
const KV_VALUE_LIMIT = 25 * 1024 * 1024;

async function saveRegistry(reg: Registry): Promise<void> {
	if (DRY) { log('dry-run: registry se neukládá'); return; }

	const pruned = pruneSnapshots(reg);

	// Rozdělení na dvě hodnoty. Kritérium je `gone`: zaniklá stránka nese jen
	// přesměrování, živá a archivní všechno ostatní.
	const active: Registry = {};
	const retired: Registry = {};
	for (const [k, e] of Object.entries(reg)) (e.gone ? retired : active)[k] = e;

	const parts: Array<{
		key: string; file: string; data: unknown; count: number; label: string; payload?: string;
	}> = [
		{ key: KV_ACTIVE, file: REGISTRY_FILE, data: active, count: Object.keys(active).length, label: 'registry' },
		{
			key: KV_RETIRED, file: RETIRED_FILE,
			// Zhuštěný tvar — jinak to nad 25 MB neuloží (viz packRetired).
			data: packRetired(retired), count: Object.keys(retired).length,
			label: 'přesměrování',
		},
	];

	for (const p of parts) {
		const payload = JSON.stringify(p.data);
		const pct = (payload.length / KV_VALUE_LIMIT) * 100;
		log(
			`${p.label}: ${p.count} záznamů, ` +
			`${(payload.length / 1e6).toFixed(2)} MB (${pct.toFixed(0)} % limitu KV)`
		);
		// Radši spadnout tady s jasnou zprávou než dostat neprůhledné HTTP 413 —
		// a hlavně: tichý neúspěch zápisu by rozbil stabilitu profilových URL.
		if (payload.length > KV_VALUE_LIMIT) {
			throw new Error(
				`${p.label} ${(payload.length / 1e6).toFixed(2)} MB přesáhlo limit KV 25 MB. ` +
				`Prořezat retenci (GRACE_DAYS / REDIRECT_DAYS / záznamy bez page).`
			);
		}
		if (pct > 80) {
			console.error(`[sync] POZOR: ${p.label} je na ${pct.toFixed(0)} % limitu KV — naplánovat prořez`);
		}
		p.payload = payload;
	}
	if (pruned) log(`zahozeno ${pruned} nepotřebných snapshotů a rozvrhů`);

	const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
	if (!NO_KV && CF_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_API_TOKEN) {
		// **Přesměrování se zapisují PRVNÍ.** Jsou to dva samostatné PUTy a když
		// by druhý selhal, musí přežít ta hodnota, ze které se dá stav dopočítat:
		// starý klíč `registry` pořád obsahuje i zaniklé záznamy, takže načtení
		// příště sesype všechno zpátky. V opačném pořadí by pád mezi zápisy
		// smazal 71 000 přesměrování natrvalo a URL by se vrátily na 404 (D35).
		for (const p of [...parts].reverse()) {
			const body = new FormData();
			body.set('value', p.payload!);
			body.set('metadata', '{}');
			const res = await fetch(kvUrl(p.key), {
				method: 'PUT',
				headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
				body,
			});
			if (!res.ok) throw new Error(`KV write ${p.key} selhalo: HTTP ${res.status} ${await res.text()}`);
		}
		log('registry uloženo do KV (2 klíče)');
		return;
	}
	mkdirSync(dirname(REGISTRY_FILE), { recursive: true });
	for (const p of parts) writeFileSync(p.file, p.payload!);
	log(`registry uloženo lokálně (${Object.keys(active).length} + ${Object.keys(retired).length} záznamů)`);
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Registry v1 → v2. Původní `streak` se zvyšoval při každém běhu bez ohledu na
 * mezery mezi nimi, takže to nikdy nebyl streak — je to počet dnů, kdy jsme
 * modelku viděli. Přejmenováno na `seen`; `streak` začíná počítat nanovo.
 */
function migrateRegistry(reg: Registry): void {
	let n = 0;
	let cleaned = 0;
	let slimmed = 0;
	for (const e of Object.values(reg)) {
		// Jednorázově zeštíhlit snapshoty uložené před zavedením SNAP_OMIT.
		// Bez tohohle by se 2,79 MB uvolňovalo jen postupně, jak se modelky
		// objevují ve feedu — a na to při 1,53 MB do stropu není čas.
		if (e.snap) {
			const sn = e.snap as unknown as Record<string, unknown>;
			for (const k of SNAP_OMIT) {
				if (k in sn) { delete sn[k]; slimmed++; }
			}
		}
		if (typeof e.seen !== 'number') {
			e.seen = Math.max(1, (e as unknown as { streak?: number }).streak ?? 1);
			e.streak = 1;
			n++;
		}
		// Snapshoty uložené dřív, než se začaly čistit nespárované surrogate
		// páry, by shodily build (JSON s `\ud83e` na konci řetězce).
		const snap = e.snap as unknown as Record<string, unknown> | undefined;
		if (!snap) continue;
		for (const [k, v] of Object.entries(snap)) {
			if (typeof v !== 'string') continue;
			const fixed = stripLoneSurrogates(v);
			if (fixed !== v) { snap[k] = fixed; cleaned++; }
		}
	}
	// ZRUŠENO 19. 8. 2026. Tenhle úklid mazal `gone` u neindexovatelných stránek
	// s odůvodněním „404 je u nich správná odpověď". Není: změřeno v GSC, že
	// 729 z 837 stránek modelek s historií vracelo 404 a padlo s nimi 89 %
	// impresí webu (D35). Přesměrování teď dostane každá zmizelá stránka
	// a limit 2 000 pravidel neplatí, protože mapu obsluhuje Worker.
	//
	// Kdyby to tu zůstalo, každý běh by 54 000 přesměrování smazal a hned znovu
	// založil — zbytečný zápis do KV a v logu nesmyslné „nově přesměrováno".
	if (n) log(`registry: převedeno ${n} záznamů na v2`);
	if (cleaned) log(`registry: opraveno ${cleaned} řetězců s rozseknutým emoji`);
	if (slimmed) log(`registry: zeštíhleno ${slimmed} polí ve snapshotech (limit KV 25 MB)`);
}

// ── stahování ───────────────────────────────────────────────────────────────

async function fetchPage(net: NetworkDef, offset: number): Promise<unknown[]> {
	const { url, init } = net.buildRequest(process.env, offset);
	let lastErr: unknown;
	// Feedy občas vrátí 5xx nebo se zaseknou; 3 pokusy s lineárním backoffem.
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
			// **416 = „taková stránka není", ne porucha.** ImLive přes CrakRevenue
			// má většinou míň než 100 živých pokojů, takže dotaz na druhou stránku
			// vrátí Range Not Satisfiable — a sync na tom celou síť zahazoval
			// („✗ imlive offset=100: HTTP 416"), takže ImLive z katalogu mizel
			// obden a CI padalo na „žádný odchozí odkaz na imlive". Prázdná
			// stránka ukončí stránkování o řádek níž, přesně jako u ostatních.
			if (res.status === 416) return [];
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const payload = await res.json();
			return net.extract(payload);
		} catch (e) {
			lastErr = e;
			if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
		}
	}
	throw new Error(`${net.id} offset=${offset}: ${lastErr}`);
}

async function fetchNetwork(net: NetworkDef): Promise<Model[]> {
	const missing = net.requiredEnv.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`${net.id}: chybí env ${missing.join(', ')}`);

	const seen = new Set<string>();
	const out: Model[] = [];
	const pages = net.pagination?.maxPages ?? 1;
	const size = net.pagination?.pageSize ?? 0;

	for (let page = 0; page < pages; page++) {
		const raw = await fetchPage(net, page * size);
		if (raw.length === 0) break;
		// Kontrola vydělávajícího odkazu proti feedu — na první stránce, jednou
		// za běh. Padáme radši tady, než abychom týden posílali kliky zdarma.
		if (page === 0 && net.auditEarnings) {
			const problems = net.auditEarnings(raw, process.env);
			if (problems.length) {
				throw new Error(
					`${net.id}: affiliate odkaz nesedí s feedem — ${problems.join('; ')}. ` +
					`Zkontroluj src/lib/affiliate.ts (u Chaturbate hlavně kód programu v \`tour\`).`
				);
			}
			log(`${net.id}: affiliate odkaz souhlasí s tvarem z feedu`);
		}
		for (const r of raw) {
			const m = net.map(r);
			if (!m?.slug) continue;
			if (seen.has(m.slug)) continue; // stránkování občas vrátí překryv
			seen.add(m.slug);
			out.push({ ...m, network: net.id });
		}
		// Kratší stránka než pageSize = konec dat.
		if (size && raw.length < size) break;
		if (LIMIT && out.length >= LIMIT) break;
	}

	if (out.length < net.minExpected) {
		throw new Error(
			`${net.id}: jen ${out.length} modelek, čekáme aspoň ${net.minExpected}. ` +
			`Buď se změnilo API, nebo vypršel klíč — build radši padá, než aby nasadil prázdný katalog.`
		);
	}
	log(`${net.id.padEnd(11)} ${out.length} modelek`);
	return LIMIT ? out.slice(0, LIMIT) : out;
}

/**
 * Opt-out pro modelky.
 *
 * Publikujeme o reálných lidech víc než jen výpis: kde ještě vysílají a (od
 * konce srpna) kdy je vídáme online. To druhé je informace o rutině konkrétní
 * osoby, takže **musí existovat ventil** — a takový, který nevyžaduje, aby nám
 * kdokoli něco dokazoval e-mailem.
 *
 * Řešení: modelka si dá kód do **room subjectu**, který stejně ingestujeme
 * každé dvě hodiny. Nejbližší sync ho uvidí a profil zmizí z katalogu, z indexu
 * finderu i z rozvrhů. Je to self-service a **ověřitelné**: do subjectu svého
 * pokoje může psát jen ona.
 *
 * Změřeno 20. 8. 2026, u kolika procent pokojů subject vůbec máme: CamSoda 100,
 * LiveJasmin 97, Amateur 98, Chaturbate 94, BongaCams 70, Cam4 62 —
 * a **XLoveCam 0 %**. Pro XLoveCam tedy zbývá `info@ecamx.com`, jinak by to
 * pro 492 modelek nefungovalo a tvrdit „stačí kód" by byla lež.
 */
const OPT_OUT_CODE = /(?:^|[^a-z])ecamx[\s-]?out(?:[^a-z]|$)/i;

function optedOut(m: Model): boolean {
	return !!m.subject && OPT_OUT_CODE.test(m.subject);
}

// ── agregace taxonomií ──────────────────────────────────────────────────────

interface Facet { slug: string; label: string; count: number }

function tally(models: Model[], pick: (m: Model) => string[]): Map<string, number> {
	const c = new Map<string, number>();
	for (const m of models) for (const v of new Set(pick(m))) c.set(v, (c.get(v) ?? 0) + 1);
	return c;
}

function toFacets(counts: Map<string, number>, min: number): Facet[] {
	return [...counts.entries()]
		.filter(([, n]) => n >= min)
		.sort((a, b) => b[1] - a[1])
		.map(([slug, count]) => ({ slug, label: titleCase(slug), count }));
}

function titleCase(slug: string): string {
	return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── hlavní běh ──────────────────────────────────────────────────────────────

const started = new Date();
const today = started.toISOString().slice(0, 10);

log(`start${DRY ? ' (DRY RUN)' : ''}${LIMIT ? ` limit=${LIMIT}/síť` : ''}`);

// Sítě stahujeme paralelně — jsou nezávislé a nejpomalejší (Cam4) trvá ~15 s.
const settled = await Promise.allSettled(NETWORKS.map(fetchNetwork));
const failures = settled
	.map((r, i) => (r.status === 'rejected' ? `${NETWORKS[i].id}: ${r.reason?.message ?? r.reason}` : null))
	.filter(Boolean) as string[];

if (failures.length) {
	console.error('\n[sync] SELHÁNÍ:');
	for (const f of failures) console.error('  ✗ ' + f);
	// Jedna vypadlá síť ze sedmi se dá přežít; dvě a víc znamenají systémový problém.
	if (failures.length >= 2) {
		console.error('[sync] padlo víc než jedna síť → build končí chybou');
		process.exit(1);
	}
	console.error('[sync] pokračuji se zbylými sítěmi\n');
}

const fetched: Model[] = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

// Opt-out se aplikuje TADY, tedy dřív než taxonomie, registry i index finderu —
// aby se nemusel hlídat na deseti místech dál v souboru.
const optOuts = fetched.filter(optedOut);
const fetchedLive: Model[] = optOuts.length ? fetched.filter((m) => !optedOut(m)) : fetched;
if (optOuts.length) {
	log(`opt-out: ${optOuts.length} modelek si vyžádalo vyřazení (kód v room subjectu)`);
}
log(`celkem staženo: ${fetchedLive.length} modelek ze ${settled.filter((r) => r.status === 'fulfilled').length} sítí`);

// ── strop souborů platí i na ŽIVÉ modelky ───────────────────────────────────
/**
 * Free plán unese 20 000 souborů a CI zastavuje na 19 000. Do 25. 8. omezoval
 * `MAX_MODEL_PAGES` **jen archiv** — živá modelka dostala stránku vždycky.
 * Jenže počet živých pokojů se mezi syncy hýbe o tisíce (změřeno v jednom dni:
 * 15 844 → 17 421), takže při přílivu archiv dostal **nula míst** a vypadly
 * i stránky s měřenou poptávkou. Alarm to nahlásil: „strop vyhodil 332 stránek
 * S MĚŘENOU POPTÁVKOU", což je přesně regrese, kterou řešilo D53.
 *
 * Pořadí, v jakém se ubírá:
 *   1. **měřená poptávka** — pozice se nezahazují nikdy (D53),
 *   2. **už má stránku** — jinak by URL blikaly mezi stránkou a přesměrováním
 *      podle hodiny (tentýž problém jako u faset, D44),
 *   3. větší publikum, pak víc viděných dnů.
 *
 * Kdo se nevejde, **zůstává v registry** a stránku dostane, jakmile se místo
 * uvolní. Nic se nemaže.
 */
const ARCHIVE_RESERVE = parseInt(process.env.ARCHIVE_RESERVE || '2400', 10);
/** Kolik URL zabere `count` položek v mřížce po `size`. Nikdy míň než 1. */
/**
 * Kolik URL zabere jedna faseta. **Se stropem** — stránkování mřížek se od
 * 28. 8. generuje jen do `MAX_GRID_PAGES` (viz `src/lib/paging.ts`), takže bez
 * něj by odhad souborů nadhodnocoval o ~670 a strop stránek modelek by se
 * zbytečně držel nízko. Adresář `/models/` strop nemá.
 */
const gridPages = (count: number, size: number, cap = MAX_GRID_PAGES) =>
	Math.min(Math.max(1, Math.ceil(count / size)), cap);
const liveBudget = Math.max(1000, MAX_MODEL_PAGES - ARCHIVE_RESERVE);

const registry = await loadRegistry();
migrateRegistry(registry);
const demand = await loadDemand();

const models: Model[] = (() => {
	if (fetchedLive.length <= liveBudget) return fetchedLive;
	const score = (m: Model): number => {
		const e = registry[`${m.network}:${m.slug}`];
		const d = e?.page ? (demand[e.page] ?? 0) : (demand[m.slug] ?? 0);
		return (d >= 1 ? 1e9 : 0) + (e?.page ? 1e6 : 0) + (e?.peak ?? 0) * 100 + (e?.seen ?? 0);
	};
	const ranked = [...fetchedLive].sort((a, b) => score(b) - score(a));
	const kept = ranked.slice(0, liveBudget);
	const deferred = ranked.slice(liveBudget);
	const brandNew = deferred.filter((m) => !registry[`${m.network}:${m.slug}`]?.page).length;
	log(
		`strop: živých ${fetchedLive.length} > rozpočet ${liveBudget}, `
		+ `${deferred.length} odloženo (z toho ${brandNew} nově objevených); `
		+ `zůstávají v registry a stránku dostanou, až se místo uvolní`
	);
	return kept;
})();

// ── paměť publikovaných faset (hystereze) ───────────────────────────────────
/**
 * Které fasety už jednou byly URL. Bez tohohle **stránky blikají**: prahy
 * (`THRESHOLDS`) se měří proti JEDNOMU snapshotu, sync jde 12× denně, a supply
 * se hýbe. Změřeno 19. 8. 2026: 7 zemí a 58 kategorií leží do 1,5× prahu, takže
 * `/country/be/` existovalo v jednom buildu (23 modelek) a v dalším vracelo
 * **404** (19 modelek). Pro Google je to nejhorší možný signál: URL, která se
 * objevuje a mizí.
 *
 * Pravidlo: nad prahem = publikuj a zapamatuj si datum. Pod prahem stránka
 * zůstane, dokud je supply aspoň **poloviční** a od posledního překročení
 * neuběhlo víc než `PUBLISHED_GRACE_DAYS`. Když kategorie opravdu vymře, URL
 * po týdnu zmizí — ale ne kvůli dvouhodinovému výkyvu.
 */
type PublishedMemory = Record<string, Record<string, string>>;
const PUBLISHED_KEY = 'facets-published';
const PUBLISHED_FILE = join(ROOT, 'seed', 'facets-published.json');
const PUBLISHED_GRACE_DAYS = 7;

async function loadPublished(): Promise<PublishedMemory> {
	const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
	if (!NO_KV && CF_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_API_TOKEN) {
		const v = await kvRead(PUBLISHED_KEY) as unknown as PublishedMemory | null;
		if (v) return v;
		log('paměť publikovaných faset v KV zatím není — zakládá se');
		return {};
	}
	if (existsSync(PUBLISHED_FILE)) {
		return JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8')) as PublishedMemory;
	}
	return {};
}

const published = await loadPublished();
const graceCutoff = isoDay(started.getTime() - PUBLISHED_GRACE_DAYS * 86_400_000);
let kept = 0;

/**
 * „Tahle faseta má být URL." `ok` je dnešní pravidlo (práh, publikovatelnost);
 * když neprojde, rozhoduje paměť.
 */
function keepFacet(kind: string, slug: string, count: number, min: number, ok: boolean): boolean {
	const mem = (published[kind] ??= {});
	if (ok) { mem[slug] = today; return true; }
	const last = mem[slug];
	if (!last || last < graceCutoff) return false;
	if (count < Math.max(1, Math.ceil(min / 2))) return false;
	kept++;
	return true;
}

/** Paměť nemá růst navěky — co je pod hranicí odkladu, jde pryč. */
function prunePublished(): number {
	let dropped = 0;
	for (const kindMem of Object.values(published)) {
		for (const [slug, when] of Object.entries(kindMem)) {
			if (when < graceCutoff) { delete kindMem[slug]; dropped++; }
		}
	}
	return dropped;
}

// ── taxonomie ───────────────────────────────────────────────────────────────
// Musí být před výběrem stránek: cíl přesměrování zaniklé modelky je její
// nejsilnější kategorie, takže potřebujeme vědět, které kategorie vůbec existují.

const catCounts = tally(models, (m) => m.tags.map(canonicalTerm).filter(Boolean) as string[]);
const categories = toFacets(catCounts, 1).filter((f) =>
	keepFacet('categories', f.slug, f.count, THRESHOLDS.category,
		isPublishableCategory(f.slug, f.count)));

const countries = toFacets(tally(models, (m) => (canonicalCountry(m.country) ? [canonicalCountry(m.country)!] : [])), 1)
	.filter((f) => keepFacet('countries', f.slug, f.count, THRESHOLDS.country, f.count >= THRESHOLDS.country));
const genders = toFacets(tally(models, (m) => (m.gender ? [m.gender] : [])), 1);
const ethnicities = toFacets(tally(models, (m) => (m.ethnicity ? [canonicalTerm(m.ethnicity)!] : []).filter(Boolean)), 1)
	.filter((f) => keepFacet('ethnicities', f.slug, f.count, THRESHOLDS.attribute, f.count >= THRESHOLDS.attribute));
const hairColors = toFacets(tally(models, (m) => (m.hairColor ? [canonicalTerm(m.hairColor)!] : []).filter(Boolean)), 1)
	.filter((f) => keepFacet('hairColors', f.slug, f.count, THRESHOLDS.attribute, f.count >= THRESHOLDS.attribute));
const bodyTypes = toFacets(tally(models, (m) => (m.bodyType ? [canonicalTerm(m.bodyType)!] : []).filter(Boolean)), 1)
	.filter((f) => keepFacet('bodyTypes', f.slug, f.count, THRESHOLDS.attribute, f.count >= THRESHOLDS.attribute));
const languages = toFacets(tally(models, (m) => m.languages.map(canonicalLanguage).filter(Boolean) as string[]), 1)
	.filter((f) => keepFacet('languages', f.slug, f.count, THRESHOLDS.language, f.count >= THRESHOLDS.language));
const ageGroups = toFacets(tally(models, (m) => (ageBucket(m.age) ? [ageBucket(m.age)!] : [])), 1);
const networkFacets = toFacets(tally(models, (m) => [m.network]), 1);

if (kept) log(`hystereze: ${kept} faset drženo pod prahem (URL by jinak blikala)`);
log(
	`taxonomie: ${categories.length} kategorií (z ${catCounts.size} syrových), ` +
	`${countries.length} zemí, ${languages.length} jazyků, ` +
	`${ethnicities.length + hairColors.length + bodyTypes.length} atributů`
);

// ── registry: identita, retence a výběr stránek ─────────────────────────────
// (načteno výš, protože podle něj se rozhoduje, které živé modelky se vejdou
// do stropu — a to musí padnout dřív, než se z nich spočítají taxonomie.)

// ── poptávka: co Google opravdu hledá ───────────────────────────────────────
//
// Do 19. 8. řídila retenci jen nabídka — čerstvost (`last`) a počet viděných
// dnů. Důsledek se dal změřit v GSC: **729 z 837 stránek modelek, které kdy
// měly imprese, vracelo 404** a padlo s nimi 89 % impresí webu, včetně dvou
// nejsilnějších stránek (`lunarspark` pozice 6,7 a `tinyxstar` 10,3).
//
// Poptávka má proto přednost před čerstvostí. Dva zdroje:
//  – `seed/legacy-gone-stats.json` — imprese z GSC za 16 měsíců. Commitnutý
//    soubor, ne API dotaz: GSC klíč nepatří do CI.
//  – KV klíč `demand` — objem hledání na nick z Ahrefsu, plní ho
//    `~/ai/scripts/ecamx/demand.py` na Malině. Měřeno: top 60 nicků katalogu
//    = 45 370 hledání/měs v US, 51 z nich KD ≤ 20 (víc než „cam girls" má při
//    KD 59). Když `demand` v KV není, sync jede dál jen z GSC dat.
interface DemandEntry {
	impressions?: number;
	clicks?: number;
	volume?: number;
	/** Bing (a s ním DuckDuckGo a Yahoo) — přidáno 24. 8. 2026, viz níž. */
	bing_impressions?: number;
	bing_clicks?: number;
}

function demandScore(v: DemandEntry): number {
	// Klik váží víc než imprese — dokazuje provoz, ne jen zobrazení. Objem
	// hledání je řádově vyšší číslo, tak se dělí, ať jedna měřená modelka
	// nepřebije celou GSC historii.
	//
	// **Bing se počítá stejně jako Google, ne slabší.** Změřeno 24. 8. 2026:
	// Google dává webu ~5 impresí denně, Bing má v indexu 52 380 URL a přinesl
	// 1 048 kliků na stránky modelek. Dokud tenhle člen chyběl, retence mazala
	// vlastní pozice — vzorek 24 vydělávajících stránek dal 13× 404, 9× 302
	// jinam a 2× 200. Viz D53.
	return Math.max(
		(v.impressions ?? 0) + (v.clicks ?? 0) * 10,
		(v.bing_impressions ?? 0) + (v.bing_clicks ?? 0) * 10,
		(v.volume ?? 0) / 10,
	);
}

async function loadDemand(): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	const add = (page: string, score: number) => {
		if (score > (out[page] ?? 0)) out[page] = score;
	};
	const stats = join(ROOT, 'seed', 'legacy-gone-stats.json');
	if (existsSync(stats)) {
		const gsc = JSON.parse(readFileSync(stats, 'utf8')) as Record<string, DemandEntry>;
		for (const [page, v] of Object.entries(gsc)) add(page, demandScore(v));
		log(`poptávka: ${Object.keys(gsc).length} stránek z GSC historie`);
	}
	const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
	if (!NO_KV && CF_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_API_TOKEN) {
		const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/demand`;
		const res = await fetch(url, { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } });
		if (res.ok) {
			const kv = await res.json() as Record<string, DemandEntry>;
			for (const [page, v] of Object.entries(kv)) add(page, demandScore(v));
			const byBing = Object.values(kv).filter((v) => (v.bing_impressions ?? 0) > 0).length;
			log(`poptávka: ${Object.keys(kv).length} záznamů z KV `
				+ `(objem hledání + imprese; ${byBing} z nich drží Bing)`);
		} else if (res.status === 404) {
			log('poptávka: klíč `demand` v KV ještě není — jedu jen z GSC historie');
		}
	}
	return out;
}

/** Skóre poptávky pro URL slug stránky. 0 = nikdo o ni neprojevil zájem. */
function demandFor(page: string | undefined | null): number {
	return page ? (demand[page] ?? 0) : 0;
}
/** Nad tímhle skóre se stránka nikdy nesmaže ani nepřesměruje. */
const DEMAND_KEEP = 1;

const liveKeys = new Set(models.map((m) => `${m.network}:${m.slug}`));
const yesterday = isoDay(started.getTime() - 86_400_000);
const cutoffPage = isoDay(started.getTime() - GRACE_DAYS * 86_400_000);
const cutoffNoDemand = isoDay(started.getTime() - GRACE_DAYS_NO_DEMAND * 86_400_000);
const cutoffRedirect = isoDay(started.getTime() - REDIRECT_DAYS * 86_400_000);

/**
 * Přihrádka rozvrhu pro tenhle běh: dvouhodinové okno v UTC (0–11).
 * Bere se čas začátku syncu, ne čas zápisu — běh trvá minuty a rozvrh se
 * nesmí rozhodit podle toho, jak dlouho který feed odpovídal.
 */
const hourBucket = Math.floor(started.getUTCHours() / 2);

/** Přičte jeden vzorek do přihrádky. Strop je 35 (`z`) — nad ním se všechno
 *  půlí, aby se poměry zachovaly a řetězec zůstal 12 znaků. */
function bumpHour(hours: string | undefined, bucket: number): string {
	const buckets = Array.from({ length: 12 }, (_, i) => {
		const c = hours?.[i] ?? '0';
		const n = parseInt(c, 36);
		return Number.isFinite(n) ? n : 0;
	});
	buckets[bucket] += 1;
	if (buckets[bucket] > 35) for (let i = 0; i < 12; i++) buckets[i] = Math.floor(buckets[i] / 2);
	return buckets.map((n) => Math.min(35, n).toString(36)).join('');
}

// 0. Opt-out: co o ní víme, se zahodí, ale URL nesmí spadnout na 404 (D35) —
//    dostane přesměrování na stránku sítě jako každá zaniklá stránka.
for (const m of optOuts) {
	const e = registry[`${m.network}:${m.slug}`];
	if (!e) continue;
	delete e.snap;
	delete e.hours;
	if (e.page && !e.gone) e.gone = `/site/${m.network}/`;
}

/**
 * Kolik modelek se vrátilo z přesměrování zpátky na vlastní stránku.
 *
 * Počítá se TADY, ne v kroku 4: ten maže `gone` jen tehdy, když se stránka
 * vrátila přes poptávku, a u živých modelek je `gone` v tu dobu už dávno pryč.
 * Do 7. 9. 2026 se proto v logu hlásilo „0 modelek se vrátilo" **vždycky**
 * a kolotoč stránek (~5 400 vyhozených a stejný počet vrácených za běh) nebyl
 * z logu vůbec poznat. Viz D75.
 */
let revived = 0;

// 1. Zaznamenat dnešní výskyt a uložit čerstvý snapshot.
for (const m of models) {
	const key = `${m.network}:${m.slug}`;
	let e = registry[key];
	if (!e) {
		e = registry[key] = {
			first: today, last: today, seen: 1, streak: 1,
			peak: m.viewers ?? 0, network: m.network,
		};
	} else if (e.last !== today) {
		e.seen += 1;
		// streak je jen tehdy streak, když navazuje na včerejšek
		e.streak = e.last === yesterday ? e.streak + 1 : 1;
		e.last = today;
	}
	e.peak = Math.max(e.peak, m.viewers ?? 0);
	e.hours = bumpHour(e.hours, hourBucket);
	e.snap = trimSnap(m);
	// Vrátila se → případné přesměrování zaniká a stránka ožívá.
	if (e.gone) { delete e.gone; revived++; }
}

// 2. Přidělit URL slug těm, kdo ho ještě nemají. Řadíme podle peak diváků, ať
//    při kolizi nicků dostane holý slug ta známější — ale jen jednou provždy.
const takenSlugs = new Set<string>();
for (const e of Object.values(registry)) if (e.page) takenSlugs.add(e.page);

let assigned = 0;
for (const m of [...models].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))) {
	const e = registry[`${m.network}:${m.slug}`]!;
	if (e.page) continue;
	// `slug-network` je vždy volný: dvojice (slug, network) je v registry unikátní.
	e.page = takenSlugs.has(m.slug) ? `${m.slug}-${m.network}` : m.slug;
	takenSlugs.add(e.page);
	assigned++;
}

// 2b. Slug dostane i modelka, kterou zrovna nevidíme ve feedu, ale je po ní
//     MĚŘENÁ POPTÁVKA. Bez slugu ji kroky 3 i 4 přeskočí (`!e.page`), takže
//     nedostane ani stránku, ani přesměrování — a URL vrací tvrdou 404.
//
//     Změřeno 19. 8. 2026 na všech 1 778 nicích z KV `demand`: **179 z nich
//     vracelo 404 a stálo za nimi 40 540 hledání/měs**, včetně dvou
//     nejžádanějších stránek celého webu — `gummies15` (16 000/měs, KD 15)
//     a `hotfallingdevil` (8 900, KD 8). Dohromady 126 150 z 201 220 měřených
//     hledání mířilo na stránku, která neexistuje. Viz D40.
//
//     Klíč registry je `síť:nick`, takže nick je to za dvojtečkou — `demand`
//     je klíčovaný slugem stránky, a dokud slug není, je to právě nick.
let assignedByDemand = 0;
for (const [k, e] of Object.entries(registry)) {
	if (e.page) continue;
	const nick = k.slice(k.indexOf(':') + 1);
	if (demandFor(nick) < DEMAND_KEEP) continue;
	e.page = takenSlugs.has(nick) ? `${nick}-${e.network}` : nick;
	takenSlugs.add(e.page);
	assignedByDemand++;
}

// 3. Vybrat, co dostane stránku. Online vždy — bez toho by karta neměla kam
//    vést. Zbytek rozpočtu doplní nedávno offline, od nejčerstvějších.
// Archivní stránku dostane jen modelka, která by šla i do indexu — u zbytku
// není co indexovat a odkaz na ni nevede odnikud. NENÍ to ale důvod nechat
// jejich URL padat na 404: od 19. 8. dostane přesměrování každá zmizelá
// stránka (viz krok 4 a D35).
//
// Přednost má POPTÁVKA, ne čerstvost: stránka, kterou někdo v Googlu opravdu
// našel (imprese v GSC) nebo na jejíž nick je měřený objem hledání, se do
// rozpočtu vejde vždycky. Bez toho web mazal vlastní pozice — 89 % impresí
// končilo na 404, včetně dvou nejsilnějších stránek webu.
const archiveBudget = Math.max(0, MAX_MODEL_PAGES - models.length);
/**
 * Měřená poptávka přebíjí VŠECHNY ostatní podmínky — i `snap` a `gone`.
 *
 * Do 19. 8. odpoledne to tak nebylo a byla to díra, kterou nešlo ucpat
 * retencí: krok 4 při zániku maže `snap` (`delete e.snap`, šetří KV), takže
 * filtr `!!e.snap` vyřadil i stránku s velkou poptávkou, jakmile jednou
 * zanikla. A `!e.gone` to zablokoval zpětně — zpátky ji vrátilo jedině
 * skutečné vysílání. Výsledek: 620 nicků s poptávkou (85 610 hledání/měs)
 * přesměrovaných naslepo a 179 (40 540/měs) na tvrdé 404.
 *
 * Stránka bez snapshotu se postaví z toho, co registry pořád má — nick a síť
 * (`minimalArchive`). Nic dalšího se nedoplňuje. Viz D40.
 */
const wanted = (e: RegistryEntry) => demandFor(e.page) >= DEMAND_KEEP;
const archiveCandidates = Object.entries(registry)
	.filter(([k, e]) =>
		!liveKeys.has(k) && !!e.page
		&& (wanted(e) || (!!e.snap && !e.gone
			&& e.seen >= INDEX_MIN_DAYS && e.last >= cutoffNoDemand)));
/**
 * **Po poptávce rozhoduje TRVALOST, ne čerstvost.**
 *
 * Změřeno 7. 9. 2026 na dvou po sobě jdoucích buildech (04:00 z Maliny a 05:49
 * z CI, stejný commit): mezi nimi **zmizelo 5 037 z 15 927 indexovaných stránek
 * (31,6 %)** a vzorek 25 z nich vracel 302. Mezi vyhozenými bylo 2 034 stránek
 * se `seen >= 14` a 2 180 modelek, které byly v předchozím buildu ještě živé.
 * Google tedy dostával sitemapu, kde třetina URL do dalšího průchodu odpoví
 * přesměrováním — přesně vzorec, kterému říká „Crawled – currently not
 * indexed".
 *
 * Proč `last` nefunguje: přepíše se **každý běh každému**, kdo zrovna vysílal,
 * takže tail u hranice rozpočtu se přehazoval třikrát denně. `seen` roste
 * nejvýš o 1 za den, takže publikovaná množina drží a odříznou se ti nejméně
 * etablovaní — což jsou zároveň ti, kdo nejméně pravděpodobně něco vydělali.
 *
 * Proč `peak` nesmí rozhodovat dřív: **pět sítí počty diváků vůbec neposílá**
 * (XLoveCam, LiveJasmin, Streamate, Stripchat, ImLive → `peak = 0` u 100 %
 * modelek, změřeno), takže v každé remíze systematicky prohrávaly. Streamate
 * ztratil 48 % a Stripchat 46 % stránek proti 28 % u Chaturbate.
 *
 * Eviction se tím neruší — je strukturální (každý běh dostanou stránku nové
 * živé modelky, takže se jich stejný počet musí vejít pryč). Mění se jen to,
 * KDO odchází: místo náhodného přeskládání odchází stabilně ten nejmladší.
 */
const archiveRanked = [...archiveCandidates].sort((a, b) => {
	const d = demandFor(b[1].page!) - demandFor(a[1].page!);
	if (d !== 0) return d;
	if (b[1].seen !== a[1].seen) return b[1].seen - a[1].seen;
	if (a[1].last !== b[1].last) return a[1].last < b[1].last ? 1 : -1;
	if (b[1].peak !== a[1].peak) return b[1].peak - a[1].peak;
	// Klíč nakonec: bez něj by remízu rozhodlo pořadí v objektu, které se mezi
	// běhy mění, a tail by blikal i při jinak shodném řazení.
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
});
const archiveKeys = archiveRanked.slice(0, archiveBudget).map(([k]) => k);
// Co rozpočet odřízl. Do 24. 8. to bylo neviditelné: v logu stálo jen kolik
// stránek poptávka OCHRÁNILA, ne kolik jich strop vyhodil — a vyhozená stránka
// s poptávkou je přesně to, co web stálo vlastní pozice (D53).
const evicted = archiveRanked.slice(archiveBudget);
const evictedWithDemand = evicted.filter(([, e]) => wanted(e)).length;

const pageKeys = new Set<string>([...liveKeys, ...archiveKeys]);

/**
 * **Do sitemapy patří jen stránka, která tam bude i příští build.**
 *
 * Změřeno 7. 9. 2026 na dvou po sobě jdoucích buildech: ze 15 927 URL, které
 * sitemapa slibovala, jich **5 037 (31,6 %) do dvou hodin odpovídalo 302**.
 * Není to porucha, kterou by šlo spravit řazením — je strukturální. Stránku má
 * 17 000 modelek, ale registry jich zná ~183 000 a kdo právě vysílá, ten
 * stránku dostane (Kennyho pravidlo: klik z karty nesmí odejít z webu). Každý
 * běh se tedy ~5 000 vrácených modelek přihlásí o své slugy a stejný počet
 * právě offline stránek musí jít pryč. Kolotoč se zastavit nedá, dokud je
 * strop 17 000 proti free limitu 20 000 souborů.
 *
 * Co se dá spravit, je **co Googlu tvrdíme**. Sitemapa, kde třetina URL vrací
 * přesměrování, je pro web s DR 14 aktivně škodlivá — to je přesně vzorec
 * „Crawled – currently not indexed", který u nás GSC hlásí (za 28 dní 36
 * stránek s impresemi, z toho 3 stránky modelek, proti 2 424 stránkám
 * s impresemi na Bingu).
 *
 * Práh se **nenastavuje od oka a nesmí být absolutní** (past: `seen` roste
 * s věkem webu, takže pevná dvacítka by za pár měsíců pustila dovnitř zase
 * všechny). Počítá se ze rozpočtu: stránka je stabilní, když by přežila
 * eviction i ve chvíli, kdy by si polovinu archivního rozpočtu vzaly vracející
 * se modelky. Změřeno na dnešním katalogu → `seen >= 30`, 2 882 URL, churn
 * **0,0 %**; při `seen >= 25` to je 3 073 URL a 3,3 %.
 *
 * **Poptávka práh obchází vždycky** — a to je ta pojistka, kterou si žádá
 * paměť `seo-dr0-sitemapa-neni-discovery` („práh nikdy nezvedat bez změření
 * proti URL s impresemi"). Změřeno: zúžení nevyhodí ani jednu z 2 876 stránek
 * s měřenou poptávkou, protože ty jsou proti eviction chráněné explicitně
 * (krok 4) a jsou tedy stabilní z definice.
 *
 * Discovery to nebere: `/models/{písmeno}/` pokrývá 100 % modelek (ověřeno na
 * písmenu „a"), takže Google si stránku pořád najde — jen mu ji nepodstrkujeme
 * jako trvalou. Jakmile si ji někdo v Googlu nebo Bingu opravdu najde,
 * `demand` ji do sitemapy pustí sám. Stránky **zůstávají `index, follow`** —
 * noindex by deindexoval i to, co dnes vydělává na Bingu.
 */
const SITEMAP_SAFETY = parseFloat(process.env.SITEMAP_SAFETY || '0.5');
const holderSeen = [...pageKeys].map((k) => registry[k]!.seen).sort((a, b) => b - a);
const seenCut = holderSeen[Math.floor(archiveBudget * SITEMAP_SAFETY)] ?? 0;

// 4. Kdo stránku měl a teď ji nemá → 301 na nejbližší živou stránku.
//    Jakmile se `gone` nastaví, zpátky ji vrátí jen skutečné vysílání (krok 1) —
//    bez toho by modelky na hraně stropu blikaly mezi stránkou a redirectem.
const categorySlugs = new Set(categories.map((c) => c.slug));
const countrySlugs = new Set(countries.map((c) => c.slug));

function redirectTarget(e: RegistryEntry): string {
	const snap = e.snap;
	if (snap) {
		const cat = snap.tags.map(canonicalTerm).find((t) => t && categorySlugs.has(t));
		if (cat) return `/cams/${cat}/`;
		const country = canonicalCountry(snap.country);
		if (country && countrySlugs.has(country)) return `/country/${country}/`;
	}
	return `/site/${e.network}/`;
}

let retired = 0, returned = 0, keptByDemand = 0;
for (const [k, e] of Object.entries(registry)) {
	// Modelka se vrátila: stránka je znovu statický soubor, takže staré
	// přesměrování musí zmizet, jinak by v mapě zůstalo navěky.
	if (pageKeys.has(k) && e.gone) { delete e.gone; returned++; continue; }
	if (pageKeys.has(k) || !e.page || e.gone) continue;
	// Stránka s měřenou poptávkou se nepřesměrovává. Když se nevešla do
	// rozpočtu, je to chyba rozpočtu — ne důvod zahodit pozici v Googlu.
	if (demandFor(e.page) >= DEMAND_KEEP) { keptByDemand++; continue; }
	// **Přesměrování dostane KAŽDÁ zmizelá stránka**, ne jen ta nad prahem
	// `INDEX_MIN_DAYS`. Ta podmínka tu byla proto, že se přesměrování musela
	// vejít do 2 000 pravidel `_redirects` — a důsledek byl, že 5 878 živých
	// modelek pod prahem mělo URL, které se v okamžiku konce vysílání změnilo
	// v tvrdou 404. Od 19. 8. mapu čte Worker, kde limit není (D35).
	e.gone = redirectTarget(e); retired++;
	// Snapshot už není k čemu — stránka neexistuje. Šetří to megabajty v KV.
	delete e.snap;
}

// 5. Úklid. Slug se uvolní až po vypršení přesměrování, jinak by ho zabrala jiná
//    modelka a stará URL by vedla na cizí obsah.
let pruned = 0;
for (const [k, e] of Object.entries(registry)) {
	if (liveKeys.has(k)) continue;
	// Záznam s měřenou poptávkou se NEMAŽE. Bez téhle výjimky by ho krok 5
	// smazal hned v příštím běhu a stránka, kterou jsme právě zachránili, by
	// se zase rozpadla na 404 — přesně tak zmizely `lunarspark` a `hoaarisa`,
	// které registry dnes vůbec nezná. Viz D40.
	if (demandFor(e.page) >= DEMAND_KEEP) continue;
	const dead = e.gone ? e.last < cutoffRedirect : e.last < cutoffPage;
	if (dead) { delete registry[k]; pruned++; }
}

// ── výstupní katalog ────────────────────────────────────────────────────────

/** Model plus to, co o něm ví registry. Tohle konzumuje web. */
type CatalogModel = Model & {
	page: string;
	first: string;
	last: string;
	seen: number;
	streak: number;
	/** Nejvyšší zaznamenaný počet diváků. Jediný údaj o popularitě, který máme. */
	peak: number;
	/** 12 dvouhodinových přihrádek v base36 — kdy modelku vídáme online. */
	hours?: string;
	online: boolean;
	indexable: boolean;
	/**
	 * Bude tahle stránka existovat i příští build? Jen takové patří do
	 * sitemapy — viz `seenCut` výš. `indexable` říká „smí do indexu",
	 * `stable` říká „smíme to Googlu slíbit".
	 */
	stable: boolean;
	/** Skóre poptávky z KV klíče `demand` + GSC historie (viz D35). */
	demand: number;
	/**
	 * Stránka postavená jen z nicku a sítě, protože registry nemá snapshot.
	 * Šablona podle toho vynechá všechno, co by si musela vymyslet. Viz D40.
	 */
	archived?: boolean;
};

const decorate = (m: Model, e: RegistryEntry, online: boolean): CatalogModel => ({
	...m,
	page: e.page!,
	first: e.first,
	last: e.last,
	seen: e.seen,
	streak: e.streak,
	peak: e.peak,
	hours: e.hours,
	online,
	// Měřená poptávka indexovatelnost otevírá hned — čekat 3 dny u stránky,
	// na kterou se lidi opravdu ptají, znamená nechat pozici ležet.
	indexable: e.seen >= INDEX_MIN_DAYS || demandFor(e.page) >= DEMAND_KEEP,
	stable: demandFor(e.page) >= DEMAND_KEEP || e.seen >= seenCut,
	// Skóre poptávky jde i do katalogu: šablony podle něj řadí vnitřní odkazy
	// a rozhodují, které stránce se vyplatí delší text. Zaokrouhleno — přesnost
	// tady nikdo nepotřebuje a v JSON to šetří bajty.
	demand: Math.round(demandFor(e.page)),
	// U offline modelky je počet diváků z minula lež — radši nic.
	viewers: online ? m.viewers : null,
});

/**
 * Stránka pro modelku, u které registry nemá snapshot — jen nick a síť.
 * Všechno ostatní je `null`/`[]`, protože cokoli jiného by byl výmysl:
 * šablona `live/[slug].astro` u `archived` vynechá text i „naposledy vysílala"
 * a `attrs` prázdné hodnoty samy přeskočí. Stejný tvar jako
 * `src/lib/legacy-pages.ts`, jen zdroj je registry místo seed souboru.
 */
function minimalArchive(key: string, e: RegistryEntry): CatalogModel {
	const nick = key.slice(key.indexOf(':') + 1);
	return {
		slug: nick, network: e.network, username: nick, displayName: nick,
		gender: null, age: null, country: null, languages: [], tags: [],
		ethnicity: null, hairColor: null, eyeColor: null,
		bodyType: null, bustSize: null,
		appearance: [], sexualPreference: null, streamTypes: [],
		subject: null, viewers: null, thumbnail: null,
		blockedCountries: [], previewVideo: null,
		followers: null, isHd: false, isNew: false, onlineSeconds: null,
		toy: false, status: null, goalText: null,
		turnOns: null, photos: null, videos: null,
		page: e.page!, first: e.first, last: e.last,
		seen: e.seen, streak: e.streak, peak: e.peak, hours: e.hours,
		online: false, indexable: true,
		stable: demandFor(e.page) >= DEMAND_KEEP || e.seen >= seenCut,
		demand: Math.round(demandFor(e.page)),
		archived: true,
	};
}

const onlineCatalog = models.map((m) => decorate(m, registry[`${m.network}:${m.slug}`]!, true));
const archiveCatalog = archiveKeys.map((k) => {
	const e = registry[k]!;
	return e.snap ? decorate(e.snap, e, false) : minimalArchive(k, e);
});
const minimal = archiveCatalog.filter((m) => m.archived).length;
const goneMap: Record<string, string> = {};
for (const e of Object.values(registry)) if (e.gone && e.page) goneMap[e.page] = e.gone;

const indexable = [...onlineCatalog, ...archiveCatalog].filter((m) => m.indexable).length;
const stableCount = [...onlineCatalog, ...archiveCatalog].filter((m) => m.indexable && m.stable).length;

log(`registry: ${Object.keys(registry).length} záznamů (+${assigned} nových slugů, +${assignedByDemand} podle poptávky, ${retired} zaniklo, ${pruned} smazáno)`);
log(`stránky modelek: ${onlineCatalog.length} živých + ${archiveCatalog.length} z archivu (z toho ${minimal} jen z nicku a sítě) = ${onlineCatalog.length + archiveCatalog.length}, strop ${MAX_MODEL_PAGES}`);
log(`z toho indexovaných: ${indexable} (práh seen>=${INDEX_MIN_DAYS} nebo poptávka), přesměrování: ${Object.keys(goneMap).length}`);
log(`v sitemapě: ${stableCount} stabilních (práh seen>=${seenCut} nebo poptávka) — `
	+ `zbytek katalogu drží adresář /models/, ale Googlu ho neslibujeme`);
log(`poptávka: ${keptByDemand} stránek ochráněno, ${retired} nově přesměrováno`);
log(`kolotoč: ${revived} modelek se vrátilo z přesměrování na vlastní stránku`
	+ `${returned ? ` (+${returned} přes poptávku)` : ''} — strop je ${MAX_MODEL_PAGES}, `
	+ `takže stejný počet stránek musí odejít (D75)`);
const staleNoDemand = Object.entries(registry).filter(([k, e]) =>
	!liveKeys.has(k) && !!e.page && !e.gone && !wanted(e)
	&& !!e.snap && e.last < cutoffNoDemand && e.last >= cutoffPage).length;
log(`rozpočet: ${archiveRanked.length} kandidátů na archiv, ${archiveKeys.length} se vešlo, `
	+ `${evicted.length} odříznuto stropem ${MAX_MODEL_PAGES}; `
	+ `prořezáno bez poptávky po ${GRACE_DAYS_NO_DEMAND} dnech: ${staleNoDemand}`);
if (evictedWithDemand > 0) {
	console.error(`[sync] POZOR: strop vyhodil ${evictedWithDemand} stránek S MĚŘENOU POPTÁVKOU `
		+ '— to jsou pozice, které web zahazuje; zvedni MAX_MODEL_PAGES nebo prořeď bez poptávky');
}
// Hláška má smysl jen tehdy, když strop OPRAVDU něco odřízl. Dřív se počítala
// z `archiveBudget < archiveKeys.length + retired`, což platilo skoro vždycky
// (`retired` roste s každou zmizelou modelkou) a v logu strašila i ve chvíli,
// kdy se archiv vešel celý.
if (evicted.length > 0) {
	// Nejen KOLIK, ale KDO: po přechodu na řazení podle `seen` (7. 9. 2026) mají
	// odcházet jen nejmladší stránky. Když se tady `seen` vyšplhá k desítkám,
	// znamená to, že strop požírá etablované profily a rozpočet je potřeba řešit
	// — ne že řazení nefunguje.
	const seens = evicted.map(([, e]) => e.seen).sort((x, y) => y - x);
	const median = seens[Math.floor(seens.length / 2)];
	log(`POZOR: strop odřízl ${evicted.length} archivních stránek — retence je fakticky `
		+ `kratší než ${GRACE_DAYS} dní; nejvyšší seen mezi vyhozenými ${seens[0]}, medián ${median}`);
}

// ── kurátorské „money" kategorie ────────────────────────────────────────────
// Ruční seznam podle změřené poptávky. Nepodléhá prahu 50, ale MUSÍ mít
// MIN_MEMBERS modelek (živé + archiv), jinak stránku nedostane — thin content
// zabil starý web a tady si ho vyrobit nesmíme. Viz src/lib/money-categories.ts.
const autoCategorySlugs = new Set<string>([
	...categories.map((c) => c.slug),
	...ethnicities.map((c) => c.slug),
	...hairColors.map((c) => c.slug),
	...bodyTypes.map((c) => c.slug),
]);

const curated = MONEY_CATEGORIES.flatMap((c) => {
	if (c.intentOk === false) return [];
	const liveHits = onlineCatalog.filter((m) => matchesMoney(m, c.rule));
	const allHits = liveHits.length + archiveCatalog.filter((m) => matchesMoney(m, c.rule)).length;
	if (allHits < MIN_MEMBERS || liveHits.length < MIN_LIVE) {
		log(
			`kurátorská kategorie ${c.slug} vynechána: ${liveHits.length} živých ` +
			`(min ${MIN_LIVE}), ${allHits} celkem (min ${MIN_MEMBERS})`
		);
		return [];
	}
	const female = liveHits.filter((m) => m.gender === 'female').length;
	return [{
		slug: c.slug,
		label: c.label,
		count: liveHits.length,
		// „cam girls" v titulku smí být jen tam, kde to je pravda. Počítá se z dat.
		girls: liveHits.length > 0 && female / liveHits.length >= GIRLS_SHARE_MIN,
		fresh: !autoCategorySlugs.has(c.slug),
	}];
});

const curatedNew = curated.filter((c) => c.fresh).length;
log(
	`kurátorské kategorie: ${curated.length} (${curatedNew} nových URL, ` +
	`${curated.length - curatedNew} rozšiřuje existující)`
);

/**
 * Odhad počtu souborů v buildu. **Počítá i stránkování** — bez toho lhal
 * o 1 500 souborů: 25. 8. hlásil rezervu 2 164, když už byl build 320 souborů
 * NAD stropem CI. Mřížka se stránkuje po `GRID.size`, adresář po
 * `DIRECTORY_SIZE`, takže s růstem katalogu roste i počet stránkovacích URL —
 * konstanta na to nestačí.
 *
 * Zbytek (assety `_astro`, statické stránky, sitemapy, obrázky) měřeno
 * 25. 8. 2026: 629 souborů. Autorita je ale krok „Check asset count" v CI,
 * tenhle odhad je jen varování dřív, než se build spustí.
 */
const STATIC_FILES = 700;
const facetPages = [
	...categories, ...countries, ...genders, ...ethnicities,
	...hairColors, ...bodyTypes, ...ageGroups, ...curated,
].reduce((n, f) => n + gridPages(f.count, GRID.size), 0)
	+ networkFacets.reduce((n, f) => n + gridPages(f.count, NETWORK_GRID.size), 0);
const directoryPages = [...onlineCatalog, ...archiveCatalog]
	.reduce((acc: Map<string, number>, m) => acc.set(modelLetter(m.page), (acc.get(modelLetter(m.page)) ?? 0) + 1), new Map<string, number>())
	.values()
	// Bez stropu: adresář je jediná trvalá crawl cesta ke stránkám modelek (D33).
	.reduce((n: number, count: number) => n + gridPages(count, DIRECTORY_SIZE, Infinity), 0);

const pageCount = STATIC_FILES + facetPages + directoryPages
	+ onlineCatalog.length + archiveCatalog.length;
// Strop souborů je na `workers_paid` 100 000 (ověřeno 7. 9. 2026), takže se
// hlídá to, co dnes opravdu bolí: **délka běhu CI**. 30 000 souborů ≈ 19 min
// na běh ≈ 1 900 min/měs při třech bězích denně, což je u hranice 2 000.
const CI_FILE_BUDGET = parseInt(process.env.CI_FILE_BUDGET || '30000', 10);
log(`odhad stránek celkem: ~${pageCount} (do rozpočtu CI ${CI_FILE_BUDGET} souborů zbývá `
	+ `${CI_FILE_BUDGET - pageCount}; technický strop Workers Paid je 100 000)`);
if (pageCount > CI_FILE_BUDGET - 2_000) {
	console.error(`[sync] POZOR: ${pageCount} stránek — každý soubor navíc prodlužuje běh CI `
		+ `(~33 ms/stránku) a rozpočet je 2 000 min/měs na účet. Zkontroluj projekci: `
		+ `python3 ~/ai/bin/ecamx-actions-check.py --dry-run`);
}

// ── zápis ───────────────────────────────────────────────────────────────────

if (DRY) {
	log('dry-run: nic se nezapisuje');
	log(`ukázka kategorií: ${categories.slice(0, 15).map((c) => `${c.slug}(${c.count})`).join(', ')}`);
	log(`ukázka zemí: ${countries.slice(0, 12).map((c) => `${c.slug}(${c.count})`).join(', ')}`);
	log(`jazyky: ${languages.map((c) => `${c.slug}(${c.count})`).join(', ')}`);
	log(`kurátorské: ${curated.map((c) => `${c.slug}(${c.count}${c.fresh ? ' NOVÁ' : ''})`).join(', ')}`);
} else {
	mkdirSync(DATA_DIR, { recursive: true });
	const write = (name: string, data: unknown) => {
		writeFileSync(join(DATA_DIR, name), JSON.stringify(data));
		log(`zapsáno ${name}`);
	};
	write('models.json', onlineCatalog);
	write('archive.json', archiveCatalog);
	write('gone.json', goneMap);

	/**
	 * **Mapa přesměrování jako shardované statické assety.**
	 *
	 * Worker si ji do 23. 9. 2026 nesl v bundlu jako JS literál — 6,0 z 6,9 MB,
	 * tedy 87 % (D76). Parsoval ho každý studený start isolate, i když se
	 * přesměrování týká jen cest, na které neexistuje statický soubor.
	 *
	 * Soubory leží v `public/`, takže je servíruje **assets layer**, a Worker
	 * si je vytahuje přes binding `ASSETS` — stejně jako `/404.html` ve
	 * `[...path].ts`. Vzor je `public/live-pages.json` (taky generovaný sync,
	 * taky čtený za běhu). Do KV to nepatří: ta binding schválně nemá (D3).
	 *
	 * `gone.json` v `src/data/` zůstává — čte ho `check-links.ts` na ověření
	 * cílů a je to jediný zdroj pravdy pro obojí.
		 */
	const shards = new Map<string, Record<string, string>>();
	for (const [slug, target] of Object.entries(goneMap)) {
		const key = shardOf(slug);
		(shards.get(key) ?? shards.set(key, {}).get(key)!)[slug] = target;
	}
	// Staré shardy se musí uklidit: slug se uvolní po `REDIRECT_DAYS`, takže
	// soubor může zůstat ležet i ve chvíli, kdy v něm nic není.
	const shardDir = join(PUBLIC_DIR, 'gone');
	rmSync(shardDir, { recursive: true, force: true });
	mkdirSync(shardDir, { recursive: true });
	for (const [key, map] of shards) {
		writeFileSync(join(shardDir, `${key}.json`), JSON.stringify(map));
	}
	log(`zapsáno gone/ (${shards.size} shardů pro ${Object.keys(goneMap).length} přesměrování)`);
	write('facets.json', {
		categories, countries, genders, networks: networkFacets,
		ethnicities, hairColors, bodyTypes, languages, ageGroups, curated,
		// Písmena abecedního adresáře. Worker je potřebuje k tomu, aby neznámý
		// `/live/{nick}/` poslal na existující `/models/{písmeno}/` místo 404
		// (D53) — a `MODEL_LETTERS` z `data.ts` v Workeru mít nemůže, ten tahá
		// 13 MB katalogu.
		letters: [...new Set([...onlineCatalog, ...archiveCatalog]
			.map((m) => modelLetter(m.page)))].sort(),
	});
	/**
	 * **Které modelky u nás mají stránku** — pro záchranné karty (D67).
	 *
	 * Mřížka si na starší stránce dotáhne modelky z živého feedu, jenže část
	 * z nich u nás stránku nemá (změřeno 29. 8.: chaturbate 19 z 20, stripchat
	 * 12 z 20). Karta bez stránky původně končila přesměrováním do pokoje
	 * partnera — Kenny to zakázal: „žádné přesměrování k partnerovi hned,
	 * potřebujeme ty lidi co nejdýl udržet na webu." Klient proto takové karty
	 * přeskočí, a k tomu potřebuje seznam.
	 *
	 * Je to **statický soubor, ne data ve Workeru**: 400 kB literál v modulu
	 * endpointu by se parsoval při startu každého isolate a `/api/online/`
	 * má strop 10 ms CPU. Takhle to stojí jeden asset (cache na edge, ~120 kB
	 * po gzipu), stáhne se **jen když se záchrana opravdu spouští**, a Worker
	 * se toho vůbec netýká.
	 *
	 * Formát je per síť: `p` = stránka se jmenuje jako slug, `x` = jmenuje se
	 * `{slug}-{síť}` (kolize slugů napříč sítěmi, dnes 1 472 z 17 000).
	 */
	{
		const byNet: Record<string, { p: string[]; x: string[] }> = {};
		for (const m of [...onlineCatalog, ...archiveCatalog]) {
			const n = (byNet[m.network] ??= { p: [], x: [] });
			(m.page === m.slug ? n.p : n.x).push(m.slug);
		}
		writeFileSync(join(PUBLIC_DIR, 'live-pages.json'),
			JSON.stringify({ v: 1, nets: byNet }));
		const total = Object.values(byNet).reduce((a, n) => a + n.p.length + n.x.length, 0);
		log(`zapsáno live-pages.json (${total} stránek pro záchranné karty)`);

		/**
		 * **Seznam pro IndexNow — „tyhle stránky teď existují".**
		 *
		 * `indexnow.py` bral URL ze sitemapy, a to od D75 nejde: sitemapa je
		 * schválně jen ta stabilní část (~5 200 z 15 900), takže by se z pingů
		 * vytratily právě nové stránky — a tím by se zavřel kruh, protože do
		 * sitemapy se stránka dostane až měřenou poptávkou. Bing přitom nese
		 * 233 kliků proti 8 z Googlu, takže jeho discovery se oslabit nesmí.
		 *
		 * Sitemapa a IndexNow mají různý význam a proto různý zdroj: sitemapa
		 * je **trvalý slib**, ping je **„podívej se teď"**. Pro ping je stránka,
		 * která za osm hodin může zmizet, úplně v pořádku.
		 */
		const indexnow = [...onlineCatalog, ...archiveCatalog]
			.filter((m) => m.indexable)
			.map((m) => `/live/${encodeURIComponent(m.page)}/`)
			.sort();
		writeFileSync(join(PUBLIC_DIR, 'indexable-pages.txt'), `${indexnow.join('\n')}\n`);
		log(`zapsáno indexable-pages.txt (${indexnow.length} URL pro IndexNow)`);
	}

	// Paměť publikovaných faset — bez zápisu by hystereze nefungovala.
	{
		const dropped = prunePublished();
		const payload = JSON.stringify(published);
		const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
		if (!NO_KV && CF_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_API_TOKEN) {
			const body = new FormData();
			body.set('value', payload);
			body.set('metadata', '{}');
			const res = await fetch(kvUrl(PUBLISHED_KEY), {
				method: 'PUT',
				headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
				body,
			});
			if (!res.ok) throw new Error(`KV write ${PUBLISHED_KEY} selhalo: HTTP ${res.status}`);
		} else {
			writeFileSync(PUBLISHED_FILE, payload);
		}
		const n = Object.values(published).reduce((a, m) => a + Object.keys(m).length, 0);
		log(`paměť faset: ${n} slugů${dropped ? `, ${dropped} vypršelo` : ''}`);
	}
	write('meta.json', {
		generatedAt: started.toISOString(),
		modelCount: onlineCatalog.length,
		archiveCount: archiveCatalog.length,
		indexableCount: indexable,
		sitemapCount: stableCount,
		seenCut,
		goneCount: Object.keys(goneMap).length,
		networks: networkFacets.map((n) => ({ id: n.slug, count: n.count })),
		degraded: failures,
	});
	await saveRegistry(registry);
}

log(`hotovo za ${((Date.now() - started.getTime()) / 1000).toFixed(1)} s`);
