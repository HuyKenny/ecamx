/**
 * Catch-all pro cesty, na které neexistuje statický soubor.
 *
 * **Proč to je nejdůležitější route na webu:** do 19. 8. 2026 tady nebylo nic
 * a stránky modelek, které přestaly existovat, vracely tvrdou 404. Změřeno
 * v GSC: 729 z 837 stránek modelek, které kdy měly imprese, byla 404 — 2 185
 * z 2 474 impresí (89 %). A nebyla to jen historie: modelka pod prahem
 * `INDEX_MIN_DAYS` (5 878 z 8 168 živých) dostala stránku, dokud vysílala,
 * a v momentě, kdy skončila, se z URL stala 404 — `/live/shena-nomy/` zmizela
 * během dvou hodin. Google to čte jako nedůvěryhodný web; odtud „Crawled –
 * currently not indexed" u prakticky celého `/live/`.
 *
 * Statické soubory obsluhuje **assets layer PŘED Workerem**, takže se sem
 * dostane jen to, co soubor nemá. Když se modelka vrátí, její stránka je znovu
 * statický soubor a tahle route ji vůbec neuvidí.
 *
 * ⚠️ NESMÍ zastínit `/go/` ani `/api/` — to jsou vydělávající a datové routy
 * a mají vlastní, konkrétnější soubory. Astro dává přednost konkrétnější
 * routě, ale hlídá to i guard v CI („Verify /go/ redirects earn money").
 *
 * Viz docs/DECISIONS.md D35.
 */
import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { catchAll, type Assets } from '../lib/catch-all';

export const prerender = false;

/** Logic lives in `src/lib/catch-all.ts`; `/live/*` reaches it without Astro (`src/worker.ts`). */
export const GET: APIRoute = ({ url }) => catchAll(url, (workerEnv as unknown as { ASSETS?: Assets }).ASSETS);
