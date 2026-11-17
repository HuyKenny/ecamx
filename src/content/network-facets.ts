/**
 * Network × category pages, `/site/{network}/{facet}/` (D89).
 *
 * The biggest legal cam aggregator (lemoncams.com, ~4 M US visits/month) gets
 * most of its traffic from exactly this combination: "ebony chaturbate" 11k at
 * KD 0, "chaturbate men" 14k at KD 3, "chaturbate milf" 7.8k at KD 12. ecamx had
 * no such page, so the demand went to `/cams/{x}/` (all networks) or nowhere.
 *
 * `DEMAND` is copied from `reports/ecamx/content-gap-YYYY-MM.json` in the
 * workspace (`scripts/ecamx/content-gap.py`): summed US volume of the keywords
 * that map to the page. A demand-backed combination needs fewer live models to
 * get a page than a speculative one (see `networkFacetPages()` in `data.ts`).
 * Re-run the script and update this list; never invent volumes.
 */

/** Gender pages under a network. Slug in the URL → `Model.gender`. */
export const NETWORK_GENDERS: Record<string, { gender: string; label: string; noun: string }> = {
	men: { gender: 'male', label: 'Men', noun: 'male cams' },
	couples: { gender: 'couple', label: 'Couples', noun: 'couple cams' },
	trans: { gender: 'trans', label: 'Trans', noun: 'trans cams' },
};

/** Slugs under `/site/{network}/` that are other page types — never a facet. */
export const RESERVED_NETWORK_SUBPAGES = new Set(['alternatives', 'tokens']);

/**
 * Networks that also get speculative pages for every curated ("money")
 * category. The others only get demand-backed combinations — small inventories
 * would make thin pages (D23).
 */
export const NETWORKS_WITH_CURATED_MATRIX = ['chaturbate', 'stripchat', 'camsoda', 'bongacams'];

/** Minimum models in the build catalogue: with measured demand / without. */
export const MIN_MODELS_DEMAND = 6;
export const MIN_MODELS_SPECULATIVE = 15;

/** Measured demand, Ahrefs US, 2026-11-17 (lemoncams.com + chococams.com, KD ≤ 25). */
export const DEMAND: Array<{ net: string; slug: string; volume: number }> = [
	{ net: 'chaturbate', slug: 'men', volume: 25100 },
	{ net: 'chaturbate', slug: 'ebony', volume: 18800 },
	{ net: 'chaturbate', slug: 'milf', volume: 8800 },
	{ net: 'stripchat', slug: 'vr', volume: 8700 },
	{ net: 'chaturbate', slug: 'latin', volume: 8000 },
	{ net: 'chaturbate', slug: 'couples', volume: 6600 },
	{ net: 'chaturbate', slug: 'mature', volume: 4400 },
	{ net: 'chaturbate', slug: 'pregnant', volume: 2700 },
	{ net: 'stripchat', slug: 'men', volume: 2700 },
	{ net: 'stripchat', slug: 'indian', volume: 2300 },
	{ net: 'chaturbate', slug: 'hairy', volume: 2000 },
	{ net: 'stripchat', slug: 'ebony', volume: 1550 },
	{ net: 'camsoda', slug: 'ebony', volume: 1000 },
	{ net: 'chaturbate', slug: 'lesbian', volume: 900 },
	{ net: 'chaturbate', slug: 'new', volume: 900 },
	{ net: 'chaturbate', slug: 'indian', volume: 850 },
	{ net: 'stripchat', slug: 'chinese', volume: 800 },
	{ net: 'stripchat', slug: 'gay', volume: 700 },
	{ net: 'stripchat', slug: 'latin', volume: 700 },
	{ net: 'cam4', slug: 'latin', volume: 700 },
	{ net: 'chaturbate', slug: 'teen', volume: 700 },
	{ net: 'chaturbate', slug: 'redhead', volume: 450 },
	{ net: 'chaturbate', slug: 'asian', volume: 450 },
	{ net: 'camsoda', slug: 'couples', volume: 150 },
];
