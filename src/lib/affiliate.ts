/**
 * Affiliate URL — embed do iframu a deeplink pro CTA.
 *
 * Volá se JEN při buildu (statické stránky).
 * Affiliate ID nejsou tajemství — končí ve veřejné URL — ale do repa nepatří,
 * ať se dají rotovat bez commitu. Zdroj: credentials/.ecamx-credentials.env.
 *
 * Tohle je jediná věc na webu, která vydělává. Když se rozbije, web funguje
 * dál a nikdo si toho nevšimne → proto `assertAffiliateEnv()` v buildu.
 */
import type { NetworkId } from './data';

/**
 * Čtení affiliate ID. Existují dvě cesty a obě jsou potřeba:
 *
 *  – **při buildu** z `import.meta.env` s prefixem `PUBLIC_`, protože
 *    prerenderer @astrojs/cloudflare běží ve workerd sandboxu bez `process.env`,
 *  – **za běhu** ve Workeru (route `/go/`) z Worker secrets, tedy z názvů
 *    BEZ prefixu.
 *
 * Proto berou všechny buildery `env` jako parametr s build-time výchozí
 * hodnotou. Jinak by musela vzniknout druhá sada builderů — a jedna taková
 * duplicitní sada v `scripts/cam-networks.ts` už je a jen se plete.
 */
export type EnvGet = (key: string) => string;

const buildEnv: EnvGet = (k) =>
	(import.meta.env as Record<string, string | undefined>)[`PUBLIC_${k}`] ?? '';

/**
 * Odkud klik odešel. Bez tohohle nejde poznat, jestli vydělává karta v mřížce,
 * tlačítko pod přehrávačem nebo nabídka na offline stránce — a tedy ani co
 * ladit. Posílá se tam, kde to síť umí přijmout (Chaturbate `track`,
 * LiveJasmin `params[utm_content]`); ostatní sítě subid v affiliate URL nemají.
 */
export type Placement =
	| 'card' | 'grid' | 'profile' | 'player' | 'offline' | 'network' | 'finder' | 'watchlist'
	// Lepivý pásek na mobilu (D58). Měří se zvlášť, aby se za týden dalo říct,
	// jestli vydělal — dnes nese stránka modelky 22 z 32 prokliků.
	| 'sticky'
	// Záchranná karta: modelka, kterou klient dotáhl ze živého feedu, protože
	// karty z buildu už nevysílaly. Nemá u nás stránku, takže klik jde rovnou
	// do pokoje — a musí se dát odlišit od běžné karty, aby šlo změřit, kolik
	// prokliků vzniklo právě takhle. Viz D67.
	| 'rescue';

/**
 * Chaturbate vybírá program podle parametru `tour`, ne podle nastavení účtu.
 * `LQps` = revshare chat (20 % z utracených tokenů trvale), `yiMH` = PPS.
 * Kenny chce příjem z dýšek → revshare. Přepnutí = prohodit konstantu.
 *
 * POZOR: env `CHATURBATE_TOUR` obsahovala `rev`, což NENÍ platný kód a
 * Chaturbate ho ignoroval → odkazy padaly na výchozí program účtu. Proto se
 * tour bere odsud a ne z env.
 */
const CB_TOUR_LINK = 'LQps';

/**
 * Offer ID v CrakRevenue tracking URL. Není to tajemství (je ve veřejné URL),
 * ale je to jediné místo, kde ho web má — druhá kopie je v `cam-networks.ts`
 * jen pro kontrolu proti feedu, a `auditEarnings` je porovnává.
 */
const CRAK_OFFER: Record<'stripchat' | 'streamate' | 'imlive', string> = {
	stripchat: '4247',
	streamate: '3941',
	imlive: '3923',
	// MyFreeCams (offer 3648) je vypnutý od 26. 8. 2026: **nabídka ignoruje
	// `model=`** a všechny nicky končí na `myfreecams.com/?cam=30352`. Ověřeno
	// na třech modelkách i na URL vzaté přímo z jejich feedu, takže to není naše
	// skládanina. Vracet to zpátky až po ověření, že offer model respektuje.
	// Viz D59.
};

/**
 * ⚠️ PŘEHRÁVAČ A CTA MUSÍ ZŮSTAT NA JINÝCH URL. Nesjednocovat!
 *
 * Chaturbate přiřadí provizi JEDINĚ přes `/in/` — ověřeno 16. 8. 2026 podle
 * cookies `fromaffiliate` + `in_hit`:
 *
 *   /{room}/?campaign=…            → 200, 0 affiliate cookies
 *   /embed/{room}/?campaign=…      → 200, 0 affiliate cookies
 *   /in/?tour=…&campaign=&room=…   → 302, 2 affiliate cookies  ✓
 *
 * Jenže `||chaturbate.com/in/` je v EasyList, a Chrome podle filtrovacího
 * seznamu označí takový iframe za reklamu. Živý stream pak spolehlivě překročí
 * limit 4 MB a **Chrome ho sám odstraní** (Heavy Ad Intervention) — místo
 * streamu zůstane „Tato reklama používala příliš mnoho zdrojů". Přesně to se
 * 16. 8. stalo, když jsem embed na `/in/` přepsal.
 *
 * Řešení: rozdělit roli.
 *   – embed  → `/embed/{room}/`, na žádném seznamu není, přehrávač žije všem.
 *              Provizi nepřiřazuje, ale nepřiřazoval ji nikdy — a s `/in/`
 *              by nebyl ani stream, ani provize.
 *   – CTA    → `/in/`, protože jen to vydělává. Uživatelům s blokátorem se
 *              tlačítko skryje (`##a[href^="https://chaturbate.com/in/?"]`)
 *              a je to daň affiliate modelu, kterou vědomě neobcházíme.
 *
 * Viz docs/DECISIONS.md D13.
 */

/**
 * LiveJasmin čeká klíče `params[psid]` DOSLOVA — `URLSearchParams` by z nich
 * udělalo `params%5Bpsid%5D` a tracking by přestal fungovat. Kóduje se tedy
 * jen hodnota, klíč zůstává syrový (stejně to dělal i původní plugin).
 */
function rawBracketQuery(pairs: Array<[string, string]>): string {
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/**
 * First-party odkaz na odchozí přesměrování. **Tohle patří do šablon**, ne
 * `deepLink()` — viz `src/pages/go/[network]/[user].ts`, proč: affiliate klíč
 * nezůstane ve veřejném HTML, placement dojde u všech sítí a HTML je menší.
 */
export function goLink(network: NetworkId, username: string, placement: Placement = 'card'): string {
	return `/go/${network}/${encodeURIComponent(username)}/?p=${placement}`;
}

/**
 * Náhledový player. `widget:` prefix znamená, že to není iframe (Amateur.tv).
 *
 * `ref` je `Model.embedRef` — potřebují ho jen sítě z CrakRevenue, kde nick na
 * sestavení URL nestačí (Streamate má v URL číselné ID, ImLive náhodné UUID).
 * Když chybí, přehrávač se vynechá: prázdný rámec je horší než poster s CTA.
 */
export function embedUrl(
	network: NetworkId,
	username: string,
	env: EnvGet = buildEnv,
	ref?: string | null,
): string {
	const u = encodeURIComponent(username);
	switch (network) {
		// NE `/in/` — viz komentář výše. Chrome by iframe označil za reklamu
		// a po překročení 4 MB ho odstranil.
		case 'chaturbate': {
			// `embed_video_only=1` — VĚDOMÉ ROZHODNUTÍ, ne úspora bajtů.
			//
			// Bez něj je v iframu celý pokoj Chaturbate: chat, SEND TIP, PM,
			// Cam To Cam, Start Private Show, „Purchase Tokens". Změřeno
			// 18. 8.: 7 odkazů a 40+ klikatelných prvků. A `/embed/` NENASTAVÍ
			// affiliate cookie — ověřeno se `campaign`, s `campaign` + `tour`
			// i s `embed_video_only`: odpověď pošle jen `csrftoken`, `sbr`,
			// `__cf_bm`, a slovo `campaign` se v HTML embedu ani neobjeví.
			// Cookie dává jedině `/in/` (viz komentář výše a D13).
			//
			// Takže každý klik uvnitř přehrávače končil na
			// `/auth/login/?next=/{room}/` BEZ provize — a je to ten nejsilnější
			// klik na webu. Nepřihlášený návštěvník tam chatovat ani tipovat
			// nemůže; jediné, co ten chat dělá, je že ho Chaturbate převezme
			// zdarma. S tímhle parametrem zůstane v rámci jen video (ověřeno:
			// 0 chat / 0 tip / 0 PM prvků) a klik do plochy jde přes naši
			// klikací vrstvu na `/go/`. Viz D34.
			//
			// `show_avatars` odešlo s chatem — bez chatu nemá co dělat.
			const q = new URLSearchParams({
				embed_video_only: '1',
				campaign: env('CHATURBATE_AFFILIATE'),
				bgcolor: 'black',
			});
			return `https://chaturbate.com/embed/${u}/?${q}`;
		}
		case 'camsoda':
			return `https://www.camsoda.com/${u}/iframe?id=${encodeURIComponent(env('CAMSODA_AFFILIATE'))}`;
		// `/{nick}/embed`, NE `/en/embed/{nick}`. Ta druhá cesta vrací **404
		// u všech modelek včetně právě vysílajících** (ověřeno 18. 8. na osmi,
		// z toho čtyřech živých) — Cam4 na ní servíruje výpis kategorií, takže
		// se ~1 000 stránkám modelek do přehrávače nahrávalo 120 kB cizí
		// chybové stránky. `/{nick}/embed` je jejich skutečný embed: hraje,
		// má vlastní ovládání a u offline modelky řekne „I'm currently offline".
		// (Starý plugin tu měl relativní "/en/embed/…", které prohlížeč
		// resolvoval na ecamx.com — proto absolutní URL.)
		// Nick zmenšený ze stejného důvodu jako u BongaCams: `/Pinkloving/embed`
		// 301-uje na `/pinkloving/embed`, což je hop navíc v přehrávači.
		/**
		 * **Cam4 taky nejede přes rámec, ale přes VLASTNÍ přehrávač.**
		 *
		 * Kenny 30. 8.: „cam4 když kliknu na /live/ tak mi to píše Tento obsah
		 * je blokován." Z Maliny to nešlo zopakovat ani na 14 modelkách (rámec
		 * se načetl, `www.cam4.com` není na EasyListu ani EasyPrivacy a Cam4
		 * neposílá X-Frame-Options), takže to blokuje něco u návštěvníka —
		 * a proti tomu se rámcem bránit nedá.
		 *
		 * Jejich feed ale u 286 z 300 modelek posílá `preview_url`, což je
		 * plnohodnotný živý HLS playlist (změřeno: 1280×720, avc1+mp4a,
		 * `access-control-allow-origin: *`, segmenty 665 kB). Na `<video>`
		 * blokovací pravidla na `$subdocument` neplatí a host je
		 * `stackvaults-hls.xcdnpro.com`, tedy ani jménem nepřipomíná cam4.
		 *
		 * Vedle toho to spraví i díru v provizi: jejich `/{nick}/embed`
		 * **nenese žádné affiliate ID** (na rozdíl od odchozího odkazu, který
		 * má `sid`/`aid`/`rp`), takže klik uvnitř rámce nevydělal nic. Nad
		 * vlastním `<video>` leží `.player-hit`, který klik pošle přes `/go/`.
		 *
		 * Bez adresy (14 z 300) zůstává rámec — pořád lepší než prázdno.
		 * Viz D70.
		 */
		case 'cam4':
			return ref
				? `hls:${ref}`
				: `https://www.cam4.com/${encodeURIComponent(username.toLowerCase())}/embed`;
		/**
		 * **BongaCams nejede přes iframe, ale přes VLASTNÍ přehrávač.** Rámec
		 * z jejich domény je od 26. 8. 2026 na EasyListu
		 * (`||bongacams.com^$subdocument,third-party`), takže by ho Chrome
		 * označil za reklamu a po 4 MB přenosu sám odstranil (Heavy Ad
		 * Intervention, D13) — a guard `check-blocklists.ts` by správně zastavil
		 * deploy. Zrcadla to neřeší (past 70).
		 *
		 * Jejich feed ale u KAŽDÉ modelky posílá `stream_feed_url`, tedy HLS
		 * playlist na `bcvcdn.com` (změřeno 27. 8.: 1 293 z 1 293 záznamů,
		 * HTTP 200 bez jakýchkoli hlaviček, `access-control-allow-origin: *`,
		 * kvality 240p/480p/720p). Na `<video>` neplatí `$subdocument` ani
		 * Heavy Ad Intervention a `bcvcdn.com` na blokovacích seznamech není.
		 * Adresu nese `ref` (`Model.embedRef`, plní ho sync) — **odvodit z nicku
		 * se NEDÁ**, shard hostů je 34 a cizí shard vrací 404.
		 *
		 * Prázdný návrat (modelka bez adresy) = stránka ukáže náhled a CTA
		 * (`hasPlayer` v `live/[slug].astro`), tedy stav do 27. 8. Viz D62.
		 */
		case 'bongacams':
			return ref ? `hls:${ref}` : '';
		case 'xlovecam':
			return `https://www.xlovecam.com/prm03/chat?id_affilie=${encodeURIComponent(env('XLOVE_AFFILIATE_ID'))}&psm=${u}`;
		case 'livejasmin':
			return 'https://ptcdw.com/live-stream/?' + rawBracketQuery([
				['psid', env('LIVEJASMIN_USERID')],
				['siteId', 'jsm'],
				['pageName', 'freechat'],
				['performerName', username],
				['params[psid]', env('LIVEJASMIN_USERID')],
				['params[pstool]', '202_1'],
				['params[psprogram]', env('LIVEJASMIN_PSPROGRAM') || 'revs'],
				['embedTool', '1'],
				['lang', 'en'],
				['forcedPerformers[]', username],
			]);
		// ── sítě přes CrakRevenue ────────────────────────────────────────────
		// Hosty ověřené proti EasyListu 25. 8. 2026: `suaplf.live` na seznamech
		// není, u `naiadsystems.com` je blokovaná jen cesta `/api/v1/xment/`,
		// ne `purecam`. Hlídá dál `scripts/check-blocklists.ts` — kdyby se to
		// změnilo, build padne (past 13).
		//
		// **Nick se tu NEZMENŠUJE.** Feed posílá `name=mc-Olivia`
		// a `Linda_0nline`; malá písmena vracejí prázdný přehrávač.
		case 'stripchat':
			return `https://suaplf.live/stripchat?name=${u}`;
		// purecam potřebuje číselné ID performera (`Model.embedRef`).
		case 'streamate':
			return ref
				? `https://hybridclient.naiadsystems.com/purecam?performer=${u}`
					+ `&performerid=${encodeURIComponent(ref)}&volumelevel=0&widescreen=true`
				: '';
		// ImLive má v URL náhodné UUID a stream name — odvodit se nedá, jede
		// se z toho, co přišlo ve feedu.
		/**
		 * `ref` je `iframeFeedURL` ze CrakRevenue, tedy CIZÍ řetězec, který jde
		 * rovnou do `iframe.src`. Bez kontroly schématu by kompromitovaný feed
		 * stačil na `javascript:` v našem originu. Jinde na webu takový sink
		 * není (u BongaCams to hlídá `/api/stream/`).
		 */
		case 'imlive':
			return ref && /^https:\/\//i.test(ref) ? ref : '';
		/**
		 * **Amateur.tv přehrávač je od 28. 8. 2026 vypnutý.** Jejich widget
		 * vyžaduje `data-id` přímo v HTML a to ID je **týž řetězec jako
		 * credential k jejich feedu** (past 19) — ležel tedy čitelně ve zdroji
		 * 274 stránek a kdokoli s ním mohl tahat jejich data na náš účet.
		 * Cíl D17 („klíč nesmí být ve veřejném HTML") tím byl splněn jen
		 * z poloviny. Zároveň to byl jediný cizí skript na celém webu
		 * (`cdn.a00s.net`), takže jeho odstranění otevřelo cestu k plné CSP.
		 *
		 * Cena je malá: Amateur.tv má 1 proklik za 28 dní (GA4). Stránka teď
		 * ukáže náhled a odkaz do pokoje, stejně jako to měl BongaCams.
		 * Kdyby Amateur.tv vydal widget ID oddělené od API klíče, dá se to
		 * vrátit. Viz D63.
		 */
		case 'amateur':
			return '';
	}
}

/** CTA „Chat & tip" — affiliate deeplink do pokoje modelky. */
export function deepLink(
	network: NetworkId,
	username: string,
	placement: Placement = 'card',
	env: EnvGet = buildEnv,
): string {
	const u = encodeURIComponent(username);
	switch (network) {
		// Kanonický tvar podle feedu je /in/?tour=…&campaign=…&track=…&room=…,
		// ne /username/?campaign=… . `track` je volný řetězec → nese placement.
		case 'chaturbate': {
			const q = new URLSearchParams({
				tour: CB_TOUR_LINK,
				campaign: env('CHATURBATE_AFFILIATE'),
				track: placement,
				room: username,
			});
			return `https://chaturbate.com/in/?${q}`;
		}
		case 'camsoda':
			return `https://www.camsoda.com/${u}?id=${encodeURIComponent(env('CAMSODA_AFFILIATE'))}`;
		case 'cam4': {
			const q = new URLSearchParams();
			if (env('CAM4_SID')) q.set('sid', env('CAM4_SID'));
			if (env('CAM4_AID')) q.set('aid', env('CAM4_AID'));
			if (env('CAM4_RP')) q.set('rp', env('CAM4_RP'));
			return `https://www.cam4.com/${u}?${q}`;
		}
		case 'amateur':
			return `https://www.amateur.tv/${u}?a=${encodeURIComponent(env('AMATEUR_API_KEY'))}`;
		// Vlastní tracking wrapper sítě (tak to dělá i jejich feed v `chat_url`).
		// Dřív se používalo bngprm.com/promo.php?type=direct_link, což je starší
		// cesta z pluginu.
		/**
		 * `csurl` míří na POKOJ, ne na `chat-popup`. Do 26. 8. tam byl popup
		 * a Kenny hlásil, že „proklik hází chybu": v novém tabu z toho vyleze
		 * obecná titulka BongaCams a přes datacentrovou IP dokonce Cloudflare
		 * challenge (403 „Just a moment…"). Jejich feed přitom nabízí čtyři
		 * varianty a tahle je jejich `chat_url_on_home_page`:
		 *   chat_url              → /chat-popup/{nick}   (vyskakovací přehrávač)
		 *   chat_url_on_home_page → /{nick}              ← tohle chceme
		 *   profile_page_url      → /profile/{nick}      (viz `profileLink`)
		 * **Nick se nezmenšuje** — feed posílá `RabeccaCaldwell`, `BABYam`.
		 * Viz D59.
		 */
		case 'bongacams':
			return `https://bongacams.com/track?c=${encodeURIComponent(env('BONGACAMS_USER_ID'))}` +
				`&csurl=${encodeURIComponent(`https://bongacams.com/${username}`)}`;
		case 'xlovecam':
			return `https://www.xlovecam.com/en/chat/${u}/?id_affilie=${encodeURIComponent(env('XLOVE_AFFILIATE_ID'))}`;
		// Opraveno proti pluginu: ten posílal rozbité `lang]=es` a neexpandovaný {SUBAFFID}.
		// ── sítě přes CrakRevenue ────────────────────────────────────────────
		// Tvar je z jejich feedu (`roomUrl`), ne z dokumentace:
		// `t.camsk7.com/{affiliate}/{offer}?…&model={nick}`. Placement jde do
		// `aff_sub1` — dokumentace ho má jako volný tracking parametr, takže
		// `?p=` zůstává měřitelné až do jejich statistik. Hlídá `auditEarnings`
		// v `scripts/cam-networks.ts`: kdyby se offer ID změnilo, sync padne.
		case 'stripchat':
		case 'streamate':
		case 'imlive': {
			const q = new URLSearchParams();
			// Streamate má ve feedu navíc tenhle sub — nechává se přesně tak,
			// jak ho posílají oni.
			if (network === 'streamate') q.set('aff_sub3', 'TC_LW9H5CT9');
			// `model` musí být `nameClean`, tedy nick MALÝMI písmeny — přesně
			// tak, jak ho posílá feed v `roomUrl`. S originální kapitalizací
			// (`DaiseyDesire`) parametr nesedí a `auditEarnings` sync zastaví;
			// ověřeno na 398 modelkách všech čtyř sítí, že `nameClean` je vždy
			// prostý lowercase `name`. Přehrávač to má naopak — tam se nick
			// zmenšit NESMÍ.
			q.set('model', username.toLowerCase());
			q.set('aff_sub1', placement);
			return `https://t.camsk7.com/${encodeURIComponent(env('CRAKREVENUE_AFF_ID'))}`
				+ `/${CRAK_OFFER[network]}?${q}`;
		}
		case 'livejasmin':
			return 'https://rpwmct.com/?' + rawBracketQuery([
				['params[psid]', env('LIVEJASMIN_USERID')],
				['params[psprogram]', env('LIVEJASMIN_PSPROGRAM') || 'revs'],
				['params[pstool]', '213_1'],
				['params[utm_source]', 'ecamx'],
				['params[utm_content]', placement],
				['siteId', 'jsm'],
				['pageName', 'freechat'],
				['performerName', username],
				['lang', 'en'],
			]);
	}
}

/**
 * Odkaz na profil modelky, ne do živého pokoje. Používá offline stránka —
 * pokoj je prázdný, ale profil (fotky, videa, „upozorni mě") pořád konvertuje
 * a pořád je pod affiliate trackingem.
 */
export function profileLink(network: NetworkId, username: string, env: EnvGet = buildEnv): string {
	switch (network) {
		case 'bongacams':
			return `https://bongacams.com/track?c=${encodeURIComponent(env('BONGACAMS_USER_ID'))}` +
				`&csurl=${encodeURIComponent(`https://bongacams.com/profile/${username}`)}`;
		default:
			return deepLink(network, username, 'offline', env);
	}
}

/**
 * Build padá, když chybí affiliate ID — jinak by se nasadil web, který vypadá
 * v pořádku, ale neposílá provizi.
 */
export function assertAffiliateEnv(env: EnvGet = buildEnv): void {
	const required = [
		'CHATURBATE_AFFILIATE', 'CAMSODA_AFFILIATE', 'CAM4_SID',
		// `AMATEUR_API_KEY` tu od 28. 8. NENÍ. Build ho nepotřebuje (odkaz se
		// skládá až ve Workeru z secretu) a jeho přítomnost v build prostředí
		// znamenala, že se zapekl do bundlu — přesně to, čemu má `/go/` bránit.
		// Chybějící secret za běhu odchytí kontrola v `/go/` (404 + log). D63.
		'BONGACAMS_USER_ID', 'XLOVE_AFFILIATE_ID', 'LIVEJASMIN_USERID',
		// Jedno ID pro čtyři sítě z CrakRevenue — bez něj by jejich odkazy
		// vedly do pokoje bez provize.
		'CRAKREVENUE_AFF_ID',
	];
	const missing = required.filter((k) => !env(k));
	if (missing.length) {
		throw new Error(
			`Chybí affiliate ID: ${missing.join(', ')}. Bez nich web nevydělává — build končí.`
		);
	}
}
