# ecamx.com — poznámky pro Claude / Codex

Adult cam affiliate agregátor (EN). Astro → statické stránky na Cloudflare Workers.
Nahrazuje starý WordPress (Pro Theme + Plugin Cams), který se dusil vlastním syncem.

## Rychlá orientace

```
scripts/cam-networks.ts     registr 7 cam sítí jako DATA — endpointy, mapování, affiliate URL
scripts/taxonomy-cleanup.ts pravidla, co se stane stránkou a co ne (prahy, deduplikace)
scripts/sync-cams.ts        hlavní sync: fetch → normalizace → registry → src/data/*.json
scripts/build-redirects.ts  seed/legacy-redirects.txt + gone.json → public/_redirects
scripts/check-links.ts      poprodukční kontrola dist/ (odkazy, redirecty, sitemapa)
scripts/seed-registry.ts    jednorázový bootstrap registry z historie starého WP
scripts/probe-networks.ts   diagnostika: zkusí všech 7 API a ukáže, co se plní
scripts/check-card-taps.mjs kam vede klepnutí do karty (dotyk 390 px + myš) — ručně, ne CI
scripts/check-redirects.ts  odchozí odkazy všech sítí končí u té modelky — týdně cronem
scripts/check-grid.mjs      chování mřížky v prvních vteřinách + podíl živých karet
scripts/check-rescue.mjs    záchranné karty (D67): podstrčí starou stránku a změří je
scripts/check-hls-player.mjs přehrávač BongaCams + náhrada za dovysílanou modelku
scripts/check-sitemap-churn.mjs slibuje sitemapa URL, které tam budou i příště (D75)
src/data/                   generováno syncem, gitignorováno
seed/                       exporty ze starého WP (registry.json se drží lokálně)
```

`src/data/` = `models.json` (právě online) · `archive.json` (offline do 45 dnů,
stránku pořád mají) · `gone.json` (slug → cíl 301) · `facets.json` · `meta.json`.

## Příkazy

```bash
pnpm sync:dry            # sync bez zápisu, rychlá kontrola
pnpm sync                # plný sync → src/data/
pnpm dev                 # astro dev (viz níže — spouštět na pozadí)
pnpm build               # → dist/client (statika) + dist/server/wrangler.json
pnpm preview             # wrangler dev -c dist/server/wrangler.json
pnpm deploy              # build + wrangler deploy

node --experimental-strip-types scripts/probe-networks.ts   # diagnostika API
```

Dev server pouštěj na pozadí: `astro dev --background`, pak `astro dev logs` / `stop`.

## Co je jinde než u ostatních projektů

- **Žádná runtime databáze.** Katalog se generuje při buildu do `src/data/*.json`
  a Astro z nich staví statické stránky. D1 ani Turso tu nejsou.
- **Registry v Cloudflare KV** (přes REST API, jen při buildu — ne binding).
  Drží streak/first/last u každé modelky, aby profilové URL nemizely mezi buildy.
  Lokálně padá na `seed/registry.json`.
- **Jediná dynamická route** je `/api/online/[network]` (`prerender = false`).
  Všechno ostatní je statika → requesty zdarma a neomezeně.

## Pasti, na které se tu už narazilo

1. **`@astrojs/cloudflare` v14 nedeployuje z kořenového `wrangler.jsonc`.**
   Build vyrobí `dist/server/wrangler.json` a deployuje se TEN. `env.production`
   se do něj nepropíše → konfiguraci držet na top-level.
2. **Chaturbate API:** `client_ip` je povinný (jinak HTTP 400) a `limit` má strop
   **500**. Offset funguje → bez stránkování bys místo 4 000 modelek dostal 500.
3. **Cam4 tagy** chodí jako `gay-gangbang|niche.292.name`. Brát jen část před `|`.
   Starý plugin slugifikoval celý řetězec — odtud těch 250 termů `analniche-34-name`.
4. **Amateur.tv nemá iframe**, jen JS widget (`cdn.a00s.net/livecamaffiliates.min.js`).
   `embedUrl()` vrací marker `widget:amateur:{user}`, šablona ho musí přeložit.
5. **Amateur.tv vrací ~120 modelek**, ne tisíce — je to live feed, ne katalog.
   Starý web měl 3 049, ale to byla kumulace za 9 měsíců.
6. **Náhledy se NIKDY necachují lokálně** — hotlink z CDN sítí. Kdybychom je
   proxovali, spadneme pod klauzuli Cloudflare o velkých souborech na free CDN.
   Cam4 má podepsané URL, které expirují → `onerror` fallback je povinný.
7. **Strop souborů drží MINUTY CI, ne Cloudflare** (od 7. 9. 2026). Účet má
   `workers_paid` (ověřeno v API), kde je limit **100 000 souborů** na verzi —
   ne 20 000 jako na free. Zavazující je rozpočet GitHub Actions: 2 000 min/měs
   na účet (past 101), a změřeno na 12 bězích **11,8 min při 18 199 souborech**,
   tedy ~33 ms na soubor. Sync i CI proto hlídají `CI_FILE_BUDGET = 30 000`
   (≈ 19 min/běh ≈ 1 900 min/měs při 3 bězích denně). Viz D75.
8. **Nespárované surrogate páry shodí build.** Room subject typu
   „100 tokens 🩵" oříznutý regexem uprostřed emoji dá `\ud83e` a striktní JSON
   parser v Rolldownu na tom padne („unexpected end of hex escape"). Čistí to
   `stripLoneSurrogates()` v `cam-networks.ts` — i na snapshotech z KV.
9. **`_redirects` má limit 2 000 pravidel** a Cloudflare přebytek **tiše zahodí**.
10. **CamSoda ignoruje `limit`** — vždycky pošle celý feed (1,2 MB). Cam4 má pole
    `goal`, `goal_balance` i `hd_stream`, ale **neplní je** (samé nuly/null).
11. **Chaturbate `tour` vybírá program**, ne nastavení účtu: `LQps` = revshare,
    `yiMH` = PPS. Env `CHATURBATE_TOUR=rev` byla nesmysl, který síť ignorovala.
    Platí ale jen na `/in/` odkazech — v embedu se `tour` nepoužívá, viz bod 13.
12. **Odkaz z karty nesmí vést ven.** Karta jde na `/live/{page}/`, ven vede jen
    tlačítko „Chat". Kvůli tomu celá přestavba existuje (viz D8).
13. **Přehrávač a CTA mají SCHVÁLNĚ jinou URL — nesjednocovat.** Provizi u
    Chaturbate přiřadí jen `/in/`, ale to je v EasyList, takže Chrome takový
    iframe označí za reklamu a po 4 MB přenosu ho **sám odstraní** (Heavy Ad
    Intervention). Embed proto jede na `/embed/`, CTA na `/in/`. Viz D13;
    hlídá `scripts/check-blocklists.ts`.
14. **Iframe se vkládá až po kliknutí** (poster + play). Interakce uživatele
    rámec z Heavy Ad Intervention vyjímá a nestahují se desítky MB videa
    člověku, který profil jen prolétne.
15. **Mřížky mají rezervu a offline karty se SKRÝVAJÍ, ne zašeďují.** Do HTML jde
    3× víc karet (`reserve` prop, `hidden`), klient je odkrývá za zhasnuté.
    Sync běží **každé 2 h** — víc se do free minut Actions nevejde, a každá
    karta navíc v HTML ten rozpočet ujídá. Viz D14.
16. **Odchozí odkazy jdou přes `/go/{network}/{nick}/?p={placement}`**, ne přímo
    na affiliate URL. Do šablon patří `goLink()`, NE `deepLink()` — ten je jen
    pro runtime v `/go/`. Drží klíč Amateur.tv mimo HTML a `placement` u všech
    7 sítí. Viz D17; hlídá guard „Verify /go/ redirects earn money".
17. **XLoveCam posílá číselné kódy**, mapa je v `scripts/xlove-filter-map.ts`
    (vytažená ze starého pluginu). Bez ní byla síť na 325 stránkách nula.
    **BongaCams má zemi v `homecountry`, ne v `country`.** Viz D18.
18. **Přehrávač naskočí sám u sítí v `AUTOPLAY_SAFE`**, u LiveJasminu
    a XLoveCamu zůstává klik (jsou na blokovacím seznamu). Viz D20.
19. **`AMATEUR_API_KEY` je zároveň affiliate ID i credential k feedu.** Nedá se
    to rozdělit, je to jejich design. Proto MUSÍ zůstat mimo statické HTML.

20. **Kanonizace termů je JEN v `src/lib/taxonomy.ts`** — importuje si ji sync
    i render. Dřív měl `src/lib/data.ts` vlastní kopii bez `CANONICAL` a stránky
    proto neviděly modelky, které sync do kategorie spočítal: `/cams/big-tits/`
    mělo v titulku 1 103, ale našlo 244 (878 má tag `bigboobs`/`bigtits`),
    `/cams/bigass/` 1 107 vs. 786. **Neduplikovat ji.** Viz D24.
21. **Kurátorské „money" kategorie jsou v `src/lib/money-categories.ts`**,
    `FacetKind = 'money'`, členství = **unie signálů** (tagy + strukturovaná pole
    + gender + věk), bez prahu 50. Důvod: `NOT_A_CATEGORY` vyhazuje `bbw`/`indian`/
    `asian`/`ebony` z tagů s tím, že je pokryje jiná taxonomie, ale **etnicitu
    a postavu hlásí jen BongaCams a LiveJasmin** (1 360 z 8 182 modelek má
    etnicitu, 379 postavu) → termy propadly oběma síty. Tag `bbw` má 181 modelek,
    `bodyType` 15. Pojistky `MIN_MEMBERS = 20` a **`MIN_LIVE = 10`** (mřížka
    offline karty skrývá, takže samotné MIN_MEMBERS nestačí). Viz D23.
22. **Fráze „cam girls" se do titulku smí jen když `girls === true`.** Počítá to
    sync z podílu žen (`GIRLS_SHARE_MIN = 0.8`), netipuje se. `/cams/gay/` má 0 %
    a `/cams/latin/` 74 % (122 mužů a 70 trans) → dostanou „Models". Viz D23.
23. **BongaCams má v `homecountry` VOLNÝ TEXT psaný performerkou** — 183 různých
    hodnot: anglické názvy, cyrilice („Россия" 79 modelek), vtipy („Бонгания",
    „Вебкамия"), „Europe", vycenzurovaný „*********k". Používat `canonicalCountry()`;
    co se nerozpozná, **se zahodí**. Bez toho existovaly `/country/co/`
    i `/country/colombia/` a druhá měla v H1 „COLOMBIA". **Cyrilici je nutné hledat
    PŘED slugifikací** (ta nechá jen `[a-z0-9]`) — platí i pro `canonicalLanguage`,
    kde byl klíč `русский` nedosažitelný. Viz D25.
24. **Na `/country/{kód}/` se odkazuje jen přes `linkableCountry()`.** Stránka země
    existuje až od 20 modelek, takže surový kód dá 404 — přesně na tom spadl
    `check-links.ts` u 18 zemí (pt, cl, hu, ch, kz, lv, vn, fi, au, bg, pe, nz, ee,
    md, nl, rs, sb, uk).
25. **Stránkování mřížek JE zavedené (18. 8., otáčí D27).** Blok **180 modelek
    na URL** (60 viditelných + 120 rezerva), stránka 1 zůstává na své adrese,
    stránky 2+ jsou `[slug]/[page].astro` vedle `[slug].astro`, `/1/` se
    negeneruje. Rozměry jsou v `src/lib/paging.ts` — **ne** jako konstanta ve
    frontmatteru: `getStaticPaths()` běží v izolovaném rozsahu a na frontmatter
    nedosáhne (modulový `const ROUTES` shodil prerender na „ReferenceError").
    Stránka ≥2 je **`noindex, follow`**, není v sitemapě a nemá SEO copy ani
    JSON-LD. Stránkuje se **segmentem**, nikdy `?page=` (`robots.txt` má
    `Disallow: /*?`). Počet stránek se bere z délky skutečného výsledku, **nikdy
    z `facet.count`** (viz bod 20). Celý katalog = 425 URL, ne „tisíce", jak
    tvrdilo D27. Viz D32.
26. **Trvalá crawl cesta ke stránkám modelek je adresář `/models/`**, ne mřížky
    ani stránkování. Důvod: 18. 8. nemělo **6 102 ze 14 000** stránek modelek
    nikde odkaz, z toho 4 849 archivních — a archiv posíláme do sitemapy jako
    indexovatelný. Mřížky ukazují jen živé, takže archiv odkázat neumí.
    Adresář je textový (250 odkazů/stránka, žádné náhledy), řadí se podle slugu
    `page` (stabilita) a je v patičce. Sirotky hlídá guard v `check-links.ts` —
    když spadne, chybí odkaz, ne test. Viz D33.
27. **Chaturbate embed jede `embed_video_only=1` a nad streamem je `.player-hit`.**
    `/embed/` **nenastaví affiliate cookie NIKDY** (ověřeno se `campaign`,
    s `campaign` + `tour` i s `embed_video_only`) — cookie dává jedině `/in/`,
    které Chrome zabíjí jako reklamu (bod 13). Klik na chat/tip uvnitř rámce byl
    proto proklik zdarma pro Chaturbate. **Nezkoušet to znovu** a nepřidávat do
    embedu chat. Vrstva vynechává spodních **34 px** (ovládání video.js je 30 px)
    — bez toho není dosažitelný unmute u ztišeného autoplay. Cam4 embed je
    `/{nick}/embed`, **ne** `/en/embed/{nick}` (to vrací 404 u všech modelek).
    Viz D34.
28. **Ručně psané texty kategorií patří do `src/content/curated-copy.json`**, NE do
    `category-copy.json` — ten generuje `scripts/build-category-copy.ts` ze starého
    WP a při dalším běhu by ruční doplňky přepsal.
29. **`src/lib/model-copy.ts` nesmí nic vymýšlet.** Každá věta odpovídá poli; když
    pole není, věta se vynechá. Žádné relativní časy („3 days ago" by se měnilo při
    každém z 12 denních buildů), žádný `Math.random()` (varianta se volí ze slugu),
    a **streak se hlásí jen u online modelky** — na archivní stránce by „is on
    a 3-day run right now" byla lež. Číslo sloves musí projít `v(p, …)`, jinak
    u páru vznikne „They chats in English". Viz D26.
30. **Počty v titulcích jdou přes `approx()`** (`250+`, zaokrouhlení dolů). Sync
    deployuje každé 2 h, takže přesné číslo dělalo dvanáct různých titulků denně
    u jedné URL. Viz D28.

31. **GA (`G-JSSZP2XFBL`) je v `Layout.astro` a MUSÍ mít `is:inline`** — jinak
    Astro stub zabalí do modulu, `gtag()` nebude globální a měření tiše umlkne.
    Kdo na GA sáhne, ať zkontroluje `src/pages/privacy.astro`: dřív tam stálo
    „We do not run Google Analytics" a nasadit tracker proti vlastní privacy
    policy je horší než nemít měření. Plná CSP bude potřebovat
    `script-src googletagmanager.com` + hash stubu a `connect-src` na
    `*.google-analytics.com`. Cena: ~265 ms TBT (měřeno). Viz D30.

32. **GA události: registrace dimenzí MUSÍ předcházet nasazení.** GA4 zahazuje
    neregistrovaný parametr **už při sběru**, takže dimenze doplněná později
    nemá historii. Nová událost = nejdřív `python3 ~/ai/scripts/ecamx/ga4.py apply`,
    pak deploy. `go_click_server` **nesmí** dostat stejný název jako `go_click`
    (dvojí počítání) a href u `/go/` odkazů se čte **až při kliku**, protože se
    za běhu mění (retarget CTA, offline→live). Na kartu se nepřidávají atributy —
    vše se odvodí z hrefu, jinak 20 B × 180 karet. `ExecutionContext` je
    v `Astro.locals.cfContext`. Viz D31.

33. **Zaniklé stránky NIKDY nesmí padat na 404.** Mapu obsluhuje Worker
    (`src/pages/[...path].ts` + `src/lib/gone.ts`), protože `_redirects` má
    limit 2 000 pravidel a přebytek Cloudflare tiše zahodí. Do `_redirects`
    patří jen legacy WP mapa. Změřeno 19. 8.: 729 z 837 stránek modelek
    s historií v GSC vracelo 404 = 89 % impresí webu. Přesměrování je **302**
    (modelka se vrací, u 301 by URL zůstala mrtvá); legacy WP je 301.
    Catch-all NESMÍ zastínit `/go/` ani `/api/` — ověřuj po každé změně routingu.
    Viz D35.
34. **Retenci řídí POPTÁVKA, ne jen čerstvost.** KV klíč `demand`
    (`~/ai/scripts/ecamx/demand.py`: GSC imprese + Ahrefs objem na nick) —
    stránka s poptávkou se nesmaže, nepřesměruje a je indexovatelná hned.
    **Past:** nick bývá běžné slovo (`molly` 96 000, `sativa` 92 000,
    `ocicat` 17 000) → objem platí jen u nezaměnitelných nicků, slovní se
    potvrzují dotazem `<nick> cam`. Z 400 bylo 91 falešných. Viz D35.

35. **Chaturbate feed má `count` — čti ho.** `onlinerooms` hlásilo 7 944 pokojů,
    my brali 4 000 (8 stránek × 500) a chyběla spodní polovina, tedy nicky
    s nejmenší konkurencí. Teď `maxPages: 20`. Kdo mění stránkování, ať porovná
    `count` z odpovědi s tím, co skončí v katalogu.
36. **Zemi má Chaturbate v `location`, ne jen v `country`.** `country` chybí
    u 32 % pokojů, `location` je vždycky — ale píše ho modelka („Antioquia,
    Colombia" i „in your heart"). Řeší `parseLocation()`: poslední úsek za čárkou
    je země (přes `canonicalCountry`), úsek před ním kraj. **Kraj nikdy nedělá
    stránku** (315 hodnot, medián 1 modelka) a **dlouhý název se zahazuje,
    nezkracuje** — ořezané „Llanfairpwllgwyngyllgo…" vypadá jako rozbitý web.
37. **`spoken_languages` je volný text — jazyky jsou WHITELIST.** „Spanish and
    English (translator)" dělalo jazyky `and` a `translator`, a šly do výpisu na
    stránce. `parseLanguages()` + `LANGUAGES` (60 jazyků): co v seznamu není, se
    zahodí. **Nepřidávat zpátky „neznámé delší než 3 znaky = jazyk".** Kanonizace
    se dělá i při renderu, protože archivní stránky běží ze starých snapshotů.
38. **Věk ber z `birthday`, ale kontroluj ho.** 27 pokojů má `1901-01-26` + věk 99
    (sentinel „neuvedeno"). Kontroluje se rok, odvozený věk 18–80 a soulad
    s feedovým `age`. Na stránce je den a měsíc **bez roku**.
39. **`hours` v registry = 12 DVOUHODINOVÝCH přihrádek, ne 24 hodinových.** Sync
    jede `0 */2 * * *`, takže hodinové přihrádky by měly polovinu navždy nulovou.
    `usualHours()` mlčí pod 7 dny a 12 vzorky — rozvrh ze dvou dnů je výmysl
    s číslem. Otáčí to pravidlo 4 v `model-copy.ts` (cena změřena: 1,1 MB z 25 MB).
40. **Affiliate odkaz hlídá `auditEarnings()` proti feedu** (`chat_room_url_revshare`)
    a sync na rozdílu PADÁ. Je to jediná věc, která nese peníze, a z nasazeného
    webu se nepozná: odkaz vypadá stejně, ať provizi přiřadí nebo ne.
    `embedUrl`/`deepLink` v `cam-networks.ts` byly mrtvý kód a **jsou smazané** —
    živé jsou jen ty v `src/lib/affiliate.ts`. Neobnovovat je.
41. **`current_show: private|hidden` není „Live now".** 445 pokojů je v placené
    show a přehrávač u nich ukáže zeď. `status` se do 19. 8. nikde nečetl; teď
    má stránka odznak „Private show in progress". `hidden` = `private`.
42. **Registry jsou DVA klíče v KV** — `registry` (živé + archivní) a
    `registry-gone` (přesměrování). Limit 25 MB je na hodnotu, ne na namespace,
    a přesměrování byla 53 % objemu. `loadRegistry()` je sesype, `saveRegistry()`
    rozdělí; **zapisuje se nejdřív `registry-gone`**, protože při pádu mezi dvěma
    PUTy musí přežít hodnota, ze které se stav dopočítá. Kdo čte registry mimo
    sync (`~/ai/scripts/ecamx/demand.py`), musí čít oba klíče. Viz D43.
43. **Publikace faset má HYSTEREZI** (KV `facets-published`). Prahy se měří
    proti jednomu snapshotu a sync jde 12× denně, takže `/country/be/` jeden
    build existovalo (23 modelek) a další vracelo 404 (19). Pod prahem stránka
    zůstane, dokud má aspoň poloviční supply a od překročení neuběhlo 7 dní.
    ~65 URL leží do 1,5× prahu, takže tohle není teorie. Viz D44.
44. **Souhlas s analytikou se vyžaduje jen tam, kde ho vyžaduje právo.** Věková
    lišta NEBLOKUJE obsah, takže „bez kliknutí neměříme" by u všech znamenalo
    neměřit skoro nikoho. EU/EHP/UK = opt-in (region z časové zóny, při chybě
    se bere jako EU), jinde zveřejnění + opt-out. **V EU se `gtag.js` do volby
    vůbec nenačte** — silnější než `denied`, při němž Google posílá cookieless
    pingy. Obě tlačítka musí mít stejnou velikost, jinak souhlas není platný.
    Viz D45.
45. **`go_click_server` musí ctít tentýž souhlas jako klient**, jinak zadní
    cesta ruší, co lišta slíbila. Worker do `localStorage` nevidí → volba je
    i v cookie `ecamx_consent`; zemi bere z **`cf-ipcountry`**, ne z časové zóny.
    `client_id` je naše first-party cookie `ecamx_cid` — **nikdy náhodné ID**,
    to by z každého prokliku udělalo nového uživatele. Bez cookie se hit
    neposílá. Měření je v `try` + `waitUntil` a **nikdy nesmí sáhnout na 302**.
    Viz D46.
46. **Cloudflare `bot_management` umí jen PUT, ne PATCH** — přepisuje celý
    objekt a co v těle není, spadne na default. Vždycky si nejdřív stáhnout celý
    objekt do `backups/` a po zápisu porovnat položku po položce; odpovědi PUTu
    nevěřit (vrátila `ai_bots_protection: disabled`, ačkoli uložené zůstalo
    `block`). Scoped token na to nemá právo, jde to jen globálním klíčem
    z `.cloudflare-credentials.env`. JS Detections je od 19. 8. vypnuté. Viz D47.
47. **Cross-network blok tvrdí shodu JMÉNA, ne osoby.** Tři tiery podle toho, co
    hlásí OBĚ strany (`src/lib/cross-network.ts`): 1 087 stránek korroborovaných,
    896 jen podle nicku, 92 rozporných. „Údaj známý jen na jedné straně" NENÍ
    shoda. **Rozdílná země není rozpor** — ze 111 takových párů má 63 % shodný
    věk, je to nastavená lokalita. **Nikdy `sameAs`/`identifier`** mezi dvěma
    našimi `/live/` URL a nikdy „same girl/model/verified". Viz D48.
48. **Do srovnávače sítí smí jen to, co hlásí všech sedm.** Nula ve feedu znamená
    „síť to nezveřejňuje", ne „modelky to nemají" — „CamSoda: HD 0 %" by byla lež
    lichotící Chaturbate, tedy našim provizím. `src/lib/network-stats.ts` proto
    u nehlášených polí vrací `null` a šablona to **napíše slovem**. Viz D48.
49. **Dolarové ceny jsou JEN v `src/content/token-rates.ts`**, nikdy v `networks.ts`.
    Žádná ze 7 sítí je nezveřejňuje (login/403/404), takže je musí opsat člověk
    z přihlášeného účtu; bez dat se `/site/*/tokens/` **negeneruje** a guard #7
    v `check-links.ts` build zastaví, když je `checkedOn` starší 90 dnů. Viz D48.
50. **`limit` u feedu ověřuj proti realitě.** cam4 i BongaCams vracely přesně
    1 000 při `limit=1000`; při 3000 vrátí 1 778 a 1 395. **Kulaté číslo rovné
    limitu je příznak useknutí, ne velikost sítě** — stejná chyba jako
    u Chaturbate (D42). `offset` obě ignorují.
51. **Index finderu je STATICKÝ asset, ne Worker.** `/api/online` má naměřeno
    14 ms CPU při 300 záznamech (strop 10 ms) a sdílí rate limit s `/go/`.
    Generuje se při buildu z `MODEL_PAGES` (`src/lib/search-index.ts`), cesta je
    **stabilní bez hashe** (12 deployů denně = 12 URL denně a nulová cache).
    Guard v `check-links.ts` hlídá „řádků == stránek modelek" a že v assetu není
    klíč z env. Formát stojí na třech měřených předpokladech — před změnou
    spustit `assertIndexAssumptions()`. Viz D49.
52. **Nic v `/finder/` se neodkrývá skriptem.** První verze měla nástroj
    v `hidden` a engine ho odkrýval → **CLS 0,2724**, tedy táž chyba jako
    u věkové lišty (D29). Blok je v HTML od začátku, pole je `disabled`, výsledky
    mají pevnou výšku se scrollem. Po opravě CLS 0. Kdo tam přidá prvek, který
    se zjevuje, ať znovu změří CLS.
53. **Filtr „Live now" se u jmenného dotazu sám povolí.** „Nenašli jsme nic" je
    u dotazu na konkrétní nick horší odpověď než „není teď online" — a musí se to
    v UI říct, ne udělat potichu. Viz D49.
54. **Cena dostane číslo jen se DVĚMA nezávislými zdroji**, jinak rozpětí —
    a u rozpětí musí obě hranice něco znamenat (dolní = nejlepší kurz ze zdrojů,
    horní = cena, kterou zaplatíš jistě opakovaným nákupem ověřeného balíčku).
    Guard v `check-links.ts` build zastaví při jediném zdroji i při `checkedOn`
    starším 90 dnů. Anti-bot challenge sítí se **neobchází** — z naší IP proti
    plátcům provizí je to cesta k vypnutému účtu. Viz D50.
55. **Šablona, která se nikdy nevykreslila, není hotová.** `tokens.astro` bez dat
    negeneruje URL, takže se neotestovala — a nadhozená data v ní našla tři
    chyby, včetně tabulky nabízející nekoupitelné ceny (`tokeny × nejlepší kurz`
    dá u 100 tokenů $8,00, což ti nikdo neprodá). Viz D50.
56. **`minExpected` patří pod POZOROVANÉ MINIMUM, ne k maximu.** 19. 8. jsem ho
    u cam4 dal na 1 200 a u BongaCams na 1 000 podle jednoho měření — a BongaCams
    reálně vrací 1 002–1 391, takže síť vypadla ve třech CI bězích ze šesti.
    Teď 700 a 400. Kdo na práh sáhne, ať se podívá na několik běhů v různých
    hodinách. Viz D51.
57. **Na `/site/{síť}/` se odkazuje JEN přes `linkableNetwork()`.** Sync výpadek
    jedné sítě toleruje, ale její modelky zůstanou v katalogu ze snapshotů —
    a odkaz na neexistující stránku sítě shodí `check-links` (6 501 stránek,
    20. 8.). Stejné pravidlo jako u zemí (bod 24). Viz D51.
58. **Watchlist je JEN v prohlížeči a živý stav čte JEDNA funkce.** Per-user stav
    do KV nepatří (1 000 zápisů/den → ~150 uživatelů a je vyčerpáno) a Worker
    na hlídání sedmi feedů nemá CPU (10 ms, u BongaCams naměřeno 14 ms při 300
    záznamech). Odznak v hlavičce i `/my/` proto jdou přes `liveFor()`
    ve `watchlist.ts` — dedup rozdělaného requestu + `sessionStorage` na 60 s.
    Bez toho stahovala `/my/` tentýž feed dvakrát, a `/api/` sdílí okno rate
    limitu s vydělávajícím `/go/`. Klik z `/my/` se měří existujícím
    `?p=watchlist`, **žádná nová událost** (dvojí počítání, bod 32). Viz D52.
59. **Rezervace místa pro obsah dosypaný skriptem se nehádá číslem.** Seznam
    `/my/` má pevnou výšku se scrollem a počet řádků dodává blokující skript
    jako `--watch-rows`; `min-height` „na jednu linku" neplatí, protože řádek se
    na mobilu zalomí (změřeno CLS 0,1208). U `/finder/` byla rezervace pro
    „Show more" o 14 px menší než tlačítko (CLS 0,0128) a **`[hidden]` má
    v preflightu Tailwindu `display: none !important`** — pravidlo, které ho
    chce nechat v layoutu, bez `!important` neplatí vůbec a posun vyroste na
    46 px (CLS 0,0421). Viz D52.
60. **Opt-out modelky platí i pro rozvrh a musí zůstat self-service.** Kód
    `ecamx-out` v room subjectu se aplikuje v syncu na jednom místě (před
    taxonomiemi, registry i indexem) a registry vyřazené zahodí `snap`+`hours`
    a nastaví `gone` → 302, ne 404. Ověřeno: 0 falešných shod na 10 659 reálných
    subjectech. XLoveCam subject nehlásí (0 %) → e-mail. Viz D52.
61. **Poptávku měříme na VŠECH vyhledávačích, jinak si mažeme pozice.** KV klíč
    `demand` řídí retenci (`demandFor >= DEMAND_KEEP` = nikdy nesmazat) a do
    24. 8. ho plnil jen GSC + Ahrefs. Google přitom dává webu ~5 impresí denně,
    kdežto Bing má v indexu 52 380 URL a přinesl 1 048 kliků — **2 001 stránek
    drží jedině Bing** a překryv s GSC je 1 %. Vzorek 24 vydělávajících stránek
    dal 13× 404, 9× 302 jinam, 2× 200. `demand.py` má proto třetí zdroj
    (Bing WM `GetPageStats`) s vlastními poli `bing_impressions`/`bing_clicks`
    a `demandScore()` je bere stejnou vahou jako GSC. Kdo přidá další zdroj
    provozu, přidá ho i sem. Viz D53.
62. **`/live/{nick}/` nesmí vrátit 404 ani u nicku, který registry nezná.**
    Mapa `gone` zná jen slugy, které u nás stránku měly — nick ze starého WP
    padal na tvrdou 404, a to byla polovina měřené poptávky. Fallback je
    `/models/{písmeno}/` (seznam profilů, ne náhodná kategorie); písmena dodává
    sync ve `facets.json.letters`, protože `MODEL_LETTERS` z `data.ts` by do
    Workeru přitáhlo 13 MB. **Co netvarem nicku není, zůstává 404** — soft 404
    na všechno je horší. Viz D53.
63. **Sitemapa je sitemapINDEX a stránky modelek jsou v ní celé.** Strop 150
    z 19. 8. Googlu nepomohl (rozcestníky po týdnu pořád „unknown to Google")
    a Bingu, který nese 97 % kliků a crawluje 9 500 URL/den, upíral seznam.
    Teď `sitemap-hubs.xml` + `sitemap-models-{n}.xml` po 5 000 (6 660 URL místo
    681). Jméno drží tvar `sitemap-*.xml` (past 43) a **guard musí projít
    i soubory z indexu**, jinak z kontroly vypadne 13 000 URL. Legacy WP vzory
    (`/webcam_category/{term}/page/{n}/`, `…niche-NN-name`) řeší Worker jako
    301, ne tisíce pravidel v `_redirects` (limit 2 000). Viz D53.
64. **Seznam sítí je na TŘECH místech a tsc pokryje jen dvě.** `NetworkId`
    v `src/lib/data.ts` **i** `scripts/cam-networks.ts` (sync nesmí importovat
    katalog), `IDX_NETWORKS` v `src/lib/search-index.ts` a `NETWORKS`
    v `src/pages/go/[network]/[user].ts`. Kdo síť přidá jen do typů, dostane
    vygenerované stránky s CTA a **404 na prokliku**, tedy proklik zdarma pro
    síť. Index finderu má navíc na síť **celý bajt** (do 25. 8. tři bity, tedy
    max 8 sítí — u jedenácté by `indexOf` = −1 dalo index 7 a finder by tvrdil
    „Amateur.tv"); generátor na síti mimo `IDX_NETWORKS` padá. Viz D54.
65. **CrakRevenue = jen sítě, které přímo nemáme.** `performers-ext` umí i
    chaturbate, bongacash a awempire, ale tutéž síť ze dvou zdrojů tahat NESMÍME
    (dvě stránky téhož člověka, D48) a agregátor jich vidí míň — 5 721 pokojů
    Chaturbate proti 7 720 z přímého API, a chybí ty nejmenší. Pasti API:
    `User-Agent` je povinný (jinak HTML 403), víc genderů jde jen jako
    `gender=f%2Cm%2Cc%2Ct` (jinak tiše samé ženy), `size` má strop 100,
    `age: 0`/`country: ""` = neuvedeno, do `model=` v odkazu patří `nameClean`
    (malými), do přehrávače `name` (s kapitalizací). Počty diváků API nedává
    vůbec. Viz D54.
66. **Odhad počtu souborů v syncu byl slepý na stránkování.** Hlásil rezervu
    2 164 souborů, když už byl build 320 souborů NAD stropem CI — počítal jen
    fasety a stránky modelek, ne stránkované mřížky a adresáře. Teď je v něm
    měřená konstanta `NON_MODEL_FILES = 2 100`; **autorita je ale krok
    „Check asset count" v CI**, ne odhad. Kdo mění stránkování, ať konstantu
    přeměří. Viz D54.
67. **Slovo „Free" v titulku smí jen u freemium sítí.** LiveJasmin, XLoveCam,
    Streamate a ImLive účtují po minutě a volný je jen náhled; slibovat u nich
    „free webcam show, no signup" je lež, kterou návštěvník odhalí prvním
    kliknutím. Seznam je `PER_MINUTE` v `src/lib/seo.ts` a odpovídá recenzím
    v `src/content/networks.ts`. Viz D54.
68. **Strop stránek platí i na ŽIVÉ modelky, ne jen na archiv.** Počet živých
    pokojů se mezi syncy hýbe o tisíce (naměřeno 15 844 → 17 523 v jednom dni),
    takže „živá dostane stránku vždycky" znamenalo, že při přílivu zbylo na
    archiv nula míst a vypadly i stránky s poptávkou (alarm z D53 se ozval na
    332 z nich) — a build přetekl na 19 910 souborů. Ubírá se v pořadí:
    poptávka (nikdy), už má stránku (jinak URL blikají, D44), publikum, viděné
    dny; odložená modelka zůstává v registry. Odhad souborů navíc **musí
    počítat stránkování** (mřížky po 180, adresář po 250), ne konstantu.
    Viz D55.
69. **Text stránky modelky je z KATALOGU, ne z frází.** Popisky od modelek
    nemáme (lite API má `i18n` prázdné) a vymýšlet se nesmí (D26). Co máme
    navíc, je poloha v našem měření: velikost sítě, publikum proti mediánu
    sítě, kolik modelek vedeme z její země, kolik pokojů nese její tag. K tomu
    FAQ v těch tvarech, ve kterých se to opravdu hledá (`{nick} cam`,
    `{nick} webcam` — změřeno na 3 141 bingových dotazech). Medián stránky
    450 → 650 slov, 52 % vět je na webu jen jednou. **Věta, která stojí na
    90 % stránek stejně, není text** — tak vypadla „12 000+ modelek uvádí
    angličtinu". Viz D55.
70. **Embed může umřít ze dne na den, protože se změní CIZÍ seznam.** 26. 8.
    přidal EasyList `||bongacams.com^$subdocument,third-party` a guard
    (správně, D13) zastavil deploy — web pak **deset hodin** stál na starém
    seznamu a mřížka zhasla 116 ze 120 karet. Když se to stane: síť vyndat
    z `AUTOPLAY_SAFE`, `embedUrl()` pro ni vrátit `''` (stránka pak dá náhled
    s odkazem — hlídá `hasPlayer`, aby nevzniklo tlačítko, které nejde
    zmáčknout) a **nespoléhat na zrcadla** (`bongacams10.com` má dnes jen
    `$popup`, zítra může mít `$subdocument`). Viz D56.
71. **Zhasnutá mřížka musí umět rozlišit „nikdo nevysílá" od „naše stránka je
    stará".** V hlavičce je `<meta name="ecamx-built">`; nad 3 h (sync jede 2×/h)
    píše mřížka, jak je výpis starý, a nabídne načtení bez cache. Bez toho web
    tvrdil „Nobody in this category is live right now" ve chvíli, kdy byly živé
    tisíce pokojů. Karty se dál skrývají, mění se jen tvrzení. Viz D56.
72. **Zamrzlý deploy hlídá `bin/ecamx-deploy-watch.py`** (cron 30 min, Discord).
    Hlídá SYMPTOM — věk nasazeného buildu a stav posledního běhu CI — ne
    konkrétní guard, protože příště spadne jiný. Pět spadlých běhů za sebou
    zůstalo deset hodin bez povšimnutí; to bylo dražší než ta chyba sama.
    Viz D56.
73. **Klient mřížku NEPŘESKLÁDÁVÁ.** Živý průchod smí jen nahradit zhaslou
    kartu kartou z rezervy **na jejím místě**; přeživší karty se nehýbou. Do
    26. 8. se mřížka řadila podle aktuálních diváků a na homepage se z 60 karet
    28 vyměnilo a z 32 přeživších si jen 5 udrželo pozici — 300–700 ms po
    dopadu, tedy přesně pod rukou. **CLS to nezachytí** (mřížka nemění výšku),
    takže to nehlásí žádná metrika; kdo sem sáhne, ať porovná pořadí karet před
    a po průchodu (`tmp/grid-order.mjs`). Prokládání sítí platí dál, ale na
    REZERVU. Viz D57.
74. **Filtr mřížky se aplikuje BLOKUJÍCÍM skriptem, ne po dopadu.** Volba sítí
    z `localStorage` se vkládá jako `<style>` s `.card:not([data-network=…])`
    ještě v `<head>`; kdyby karty skrýval odložený modul, posunul by obsah.
    A pozor na druhý efekt: ve **filtrovaném** pohledu není z čeho doplnit díry
    po zhaslých kartách, takže se mřížka vyprázdní a poskočí (naměřeno
    CLS 0,146 na `/cams/bbw/` + Chaturbate). Proto se tam zhaslé karty vracejí
    zešedlé do dvanácti kusů a hláška nabídne `/site/{síť}/`. Viz D58.
75. **Nová hodnota `Placement` patří na DVĚ místa** (union v `affiliate.ts`
    i `PLACEMENTS` v `/go/[network]/[user].ts`) — jinak proklik spadne na `card`
    a měření tiše lže. Platí i pro `sticky` z D58. Kdo přidává CTA, ať ověří
    `curl` na `/go/{síť}/{nick}/?p={placement}`: u Chaturbate musí být
    `track={placement}`, u CrakRevenue `aff_sub1={placement}`.
76. **Počet sítí se NEPÍŠE do textu.** Homepage tvrdila „all 7 sites" ještě den
    po tom, co jich bylo jedenáct, a ve stejném odstavci měla správné číslo
    z dat. Bere se `META.networks.length` (nebo `FACETS.networks.length`).
    Viz D58.
77. **Cíl odchozího odkazu se bere Z FEEDU, ne podle citu.** BongaCams dává
    čtyři varianty a my měli tu nejhorší (`chat_url` = `chat-popup`, tedy
    vyskakovací přehrávač → obecná titulka a Cloudflare challenge). Správná je
    `chat_url_on_home_page` (`csurl=…/{Nick}`). Kdo mění `deepLink()`, ať se
    podívá, co síť sama posílá — a pak to ověří `scripts/check-redirects.ts`.
    Viz D59.
78. **Nabídka u agregátora může ignorovat `model=`.** MyFreeCams přes
    CrakRevenue (offer 3648) posílal **každý** nick na `myfreecams.com/?cam=30352`
    — i URL vzatá přímo z jejich feedu. Odkaz, který nedovede k té modelce,
    je podvod na návštěvníkovi, ne jen ztracená provize: síť je vypnutá. U nové
    sítě z agregátoru vždycky ověř dva různé nicky, ne jeden. Viz D59.
79. **Autoplay se povoluje po dvou MĚŘENÍCH, ne podle dojmu:** host nesmí být na
    blokovacích seznamech (jinak Heavy Ad Intervention rámec po 4 MB odstraní,
    D13) **a** embed musí hrát bez interakce — ověřuj s
    `--autoplay-policy=document-user-activation-required`. Streamate (`purecam`)
    tím neprojde (video není ztišené), stripchat a imlive ano. Klikací vrstva
    `STREAM_LINK` patří jen Chaturbate: u CrakRevenue přiřadí provizi klik
    uvnitř jejich rámce. Viz D59.
80. **`scripts/check-redirects.ts` nesmí do CI.** Je to jedenáct skutečných
    affiliate prokliků; každé dvě hodiny by to vypadalo jako klikací fraud.
    Týdně cronem a ručně. A testuje se `username`, ne slug z feedu — cam4 na
    slug vrací `error-no-profile`. Viz D59.
81. **Odchozí odkaz nepatří do náhledu karty.** `.card-cta` se skrývá jen pod
    `@media (hover: hover)`, takže na telefonu svítí pořád — a v náhledu leží
    v ploše, kterou člověk mačká, aby otevřel modelku (změřeno: střed karty
    vracel `a.card-cta`, 7 z 8 prokliků `?p=card` je z dotyku). Od 27. 8. je
    odkaz **poslední v kartě a mimo náhled**: na dotyku pás 44 px v toku, na
    myši pilulka nad spodním okrajem náhledu. Pilulka se pozicuje z `cqw`
    (`.card` je `container-type: inline-size`), protože patička mění výšku podle
    zalomení jména — `bottom` by ji rozhodilo. Zvětšovat odchozí cíl **uvnitř**
    náhledu je krok zpět: pás by tam zabral 23 % plochy karty místo 4,9 %.
    Viz D61.
82. **Popup a embed URL nikdy jako cíl nového tabu.** Stránka pro rámec nebo
    vyskakovací okno se mimo svůj kontext běžně sama zavře, takže návštěvníkovi
    „blikne záložka" (BongaCams `chat-popup`, D59). `check-redirects.ts` to
    hlídá u **všech** sítí, ne jen u té, kde se to stalo — je to chyba, která
    se z kódu nepozná. Viz D61.
83. **Hover se v headless Chromiu na Malině NEDÁ emulovat.** Prohlížeč hlásí
    `hover: none` i `pointer: none` a `Emulation.setEmulatedMedia` s tím
    nepohne, takže měření „na desktopu" tiše běží na DOTYKOVÉ větvi CSS a
    projde na nesprávném stylu. `scripts/check-card-taps.mjs` proto myší větev
    vynucuje přepsáním media queries v doručeném CSS (`hover: hover` → `all`,
    `hover: none` → podmínka, která nikdy neplatí). Kdo měří cokoli závislého
    na hoveru, ať si nejdřív vypíše `matchMedia('(hover: hover)').matches`.
84. **Když síť zabije iframe, hledej v jejím feedu stream.** BongaCams posílá
    u každé modelky `stream_feed_url` (HLS na `bcvcdn.com`) — na `<video>`
    neplatí `$subdocument` ani Heavy Ad Intervention a ten host na seznamech
    není. Marker `hls:` z `embedUrl()` je stejný princip jako `widget:`: co se
    nesmí dostat do `iframe.src`, nesmí vypadat jako URL. Viz D62.
85. **U HLS je HTTP 200 slabý důkaz.** Playlist neexistující nebo skončené
    modelky má 25 bajtů a nula variant — chyba se pozná až z obsahu, ne ze
    stavového kódu. A **shard v adrese se z nicku odvodit nedá** (cizí shard =
    404, 34 shardů na 1 293 modelek), přitom zastarává: medián vysílání 1,2 h
    proti syncu po 2 h. Proto `/api/online/{síť}/?s=1` a tichý fallback na
    poster + odkaz. Viz D62.
86. **Obnova adresy streamu se ptá na JEDNU modelku, ne na seznam.** Mapa
    150 nejsledovanějších byla k ničemu: shard mění právě dlouhý ocas
    (změřeno — všechny tři modelky s novým shardem měly 10–49 diváků, hranice
    top 150 je 102), populárním drží. `api_v=2&username={nick}` vrátí jednu
    modelku ve 2,8 kB místo 4,4 MB (chce `client_ip`, je **case-sensitive**
    a na offline modelku odpoví `Invalid model username or offline model`).
    Obsluhuje `/api/stream/bongacams/{nick}/`. A kdo přidá do `/api/online`
    parametr, který mění obsah odpovědi, **musí ho přidat do cache klíče** —
    klíč je `origin+pathname` bez query, takže by mřížka dostala odpověď
    určenou někomu jinému. Viz D62.
87. **Odkaz s `target="_blank"` na doménu s plošným `$popup` je mrtvý
    proklik.** Blokovače popupem rozumí i nový tab z kliknutí: záložka se
    otevře a hned zavře — a v našich datech to vypadá jako uskutečněný proklik.
    Z jedenácti sítí to má jen BongaCams (ověřeno 27. 8.), takže se u ní
    naviguje na místě. **Plošné pravidlo je jen to, kterému za hostem nic
    nezbývá:** `||cam4.com^*&utm_source=$popup` plošné NENÍ a guard na tom
    napoprvé sám spadl. Viz D62.
88. **Guard nesmí importovat `src/lib/data.ts`.** Přitáhne katalog (13 MB JSONu)
    a skript spadne na `ERR_IMPORT_ATTRIBUTE_MISSING`. Sdílené konstanty patří
    do malého modulu (`src/lib/popup-blocked.ts`), který `data.ts` jen
    reexportuje. Stejné pravidlo jako u syncu (past 64).
89. **Kdy karta zhasne, se předpovědět nedá.** Změřeno na 8 043 pokojích
    Chaturbate se dvěma snímky 27 minut od sebe: přežije 82 % a **napříč všemi
    skupinami stejně** (délka vysílání 77–85 %, publikum 78–84 %). Riziko konce
    je v čase konstantní, takže řadit mřížku podle „šance na přežití" nemá
    smysl. Jediné, co s výměnou karet jde dělat, je udělat ji dřív (přednačtení
    feedů z `<head>`, žádné čekání na `requestIdleCallback`) a plynule. Viz D63.
90. **Síť bez živého feedu nikdy nezhasne.** Do 28. 8. neměly stripchat,
    streamate ani imlive `/api/online/`, takže 18 z 60 karet na homepage
    tvrdilo „Live" napořád. Mají ho teď (CrakRevenue, top 100 podle score),
    ale s příznakem **`viewersUnknown`**: ta síť diváky nehlásí, takže by
    z heuristiky `floor` vyšlo, že offline je každá modelka mimo odpověď —
    a mřížka by zhasla skoro celá. Kdo přidá feed bez počtů diváků, musí ten
    příznak nastavit. Viz D63.
91. **Váhy sítí jsou v `src/lib/network-weight.ts` a stojí na GA4.** Chaturbate
    nese 50 % prokliků a dostával 10 % karet; váha 4 z něj dělá třetinu mřížky
    a první kartu. Váhy musí být na **třech místech současně**: `diversify()`
    v buildu, klientské doplňování rezervy (`data-network-weight` na `<body>`)
    a `similarLive()`. Když se změní jen jedno, poměr se po opravě mřížky
    rozpadne. Před změnou čísel se kouká do `ga4.py money`. Viz D63.
92. **Odznak „Offline" nestačí — musí zmizet i přehrávač.** Stránka postavená
    jako živá nechávala běžet rámec, takže na tmavém webu svítil bílý blok
    „Room is currently offline" z cizí domény. Povýšení offline→online kód uměl,
    opačný směr ne. Blok `[data-player-offline]` je proto v HTML od začátku
    skrytý a živá kontrola ho odkryje. Viz D63.
93. **`registry-gone` se ukládá ZHUŠTĚNĚ.** 28. 8. mělo 26,17 MB proti limitu
    KV 25 MB a sync přestal ukládat (noční běh CI spadl). Zkrátit retenci
    nepomůže — **všech 140 531 záznamů bylo mladších 30 dnů**, stejně jako
    v srpnu. Zaniklá stránka nepotřebuje `streak`, síť (je v klíči) ani datum
    jako řetězec: tvar `{v:3,base,t:[cíle],r:{klíč:[first,last,seen,peak,cílIdx,page?,hours?]}}`
    dá 48 B místo 186 B, tedy 8,33 MB. **Kdo čte `registry-gone` mimo sync
    (`~/ai/scripts/ecamx/demand.py`), musí umět rozbalit.** Starý plochý tvar se
    pořád načte. Viz D63.
94. **CSP se generuje z postaveného webu, neopisuje se.** `scripts/build-csp.ts`
    (postbuild) vytáhne z `dist/client/**` hosty rámců, obrázků a videí
    a hashe inline skriptů; nová síť tím allowlist rozšíří sama a cizí skript
    build zastaví. Tutéž hodnotu vloží do Workeru za `__ECAMX_CSP__`, protože
    na Worker routy `_headers` NEPLATÍ. `style-src` musí zůstat
    `'unsafe-inline'` (filtr sítí vyrábí `<style>` za běhu). Viz D63.
95. **Do `.env` patří jen to, co potřebuje BUILD.** `import.meta.env` se sahá
    výrazem (`PUBLIC_${k}`), takže Vite vloží do bundlu **celý objekt** — a
    `PUBLIC_XLOVE_API_KEY` s `PUBLIC_LIVEJASMIN_API_KEY` tak seděly v nasazeném
    kódu Workeru, přestože je build vůbec nečte. Runtime klíče patří do Worker
    secrets. Hlídá rozšířený guard v `check-links.ts`, který od 28. 8. skenuje
    `dist/client/**` i `dist/server/**`, ne jen index finderu. Viz D63.
96. **Vite zapéká do bundlu Workeru CELÉ prostředí procesu**, ne jen `PUBLIC_*`
    (ověřeno 28. 8.: v `dist/server/chunks/*.mjs` byl kompletní výpis env).
    Build se proto nesmí pouštět v shellu s načtenými creds — sync ano, ten je
    potřebuje. `pnpm deploy` na tom teď padne dřív, než něco nahraje, protože
    před `wrangler deploy` běží guard.
97. **Živý průchod mřížkou nesmí čekat na nejpomalejší feed.** Deset feedů
    dobíhá mezi 230 a 736 ms, takže `allSettled` posunul opravu na 663 ms.
    První průchod jde na čas (300 ms), druhý po doběhnutí — a **musí být
    idempotentní**: „Show more" i hláška pod mřížkou se z předchozího kola
    odstraní a GA události se posílají jen z posledního (past 32). Viz D63.
98. **CSP a přehrávač: `media-src` potřebuje `blob:`.** hls.js dává `<video>`
    MediaSource přes `URL.createObjectURL` a transmuxer pouští ve workeru
    z blobu. Bez toho přehrávač tiše nehraje **jen tam, kde není nativní HLS**
    — na Malině to nepoznáš, protože její Chromium HLS umí. Ověřuje
    `check-hls-player.mjs`, který si cestu přes knihovnu vynucuje. A pozor,
    CSP kontroluje **cíl přesměrování**: náhledy Amateur.tv jdou z
    `www.amateur.tv` na `f-stream-captures.a0s.net`. Viz D63.
99. **Rozpočet souborů je hra s nulovým součtem — a stránkování mřížek je
    v ní ta nejlevnější měna.** Rozpočet dnes měří minuty CI, ne soubory
    (past 7; do 7. 9. 2026 to byl free limit 20 000 souborů). Stránkování stálo 1 103 souborů a mělo **23
    zobrazení za 28 dní** (půlka z toho legacy adresy), zatímco strop vyhazoval
    851 archivních stránek S MĚŘENOU POPTÁVKOU. Strop `MAX_GRID_PAGES` je proto
    3 a **cestuje s `GridSize`**, aby ho `getStaticPaths()` i stránkovací lišta
    braly stejně — jinak lišta odkazuje na negenerované stránky. Adresář
    `/models/` strop NEMÁ, je to jediná trvalá crawl cesta (D33). Viz D64.
100. **Živé modelky nesmí sníst celý rozpočet stránek.** Každá živá dostávala
    stránku dřív než jakákoli archivní, takže archiv bral zbytek a stránky
    s poptávkou padaly pod stůl. `ARCHIVE_RESERVE` je proto 2 400 (bylo 900):
    ~860 nejtenčích živých profilů počká v registry. Mřížka ukazuje 60 karet
    z 15 000 a odložené profily jsou stejně `noindex`, takže to nikdo nepozná —
    na rozdíl od zahozené pozice v Bingu. Viz D64.
101. **Free limit Actions je 2 000 minut na ÚČET, ne na repo.** Sdílejí ho
    ecamx, rankizo a rankmat; ecamx sám bral ~1 782 min a 28. 8. to celé
    přeteklo — GitHub přestal spouštět joby s hláškou o fakturaci. Build jede
    od té doby **4× denně** (`0 0,6,12,18`), rozdělané běhy se ruší
    (`cancel-in-progress`) a ruční kontrolní skripty jsou v `paths-ignore`.
    Kdo sahá na interval nebo na počet stránek, ať si nejdřív sečte minuty
    všech tří rep — a ať ví, že **zmenšit web vyjde dráž než ubrat běh**:
    pevná část běhu je ~2,3 min, takže 5 běhů s menším katalogem stálo víc než
    4 běhy s plným. Viz D65.
102. **Delší interval znamená víc zombie karet, ne prázdnou mřížku.** Mřížka se
    zaplní i ze starých dat (karty mimo výřez feedu mají stav „nevíme"), ale
    část z nich už nevysílá. Nad 3 h stáří stránky proto klient vymění i tyhle
    nejisté karty za potvrzeně živé z rezervy; na čerstvé stránce ne, aby se
    mřížka zbytečně nehýbala (D57). Prahy hlášek o zastaralosti musí jít nahoru
    spolu s intervalem, jinak strašily každou noc. Viz D65.
103. **Malina umí web nasadit, když CI nejede** — `bin/ecamx-pi-deploy.sh`
    (cron `15 */2`). Je to **záchranná brzda, ne druhý plánovač**: když je
    nasazený build mladší než 7 h, skript hned skončí, takže při funkčním CI
    nedělá nic. Build na Malině trvá 17 min a **potřebuje aspoň 3 GB volné
    paměti** — jinak ho zabije earlyoom v půlce (změřeno 28. 8. dvakrát).
    Build jede v čistém prostředí (past 96) a bez zelených guardů se nenasazuje.
    **Kolik paměti smí build sežrat, se dá spočítat, ne hádat:**
    `/etc/default/earlyoom` má `-m 8 -s 8` a v `--prefer` je `node`, takže
    jakmile systému klesne volná paměť pod **8 % z 8 062 MB = 645 MB**,
    earlyoom sestřelí právě náš build. Z toho plyne `halda ≤ volno − 1400`
    (645 práh + ~400 růst ostatních sezení + ~350 režie V8 a katalogu).
    Sedí to na obou měřeních: volno 3 030 / halda 2 048 prošlo, volno 2 834 /
    halda 1 934 bylo zabito. Skript si haldu počítá sám a čeká až 20 min na
    okno volné paměti, protože 30. 8. couvl o 22 MB a další šance byla za 2 h.
    **Cron má holé `PATH=/usr/bin:/bin`, kde `pnpm` ani `node` nejsou** — skript
    na tom 29. 8. spadl ve dvou po sobě jdoucích bězích („pnpm: command not
    found") a web zůstal na 20 h starém buildu, aniž by to kdokoli poznal:
    záchranná brzda tiše nefungovala od chvíle, kdy vznikla. Nvm bin se proto
    přidává do PATH natvrdo (profil se v cronu nenačítá) a chybějící `pnpm` je
    od té doby hlášená chyba, ne němé selhání. Práh volné paměti jde na ruční
    pokus snížit přes `ECAMX_MIN_FREE_MB`. Viz D65.
104. **Feed z Workeru vidí JINÝ roster než build.** CamSoda, cam4 a LiveJasmin
    servírují lineup podle IP volajícího: build jede z Maliny/GitHubu, runtime
    z Cloudflare — průnik klíčů byl u CamSody 190 z 1 689, u cam4 11 z 300.
    Heuristika „chybí ve feedu → offline" tím sestřelila 14 živých karet z 18
    (CamSoda), 11 z 18 (cam4) a 15 ze 17 (LiveJasmin) a ty sítě z mřížky zmizely
    úplně. Příznak **`absenceUnproven`** proto u nich zakazuje zhasínání; mají
    ho i XLoveCam a tři sítě z CrakRevenue (ty diváky nehlásí, takže `floor` je
    nula a platí na každého). Zhasíná se jen u Chaturbate, BongaCams
    a Amateur.tv, kde roster sedí. **Kdo přidá síť, ať nejdřív porovná průnik
    `/api/online/{síť}/` s feedem staženým odjinud.** Viz D66.
105. **Statická karta nemůže slíbit živý stream — feed ano.** I při čtyřech
    buildech denně je stránka až 6 h stará a za 27 minut dovysílá 18 % pokojů;
    na 13,9 h starém buildu bylo z 60 viditelných karet potvrzeně živých **12**,
    takže čtyři z pěti kliků skončily na „just ended the stream". Od D67 proto
    `/api/online/{síť}/?cards=N` vrací **hotové karty** (nick, náhled, diváci,
    adresa přehrávače) a klient jimi na starší stránce nahradí nejisté karty
    a na stránce dovysílané modelky rozjede náhradu. Dvě pravidla k tomu:
    **`?cards=` MUSÍ být v cache klíči** (past 86 — klíč je jinak jen
    `origin+pathname`, takže by mřížka dostala tučnou odpověď a naopak),
    **Karta smí vzniknout jen pro modelku, jejíž stránku máme** — feed jich
    vrací i spoustu bez stránky (stripchat 12 z 20) a posílat je do pokoje
    partnera Kenny zakázal (D68). Seznam je statický `public/live-pages.json`,
    ne data ve Workeru: 400 kB literál by se parsoval při startu isolate.
    A **náhled musí posílat endpoint**: odvodit ho z nicku jde jen u Chaturbate
    a Streamate, ostatní sítě mají v adrese podpis, shard nebo hash. Ověřeno
    proti živým feedům všech osmi sítí: náhled i adresa přehrávače dojdou všude
    kromě dvou — **BongaCams** adresu streamu ve feedu schválně nemá (celý feed
    má 4,4 MB, čerstvá adresa se bere z `/api/stream/bongacams/{nick}/`, D62),
    takže náhrada na jeho stránkách musí sáhnout tam; **Amateur.tv** přehrávač
    nemá vůbec (widget odstraněn v D63), takže tam zůstává poctivá hláška.
106. **Záchranná karta si musí přepsat i `target`.** Klonuje se ze sousední
    karty, takže po ní zdědí `target="_blank"` — a u BongaCams (jediná síť
    v `POPUP_BLOCKED_NETWORKS`, D62) blokovač nový tab zabije, takže by proklik
    nikam nevedl. Seznam jde na klienta atributem `data-same-tab` na `<body>`,
    aby zůstal na jednom místě v `popup-blocked.ts`, kde ho hlídá
    `check-blocklists.ts`. Stejně tak zmizí odznaky HD/New/Toy a `data-preview`
    původní modelky — o té nové by lhaly.
107. **Guard, který měří jen počty, přehlédne to podstatné.** `check-grid.mjs`
    hlásil „všechno v pořádku" na stránce, kde ze 60 karet vysílalo 12: kontroloval
    počet karet, pořadí a CLS, ale ne to, jestli za kartou někdo je. Teď měří
    **podíl potvrzeně živých** (čerstvá stránka ≥ 80 %, starší tří hodin ≥ 50 %)
    a `check-hls-player.mjs` má případ „modelka dovysílala → hraje náhrada".
    Na čerstvé produkci se ale záchrana **nespustí** (a to je správně: podmínka
    je „starší 3 h A živých míň než polovina"), takže by ta cesta zůstala
    neměřená. `check-rescue.mjs` proto stránce podstrčí starou značku buildu
    **a prořídí feed živosti na 5 %** — feed s `?cards=` nechá být, jinak by se
    testovala vlastní podvržená data. Naměřeno 29. 8.: **60 z 60 viditelných
    karet potvrzeně vysílá**, 52 z nich je z feedu, CLS 0.
    Obojí jde změřit jen proti živému webu; proti statickému serveru se to
    přeskočí, protože `/api/online/` tam není.

108. **Povýšení offline stránky musí stream pustit, ne odkrýt tlačítko.** Když
    se stránka stavěla jako offline a modelka mezitím vysílá (D19), do 29. 8.
    se jen odkrylo Play — Kenny: „stream neběží a musíme zmáčknout play."
    Rámec se teď vkládá sám (`startEmbed('auto')`), ale **jen u sítí
    v `AUTOPLAY_SAFE`**: streamate nemá ztišené video a Chrome mu autoplay
    zablokuje, XLoveCam a LiveJasmin jsou na EasyListu. Kdo tam chce přidat
    síť, ať to nejdřív změří s `--autoplay-policy=document-user-activation-required`,
    ne podle dojmu. Rozhoduje stránka modelky (`data-autoplay`), Layout jen
    pošle `ecamx:model-online`. Viz D68.

109. **Náhled, který vrátí 404, není prázdný obrázek — je to díra v mřížce.**
    Cam4 nemá snapshot pro část modelek (i pro ty, co vysílají) a
    `snapshots.xcdnpro.com` vrací 404 s `text/html`, což prohlížeč u obrázku
    zahodí (ORB). Na `/site/cam4/` to bylo **8 ze 40 karet**; homepage ukázala
    1 z 60, takže se na to nedá spoléhat při kontrole. Cam4 na to má vlastní
    pole (`profile_thumb`, `thumb_error`) → `thumbnailFallback`. Pořadí: živý
    snapshot → profilovka → avatar → teprve pak kartu vystřídá rezerva.
    **Kdo přidává síť, ať se podívá, jestli feed nemá podobné pole** — a ať
    guard pustí na rozcestník té sítě, ne jen na homepage. Viz D69.

110. **Zablokovaný rámec u návštěvníka se z Maliny nezopakuje — a nemusí.**
    Kenny 30. 8. hlásil u Cam4 „Tento obsah je blokován"; z Maliny se rámec
    načetl u 14 z 14 modelek, `www.cam4.com` není na blokovacích seznamech,
    Cam4 neposílá X-Frame-Options a naše CSP ho má ve `frame-src`. Blokuje to
    něco u návštěvníka a **cizím rámcem se proti tomu bránit nedá** — správná
    odpověď je rámec zrušit. Cam4 posílá ve feedu `preview_url`, tedy živý HLS
    (286 z 300 modelek), takže hraje v našem `<video>` jako BongaCams (D62).
    Adresa je ale krátkodobá (12 h stará = 404 u 8 z 8), takže se čerstvá tahá
    z `/api/stream/cam4/{nick}/` **rovnou**, ne až po selhání. Viz D70.

111. **`wrangler deploy` může skončit s nulou a nic nenasadit.** 30. 8. se
    zastavil na 11 898 z 18 271 souborů, vrátil 0 a web zůstal šest hodin na
    starém buildu. Úspěšný běh končí `✨ Success! Uploaded N files`; ten
    spadlý ne. `ecamx-pi-deploy.sh` proto po deployi porovná
    `<meta name="ecamx-built">` z `dist/client/index.html` s tím, co servíruje
    produkce, a bez shody skončí chybou. **Nevěř návratovému kódu, ověř
    výsledek** — platí i pro ruční `wrangler deploy`. Viz D70.

112. **Karta nemá odchozí odkaz — a nesmí ho dostat zpátky.** Tlačítko „Chat →"
    za sedm dní neudělalo ani jeden proklik (`card` 0), zatímco klik do streamu
    na stránce modelky jich měl 27 z 36. Od D71 vede celá karta jen na
    `/live/`. Hlídá to `check-card-taps.mjs`: z 18 bodů po ploše karty nesmí
    ani jeden vést ven, ani po najetí myší. Záchranné karty se od té doby
    poznávají podle `data-rescued`, ne podle `?p=rescue` v CTA.
113. **Prahy stárnutí se počítají ze SKUTEČNÉ mezery, ne z cronu.** GitHub
    plánované běhy zdržuje: `0 1,9,17` se 4.–7. 9. 2026 spouštěl v 05:49 /
    12:41 / 18:55 UTC, tedy o ~4,5 h později, takže noční mezera není
    plánovaných 8 h ale **10,9 h**. S prahem 9 h se proto každou noc ve 04:00
    UTC *současně* nakoplo CI a stavěla Malina — totéž dvakrát, 4,14 běhu denně
    a projekce 1 721 z 2 000 minut místo zamýšlených 1 134. Od 7. 9. zalévá
    noční mezeru **Malina** (`STALE_HOURS` 9 h, vlastní železo), nakopnutí CI
    je záloha zálohy až ve **12 h** a poplach ve **14 h**
    (`bin/ecamx-deploy-watch.py`). Kdo sáhne na `cron`, ať si nejdřív pustí
    `gh run list --json createdAt,event` a podívá se, kdy běhy OPRAVDU jedou.
    Viz D75.

114. **Titulek ani popisek se neseká uprostřed — ubere se to nejmíň důležité.**
    `fitTitle(...variants)` a `fitDescription(lead, optional, tail)`
    v `src/lib/seo.ts`: první varianta, která se vejde do 65 znaků, a vsuvky
    jen dokud se se závěrem vejdou do 155. Bez toho ořezával SERP právě to
    nejcennější — u popisků výzvu k akci na konci (46 % bylo nad 160 znaků).
    **Po každé změně titulků ověř i unikátnost**, ne jen délku: zkrácení může
    dvě modelky sloučit a duplicita je horší než dlouhý titulek (změřeno
    13 414 / 13 414). Viz D74.
115. **Nasazený `robots.txt` není ten náš.** Cloudflare (AI Crawl Control) do
    něj vkládá bloky pro AI boty, `Content-Signal` a druhou skupinu
    `User-agent: *`. Funkčně to nevadí (Google i Bing skupiny slučují), ale
    duplicitu **nehledej v `src/pages/robots.txt.ts`** — tam není. Konkrétně:
    zóna má `is_robots_txt_managed: true` v `zones/{zone}/bot_management`
    (jen globální klíč, past 46). **Vypínat to nemá cenu** — vynucení dělá
    `ai_bots_protection: "block"` na hraně, ne robots.txt, ale ta injektáž nese
    `Content-Signal: search=yes,ai-train=no,use=reference`, tedy rezervaci práv
    podle čl. 4 směrnice EU 2019/790. Že naše `Disallow` platí, se ověřuje
    v GSC (7. 9. 2026: ze 36 stránek s impresemi má 0 vzor `/go/`, `/api/`
    nebo `?`), ne čtením robots.txt. Viz D75. Podobně
    `/cams/hd` → 307 na verzi s lomítkem dělá vrstva assetů Cloudflare
    (`html_handling: auto-trailing-slash`) a status se z aplikace nepřepíše.
    Viz D74.
116. **V `_redirects` se cesta zapisuje procentně zakódovaná.** Cloudflare si
    ji normalizuje, takže `/webcam_country/молдова/` a `/webcam_country/%D0%BC…/`
    jsou pro něj jeden záznam — při obou podobách build hlásí „Ignoring
    duplicate rule" a jednu zahodí. Viz D74.

117. **Záloha z Maliny nasazuje PRACOVNÍ KOPII, CI commitnutý stav.** 4. 9.
    byly opravy nasazené z Maliny v 10:40 a v 13:16 je CI přestavělo pryč —
    živá značka buildu byla novější (`13:16:16Z`) než lokální `dist`
    (`10:16:52Z`), a přesto bez opravy. `ecamx-pi-deploy.sh` je **záchrana pro
    případ, že CI nejede**; u změny kódu patří `git push` PŘED deploy, jinak
    se ověřuje něco, co za pár hodin zmizí. Viz D74.

118. **Při auditu nastav `r.encoding = 'utf-8'`.** Odpovědi mají
    `content-type: text/html` bez `charset`, takže Python `requests` sáhne po
    ISO-8859-1 a UTF-8 pomlčka se počítá jako 3 znaky (titulek 65 → 67, popisek
    152 → 176). Ověření opravy metadat kvůli tomu tvrdilo, že nezabrala.
    Prohlížeče ani Googlebot problém nemají (čtou `<meta charset>`), a přepsat
    Content-Type přes `_headers` by u složkových URL zasáhlo i ostatní soubory.
    Podobně **první stránka v běhu prohlížeče není měření** — LCP homepage
    vyšlo 5 224 ms místo 1 112 ms, dokud před ní nebyl zahřívací průchod.
    Viz D74.

119. **Kolotoč stránek modelek je STRUKTURÁLNÍ — nespravuje se řazením.**
    Registry zná **193 414** modelek, stránku má **17 000** (strop proti free
    rozpočtu minut CI) a živá modelka ji dostane vždycky (D8). Každý běh se
    tedy o slugy přihlásí tisíce vracejících se modelek a stejný počet právě
    offline stránek musí jít pryč: naměřeno **10 750 kandidátů na 5 364 míst**,
    tedy ~5 400 vyhozených za běh. Řazení rozhoduje jen KTERÉ odejdou, ne kolik.
    **Strop se 7. 9. 2026 zvedl ze 17 000 na 22 000** a eviction tím spadla na
    nulu (6 979 kandidátů, 6 979 se vešlo) — šlo to, protože Workers Paid dovolí
    100 000 souborů. Dál už to bez ceny nejde: každá stránka je ~33 ms běhu CI
    a rozpočet je 2 000 min/měs. Před dalším zvednutím pusť
    `python3 ~/ai/bin/ecamx-actions-check.py --dry-run`. Viz D75.
120. **Do sitemapy patří jen `stable`, ne všechno indexovatelné.** Do 7. 9. 2026
    sitemapa slibovala ~15 900 URL a **5 037 z nich (31,6 %) do dvou hodin
    odpovídalo 302** (vzorek 25 z 25) — přesně vzorec „Crawled – currently not
    indexed", který GSC hlásí. `stable` = má poptávku **nebo** `seen` nad
    `seenCut`, a ten se **počítá z rozpočtu** (`archiveBudget × 0,5` mezi
    držiteli stránek), ne pevným číslem: `seen` roste s věkem webu, takže tvrdá
    dvacítka by za pár měsíců pustila dovnitř zase všechny. Práh musí ležet
    **nad** frontou eviction (7. 9.: práh 19, nejvyšší vyhozený `seen` 14).
    **Poptávka práh obchází vždycky** — to je pojistka, kterou žádá paměť
    `seo-dr0-sitemapa-neni-discovery`; ověřeno 2 877 z 2 877. Stránky zůstávají
    `index, follow` (noindex by deindexoval i to, co vydělává na Bingu)
    a discovery drží adresář `/models/` (D33). Hlídá
    `scripts/check-sitemap-churn.mjs`. Viz D75.
121. **`peak` není tiebreak napříč sítěmi.** XLoveCam, LiveJasmin, Streamate,
    Stripchat a ImLive počty diváků **vůbec neposílají** → `peak = 0` u 100 %
    jejich modelek, takže v každé remíze systematicky prohrávaly: Streamate
    ztratil 48 % a Stripchat 46 % stránek proti 28 % u Chaturbate. Řadit se má
    podle `seen` (platí všude a roste nejvýš o 1 za den); `peak` až pak. Totéž
    platí pro každou novou heuristiku nad počtem diváků — nejdřív si vypiš,
    kolik sítí to pole vůbec plní (past 48). Viz D75.
122. **`tsc --noEmit` běží v CI PŘED syncem.** Do 7. 9. 2026 nebyl v pipeline
    vůbec a na `main` proto tiše ležela chyba TS2339 (mapper cam4 přidával do
    karty pole `f`, které v typu nebylo). Krok stojí ~20 s a spadne dřív, než se
    stáhne sedm feedů.
123. **Hlídač přehrávače musí u Cam4 ověřit živost na `/api/stream/`.** Vybíral
    si modelku z mřížky až 8 h starého buildu a pak vyžadoval běžící stream —
    7. 9. 2026 hlásil **osm chyb** v přehrávači, který byl v pořádku
    (`salixbby` byla offline, `{"offline":true}`). BongaCams má adresu ve feedu,
    Cam4 ji z buildu zahazuje a bere čerstvou z endpointu (D70), takže i test
    se musí ptát tam. Kdo přidá síť s `buildUrlUsable: false`, ať dopíše i tuhle
    kontrolu. Viz D75.

124. **Lokální `tsc` prochází z výpůjček, které CI nemá.** Tři různé zdroje,
    všechny odhalené 7. 9. 2026 tím, že přidaný krok „Typecheck" spadl třikrát
    v řadě — a ani jednou na kódu:
    **(a)** `@types/node` v `apps/ecamx/package.json` vůbec nebyl a TypeScript
    ho našel o úroveň výš, v `/home/kenny/ai/node_modules/@types/node` (root
    workspace má vlastní `package.json`, takže resolver při chůzi nahoru
    uspěje); CI klonuje jen repo ecamx.
    **(b)** `src/data/*.json` vyrábí sync katalogu → typecheck musí být ZA ním.
    **(c)** `worker-configuration.d.ts` deklaruje `cloudflare:workers`
    a `ExecutionContext`, je v `.gitignore` a vyrábí ho `wrangler types` —
    lokálně ležel z 16. 8., v CI nebyl.
    Pořadí v CI je proto `wrangler types` → `astro sync` → `tsc --noEmit`, a to
    až po syncu katalogu.
    **Než na tohle sáhneš, ověř v izolaci:**
    `pnpm exec tsc --noEmit --typeRoots ./node_modules/@types` (odhalí (a))
    a smaž `.astro` i `worker-configuration.d.ts` (odhalí (b) a (c)) — jinak
    měříš vlastní pohodlné prostředí, ne to, co bude mít CI. A pozor: `pnpm
    sync` je sync KATALOGU, `pnpm exec astro sync` generuje typy.
    Chyby se navíc řetězí: bez typů `process` hlásí TS i „function returning
    'never' cannot have a reachable end point" a implicitní `any`
    v callbacích, takže jedna chybějící závislost vypadá na šest problémů.

125. **Na Malině sestřelí `tsc` earlyoom, když je volné paměti pod ~2 GB.**
    `--prefer` má `node`, takže padne právě on; pnpm to ohlásí jako
    „Command was killed with SIGTERM" a vypíše `undefined`, což vypadá jako
    porucha nástroje, ne jako nedostatek paměti. Před typecheckem se koukni na
    `free -m` a případně dej `NODE_OPTIONS=--max-old-space-size=1400`.

126. **Guard, který měří proxy místo skutečného artefaktu, padá na neproblému.**
    23. 9. 2026 padalo CI na „mapa přesměrování má 6.0 MB, bundle Workeru má
    limit 3 MB po gzipu" — jenže Cloudflare má **64 MiB v NEkomprimované
    podobě a na obou plánech**; gzip, který vypisuje wrangler, je jen
    informativní. Guard tedy hlídal číslo ze staršího free limitu.
    Kdo tu hranici mění, ať měří **skutečně nasazovaný artefakt**:
    `wrangler deploy --dry-run` vypíše tabulku modulů i `Total Upload`,
    a v CI se to dá vyčíst z logu kroku Deploy. Viz D76.
    **A pozor na to, NA ČEM se měří** — `dist/` po spadlém buildu není
    artefakt, který se nasazuje. Viz past 132.
127. **`dist/server/.prerender` je mrtvá váha, ale úspěšný build ji
    NENECHÁVÁ.** Ověřeno 23. 9. 2026 na dvou místech: CI hlásí
    `[strip] .prerender tam není`, a nasazený Worker měl `Total Upload:
    7167 KiB`, ne 33,8 MB. Zbyde jen po buildu, který spadl nebo byl
    přerušený. `scripts/strip-prerender.mjs` v `postbuild` (až za
    `build-csp.ts`, který skenuje `dist/server/**` kvůli CSP) ji smaže, kdyby
    se to změnilo — je to **pojistka, ne oprava**. Guard v `check-links.ts`
    na přítomnost `.prerender` padá, takže se to neztratí potichu.
    Skutečná váha bundlu byla **mapa přesměrování** (6,4 z 7,0 MB) — viz 129.
128. **Smoke test musí krýt catch-all routu.** Statické stránky obsluhuje
    assets layer PŘED Workerem, takže testování `/`, `/cams/` a `/sitemap.xml`
    tu cestu mine úplně. V CI jsou proto dvě assertion: náhodný nick musí
    vrátit **302** na rozcestník (D53 — zaniklá stránka nesmí 404) a
    `/live/@@@/` musí vrátit **404** (jinak je z webu soft 404). Obě jsou
    ověřené proti produkci.

129. **Mapa přesměrování je v shardovaných assetech, ne v bundlu.** 197 700
    slugů → 379 cílů bylo jako JS literál **6,4 z 7,0 MB bundlu** (naměřeno
    na nasazeném Workeru: `Total Upload: 7167 KiB`) a parsovalo se při každém
    studeném startu. Po přesunu do shardů je bundle **719 KiB**, tedy −90 %. Sync ji teď píše do
    `public/gone/{a–z,0–9,_}.json` (36 shardů) a `[...path].ts` si je tahá přes
    binding `ASSETS` — stejný mechanik jako `/404.html` v tomtéž souboru.
    **Do KV ne** (binding schválně nemá, D3). Cache v isolate ukládá Promise,
    ne výsledek, aby dva souběžné requesty nevyvolaly dva fetchy.
    **Výpadek shardu není 404** — spadne na `/models/{písmeno}/` (D53).
    `check-links.ts` na chybějící shardy nebo jiný počet záznamů tvrdě padá.
    Kdo mění `shardOf()`, ať ho změní na obou místech (sync i Worker) — viz D77.
130. **Rozvrh CI a prahy hlídačů se hýbou SPOLU.** 23. 9. 2026: tři buildy →
    dva (`0 3,15`), takže mezera je 12 h a se zpožděním GitHubu (2–5 h) stáří
    vystoupá na ~15 h. Prahy proto kick 16 h / poplach 18 h a `STALE_HOURS`
    16 h. Při starých 12/14 h hlídač kickoval každý den a spálil minuty, které
    se tím šetří — 22. 9. všech 48 spuštění zálohy padlo do pásma 9–11 h a ani
    jedno nebylo mrtvé CI. Viz past 113 a D77.
131. **`topDemand()` je předpočítaný.** Volá se na každé z 22 000 stránek, ale
    `demand > 0` má jen 238 z 13 846 modelek — filtr a řazení celého katalogu
    při každém volání byl zbytečný. Stejné pravidlo pro každou další funkci
    volanou ze šablony: nejdřív se podívat, jestli se nedá spočítat jednou
    (`LIVE_BY_VIEWERS`, `BY_GENDER_COUNTRY`). Viz D77.

132. **Neměř na `dist/`, který zbyl po spadlém buildu.** 23. 9. 2026 jsem
    naměřil „33,8 MB uploadu, z toho 25,3 MB `.prerender`" a postavil na tom
    celou diagnózu (D76) i commit message. Bylo to špatně: ten `dist/` zůstal
    po **neúspěšném** lokálním buildu, který se zasekl na `/index.html` kvůli
    chybějícímu `PUBLIC_CRAKREVENUE_AFF_ID`. **Úspěšný build `.prerender`
    nenechává** a nasazený Worker měl 7,0 MB. Správný postup: měřit to, co se
    opravdu nasadilo (`Total Upload` v logu kroku Deploy, nebo
    `wrangler deploy --dry-run` nad distem, o kterém vím, že vznikl úspěšným
    buildem), a když měření vyjde nápadně vysoko, **nejdřív zkontrolovat, že
    ten artefakt je vůbec ten nasazovaný**. Je to stejná rodina chyb jako
    past 118 (Latin-1) a 124 (vypůjčené typy): měření na nesprávném stavu
    vypadá jako měření. Viz D76 (oprava) a D77.

## Rozhodnutí

Viz `docs/DECISIONS.md`. Migrační plán: `~/.claude/plans/lovely-waddling-curry.md`.
Přístupy: `~/ai/credentials/.ecamx-credentials.env` (nikdy do gitu ani do chatu).
