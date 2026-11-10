/**
 * Rozměry stránkovaných mřížek. Vlastní modul schválně: `getStaticPaths()` běží
 * v izolovaném rozsahu a na proměnné z frontmatteru nedosáhne — importy ano.
 *
 * `size` je blok modelek na jednu URL, `visible` kolik je jich vidět; zbytek je
 * rezerva, ze které klientský kód dopočítává mřížku, když nějakou kartu zhasne
 * kvůli offline stavu (viz [data-grid] v Layout.astro). Bloky jsou disjunktní,
 * takže se odkazy mezi stránkami neopakují.
 */
export interface GridSize {
	size: number;
	visible: number;
	/**
	 * Nejvyšší číslo stránky, které se vůbec vygeneruje.
	 *
	 * Stránkování mřížek stálo 1 688 souborů z ~18 700 — a **za 28 dní ho
	 * navštívili čtyřikrát** (změřeno v GA4; zbytek zobrazení `/page/N/` byly
	 * legacy WP adresy z přesměrování). Přitom crawl cestu ke stránkám modelek
	 * nenese stránkování, ale textový adresář `/models/` (D33), který zvládne
	 * 250 odkazů na stránku místo 60.
	 *
	 * Ty soubory chybí jinde: strop `MAX_MODEL_PAGES` vyhazoval **851
	 * archivních stránek S MĚŘENOU POPTÁVKOU**, tedy URL, které v Bingu reálně
	 * vydělávají (D53). Výměna hluboké stránky, kam nikdo nechodí, za stránku,
	 * kterou někdo hledá, je jednosměrná. Tři stránky na fasetu = 540 karet
	 * do hloubky, což na ruční procházení bohatě stačí. Viz D64.
	 */
	maxPages: number;
}

/** Kolik stránek mřížky se nejvýš vygeneruje (viz `GridSize.maxPages`). */
export const MAX_GRID_PAGES = 3;

/** Kategorie, země, gender, homepage — stejné jako stránka 1 (VISIBLE * 3). */
export const GRID: GridSize = { size: 180, visible: 60, maxPages: MAX_GRID_PAGES };

/**
 * Homepage měla do 28. 8. **poloviční rezervu** (120 = 60 viditelných + 60):
 * změřeno 19. 8. (mobil, 4× CPU throttle, slow 4G) mělo 180 karet TBT
 * **2 280 ms** proti 1 199 ms na kategorii, a homepage je nejnavštěvovanější
 * stránka webu.
 *
 * Jenže od D65 se staví 4× denně místo 12× a rezerva 1:1 na to nestačí:
 * na 40 minut starém buildu bylo **všech 63 karet v rezervě potvrzeně
 * offline**, mřížka spadla na 57 z 60 a CamSoda z ní zmizela úplně. Karty
 * mezitím zhubly (odznaky a `data-*` se od té doby škrtaly), takže naměřený
 * TBT homepage je dnes 679 ms — prostor na plnou rezervu tam je.
 * Kdo tohle číslo zvedá dál, ať znovu změří TBT, ne aby se opíral o tenhle
 * odstavec. Viz D65.
 */
export const HOME_GRID: GridSize = { size: 180, visible: 60, maxPages: MAX_GRID_PAGES };

/** Stránky sítí mají na stránce 1 užší mřížku (VISIBLE = 40). */
export const NETWORK_GRID: GridSize = { size: 120, visible: 40, maxPages: MAX_GRID_PAGES };

/**
 * Odkazů na stránku abecedního adresáře `/models/{písmeno}/`. Textové odkazy,
 * takže 250 je ~20 kB — u karet by to byla čtvrtmegabajtová stránka.
 * Čte to i sitemapa, proto to není konstanta uvnitř šablony.
 */
export const DIRECTORY_SIZE = 250;

/** Kolik stránek zabere `total` položek. Nikdy méně než 1. */
export function pageCount(total: number, size: number): number {
	return Math.max(1, Math.ceil(total / size));
}

/**
 * Totéž pro MŘÍŽKY — se stropem z `GridSize`. Adresáře (`/models/`) tenhle
 * strop nemají a mít nesmí: jsou to jediné trvalé crawl cesty ke stránkám
 * modelek (D33), takže se použije `pageCount()`.
 */
export function gridPageCount(total: number, grid: GridSize): number {
	return Math.min(pageCount(total, grid.size), grid.maxPages);
}
