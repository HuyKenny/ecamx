/**
 * Statický index pro `/finder/`. Vzniká při buildu, ne v syncu — je to čistá
 * funkce nad `src/data/*.json`, takže jede ze **stejného zdroje pravdy jako
 * stránky** a nemůže se s nimi rozejít (poučení D24: dvě kopie kanonizace se
 * rozešly a `/cams/big-tits/` tvrdilo 1 103, ale našlo 244).
 *
 * **Stabilní cesta, žádný hash v názvu.** Sync deployuje 12× denně a roster se
 * pokaždé mění, takže hashovaná URL by znamenala 12 nových URL denně a **nulové
 * znovupoužití cache** — přesně to, co má hash řešit, jen naruby. Cachování
 * řeší `public/_headers` (`max-age=900, stale-while-revalidate`) a ETag, který
 * přidává assets layer; když se mezi syncy nic nezmění, je opakovaná návštěva
 * 304 zdarma a bez Workeru.
 */
import type { APIRoute } from 'astro';
import { buildSearchIndex } from '../../lib/search-index';

export const GET: APIRoute = () => {
	const { text, stats } = buildSearchIndex();
	// Do logu buildu, ať je vidět, když index nečekaně nafoukne nebo se scvrkne.
	console.log(
		`[search-index] ${stats.rows} řádků, ${(stats.bytes / 1024).toFixed(0)} kB, ` +
		`${stats.countries} zemí, ${stats.twinGroups} skupin dvojčat, ${stats.overrides} override`
	);
	return new Response(text, {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
};
