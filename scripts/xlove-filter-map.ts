/**
 * XLoveCam kóduje všechno do čísel. Online feed (`model/listonline`) posílá
 * `category`, `tagList` a `language_speak` jako číselné ID bez jakéhokoli
 * překladu, takže bez téhle mapy nejde z XLoveCamu vytáhnout ani gender.
 *
 * **Následek, než mapa existovala:** všech 432 modelek mělo `gender: null`,
 * `tags: []` a `languages: []`. `modelsInCategory()` filtruje podle tagů
 * a gender stránky podle genderu → XLoveCam se objevil **jedině na homepage**
 * a na 325 filtrovaných stránkách nebyl vůbec. A je to spolu s LiveJasminem
 * nejlépe platící síť v portfoliu.
 *
 * `cam-networks.ts` na tenhle soubor odkazoval komentářem, ale v repu nikdy
 * nebyl. Zdroj hodnot: starý WordPress plugin `plugincams`, soubor
 * `includes/crons/xlove_filter_map.php` (+ jazyková mapa z
 * `class-cron-xlove.php`), vytaženo 17. 8. 2026 ze zálohovaného VPS.
 * Ověřeno proti živému feedu: všech 10 kódů `category`, které feed vrací,
 * je v mapě pokryto.
 *
 * POZOR: mapy `hair`, `ethnie`, `body_apparencetype` a `bra` z pluginu tady
 * schválně nejsou — online feed ta pole vůbec neposílá, byly by to mrtvé řádky.
 * Zemi XLoveCam nehlásí nijak (plugin ji taky nikde nebral).
 */

/** Číselná kategorie → náš normalizovaný gender. */
export const XLOVE_GENDER: Record<number, string> = {
	1: 'female',   // Young women
	13: 'female',  // Ladies
	6: 'female',   // Mature female
	3: 'female',   // Lesbians
	4: 'female',   // Fetish female
	2: 'couple',   // Couples
	9: 'couple',   // Male couples
	10: 'group',   // Threesome
	11: 'group',   // Foursome
	5: 'trans',    // Transsexual
	12: 'trans',   // Transsexual couples
	7: 'male',     // Male
};

/**
 * Kategorie jako tag. `tagList` je vyplněný jen u ~12 % modelek, ale `category`
 * má každá — tohle je tedy jediná cesta, jak dostat zbytek do `/cams/`.
 * Bereme jen ty, které odpovídají skutečné kategorii u nás; „Young women"
 * a „Male" jsou gender, ne kategorie, takže se sem nedávají.
 */
export const XLOVE_CATEGORY_TAG: Record<number, string> = {
	13: 'ladies',
	6: 'mature',
	3: 'lesbian',
	4: 'fetish',
	10: 'threesome',
	11: 'foursome',
	12: 'trans',
};

/** `tagList` → název tagu. Vyplněné u ~12 % modelek, ale kde je, je bohaté. */
export const XLOVE_TAGS: Record<number, string> = {
	1: '69', 2: 'Anal Sex', 3: 'Closeup', 4: 'Sex Toys', 6: 'Femdom',
	7: 'Fetish', 8: 'Gymnast', 9: 'Heels', 10: 'Hairy', 11: 'Latex',
	12: 'Leather', 13: 'Live Orgasm', 14: 'Love Balls', 15: 'Massage',
	16: 'Masturbation', 17: 'Moaning', 18: 'Nurse', 19: 'Nylon', 20: 'Oil',
	21: 'Oral', 22: 'Panties', 23: 'Pantyhose', 25: 'Piercings',
	26: 'Pornstar', 27: 'Secretary', 28: 'Shower', 29: 'Buttplug',
	30: 'MILF', 31: 'Foot', 32: 'Spanking', 33: 'Squirting', 34: 'Stockings',
	35: 'Submissive', 36: 'Tattoo', 37: 'Uniform', 38: 'Vibrator',
	39: 'Zoom Cam', 40: 'Sound Chat', 41: 'Anilingus', 42: 'Armpits',
	43: 'Big Penis', 44: 'Boots', 46: 'Exhibitionism', 47: 'Fur',
	48: 'Hair Colour', 49: 'Hairy Men', 51: 'Legs', 52: 'Muscles',
	53: 'Older Men', 54: 'Rubber', 55: 'Shoes', 56: 'Small Penis',
	57: 'Tickling', 58: 'Transvestite', 59: 'Underwear', 60: 'Voyeurism',
	61: 'Cunnilingus', 62: 'Squirting', 63: 'Strap-on dildo',
};

/** `language_speak` → jazyk. Feed posílá „0, 1, 2" jako řetězec. */
export const XLOVE_LANGUAGES: Record<number, string> = {
	0: 'English', 1: 'French', 2: 'German', 3: 'Spanish',
	4: 'Italian', 5: 'Dutch', 6: 'Portuguese',
};

/** „0, 1, 2" nebo [0,1,2] → jména podle mapy; neznámé kódy se zahodí. */
export function xloveDecode(raw: unknown, map: Record<number, string>): string[] {
	const ids = Array.isArray(raw)
		? raw
		: String(raw ?? '').split(',');
	const out: string[] = [];
	for (const id of ids) {
		const n = typeof id === 'number' ? id : parseInt(String(id).trim(), 10);
		const name = Number.isFinite(n) ? map[n] : undefined;
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}
