/**
 * Popisky sítí, zemí a faset — malý modul bez katalogu.
 *
 * Bydlí mimo `data.ts`, protože je potřebuje i kód, který si 13 MB katalogu
 * dovolit nemůže: dynamické stránky ve Workeru (SSR profil, D82) a klientský
 * render karet (`src/lib/card.ts`). `data.ts` je jen reexportuje.
 */

export const NETWORK_LABELS: Record<string, string> = {
	chaturbate: 'Chaturbate', camsoda: 'CamSoda', cam4: 'Cam4',
	amateur: 'Amateur.tv', bongacams: 'BongaCams',
	xlovecam: 'XLoveCam', livejasmin: 'LiveJasmin',
	stripchat: 'Stripchat', streamate: 'Streamate', imlive: 'ImLive',
};

/**
 * ISO kód → název země.
 *
 * **Musí pokrývat všechno, co umí vrátit `canonicalCountry()`, ne jen dnešní
 * stránky.** Do 19. 8. tu bylo 28 zemí „těch, které reálně máme" — a jakmile
 * pokrytí Chaturbate vyskočilo a zemí bylo 29, dostaly nové stránky do H1
 * „Live Cams from EE" (`countryName` padá na velký kód). Práh 20 modelek se
 * hýbe každé 2 hodiny; seznam názvů se hýbat nesmí.
 */
export const COUNTRY_NAMES: Record<string, string> = {
	co: 'Colombia', us: 'United States', ph: 'Philippines', fr: 'France',
	ua: 'Ukraine', de: 'Germany', ke: 'Kenya', ro: 'Romania', es: 'Spain',
	mg: 'Madagascar', gb: 'United Kingdom', it: 'Italy', ar: 'Argentina',
	br: 'Brazil', ru: 'Russia', ca: 'Canada', pl: 'Poland', ve: 'Venezuela',
	cl: 'Chile', mx: 'Mexico', nl: 'Netherlands', in: 'India', za: 'South Africa',
	au: 'Australia', tw: 'Taiwan', cz: 'Czechia', hu: 'Hungary', pt: 'Portugal',
	lv: 'Latvia', ee: 'Estonia', lt: 'Lithuania', rs: 'Serbia', be: 'Belgium',
	fi: 'Finland', se: 'Sweden', no: 'Norway', dk: 'Denmark', ie: 'Ireland',
	ch: 'Switzerland', at: 'Austria', gr: 'Greece', bg: 'Bulgaria', hr: 'Croatia',
	si: 'Slovenia', sk: 'Slovakia', by: 'Belarus', md: 'Moldova', ge: 'Georgia',
	am: 'Armenia', az: 'Azerbaijan', kz: 'Kazakhstan', kg: 'Kyrgyzstan',
	uz: 'Uzbekistan', mn: 'Mongolia', tr: 'Turkey', il: 'Israel', cy: 'Cyprus',
	mt: 'Malta', is: 'Iceland', lu: 'Luxembourg', mc: 'Monaco', me: 'Montenegro',
	al: 'Albania', mk: 'North Macedonia', ba: 'Bosnia and Herzegovina',
	pe: 'Peru', ec: 'Ecuador', bo: 'Bolivia', py: 'Paraguay', uy: 'Uruguay',
	cr: 'Costa Rica', pa: 'Panama', do: 'Dominican Republic', pr: 'Puerto Rico',
	cu: 'Cuba', jm: 'Jamaica', ht: 'Haiti', hn: 'Honduras', gt: 'Guatemala',
	ni: 'Nicaragua', sv: 'El Salvador', tt: 'Trinidad and Tobago',
	ng: 'Nigeria', gh: 'Ghana', ug: 'Uganda', tz: 'Tanzania', zm: 'Zambia',
	zw: 'Zimbabwe', cm: 'Cameroon', ci: 'Ivory Coast', sn: 'Senegal',
	et: 'Ethiopia', eg: 'Egypt', ma: 'Morocco', tn: 'Tunisia', dz: 'Algeria',
	jp: 'Japan', cn: 'China', kr: 'South Korea', hk: 'Hong Kong', sg: 'Singapore',
	th: 'Thailand', vn: 'Vietnam', id: 'Indonesia', my: 'Malaysia',
	nz: 'New Zealand', pk: 'Pakistan', bd: 'Bangladesh', lk: 'Sri Lanka',
	np: 'Nepal', ir: 'Iran', iq: 'Iraq', lb: 'Lebanon', jo: 'Jordan',
	sa: 'Saudi Arabia', ae: 'United Arab Emirates',
};

/**
 * Hezčí názvy tam, kde kanonický slug není to, co lidé hledají.
 * `latin` je kanonická etnicita, ale dotaz zní „latina cams".
 */
export const FACET_LABEL_OVERRIDES: Record<string, string> = {
	latin: 'Latina',
	// `black` a `brown` jsou BARVY VLASŮ, ne etnicita ani nic jiného. Bez tohohle
	// si „Black" kanibalizovalo `/cams/ebony/` (dotaz „black cam girls" je etnický,
	// 400/měs) a „Brown" nedávalo smysl vůbec.
	black: 'Black Hair',
	brown: 'Brown Hair',
	// „nude cams" má 5 100 hledání/měs při **KD 0**, „naked cams" 1 100 při
	// **KD 81** (Ahrefs, US, 19. 8.) — stejná kategorie, desetkrát jiná šance.
	// Slug `/cams/naked/` zůstává (URL nemá cenu měnit kvůli slovu), titulek
	// a H1 ale musí říkat to, co lidi opravdu hledají.
	naked: 'Nude',
	'white-caucasian': 'White',
	'middle-eastern': 'Middle Eastern',
	hd: 'HD',
	bbw: 'BBW',
	bigass: 'Big Ass',
	'big-tits': 'Big Tits',
};

export function facetLabel(slug: string, fallback: string): string {
	return FACET_LABEL_OVERRIDES[slug] ?? fallback;
}

export function countryName(code: string): string {
	return COUNTRY_NAMES[code] ?? code.toUpperCase();
}
