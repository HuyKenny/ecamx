/**
 * Klientské čtení indexu `/search/idx.txt`.
 *
 * Formát a důvody, proč je textový a takhle úsporný, jsou v `search-index.ts`
 * (generátor). Tady je jen parser — a je **jediný**: čte ho `/finder/` i `/my/`.
 * Dvě kopie by se rozešly, což se v tomhle repu už jednou stalo u kanonizace
 * termů (`/cams/big-tits/` tvrdilo 1 103 a našlo 244, D24).
 *
 * Modul je čistě klientský: **nesmí importovat `data.ts`** (13 MB katalogu by
 * skončilo v bundlu) a nesmí nic renderovat.
 */

export interface IdxMeta {
	v: string;
	rows: number;
	nets: string[];
	netLabels: string[];
	gens: string[];
	cc: string[];
	ccNames: string[];
	/** Skupiny řádků se stejným nickem na víc sítích. */
	tw: number[][];
	/** Řádek → `page`, když se nedá odvodit slugifikací nicku. */
	ov: Record<string, string>;
}

export interface Idx {
	meta: IdxMeta;
	/** Nick i-tého řádku. */
	nick(row: number): string;
	/** URL slug stránky i-tého řádku. */
	page(row: number): string;
	network(row: number): string;
	networkLabel(row: number): string;
	gender(row: number): string;
	/** Název země, nebo prázdný řetězec. */
	country(row: number): string;
	/** ISO kód země (pro filtry), nebo prázdný řetězec. */
	countryCode(row: number): string;
	/** Věk, nebo 0 když ho síť nehlásí. */
	age(row: number): number;
	/** Byla online v posledním syncu (build-time stav, ne živý). */
	onlineAtBuild(row: number): boolean;
	/** Řádky se stejným nickem na jiných sítích. */
	twins(row: number): number[];
	/** Řádek podle `page`, nebo -1. */
	rowOfPage(page: string): number;
	/** Řádek podle pozice v blobu — pro substringové hledání. */
	rowAtOffset(offset: number): number;
	/** Blob nicků malými písmeny; hledá se v něm přes `indexOf`. */
	lower: string;
	/** Začátky řádků v blobu. */
	starts: Int32Array;
	/**
	 * Surové sloupce (4 B na řádek: síť | gender/online/suffix | země | věk). Vystaveno schválně: filtrační průchod
	 * `/finder/` jde přes 16 000 řádků a volání metody na řádek je tam zbytečná
	 * daň. Bitový layout je popsaný v `search-index.ts`; kdo ho mění, mění ho
	 * na jednom místě a musí projít oba čtenáře.
	 */
	cols: Uint8Array;
}

/** Tentýž slugify jako sync a generátor indexu. */
export function slugifyNick(s: string): string {
	return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
}

/**
 * Stáhne a rozparsuje index. Vyhodí, když se to nepovede — volající to má
 * degradovat tiše (stránka musí fungovat i bez indexu).
 */
export async function loadIndex(timeoutMs = 15000): Promise<Idx> {
	const res = await fetch('/search/idx.txt', { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const text = await res.text();
	const first = text.indexOf('\n');
	const last = text.lastIndexOf('\n', text.length - 2);
	const meta = JSON.parse(text.slice(0, first)) as IdxMeta;
	const blob = text.slice(first + 1, last + 1);
	const lower = blob.toLowerCase();
	const cols = Uint8Array.from(atob(text.slice(last + 1).trim()), (c) => c.charCodeAt(0));

	const starts = new Int32Array(meta.rows + 1);
	let at = 0;
	for (let i = 0; i < meta.rows; i++) {
		starts[i] = at;
		at = blob.indexOf('\n', at) + 1;
	}
	starts[meta.rows] = at;

	const twinOf = new Int32Array(meta.rows);
	meta.tw.forEach((group, gi) => { for (const r of group) twinOf[r] = gi + 1; });

	const nick = (row: number) => blob.slice(starts[row], starts[row + 1] - 1);
	const network = (row: number) => meta.nets[cols[row * 4]];
	const page = (row: number) => {
		const ov = meta.ov[String(row)];
		if (ov) return ov;
		const s = slugifyNick(nick(row));
		return (cols[row * 4 + 1] & 1) ? `${s}-${network(row)}` : s;
	};

	// Mapa page → řádek se staví líně: `/finder/` ji nepotřebuje vůbec,
	// `/my/` jen pro pár desítek nicků.
	let byPage: Map<string, number> | null = null;

	return {
		meta,
		lower,
		starts,
		cols,
		nick,
		page,
		network,
		networkLabel: (row) => meta.netLabels[cols[row * 4]],
		gender: (row) => meta.gens[(cols[row * 4 + 1] >> 2) & 7],
		country: (row) => {
			const ci = cols[row * 4 + 2];
			return ci ? meta.ccNames[ci - 1] : '';
		},
		countryCode: (row) => {
			const ci = cols[row * 4 + 2];
			return ci ? meta.cc[ci - 1] : '';
		},
		age: (row) => cols[row * 4 + 3] & 0x7f,
		onlineAtBuild: (row) => ((cols[row * 4 + 1] >> 1) & 1) === 1,
		twins: (row) => {
			const g = twinOf[row];
			return g ? meta.tw[g - 1].filter((r) => r !== row) : [];
		},
		rowOfPage: (target) => {
			if (!byPage) {
				byPage = new Map();
				for (let r = 0; r < meta.rows; r++) byPage.set(page(r), r);
			}
			return byPage.get(target) ?? -1;
		},
		rowAtOffset: (offset) => {
			let lo = 0, hi = meta.rows - 1;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
			}
			return lo;
		},
	};
}
