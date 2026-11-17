/**
 * Tvar živého snímku (D82) — sdílí ho cron Worker (zápis) i web (čtení).
 * Čistý modul bez `cloudflare:workers`, aby šel importovat odkudkoli.
 */
export const SNAPSHOT_KEY = 'live-snapshot';

/** Jeden řádek snímku. Krátké klíče — snímek čte každý isolate webu. */
export interface LiveRec {
	/** síť */
	n: string;
	/** username u sítě (kapitalizace, jde do přehrávače i `/go/`) */
	u: string;
	/** slug (`slugify(username)`) — páruje se s katalogem */
	s: string;
	/** cesta stránky bez `/live/` a lomítek: `slug` nebo `slug-síť` */
	p: string;
	/** 1 = statická stránka existuje (jinak ji obslouží SSR) */
	st?: 1;
	/** diváci; chybí u sítí, které je nehlásí */
	v?: number;
	/** náhled */
	t: string;
	/** záložní náhled (Cam4) */
	tf?: string;
	g?: string;
	a?: number;
	/** země (kanonický kód) */
	c?: string;
	h?: 1;
	nw?: 1;
	ty?: 1;
	/** 1 = placená/soukromá show */
	pr?: 1;
	/** embedRef (Streamate ID, ImLive URL, HLS Cam4/BongaCams) */
	e?: string;
	/** room subject, zkrácený */
	j?: string;
	/** MP4 náhled (CamSoda) */
	pv?: string;
	/** jak dlouho vysílá (s) */
	os?: number;
	/** fasety: `t:tag`, `e:`, `h:`, `b:`, `m:money`, `c:země`, `g:gender` */
	f: string[];
	/** jazyky (kanonické) */
	l?: string[];
}

export interface NetState {
	ok: boolean;
	/** čas posledního ÚSPĚŠNÉHO stažení (ms) */
	ts: number;
	count: number;
	/** krátký důvod selhání (bez URL — v ní jsou klíče) */
	err?: string;
}

export interface Snapshot {
	v: 1;
	ts: number;
	nets: Record<string, NetState>;
	m: LiveRec[];
}

/** Nad tímhle stářím (snímku nebo posledního úspěchu sítě) „nevíme". */
export const FRESH_MS = 15 * 60_000;

/** Síť má úplný a čerstvý seznam → chybějící modelka opravdu nevysílá. */
export function isFresh(snap: Snapshot, network: string, now = Date.now()): boolean {
	const n = snap.nets[network];
	return !!n && n.ok && now - snap.ts < FRESH_MS && now - n.ts < FRESH_MS;
}
