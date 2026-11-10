# Rozhodnutí (ecamx.com)

Číslovaná rozhodnutí, na která se odkazuje z komentářů v kódu.

---

## D1 — `output: 'static'`, ne SSR

Katalog má ~1 100 stránek, což se pohodlně vejde do limitu **20 000 souborů**
na deployment (free plán Workers). Statické assety mají na Cloudflare **requesty
zdarma a neomezeně** a Worker se u běžné návštěvy vůbec nespustí — takže se
nedotýkáme ani limitu 100 000 requestů/den, ani 10 ms CPU.

Zvažováno SSR (jako vian): zbytečné. Data se mění po hodinách, ne po sekundách,
a SSR by u každé návštěvy platilo CPU za něco, co je pokaždé stejné.

## D2 — Žádná runtime databáze

Sync generuje `src/data/*.json`, Astro z nich staví stránky v `getStaticPaths`.
Za běhu se do ničeho nečte.

Zvažováno D1 (jako pokector) a Turso (jako vian). Obojí by přidalo runtime
závislost a u Turso navíc write kvótu, na které už vian jednou umřel. Pro web,
který se přegeneruje jednou denně, je databáze zbytečná vrstva.

## D3 — Registry modelek v Cloudflare KV

Jediný stav, který musí přežít mezi buildy. Bez něj by se množina profilových URL
měnila každý build (feedy vrací jen právě online modelky) a Google by viděl, jak
tisíce URL vznikají a mizí.

Pravidlo: profil vznikne po **5 po sobě jdoucích výskytech**, drží se **14 dní**
po zmizení, strop **1 600** stránek řazeno podle peak diváků.

Proč KV a ne R2: KV má prosté REST API s bearer tokenem, R2 jen S3 se SigV4
podpisem. Zápis probíhá 1× denně, takže limit 1 000 zápisů/den je bez problému.
Registry se čte a zapisuje **jen při buildu**, není to Worker binding.

## D4 — Radikální prořez místo 26 830 stránek

Starý web měl 26 830 profilů a 5 930 kategorií, z nichž **64 % mělo count 0**
a 84 % míň než 5 modelek. Nulová návštěvnost za 9 měsíců.

Nový web: ~290 kategorií (práh 50 živých modelek), ~20 zemí, ~740 profilů.
Práh se měří proti jednomu live snapshotu (~7 600 online), ne proti kumulaci.

Rozhodl Kenny 16. 8. 2026 — varianta „radikální prořez".

## D5 — Náhledy zůstávají hotlinkované

Cloudflare si u free plánu vyhrazuje právo omezit servírování „videa nebo
neúměrného podílu obrázků a velkých souborů". Dokud náhledy tečou přímo z CDN
sítí (`thumb.live.mmcdn.com` atd.) a video jede v iframu na doméně sítě,
přes naši zónu jde jen HTML. Proxování náhledů by tenhle stav změnilo.

Důsledek: Cam4 podepsané URL expirují → `onerror` fallback je povinný.

## D6 — Sync selhává hlasitě

Když síť vrátí míň modelek než `minExpected`, hodí se chyba. Když padnou dvě
a víc sítí, build skončí nenulovým kódem a **nasazení se nestane**.

Alternativa (nasadit, co přišlo) by znamenala, že vypršelý klíč nebo změněné API
tiše vyprázdní část webu a nikdo si toho týdny nevšimne.

## D7 — Prefix `webcam_` v URL mizí

Starý web měl `/webcam_category/latina/` — technický artefakt WordPressu.
Nové URL: `/cams/{slug}/`, `/country/{slug}/`, `/site/{network}/`, `/girls/`.

`/live/{slug}/` zůstává beze změny, aby profily nepřišly o to málo, co mají.
Pro ~290 zachovaných kategorií vznikne 301 mapa, zbytek půjde na 404.

## D8 — Stránku dostane každá modelka, do indexu jen prokázané

**Kontext:** D3/D4 daly vlastní stránku jen 781 z 8 011 modelek. Karta bez
stránky vedla rovnou na affiliate deeplink, takže **~90 % kliků z mřížky
okamžitě odešlo z webu** a longtail na nicky se nesbíral.

Že longtail existuje, potvrzuje GSC: za 90 dní 73 impresí z 31 dotazů, ale
devět z nich jsou nicky modelek — `dulcesecreto69` (pozice 10),
`shandateneyck` (7), `danielaxhotty` (20), `cloves7368` (45). Jeden nick nese
1–2 imprese za čtvrtletí; smysl to dává až po tisících.

**Rozhodnutí (Kenny, 16. 8. 2026):**

- Stránku `/live/{page}/` dostane **každá** modelka z aktuálního syncu
  (~8 000) plus offline z posledních 45 dnů, do stropu `MAX_MODEL_PAGES`
  (14 000). Karta v mřížce vede vždy dovnitř; ven vede jen tlačítko „Chat".
- Do indexu a sitemapy jde jen modelka viděná aspoň `INDEX_MIN_DAYS` (3) různých
  dnů. Zbytek má `noindex, follow`. Při spuštění to je ~1 100 z 8 900 stránek
  a číslo roste každý den, jak se registry plní.
- Práh je jedna konstanta v `sync-cams.ts` a ladí se podle pokrytí v GSC.

**Proč ne indexovat všechno:** doména má DR 11 a starý web zabilo přesně tohle
(26 830 thin stránek, nula návštěv). Brána je pojistka, ne cíl.

**Cena:** free plán Cloudflare má strop **20 000 souborů na deployment**.
Při 14 000 stránkách modelek zbývá ~5 000 na zbytek — stránkování kategorií
se do free tieru už nevejde.

## D9 — Zánik stránky po 45 dnech a 301 na kategorii

Feedy vrací jen právě online modelky, takže „kdy naposled vysílala" ví jen
registry. Nově drží i **snapshot** posledního stavu — bez něj by offline
stránku nebylo z čeho vykreslit, a přitom právě ta je cílem longtailu
(kdo hledá nick, najde profil, kdy byla naposled živá, a mřížku živých
alternativ).

- `GRACE_DAYS = 45` — pak stránka zaniká a vzniká 301 na její nejsilnější
  kategorii (→ `/country/`, → `/site/{network}/` jako záloha).
- Návrat je automatický: jakmile se modelka objeví ve feedu, `gone` se maže
  a stránka se postaví znovu.
- Jednou nastavené `gone` se ruší **jen** skutečným vysíláním. Bez toho by
  modelky na hraně stropu blikaly mezi stránkou a přesměrováním.
- Slug se přiděluje **jednou provždy** (`page` v registry). Dřív holý slug
  patřil nejsledovanější modelce daného nicku — při 14 000 stránkách by URL
  putovaly mezi lidmi a Google by na jedné adrese potkával pokaždé někoho
  jiného. Kolize dostávají `{slug}-{network}`.
- `_redirects` má **tvrdý limit 2 000 pravidel** a přebytek Cloudflare tiše
  zahodí. 329 legacy pravidel je v `seed/legacy-redirects.txt`, zbytek generuje
  `scripts/build-redirects.ts` a při ořezu to hlásí jako chybu, ne mlčky.

## D10 — Chaturbate jede na revshare, ne PPS

Chaturbate vybírá program parametrem `tour` v URL, ne nastavením účtu. Kódy
jsou konstanty (ověřeno na 40 záznamech feedu): `LQps` revshare chat,
`9oGW` revshare embed, `yiMH`/`Jrvi` PPS varianty.

Kenny chce příjem z dýšek → revshare (20 % z utracených tokenů trvale) místo
PPS (jednorázově za registraci).

**Zároveň opraveno:** env `CHATURBATE_TOUR` obsahovala `rev`, což není platný
kód — Chaturbate ho ignoroval a odkazy padaly na výchozí program účtu. Tour se
proto bere z konstanty v `affiliate.ts`, ne z env. Kanonický tvar odkazu je
`chaturbate.com/in/?tour=…&campaign=…&track=…&room=…`, ne `/username/?campaign=…`;
`track` je volný řetězec a nese umístění prokliku (`card`, `profile`, `player`, …).

## D11 — Offline se smí označit jen to, o čem to víme

Endpoint `/api/online/{network}` tahá jen prvních N modelek (CPU limit).
Původně platilo „kdo v odpovědi není, je offline" — jenže Chaturbate má 4 000
modelek online a bereme 300, takže na kategoriích s méně sledovanými modelkami
**zhasínaly živé karty**.

Nově odpověď nese `truncated` a `floor` (nejnižší počet diváků v odpovědi).
Klient smí kartu zhasnout jen tehdy, když odpověď nebyla oříznutá, nebo když
modelka měla při buildu víc diváků než `floor`.

CPU (naměřeno `wrangler tail`, free limit 10 ms/invokaci):
BongaCams při 300 záznamech 14 ms → limit 150 → 5 ms. CamSoda parametr `limit`
**ignoruje** a vždy pošle 1,2 MB, takže se dvojice tahají regexem z textu místo
`JSON.parse` (11 ms → 4,5 ms), s fallbackem na plný parse, kdyby se tvar změnil.

## D12 — Bot Fight Mode pryč, místo něj rate limit na /api/online/*

**Mylná diagnóza, kterou tohle opravuje:** 403 z CI runnerů se svádělo na WAF
pravidlo „Block mimo EU". To je ale **vypnuté od 20. 2. 2026** (potvrzeno
v `backups/ecamx-waf-before-20260816-1725.json`) a nikdy tu chybu nezpůsobovalo.

**Skutečná příčina — Bot Fight Mode.** Security events za 23 h (GraphQL
`firewallEventsAdaptive`): **964 z 1 000 událostí má `source=botFight`**.
Z nich **426 mělo User-Agent reálného prohlížeče** — 287 z USA, 99 z Polska —
a **268 mířilo na `/live/…`**, tedy přímo na stránky, kde se konvertuje.
Bot Fight Mode se na free plánu nedá nikomu povolit výjimkou (WAF skip ani
IP allowlist na něj neplatí), takže je to jen zap/vyp.

**Rozhodnutí (Kenny, 16. 8. 2026):** Bot Fight Mode **vypnout**. Statické assety
jsou na Workers zdarma a bez limitu, takže na drtivé většině webu není co chránit.

**Náhrada:** rate limit na jedinou metrovanou cestu — `/api/online/*`
(počítá se proti 100 000 požadavků/den free plánu). Free plán dovolí jen okno
**10 s** a `mitigation_timeout` **10 s**; nastaveno **40 požadavků / 10 s na IP**.
Jedno načtení stránky vystřelí max 7 požadavků (jeden na síť), takže člověk na
hranici nedosáhne. Ověřeno: náraz 90 paralelních požadavků → 46× 200, 44× 429,
po 10 s zase 200; statické stránky nedotčené (30× 200).

Zůstávají zapnutá pravidla na `wp-login.php`, `xmlrpc.php` a spamové cesty —
nic nestojí a odfiltrují hluk po starém WordPressu.
Záloha původního stavu: `backups/ecamx-botfight-before-20260816-2331.json`.

## D13 — Přehrávač a affiliate odkaz MUSÍ mít jinou URL

**Co se stalo.** V D10 jsem přepsal Chaturbate embed na `/in/?tour=9oGW…`, aby
konečně přiřazoval provizi. Tím jsem rozbil přehrávač: místo streamu se
uživatelům ukazovalo „Tato reklama v zařízení používala příliš mnoho zdrojů,
proto ji Chrome odstranil."

**Příčina — Chrome Heavy Ad Intervention.** Chrome sám odstraní cross-origin
iframe, který je označený za reklamu a překročí limit **4 MB přenosu** (nebo
60 s CPU celkem, 15 s v 30s okně). Živý stream ty 4 MB utáhne za pár sekund.
Za reklamu ho Chrome označí podle filtrovacího seznamu a v EasyList je přímo:

```
||chaturbate.com/in/                                     blokuje /in/ i jako iframe
##a[href^="https://chaturbate.com/in/?"]                 skrývá odkazy na /in/
@@||chaturbate.com/in/$subdocument,domain=cam-sex.net    cizí cam web si musel
                                                         vyjednat výjimku pro iframe
```

Z dokumentace Chrome: *„An ad is considered heavy if the user has not
interacted with it"* — **interakce uživatele rámec z intervence vyjímá**.

**Háček, proč to nešlo jen vrátit.** Ověřeno podle cookies `fromaffiliate`
a `in_hit`: provizi přiřadí **jedině `/in/`**.

| URL | HTTP | affiliate cookies |
|---|---|---|
| `/{room}/?campaign=` | 200 | 0 |
| `/embed/{room}/?campaign=` | 200 | 0 |
| `/embed/{room}/?tour=9oGW&campaign=` | 200 | 0 |
| `/in/?tour=…&campaign=&room=` | 302 | **2** |

Z toho zároveň plyne, že Chaturbate **před 16. 8. nepřiřazoval vůbec nic** —
největší síť webu (~4 000 modelek) jela nadarmo.

**Rozhodnutí:** rozdělit role. Nesjednocovat!

- **přehrávač → `/embed/{room}/`** — na žádném seznamu není, Chrome ho nezabije.
  Provizi nepřiřazuje, ale nepřiřazoval ji nikdy; s `/in/` by nebyl ani stream,
  ani provize. Bonus: `/embed/` obsahuje i chat a tlačítko SEND TIP.
- **CTA odkazy → `/in/?tour=LQps`** — jediné, co vydělává.

**Navíc: přehrávač se spouští až na klik.** Poster s náhledem + play button,
iframe se vloží teprve po kliknutí. Platí pro všechny sítě: rámec se tak nikdy
nerozjede bez interakce uživatele, takže limit 4 MB nemá jak intervenci spustit.
Změřeno na produkci: před kliknutím **0 požadavků** na síť, po kliknutí stream
běží a po 70 s je rámec pořád živý (904×509).

**Blokátory neobcházíme.** Skrývací pravidlo schová CTA uživatelům s blokátorem
a necháváme to tak — přesouvat URL do `data-` atributu a navigovat JS by bylo
obcházení volby uživatele. Krytí je odkaz „Player not loading? Open … directly"
pod přehrávačem, který pomůže i při geo-bloku nebo když modelka skončila.

**Známé, neopravitelné:** LiveJasmin (`||ptcdw.com^`) a XLoveCam
(`||xlovecam.com^$third-party`) mají embed host na seznamu a alternativu z jejich
affiliate panelu nemáme. LiveJasmin má navíc skrytý i CTA (`rpwmct.com`).

**Guard:** `scripts/check-blocklists.ts` stahuje EasyList + EasyPrivacy a
porovnává s tím, co je v `dist/client`. Iframe na blokované cestě = **chyba**,
skrytý odkaz = varování; už známé případy jsou v `KNOWN_BLOCKED`, aby guard
hlásil jen nové regrese. Ověřeno obojí: se `/in/` v iframu spadne, bez něj projde.

## D14 — Mřížky ukazují jen to, co teď opravdu vysílá

**Co Kenny viděl:** „když přijdu na web, je tam spousta lidí offline, lidem
připadá, že je poloumrtvý web."

**Měření (17. 8., data z buildu 11,7 h stará), podíl karet, které klientský
živý stav zhasl:**

| mřížka | karet | jistě online | offline |
|---|---|---|---|
| homepage | 30 | 6 | **80 %** |
| `/girls/` | 60 | 21 | 65 % |
| `/couples/` | 60 | 7 | 88 % |
| `/cams/teen/` | 60 | 3 | **95 %** |
| `/cams/bigass/` | 60 | 3 | 95 % |

Zašedlé karty byly původně kompromis (ukázat, že modelka není live). Ve
skutečnosti to při takovém podílu vypadá jako mrtvý web.

**Dvě příčiny, dvě opravy:**

1. **Data byla stará až 24 h** (sync 1× denně). → cron **každé 2 h**.
   Rozpočet: běh ~4 min, 12 běhů/den ≈ 1 440 z 2 000 free minut GitHub Actions
   za měsíc. Kratší interval se do free tieru nevejde. **Delší build ten
   rozpočet ujídá taky** — proto je rezerva na stránkách modelek malá.
2. **Zbytkovou nesvěžest řeší klient.** Offline karty se **skryjí** (ne zašednou)
   a mřížka se doplní z **rezervy**: do HTML jde 3× víc karet, než se ukáže
   (na stránkách modelek jen 1,5×, je jich přes 10 000). Karty se zároveň
   přeskládají — jistě živé podle počtu diváků nahoru.

Rezerva je v HTML od začátku, takže crawler i prolinkování vidí všechno; skrytá
je jen pro uživatele. Cena: `dist` narostl z 369 na 455 MB, stránka kategorie
ze 91 na 233 kB. Počet souborů se nezměnil (10 450), takže limit 20 000 to
neohrožuje.

**Co se záměrně NEskrývá:** modelka, o které živý stav nic neví. Feed vrací jen
prvních N podle popularity (celkem dohlédne na ~2 500 z 8 000), takže „není
v odpovědi" ≠ „je offline" (viz D11). Radši ukázat pravděpodobně živou než
prázdnou mřížku.

**Zbývající slabina:** u úzkých kategorií může být live jen pár modelek a mřížka
zůstane krátká i po doplnění. Klient v takovém případě dopíše „Only N models
here are live right now" s odkazem na homepage — poloprázdná plocha bez
vysvětlení vypadá jako chyba, tohle ne.

## D15 — Archivní stránka jen pro to, co patří do indexu

Rezerva karet (D14) vytlačila počet stránek na strop 14 000 a jeden běh vyrobil
**13 050 přesměrování**, z nichž se do limitu 2 000 v `_redirects` vešlo 1 671 —
zbylých 11 379 URL spadlo na 404. Guard to nahlásil, ale příčina byla jinde:
archivní stránku dostávala i modelka, která nikdy nebyla indexovatelná. Do stropu
se nevešly, hned zanikaly a churnovaly URL.

**Neindexovatelná stránka nikdy nebyla v sitemapě a nikdo na ni neodkazuje, takže
je u ní 404 správná odpověď, ne 301.** Archiv proto dostane jen `seen >= INDEX_MIN_DAYS`
a `gone` se zakládá jen pro takové. Slug jim zůstane rezervovaný do prune, ať ho
nedostane jiná modelka a stará adresa neukázala cizí člověka.

Dopad: stránek 14 000 → 8 566 · souborů 14 353 → 8 917 · dist 455 → 374 MB ·
build 4m24s → 3m45s · přesměrování 13 050 → 1 888 (poprvé bez ořezu) ·
běh CI 5 → 3 min, tedy 12 běhů/den ≈ 1 080 z 2 000 free minut.

Tím se dvouhodinový sync z D14 teprve stal udržitelným — bez tohohle by ho
snědl rozpočet Actions.

## D16 — Klientské řazení nesmí zrušit prokládání sítí

Po zavedení řazení podle **živých** diváků (D14) obsadil horní řady mřížky zase
celý Chaturbate: hlásí řádově vyšší čísla než ostatní a XLoveCam s LiveJasminem
je neposílají vůbec, takže nejlépe platící síť spadla na konec. To je přesně ta
vada, kterou `diversify()` při buildu řešil.

Řešení: uvnitř stejné jistoty (jistě live / nevíme / offline) se sítě prokládají
round-robinem, uvnitř sítě rozhoduje počet diváků. Změřeno po nasazení —
homepage: 5 Chaturbate, 5 BongaCams, 5 Amateur.tv, 4 CamSoda, 4 XLoveCam,
4 LiveJasmin, 3 Cam4; prvních sedm karet je ze sedmi různých sítí.

U úzké kategorie se proloží jen to, co existuje: `/cams/teen/` je 59/60
Chaturbate, protože ten tag ostatní sítě skoro nepoužívají. To je v pořádku.

## D17 — Odchozí odkazy přes vlastní `/go/`

Zadání: „všechny streamy nám musí vydělávat, když se proklikne." Audit našel, že
mechanicky atribuce funguje u všech 7 sítí (ověřeno cookies a cílovými URL:
Chaturbate `fromaffiliate`+`in_hit`, XLoveCam `xlove_id_affi`, BongaCams
`BONGAH_HIT`, Cam4 a Amateur.tv v URL, LiveJasmin přes meta refresh na `psid`).
Ztráty byly jinde.

**Odkazy teď vedou na `/go/{network}/{nick}/?p={placement}`** a Worker odtud
přesměruje 302 na affiliate URL. Čtyři důvody, ani jeden sám by nestačil:

1. **Klíč z HTML.** Amateur.tv používá jeden string jako affiliate ID i jako
   credential k feedu, takže ležel ve veřejném HTML na 582 stránkách a kdokoli
   s ním mohl tahat jejich feed na náš účet. Po změně 133 (zbytek potřebuje
   widget v DOMu, jinak by Amateur.tv přehrávač nešel).
2. **Měření.** `placement` dostávaly jen 2 ze 7 sítí, ostatní ho zahazovaly.
3. Affiliate logika na jednom místě — rotace ID je změna secretu, ne rebuild.
4. Menší HTML (~70 B na kartu, 180 karet na mřížkové stránce).

**Vedlejší efekt, který je potřeba říct nahlas:** kosmetické filtry blokátorů
schovávají odkazy podle cílové URL (`##a[href^="https://chaturbate.com/in/?"]`,
totéž `rpwmct.com`), takže u dvou nejdůležitějších sítí CTA části návštěvníků
vůbec nesvítilo. Na first-party `/go/` to pravidlo nesedí. **16. 8. jsem napsal,
že blokátory obcházet nebudeme; 17. 8. to Kenny po předložení téhle informace
rozhodl jinak.** Text odkazu zůstává pravdivý včetně jména sítě a přiznání
provize — nemaskuje se destinace, jen se nepoužívá URL, kterou filtr zná.

**Bezpečnost routy:** `network` proti výčtu, nick proti `/^[A-Za-z0-9_.-]{1,64}$/`
(ověřeno na všech 9 202 modelkách: mimo alfanumeriku jen `-` a `_`, nejdelší 32
znaků). Cíl se skládá ze šablony, nikdy z uživatelského vstupu → open redirect
není možný. `noindex`, `Disallow: /go/`, `no-store`. Chybějící secret = 404
a hlasitá chyba, ne tichý proklik zdarma pro síť.

**Riziko:** peníze teď stojí na Workeru (free 100 000 req/den, dnes jednotky)
a `/go/*` **nesmí** spadnout pod rate limit určený pro `/api/*`.

**Guard v CI** místo grepu ve statickém HTML (ten by po tomhle refaktoru
přestal fungovat): po deployi se u všech 7 sítí ověří, že `/go/` vrací 302 na
affiliate URL se správným markerem, a že neplatné vstupy vracejí 404.
Čte se hlavička `Location` — `%{redirect_url}` se v CI u části sítí vracelo
prázdné, zatímco lokálně fungovalo, a guard tak hlásil chybu, kterou web neměl.

## D18 — Dvě nejlépe platící sítě nebyly skoro nikde

`modelsInCategory()` filtruje podle `tags`, `modelsInCountry()` podle `country`.
Kdo je nemá, není na žádné filtrované stránce. Změřeno v datech:

| síť | modelek | gender | country | tagy |
|---|---|---|---|---|
| xlovecam | 432 | **0** | 0 | **0** |
| bongacams | 866 | 866 | **0** | 866 |

- **XLoveCam** posílá `category`, `tagList` a `language_speak` jako **číselné
  kódy**. `cam-networks.ts` odkazoval komentářem na `xlove-filter-map.ts`, který
  v repu nikdy nebyl → všechno prázdné a síť byla **jen na homepage**, na 325
  filtrovaných stránkách ne. Mapu jsem našel ve starém pluginu
  (`includes/crons/xlove_filter_map.php` na zálohovaném VPS) a přenesl do repa.
  Výsledek: 480 genderů a 27 kategorií místo nuly.
- **BongaCams** posílá zemi v poli `homecountry`, kód čte `r.country`, které
  v jejich feedu **vůbec neexistuje** → 866 modelek bez země. Po opravě 646 zemí.
- `snapshot` byl nejčastější „kategorie" LiveJasminu (374 modelek) — je to
  technický příznak schopnosti snímku, ne kategorie. Do `JUNK`.

`tagList` je vyplněný jen u ~12 % modelek, ale `category` u všech, takže se
z kategorie dělá ještě jeden tag — jinak by zbytek do `/cams/` nespadl.
Zemi XLoveCam nehlásí nijak (plugin ji taky nikde nebral).

## D19 — Offline stránka se umí povýšit na živou

Data jsou až 2 h stará, takže stránka vygenerovaná jako offline může patřit
modelce, která právě vysílá. Ověřeno na produkci: u Cam4 a XLoveCamu dostal
návštěvník „isn't streaming right now", přitom podle živého API vysílaly.
Kdo přišel na jejich nick z Googlu, odešel — přímá ztráta prokliku.

Klientský živý stav teď v takovém případě schová hlášku, odkryje play a přepne
CTA z profilu na živý pokoj (`data-offline-msg`, `data-cta-offline`,
`data-live-href`). Naopak stránka vygenerovaná jako živá se **nepřepíná** na
offline — přehrávač sítě si to řekne sám a `/go/` funguje tak jako tak.

## D20 — Přehrávač naskočí sám, kde to Chrome nezabije

Heavy Ad Intervention platí **jen na rámce označené za reklamu** (D13), a
`/embed/` u Chaturbate, CamSody, Cam4 ani BongaCams na žádném blokovacím
seznamu není. U těch čtyř (+ Amateur.tv, který má vlastní JS widget) se stream
načte hned — na výdělečné stránce nemá být klik navíc. LiveJasmin (`ptcdw.com`)
a XLoveCam na seznamu **jsou**, takže tam poster + play zůstává.

Seznam je konstanta `AUTOPLAY_SAFE` v `src/pages/live/[slug].astro` a hlídá ho
`scripts/check-blocklists.ts`: kdyby se některý host na seznam dostal, CI spadne
a seznam se musí **zkrátit**, ne guard obejít.

## D21 — Bezpečnostní úklid (a co se schválně nedělá)

Audit nenašel nic kritického: klíče v `dist/client` neuniky, escapování dat
z feedů drží (ověřeno na 17 803 JSON-LD blocích a 8 566 modelkách),
`rel="noopener"` je na 100 % z 214 330 výskytů. Opraveno:

- `PUBLIC_XLOVE_API_KEY` a `PUBLIC_LIVEJASMIN_API_KEY` se pekly do nasazeného
  Worker bundlu, i když je build vůbec nečte — runtime endpoint je bere z Worker
  secrets bez prefixu. Rotace tak vyžadovala rebuild a klíče šly vytáhnout
  z kódu Workeru. Smazány z `deploy.yml` i z `.env.example`.
- `/api/online/*` vracelo klientovi `e.message`; URL feedu Amateur.tv i s klíčem
  má 93 znaků, takže se do limitu 120 vešla celá. Teď jen `reason: 'upstream'`
  a plná chyba do observability.
- Cache key obsahoval query → `?cb=<random>` obešel edge cache a vynutil
  upstream fetch s naším klíčem. Normalizováno na pathname.
- Blok `/api/*` v `_headers` byl mrtvý kód (assets layer se na Worker routu
  neaplikuje) → hlavičky jsou v odpovědi endpointu.
- `privacy.astro` nezmiňoval `cdn.a00s.net`, který na 133 stránkách běží jako
  **first-party** JS a umí čtení DOMu i storage. To je materiálně jiná věc než
  iframe a bylo to na hraně tvrzení „we do not run advertising trackers".
- `CSS.escape()` u selektoru se slugem, iframe `referrerpolicy` sjednocen se
  site-wide politikou (posílal sítím plnou URL profilu).

**CSP: jen část.** Nasazeno `object-src 'none'; base-uri 'none'; form-action
'none'; frame-ancestors 'none'; upgrade-insecure-requests` — na tomhle webu není
`<form>`, `<input>`, `<object>` ani `<embed>` (ověřeno) a nikam se needembeduje,
takže to nemá co rozbít. `script-src` a `frame-src` **schválně ne**: musely by
povolit inline module skript (Astro ho inlinuje) a 6 domén přehrávačů, a to se
nedá nasadit naslepo bez Report-Only fáze s vlastním sběrem reportů. Reálná
hodnota plné CSP by tady byla jediná — omezit, co může udělat kompromitovaný
`cdn.a00s.net`.

**Vědomě neděláno:** `COEP: require-corp` (rozbije všech 6 přehrávačů a 9 CDN
s náhledy), `sandbox` na iframu přehrávače (buď ho `allow-same-origin` anuluje,
nebo rozbije stream), SRI na `cdn.a00s.net` (vendor aktualizuje bez ohlášení,
rozbilo by widget při jejich příští tiché aktualizaci), monetizace odkazů na
2257 compliance stránky sítí.

**Zbývající riziko, které neumím zavřít:** `cdn.a00s.net` běží ve first-party
kontextu, takže kompromitovaný skript může přepsat `href` odchozích odkazů a
inkasovat provizi za nás. Statický guard to nevidí. Zmírnění: widget je scoped
jen na 133 stránek Amateur.tv.

## D22 — „cam girls" TOP 3 je nedosažitelné; cílíme longtail s KD 0–24

Zadání znělo „TOP 3 na cam girls". Změřil jsem SERP (Ahrefs, US, 17.–18. 8. 2026)
a **nedá se to on-page prací splnit**, takže to plán ani neslibuje.

`cam girls` (20 000/měs, KD 59) drží **redakce a UGC, ani jeden cam agregátor**:
chicagoreader.com/adult/cam-sites/ (DR 81, **2 075 refdomén na tu jednu stránku**),
laweekly.com/best-cam-sites/ (DR 84), Instagram (DR 100), Reddit (DR 95),
Wikipedia (DR 97), IMDb, observer.com, YouTube. Na pozici 2 je **AI Overview**,
který cituje NBC News a časopis University of Chicago. Google ten dotaz čte jako
redakční, ne jako „prohlížej živé streamy". Náš stav: DR 13, 0 organických klíčů,
0 kliků z 32 dotazů za 90 dní.

**Místo toho cílíme na změřenou poptávku, která je dosažitelná.** Segmenty
s KD ≤ 24 dávají **~19 000 hledání/měs** — skoro tolik jako celý head term, ale
proti DR 0–46 místo DR 81–100: bbw 7 400 (KD 24), ebony 3 600 (KD 0),
mature 1 700 (13), feet 1 400 (4), teen 1 100 (0), lesbian 500 (20),
smoking 500 (0), granny 300 (0), arab 200 (5), redhead 150 (0), indian 90 (0).

Že je to reálné, ukazuje uncams.com: **DR 33**, 13 058 organických klíčů,
**5 101 v TOP 3**, 644 522 návštěv/měs. Jeho `/latina-cams` stojí #2 na
„latina cam girls" — a jeho stránka je proti naší srovnatelná (108 kB, 1 520 slov,
105 odkazů na modelky) až na jednu věc: **36 odkazů na jiné kategorie, my 10.**

Kenny rozhodl 17. 8.: **longtail teď, redakční vrstva později** (redakce je jediný
typ stránky, který v tom head SERPu žije, ale stojí na odkazech) a **odkazy neřešit**.
Bez odkazů má on-page strop: konkurenti v cílovém SERPu mají 1 158–4 959 refdomén,
my 489, z nichž **94 % je spam** z portfoliové vlny (`googleseocompany.shop`,
`rankcollective.shop`, `paramount-collective-outrank-hq-dr-90.store`).

**Past, kterou z toho plyne: KD se nesmí věřit bez kontroly SERPu.**
`squirt cams` má 2 000/měs a KD 12, ale ten SERP je o **skutečných kamerách** —
dronový web shendrones.com/squirt-v2, akvárium cmaquarium.org/webcams/, Amazon
„Squirt Fountain webcam". Naše největší kategorie (1 691 modelek) tedy míří na cizí
intent a je v `MONEY_CATEGORIES` označená `intentOk: false`.

## D23 — Kurátorská vrstva kategorií nad automatickou taxonomií

Automatická taxonomie je **slovník performerek, ne hledajících**. Největší kategorie
jsou úkony bez poptávky: lovense 1 717 modelek → 100 hledání/měs (KD 64),
dancing 1 084 → 10, games 885 → 0, tattoos 665 → 0, „chatting" 799, „enjoying" 681.
15 největších kategorií = ~13 000 modelek a dohromady **2 910 hledání/měs**.

Naopak segmenty s poptávkou **propadly oběma síty**: `NOT_A_CATEGORY` vyhazuje
`bbw`, `indian`, `asian`, `ebony` z tagů s odůvodněním „patří do jiné taxonomie" —
jenže **etnicitu a postavu hlásí jen 2 ze 7 sítí** (1 360 z 8 082 modelek má
etnicitu, 379 postavu). Tag signál je řádově bohatší: `bbw` 181 v tazích vs. 15
v `bodyType`, `latina` 522 vs. 275, `ebony` 316 vs. 11, `curvy` 306 vs. 42.

Řešení = `src/lib/money-categories.ts`: ruční seznam podle změřené poptávky,
členství jako **unie signálů** (tagy + strukturovaná pole + gender + věková skupina),
`FacetKind = 'money'`, **bez prahu 50**. Automatická taxonomie zůstává vedle.

Zamítnuto: snížit globální práh na ~15 — vrátilo by stovky thin stránek a přesně
tohle zabilo starý web (26 830 profilů, 5 930 kategorií, 64 % s nulou modelek).

Dvě pojistky proti thin contentu: **`MIN_MEMBERS = 20`** (živé + archiv) a
**`MIN_LIVE = 10`**. To druhé není zbytečné: mřížka offline karty skrývá (D14),
takže kategorie s 20 modelkami v archivu a nulou online by se ukázala prázdná.
`arab` je díky nim správně vynechaný (5 živých).

Výsledek: **24 kategorií, 7 nových URL** — bbw 285 živých, filipina 83, indian 50,
gay 42, pregnant 35, granny 25, japanese 12 — a **17 rozšířených**: teen 569→2 625,
anal 1 070→1 966, feet 598→1 354, latin 275→877, ebony 191→479, asian 78→464,
bdsm 95→469, curvy 42→346, redhead 133→352.

**Fráze „cam girls" se použije jen tam, kde je pravdivá.** `girls` počítá sync
z podílu žen (`GIRLS_SHARE_MIN = 0.8`), netipuje se. Ověřeno na datech: `gay` 0 %
a `latin` 74 % (122 mužů a 70 trans na stránce) frázi nedostanou, `bbw` 86 %,
`mature` 95 % a `curvy` 95 % ano.

## D24 — Jedna kanonizace pro sync i render (opravený tichý bug)

`src/lib/data.ts` měl **vlastní kopii `canonicalTerm()` bez `CANONICAL`**, přitom
komentář nad ní tvrdil „musí být identická se syncem". Sync tedy modelku do
kategorie spočítal, ale stránka ji nenašla:

| stránka | v titulku | reálně našla | ztraceno |
|---|---|---|---|
| `/cams/big-tits/` | 1 103 | **244** | **878** (`bigboobs` 709, `bigtits` 169) |
| `/cams/bigass/` | 1 107 | 786 | 321 (`big-ass`, `big-ass-babe`) |
| `/cams/squirt/` | 1 691 | 1 638 | 53 (`squirting`) |
| `/cams/tattoos/` | 665 | 599 | 66 (`tattoo`) |

Titulek tedy lhal o počtu a mřížka byla řídká. Kanonizace je nyní **jen v
`src/lib/taxonomy.ts`** a importuje si ji sync i render. **Neduplikovat ji.**

## D25 — Země z volného textu se normalizují na ISO-2, zbytek se zahazuje

Web měl DVĚ stránky pro jednu zemi: `/country/co/` (1 385 modelek) i
`/country/colombia/` (151), stejně `ke` a `kenya`. Obě indexovatelné, obě v sitemapě,
a protože `COUNTRY_NAMES` klíč `colombia` nemá, `countryName()` spadlo na
`code.toUpperCase()` → titulek, H1, popisek i JSON-LD hlásily
**„COLOMBIA Cams – 151 Live Models from COLOMBIA"**.

Příčina je horší než duplicita: **BongaCams má v `homecountry` volný text psaný
performerkou.** Ze 646 modelek má 613 jméno místo kódu a je tam **183 různých
hodnot** — anglické názvy, cyrilice („Россия" 79 modelek), vtipy („Бонгания" =
Bongania, „Вебкамия" = Webcamia), „Europe" i vycenzurovaný „*********k".

`canonicalCountry()` v `src/lib/taxonomy.ts`: jmenná mapa včetně cyrilice
(hledá se **před** slugifikací, protože ta nechá jen `[a-z0-9]` a „Россия" by
zmizelo), a **co se nerozpozná, se zahodí** — junk stránka je horší než chybějící
údaj. Zapojeno v syncu, v `modelsInCountry()`, v cíli 301 u zaniklých modelek
i na profilu (ten posílal surovou hodnotu do `countryName()`, takže u BongaCams
modelek zobrazoval `Country: РОССИЯ`).

Výsledek: 21 zemí, všechny ISO-2, žádná duplicita; Kolumbie 1 385 → 1 612
a přibyly `ru` 123, `mx` 31, `in` 24, `br` 20.

## D26 — Text stránky modelky se generuje z dat, ne z AI

Longtail na nicky je **jediný změřený zdroj pozic**, který web má. GSC (90 dní):
`/live/carolvask/` pozice 1,0, `/live/peliirrojoo/` 1,0, `/live/alaydream/` 1,0,
`/live/chanteclingan/` 4,0 (2 kliky). Mechanismus funguje. U vyhledávanějších nicků
ale prohráváme (`azhunastar` 52, `kloee-brown` 55, `chatepoilue` 50,
`danielaxhotty` 20), protože stránka nemá čím konkurovat — jen `<dl>` a citace
`subject`. Konkurenční uncams.com má na profilu **1 156 slov** a jeho profily nesou
900–2 200 návštěv/měs.

`src/lib/model-copy.ts` staví text **výhradně z uložených dat**: `aboutParagraphs()`
z atributů, `historyParagraphs()` z registry (`first`/`last`/`seen`/`streak`/`peak`).
`peak` se do katalogu dřív vůbec nepropisoval — doplněno v `decorate()`.

Pravidla, která se nesmí porušit (jsou i v komentáři modulu):
1. **Nic se nevymýšlí** — každá věta odpovídá poli; když pole není, věta se vynechá.
2. **Žádné relativní časy** („3 days ago") — sync deployuje 12× denně, text by se
   měnil při každém buildu. Absolutní datum je stabilní.
3. **Žádný `Math.random()`** — varianta se volí deterministicky ze slugu.
4. **Nehlásíme hodiny ani dny v týdnu**, i když to konkurent dělá
   („When {nick} is usually online"). Registry drží jen `first`/`last`/`seen`/
   `streak`/`peak`; histogram dnů by znamenal další pole u 79 406 záznamů a ten
   KV objekt už má **14,2 MB z povoleného limitu 25 MB**. Místo hodin se hlásí
   frekvence („live most days"), která z dat vyplývá.
5. Modelka viděná jediný den historii nemá a **přiznáme to** místo nafukování textu.

Kenny rozhodl **„nejdřív obsah, pak víc indexu"**. Pozor ale: index se rozšiřuje
sám, protože `seen >= 3` přirozeně dozrává — indexovatelných je z 2 166 už **8 075**.
Obsah je tím urgentní, ne volitelný.

## D27 — Žádné stránkování; místo něj hustší mesh

`categorySeo()` má parametr `page` a `noindex: page > 1`, ale **nikdo ho nepředává —
je to mrtvý kód.** V `/cams/lovense/` (1 717 modelek) tak nedostane odkaz ~1 537
z nich.

Stránkování jsem **zamítl** a mrtvý parametr odstranil. Důvod je měřený:
uncams.com, který na svůj termín stojí #2, odkazuje z kategorie taky jen **105
z 545 modelek** a stránkování nemá vůbec. Vyčerpávající pokrytí není ranking faktor;
modelky se objevují sitemapou a ze stránek sítí. Naproti tomu paginace 324 kategorií
po 60 by přidala tisíce souborů proti limitu **20 000 souborů/deployment**.

Investováno tedy do toho, co konkurent má a my ne: **mesh 10 → 30 odkazů** na
příbuzné kategorie, plus odkazy na země a sítě (kategorie na ně dřív neodkazovaly
vůbec) a na profilu odkaz na zemi a síť. `relatedCategories()` navíc mělo dva tiché
defekty: volalo `modelsInCategory()` **bez `kind`**, takže na stránce etnicity nebo
kurátorské kategorie počítalo vzorek z jiných modelek, a kandidáty bralo jen
z `FACETS.categories`, takže **kurátorské kategorie nedostaly z mřížek ani jeden
vnitřní odkaz**. Totéž `linkableCategories()` na profilech.

## D28 — Počty v titulcích se zaokrouhlují (`approx()`)

Přesný počet modelek byl zapečený v každém titulku, H1 i popisku — a sync
deployuje **každé 2 hodiny**, takže Google viděl u jedné URL dvanáct různých
titulků denně. `approx()` zaokrouhluje **dolů** na hezký krok a píše `250+`:
je to pravdivé (`250+` při 285) a mění se jen když inventář opravdu vyroste.

## D29 — Registry v KV bylo 1,5 dne od hard limitu; zeštíhleno bez změny semantiky

Našel jsem to při plánování SEO práce a je to nejzávažnější nález celé iterace:
**registry mělo 23,31 MB z hard limitu 25 MB na jednu hodnotu v KV.** Rostlo
~336 záznamů **na sync** (ne na den — syncujeme 12× denně), tedy ~1 MB/den.
Do zastavení zápisu zbývalo **~1,5 dne**, a až by `saveRegistry()` selhalo,
rozpadla by se stabilita profilových URL — tedy přesně to, kvůli čemu registry
podle D3 existuje. Google by na jedné adrese potkával pokaždé jiného člověka.

Měření payloadu ukázalo, kde bytes jsou: **snapshoty žraly 12,64 MB z 23,47**
(14 000 záznamů, medián 826 B).

**Uvolněno 6,76 MB → 16,55 MB (63 % limitu), bez jakékoli změny chování webu:**

1. **`SNAP_OMIT`** — 9 polí ze snapshotu (2,79 MB). Čtyři z nich (`blockedCountries`,
   `streamTypes`, `sexualPreference`, `appearance`) **nejsou nikde čtené** — jsou
   to jen deklarace v typu, ověřeno grepem. Zbylých pět (`previewVideo`, `viewers`,
   `onlineSeconds`, `status`, `goalText`) platí **jen pro živou modelku**, a snapshot
   se používá výhradně na archivní (offline) stránce, kde by hodnota z minula lhala —
   šablony to už stejně hlídají přes `model.online &&`, a `previewVideo` je u Cam4
   podepsaná URL, která expiruje.
2. **Snapshot u modelek se `seen < INDEX_MIN_DAYS`** (5,18 MB, 5 878 záznamů).
   Archivní stránka se přiděluje až od `INDEX_MIN_DAYS` viděných dnů, takže u zbytku
   je snapshot mrtvá váha. Je to **samoopravné**: snapshot se ukládá znovu při každém
   výskytu modelky ve feedu, takže i kdyby se práh někdy snížil, data se doplní sama.
3. V `Model` jsou tahle pole teď **volitelná (`?`)**, ať nikdo nezavolá `.map()`
   na `undefined`.
4. `saveRegistry()` **loguje procento limitu při každém běhu**, nad 80 % varuje
   a nad 25 MB **tvrdě spadne s návodem** místo neprůhledného HTTP 413. Tichý
   neúspěch zápisu je tady horší než spadlý build.

**Co tím vyřešené NENÍ:** samotný růst. Prořez retence — třeba zahodit 10 269
záznamů se `seen <= 1` bez přiděleného slugu (dalších 1,2 MB) — **mění retenci
a je to rozhodnutí vlastníka**, ne mechanická úprava, takže jsem ho neudělal.

**Druhý strop, který přetéká už teď:** zaniklých stránek je 2 085 a k tomu
329 legacy pravidel, takže do limitu 2 000 v `_redirects` se **~414 přesměrování
nevejde** a ty URL padají na 404 (Cloudflare přebytek tiše zahodí). Kandidáti na
prořez: legacy pravidla ze starého WP, nebo zkrátit `REDIRECT_DAYS = 180`.

## D30 — Google Analytics 4 a co s ním souvisí

Kenny chce měřit návštěvnost (18. 8.), měřicí ID `G-JSSZP2XFBL` v `Layout.astro`.
Snippet je jeho, doplněné je jen `is:inline`: Astro by stub zabalilo do modulu,
`gtag()` by nebyl globální a `gtag('config')` by ho nenašel.

**Privacy policy se musela změnit, ne „mohla".** Stálo v ní doslova „No analytics
cookies. We do not run Google Analytics or any comparable tracker." Nasadit GA
a nechat tam tohle by znamenalo nepravdivé tvrzení na živém webu. Teď je tam, co
GA sbírá, že to je cookie, odkaz na Google i na jeho opt-out. **Vynechal jsem
tvrzení o nastavení GA property** (advertising features, Google Signals) — do
property nevidím, takže to v právním textu tvrdit nemůžu.

**Cena za výkon je změřená, ne odhadnutá** (iPhone, slow 4G, 4× throttled CPU,
4 běhy, medián): **TBT 718 → 983 ms, tedy ~265 ms** hlavního vlákna. FCP i CLS
bez změny (CLS zůstává 0 po opravě věkové lišty). Pro srovnání: Cloudflare
JavaScript Detections stojí 188 ms, takže jeho vypnutí by GA víc než zaplatilo.

**Dvě věci, které si u čísel z GA pamatovat:**
- **GA bude podhodnocovat.** Na adult webu blokuje `googletagmanager.com` velká
  část návštěvníků — kvůli blokátorům vzniklo celé `/go/` (D17).
- **Cloudflare naopak nadhodnocuje.** Měří serverově a boty počítá, uniques jsou
  podle IP. Za 12.–18. 8. hlásí 9–15 tis. pageviews a 5–8 tis. unikátů denně,
  přitom z organiku je podle GSC ~0 kliků a doména má DR 13 — takže to je
  z velké části bot provoz (viz historie Bot Fight Mode v D12: 964 z 1 000
  událostí bylo botFight). CF je horní odhad, GA dolní; pravda je mezi tím.

**Až se bude dodělávat plná CSP** (`script-src`/`frame-src`, viz D21), GA
potřebuje `script-src https://www.googletagmanager.com` + hash inline stubu a
`connect-src https://*.google-analytics.com https://region1.google-analytics.com`.
Bez toho ho CSP umlčí a nikdo si toho nevšimne, protože stránka bude fungovat.

**Zbývá rozhodnout (Kennyho věc, ne moje):** GA4 nasazuje cookie bez souhlasu.
Web má věkovou lištu, ale žádný souhlas s cookies, a chodí sem provoz z EU.
Možnosti: Consent Mode v2 s výchozím „denied" (měření zůstane, ale bude
neúplné), cookie lišta, nebo se spolehnout jen na serverová čísla z Cloudflare.

## D31 — GA4: měřit proklik, ne návštěvy

Kenny přidal service account jako Editora property a chce „vidět vše pro stream
cam adult web" (18. 8.). Na tomhle webu to znamená jednu věc: **peníze jsou
odchozí proklik na síť**, a ten v GA nebyl vidět vůbec.

**Proč nebyl:** GA4 spouští vestavěné „outbound clicks" jen na odkazy na CIZÍ
doménu. Naše odkazy vedou na first-party `/go/{síť}/{nick}/?p={placement}`
(D17) a cílová affiliate URL se skládá až ve Workeru, takže ji prohlížeč nikdy
neuvidí. Bez vlastní události tedy o proklicích nevíme nic — přitom je to jediné
číslo, kvůli kterému web existuje.

**Pořadí prací určila jedna past:** GA4 zahazuje neregistrované parametry **už
při sběru**, ne že by je jen skrýval v reportech. Registrovat dimenzi později
znamená nevratně přijít o historii. Proto se nejdřív nastavila property a teprve
pak nasazovaly události.

**Nastaveno** (`scripts/ecamx/ga4.py`, kopie osvědčeného `scripts/rankizo/ga4.py`
— PyJWT + requests, žádná Google klientská knihovna kvůli PEP 668 Pythonu na
Malině; **write scope si bere jen `apply` a `mp-secret`**, takže překlep
v reportu fyzicky nemůže nic přepsat):
- **`eventDataRetention: TWO_MONTHS` → `FOURTEEN_MONTHS`** (strop free tarifu).
  Property existuje od 9. 11. 2025, takže starší data už Google smazal.
- 7 event-scoped dimenzí: `network`, `placement`, `slot`, `page_type`,
  `live_state`, `mode`, `model`; 3 metriky: `more_count`, `shown`, `target`.
- key events **`go_click`** a **`go_click_server`**.
- `timeZone` **zůstává `Etc/UTC`** — je to EN web s převážně US publikem, takže
  UTC je neutrální hranice dne, ne devět hodin vedle jako u rankiza. Změna
  nereprocesuje historii, tak je to rozhodnutí na začátku.
- **Google Signals zůstává vypnutý.** U adult obsahu je to správný default —
  a hlavně: teď to **jde ověřit z API**, takže privacy policy to smí tvrdit.
  Tím se uzavírá to, co D30 nechalo otevřené („do property nevidím").
- `industryCategory` **schválně nenastavená**: plní jen benchmarking, který
  nečteme, a poctivá kategorie pro tenhle web v enumu není.

**Události — 8 názvů, a ani jeden nový bajt na kartě.** Vše se odvodí z `/go/`
hrefu a z atributů, které v DOMu už jsou (`article.card[data-network]`,
`[data-live-badge]`, `.is-offline`). Karet je na mřížce 180 a stránek modelek
přes 10 000, takže 20 B na kartu = 3,6 kB na stránku — `/go/` vzniklo mimo jiné
proto, aby ušetřilo 70 B/karta, bylo by absurdní je vrátit kvůli měření. Proto
**jeden delegovaný listener** na `a[href^="/go/"]`, stejný vzor jako u `error`
listeneru pro náhledy.

`go_click` · `player_start` · `player_auto` · `offline_upgraded` · `show_more` ·
`grid_sparse` · `age_accept` · `live_feed_fail`

Dvě věci, které stojí za zmínku:
- **Href se čte až při kliku**, ne při načtení: network CTA se za běhu
  přesměrovává na živou modelku a offline stránka přepíná `?p=offline` na
  `?p=profile`, když modelka naskočí (D19). Čtení při načtení by měřilo lež.
- **`slot` existuje, protože `?p=` samo nestačí**: `profile` posílá hlavní CTA
  i sticky lišta, `player` posílá textový odkaz „Player not loading?" i tlačítko
  „Open full screen". Bez `slot` by se to slilo do jednoho čísla.
- `player_auto` se měří na `load` iframu, ne na jeho přítomnosti — u čtyř ze
  šesti sítí se přehrávač renderuje ze serveru a žádný klik není, takže bez
  toho by spuštění přehrávače u většiny sítí v datech nebylo vůbec.
- `grid_sparse` je Kennyho stížnost ze 17. 8. („připadá jim, že je web
  poloumrtvý") převedená na číslo. `live_feed_fail` byl dosud úplně tichý.

**Serverové měření z `/go/` (`go_click_server`) NENÍ nasazené a čeká na Kennyho.**
GA4 nedovolí vytvořit Measurement Protocol secret, dokud na property není
odsouhlasené *User Data Collection Acknowledgement* — a jeho text je právní
prohlášení, že máme „necessary privacy disclosures **and rights from my end
users**". To je přesně ta věc, kterou Kenny vědomě odložil (souhlas neřešíme),
takže **jsem to za něj nepodepsal**; rozhodl 18. 8., že to odklikne sám v GA4.

Až to udělá, zbývá málo a je to ověřené jako proveditelné: `@astrojs/cloudflare`
14 vystavuje `ExecutionContext` jako **`Astro.locals.cfContext`**, takže
fire-and-forget přes `ctx.waitUntil()` jde (v repu se to dosud nepoužívalo
a Astro 7 zrušilo `Astro.locals.runtime.env`, tak to bylo potřeba dohledat).
Až bude hotové: `go_click_server` **musí zůstat jiný název než `go_click`**,
jinak by se každý klik počítal dvakrát — a rozdíl mezi nimi je konečně
**změřená míra blokování**, kterou jsme dosud jen tušili.

**Souhlas s cookies zůstává nevyřešený.** Kennyho rozhodnutí 18. 8.: neřešit,
jen zdokumentovat. GA4 nasazuje cookie bez souhlasu a provoz z EU sem chodí.
Zapsáno jako **vědomě přijaté riziko**, ne jako opomenutí; právní odpovědnost
je na vlastníkovi.

## D32 — Stránkování mřížek ZAVEDENO (revize D27), stránka 2+ `noindex`

**Tohle otáčí D27.** Tam jsem stránkování zamítl s tím, že „paginace 324
kategorií po 60 by přidala tisíce souborů proti limitu 20 000". Kenny se 18. 8.
zeptal na to, co je z pohledu návštěvníka absurdní: homepage tvrdí, že je online
8 168 modelek, a ukáže 30 karet — a za poslední kartou není nic. To je pravda
a mesh to nespraví, protože mesh vede na jiné rozcestníky, ne na modelky.

Číslo z D27 navíc neplatí. Při **bloku 180 modelek na URL** (60 viditelných,
120 rezerva — stejně jako dnes stránka 1) je celý katalog pokrytý za **425 URL**,
ne tisíce: většina rozcestníků je malá, deset z 362 má víc než 1 200 modelek.
Spočítáno z `facets.json`, ne odhadem. Soubory: 14 383 → ~14 900 proti stropu
19 000, na kterém padá CI (limit Cloudflare je 20 000).

Rozhodnutí:
- **Stránka 1 zůstává na své URL** a soubor se nepřesouval; stránky 2+ jsou nové
  šablony `[slug]/[page].astro` vedle `[slug].astro`. `/1/` se negeneruje.
- **Segment v cestě, ne query** (`/cams/bbw/2/`): `robots.txt` má `Disallow: /*?`,
  takže `?page=2` by crawler nikdy nenavštívil a hlubší stránky by byly slepé.
- **`noindex, follow` na stránce ≥2** a nejsou v sitemapě. Obsah se mění každé
  2 h, „bbw cams page 7" nikdo nehledá a už dnes nabízíme k indexaci 8 122 URL
  s ~0 organickými kliky — crawl budget je tu vzácnější než index. Trvalou crawl
  cestou ke stránkám modelek je proto adresář z D33, ne stránkování; u
  `noindex, follow` Google po čase přestane odkazy následovat.
- Stránka 2+ **nemá** SEO copy, JSON-LD ani křížové odkazy ze stránky 1 — jinak
  by to byl duplicitní obsah na 425 URL.
- Homepage dostala `VISIBLE = 60` (bylo 30, jako jediná se lišila od kategorií)
  a pokračování na `/page/2/`.

Past, na kterou se přitom narazilo: **`getStaticPaths()` běží v izolovaném
rozsahu a na konstanty z frontmatteru nedosáhne** — modulový `const ROUTES`
v `[gender]/[page].astro` shodil prerender na „ReferenceError: ROUTES is not
defined". Importy fungují, proto jsou rozměry mřížek v `src/lib/paging.ts`.

A jedna věc, která se **musí** brát z dat, ne z facetu: počet stránek se počítá
z délky skutečného výsledku, nikdy z `facet.count`. Na tom rozdílu stála chyba
`canonicalTerm` z D24 (`/cams/big-tits/` hlásilo 1 103, našlo 244) a tady by
z ní byly prázdné stránky.

## D33 — Adresář A–Z, protože 6 102 stránek modelek nemělo žádný odkaz

Změřeno na `dist/` 18. 8. (grep odkazů `/live/` ze všech postavených stránek
proti seznamu vygenerovaných):

| | |
|---|---|
| stránek modelek v buildu | 14 000 |
| odkazovaných z rozcestníku | 7 780 |
| **bez jediného odkazu kdekoli na webu** | **6 102** |
| z toho archivních (offline) | 4 849 |

To je horší, než jak to vypadá: archiv **posíláme do sitemapy jako
indexovatelný** (5 832 z 8 122 indexovatelných URL) a přitom na něj nevede ani
jeden interní odkaz. Mřížky ho odkázat nemohou — ukazují jen živé modelky —
a stránkování z D32 to nespraví ze stejného důvodu.

Řešení je `/models/` + `/models/{písmeno}/` po 250 **textových** odkazech
(~70 stránek, ~20–30 kB každá, žádné náhledy). Sirotků je pak 0 **konstrukcí**,
ne odhadem, a hlídá to guard v `check-links.ts`. Náhledy tam schválně nejsou:
u offline modelky by lhaly a Cam4 má v URL podepsanou expiraci.

Řadí se podle slugu `page`, ne podle diváků — obsah stránky je tím stabilní
a přesuny zůstávají uvnitř písmene. Odkaz je v patičce, tedy na každé stránce.
Kategorie navíc dostaly blok „Recently live" (24 textových odkazů do archivu):
kontextové odkazy jsou lepší než abecední výpis a úzká kategorie přestane
vypadat mrtvě.

## D34 — Klik uvnitř Chaturbate embedu nikdy nevydělal; chat z přehrávače pryč

Kenny 18. 8.: „když kliknu na chat, hodí mě to na
`/auth/login/?next=/shena_nomy/` a tam nejsou affiliate parametry."

Naše CTA je v pořádku — ověřeno curlem, že `/in/?tour=LQps&campaign=…&room=…`
vrátí 302, nastaví `fromaffiliate=1` + `in_hit=1` a přes `/gotoroom/` skončí na
pokoji s `campaign` v URL. Klikal **uvnitř iframu**. A tam byl celý pokoj
Chaturbate: chat, SEND TIP, PM, Cam To Cam, Start Private Show, „Purchase
Tokens" — změřeno v prohlížeči 7 odkazů a 40+ klikatelných prvků.

**`/embed/` nenastaví affiliate cookie NIKDY.** Ověřeno třemi variantami —
`campaign` samotné, `campaign` + `tour`, i s `embed_video_only`: odpověď posílá
jen `csrftoken`, `sbr`, `__cf_bm`, a slovo `campaign` se v HTML embedu ani
jednou neobjeví. Cookie dává jedině `/in/`, které ale Chrome označí za reklamu
a po 4 MB odstraní (D13). Klik uvnitř přehrávače byl tedy proklik zdarma pro
Chaturbate — a je to nejsilnější klik na webu.

Chat v embedu je konverzní past: **nepřihlášený návštěvník tam chatovat ani
tipovat nemůže**, jediné, co klik udělá, je že ho Chaturbate převezme bez naší
provize. Kennyho rozhodnutí: chat vypnout a klik měřit.

- `embed_video_only=1` → v rámci zůstalo 0 chat / 0 tip / 0 PM prvků a jediný
  zbylý odkaz (`/{room}/?`) má **rozměry 0×0**, tedy není klikatelný.
- Nad stream jde klikací vrstva `.player-hit` (pravé `<a>` na `/go/…?p=player`,
  `target="_blank"`, `rel="nofollow sponsored"`), takže klik do plochy videa je
  top-level navigace přes `/in/` a provizi přiřadí. Měření na ni chodí
  existujícím delegovaným listenerem, `slot=stream`.
- **Spodních 34 px zůstává nezakrytých:** ovládání video.js je 30 px vysoké
  (změřeno na 390/768/1280 px) a autoplay je podle politiky prohlížeče ztišený —
  bez dosažitelného unmute by stream zůstal navždy tichý.
- Vrstva je **jen u Chaturbate**. Ostatních šest sítí nese affiliate ID přímo
  v embed URL, takže tam klik uvnitř ztracený být nemusí; audit každé z nich je
  samostatná položka, ne odhad.

Zamítnuto: iframe na `/in/` (D13, Heavy Ad Intervention), proxy
`/embed/chaturbate/{nick}/` → 302 na `/in/` (ad-tagging se vyhodnocuje i na
redirectech a cookie třetí strany se blokují), a předstřelení cookie z naší
stránky — to je cookie stuffing.

**Vedlejší nález:** `https://www.cam4.com/en/embed/{nick}` vrací **404 u všech
modelek včetně právě vysílajících** (ověřeno na osmi, z toho čtyřech živých) —
Cam4 tam servíruje výpis kategorií, takže se ~1 000 stránkám modelek do
přehrávače nahrávalo 120 kB cizí chybové stránky. Správná cesta je
`https://www.cam4.com/{nick}/embed`: hraje, má vlastní ovládání a u offline
modelky napíše „I'm currently offline". Cam4 embed má vlastní chat a „Buy
Tokens", takže patří do zmíněného auditu. Cam4 mimochodem posílá v feedu i holé
HLS (`preview_url`) — vlastní přehrávač je tedy možný, ale to je jiná změna.

## D35 — Web mazal vlastní pozice: 89 % impresí končilo na 404

Kenny 19. 8.: „vylepši obsah a on-page, ať máme co nejvíc stránek v TOP 3".
Než jsem sáhl na jediné slovo, změřil jsem výchozí stav — a ukázalo se, že
obsah není to, co web drží dole.

**Co GSC říká za 16 měsíců:** 3 399 impresí, 143 kliků, z toho `/live/`
(stránky modelek) **2 474 impresí a 126 kliků, tedy 88 % všeho**. Stránky
modelek stojí na pozicích 1,0 (`carolvask`, `peliirrojoo`, `asturlolin`,
`li-baby`), 4,0 (`sweetanaflowers`, `chanteclingan`), 6,0 (`christinpawelk`).
Longtail na nicky je jediná věc, která na tomhle webu měřitelně funguje.

**Co URL Inspection API říká o indexaci:** indexovaná je **jediná stránka —
homepage**. `/cams/bbw/` a `/models/` = *Discovered – currently not indexed*,
`/live/tinyxstar/` = *Crawled – currently not indexed*, `/girls/`, `/cams/`,
`/cams/teen/`, `/site/chaturbate/`, `/country/co/` = *URL is unknown to Google*.

**Proč:** web systematicky rušil URL, které Google zná.

| | |
|---|---|
| stránek modelek s impresemi v historii | 837 |
| z toho dnes **tvrdá 404** | **729** |
| ztracené imprese | **2 185 z 2 474 = 89 %** |
| nejsilnější ztráty | `lunarspark` 143 impresí / pozice 6,7 · `tinyxstar` 143 / 10,3 · `hoaarisa` 70 / 6,8 |
| staré kategorie `/webcam_category/` s 404 | 61 ze 110 (`bigboobs` stálo na **4,8**, `brown-eyes` 5,3) |

Tři příčiny, každá sama by stačila:
1. **`_redirects` má limit 2 000 pravidel** a Cloudflare přebytek tiše zahodí.
   Zaniklých stránek bylo 2 085 → 414 se nevešlo.
2. Protože se přesměrování musela do limitu vejít, sync je přiděloval **jen
   stránkám nad `INDEX_MIN_DAYS`**. Živých modelek pod prahem je ale **5 878
   z 8 168**: jejich stránka existovala, dokud vysílaly, a v okamžiku konce
   vysílání se z URL stala 404. `/live/shena-nomy/` zmizela **do dvou hodin**
   od chvíle, kdy jsem na ní ověřoval přehrávač.
3. Retence se řídila jen nabídkou — `last` a `seen`. O poptávce nevěděla nic.

### Co se změnilo

- **Mapa přesměrování se přesunula do Workeru** (`src/pages/[...path].ts`
  + `src/lib/gone.ts`), kde žádný limit na počet pravidel není. `_redirects`
  zůstalo jen na 329 legacy WP pravidel. Statické soubory obsluhuje assets
  layer *před* Workerem, takže catch-all vidí jen to, co soubor nemá — a když
  se modelka vrátí, její stránka je znovu statická a route ji neuvidí.
  **Ověřeno, že nezastínila `/go/` ani `/api/`** (odpověď z `/go/` má dál
  `x-robots-tag: noindex, nofollow` a `text/plain`).
- **302, ne 301.** Modelka se běžně vrátí za pár hodin. U 301 by si prohlížeč
  i Google pamatovali přesměrování dál a URL, která zase žije, by nikdo
  nenavštívil. Trvale přesunutá je jen legacy WP struktura → ta jede 301.
- **Přesměrování dostane každá zmizelá stránka**, ne jen ta nad prahem.
- **Poptávka je nový vstup retence** (`~/ai/scripts/ecamx/demand.py` → KV klíč
  `demand`, čte `sync-cams.ts`): stránka s impresemi v GSC nebo s měřeným
  objemem hledání na nick se **nikdy nesmaže ani nepřesměruje**, při vyčerpaném
  stropu se řadí podle poptávky, a indexovatelnost se otevírá hned — bez čekání
  na tři viděné dny.
- Neznámá cesta vrací **naši 404 stránku** (36 kB s rozcestníkem), ne prázdné tělo.
- `check-links.ts` má šestý guard: každý zaniklý slug musí mít platný cíl.
  Hned první běh našel 5 cílů, které mezitím zanikly (kategorie pod prahem) —
  runtime na ně má záložní adresář, ale guard to teď hlásí.

### Kolik poptávky v katalogu leží (Ahrefs, US)

Změřeno 1 394 nicků z top 2 000 podle peaku (55 552 jednotek):
**1 778 stránek s poptávkou = 201 220 hledání/měs**, většina při KD 0–24.
Pro srovnání `cam girls` má 20 000 při **KD 59** a SERP drží redakce s DR 81–100
(D22). Konkrétně `gummies15` 16 000 (KD 15), `hotfallingdevil` 8 900 (**KD 8**),
`anabel054` 5 600 (22), `realtoxxxmaria` 4 900 (15), `elisparadisex` 4 100 (**0**).

**Past, kterou to odhalilo:** nick bývá běžné slovo a objem pak patří něčemu
jinému — Ahrefs vrátil `hercules` 137 000 (film), `molly` 96 000, `sativa`
92 000 (konopí), `ocicat` 17 000 (kočka). Objem se proto bere jen u nicků, které
jsou samy nezaměnitelné (číslice, `_`, `.`, `-`, nebo ≥ 12 znaků); slovní nicky
se musí potvrdit dotazem **`<nick> cam`** — a to je i podle GSC nejčastější tvar
(`<nick> cam` 197 impresí, `<nick> webcam` 133). Z 400 kontrolovaných se
**91 ukázalo jako falešná poptávka**.

A ještě jedno potvrzení k D13/D34: Chaturbate Users Online API vrací
`iframe_embed_revshare` jako `<iframe src='https://chaturbate.com/in/?…&track=embed'>`
— tedy oficiální embed **je** to `/in/`, které Chrome označí za reklamu a po
4 MB odstraní. Sankcionovaná cesta, která by zároveň vydělávala a přežila,
neexistuje.

## D36 — On-page podle měřených dotazů, ne podle dojmu

Kennyho zadání znělo „vylepši obsah a on-page". Vstup pro to jsou dvě měření,
ne odhad: GSC (jak se ty dotazy skládají) a Ahrefs (kolik jich je a jaká je
obtížnost).

**Jak lidé hledají modelku** (GSC, 16 měsíců, imprese / mediánová pozice):
`<nick> cam` 197 / 11,0 · samotný `<nick>` 151 / 14,5 · `<nick> webcam` 133 / 9,3 ·
`<nick> squirt` 55 / 9,0 · `<nick> dildo` 31 / 5,5 · `<nick> pussy` 27 / 7,0 ·
`<nick> live` 22 / 7,0 · `<nick> chaturbate` 14 / 11,0.

Tedy: **nick + „cam"/„webcam"/„live" + to, co dělá**. Podle toho se změnil
titulek (`{nick} Live Sex Cam – Free {síť} Webcam Show`), H1 (`{nick} Live Sex
Cam — {síť}`) a přidal se nadpis **„What {nick} streams"** nad štítky. Ta slova
na stránce byla i dřív, ale jen jako řádek odkazů bez nadpisu — a přitom to jsou
dotazy, na kterých už dnes stojíme na pozicích 5–9.

Offline varianta popisku **přestala začínat „is offline right now"**. Je to
pravda, ale jako první věta ve výsledku hledání je to jen pokyn „neklikej".
Popisek teď vede tím, co hledající chce (profil, tagy, kdo jede teď), a offline
stav je dál v textu stránky, kde nikoho nepřekvapí.

**Homepage** míří na `live sex cams` — **28 000 hledání/měs v US při KD 0**,
nejsilnější dosažitelný klíč, jaký web má (`cam girls` má 20 000 při KD 59,
D22). Dvě věci se opravily: titulek používal **přesný počet modelek**, takže
dělal dvanáct různých titulků denně — přesně to, co D28 zakazuje a co se všude
jinde drželo. A stránka měla dvě věty textu; má tři odstavce o tom, co web
opravdu dělá (konkurent, který na `sex cam` rankuje, má na homepage 1 614 klíčů).

**`/cams/naked/` cílí na „nude cams"** (5 100/měs, **KD 0**) místo „naked cams"
(1 100 při **KD 81**) — jen přes `FACET_LABEL_OVERRIDES`, slug zůstává.

**Prolinkování podle poptávky.** Stránka modelky měla 30 odkazů na jiné modelky,
konkurent, který na `ehotlovea` stojí #3, jich má 83. Přidal se blok „Most
searched cam girls right now" — 24 **textových** odkazů řazených podle skóre
`demand` (u karet by to bylo ~30 kB × 17 000 stránek, u odkazů 1,5 kB). Smysl je
posílat vnitřní odkazy tam, kde je měřená poptávka.

**Strop stránek modelek 14 000 → 17 000.** Byl vyčerpaný na kus a je to hlavní
zásoba pozic (88 % kliků webu). Soubory: ~17 970 z 19 000, kde CI zastaví.
Řadí se podle poptávky, takže když strop dojde, vypadne stránka, kterou nikdo
nehledá.

**Indexace: dva kanály navíc.** `~/ai/scripts/ecamx/indexnow.py` —
Bing `SubmitUrlBatch` (funguje hned, ecamx.com je verifikovaný; **kvóta je
100 URL/den**, ne 10 000 jak slibuje dokumentace — 101. URL vrátí ErrorCode 2)
a Google Indexing API (čeká na to, aby byl service account v GSC **Vlastníkem**;
kvóta 200/den). Pořadí je podle poptávky, ne podle abecedy. Cron: Bing denně
5:20, měření poptávky v pondělí 5:50.

**Rychlost.** Změřeno (mobil, 4× CPU throttle, slow 4G): LCP 0,3–1,0 s a CLS 0
jsou v pořádku, problém je **TBT — homepage 2 280 ms, kategorie 1 199 ms**.
Dvě změny: homepage má poloviční rezervu karet (180 → 120, tedy 60 viditelných
+ 60 v rezervě) a **přeskládání mřížky se odložilo do `requestIdleCallback`** —
je to kosmetika, HTML je správné i bez něj, a přehazovalo až 180 elementů
v okamžiku, kdy prohlížeč ještě staví stránku.

## D37 — 64 % impresí končilo na soft 404; archivní stránky se staví z nicku a sítě

**Změřeno 19. 8. 2026 odpoledne, po nasazení D35.** Vzalo se všech **965 URL,
které kdy měly imprese** (GSC, 16 měsíců), a otestoval se jejich živý HTTP stav:

| kam URL vede | URL | imprese | podíl |
|---|---|---|---|
| 302 → adresář písmene `/models/x/` | 480 | 1 339 | **39,4 %** |
| 302 → hub sítě `/site/x/` | 211 | 827 | **24,4 %** |
| 301 → kategorie (relevantní cíl) | 92 | 614 | 18,1 % |
| 200 živá stránka | 72 | 361 | 10,6 % |
| tvrdá 404 | 32 | 81 | 2,4 % |

D35 splnilo, co slíbilo: tvrdé 404 spadly z 89 % na 2,4 %. **Ale 64 % impresí
se jen přesunulo z 404 na soft 404.** Dotaz „lunarspark cam" (143 impresí,
pozice 6,7 — nejsilnější stránka webu po homepage) vede na abecední seznam
`/models/l/`. Google nerelevantní přesměrování vyhodnotí jako soft 404 a pozici
zahodí stejně, jako by tam byla 404. Formulace v `gone.ts`, že adresář je
„z existujících stránek nejblíž tomu, co člověk hledal", platí pro člověka,
ne pro hodnocení relevance.

**Proč to demand-retence z D35 nezachytila** (`scripts/sync-cams.ts`):
- `lunarspark` a `hoaarisa` **v registry vůbec nejsou** — krok 5 (`pruned`) je
  smazal dřív, než pravidlo o poptávce vzniklo.
- `tinyxstar` (143 impresí) a `tooclose_toofar` (60) v registry jsou, ale krok 4
  jim při nastavení `gone` smazal `snap` (`delete e.snap`), takže je filtr
  `!!e.snap` v kroku 3 vyřadí.
- Podmínka `!e.gone` navíc blokuje záchranu zpětně: co bylo jednou označené
  jako `gone`, vrátí zpět jedině skutečné vysílání.

Retence tedy chrání jen to, co ještě žije. Na to, co už web ztratil, nestačí.

**Řešení: `src/lib/legacy-pages.ts`.** Stránka postavená z toho mála, co
opravdu víme — **nick a síť**. Žádná data z feedu se nedoplňují: archivní
stránka neukazuje věk, zemi, štítky, „naposledy vysílala" ani generovaný text
(`aboutParagraphs`/`historyParagraphs` staví právě z těchhle polí, takže by si
musely vymýšlet). Má nick v H1 a titulku, pravdivý stav „není v našem živém
katalogu", affiliate odkaz do sítě a mřížku živých modelek, aby nebyla slepou
uličkou.

**Síť se nehádá.** 341 nicků ji má z `legacy-gone.json` (cíl `/site/{síť}/`).
Dalších **333 potvrdila sonda proti Chaturbate API** — `chaturbate.com/api/
biocontext/{nick}/` vrací 200 nebo 401, když pokoj existuje, a 404, když
neexistuje (401 = existuje, jen chce přihlášení). Zbylých **162 nicků síť nemá
a stránku nedostane** — dál jim odpovídá přesměrování z `gone.ts`. Je to
417 impresí, kterých se web vzdává; alternativa by byla stránka, která tvrdí
síť, kterou neznáme. Ostatní sítě rozlišit nejdou: `camsoda.com/{nick}`,
`bongacams.com/{nick}` i `cam4.com/{nick}` vracejí pro existující i neexistující
nick identickou odpověď (403 / 403 / 302).

Výsledek: **674 stránek pokrývajících 2 047 z 2 464 archivních impresí (83 %)**.
Mapa je commitnutá v `seed/legacy-networks.json`, takže build ani CI nikam
nesahají — sonda byla jednorázová.

## D38 — Sitemapa zmenšena z 12 226 na ~520 URL (revize D35)

**Měření:** GSC hlásí u sitemapy **8 730 odeslaných URL a 0 indexovaných**.
URL Inspection 19. 8.: indexovaná je **jediná stránka celého webu** — homepage
(crawl 17. 8.). `/cams/` a `/site/chaturbate/` „Discovered – currently not
indexed", `/girls/`, `/cams/bbw/`, `/models/` **„URL is unknown to Google"**,
tedy Google se k nim vůbec nedostal. Mezitím sitemapa vyrostla na 12 226 URL,
z toho 11 785 stránek modelek.

Žádat web s DR 11 o indexaci 12 226 URL znamená rozptýlit crawl budget na
stránky, které se navíc mění každé dvě hodiny — a kategorie, na kterých web
stojí, zůstanou neobjevené. Sitemapa proto nese homepage, **všechny** kategorie,
země a sítě, celý abecední adresář (trvalá crawl cesta ke zbytku) a jen
`SITEMAP_MODELS = 150` nejžádanějších stránek modelek podle skóre `demand`.

**Otáčí to směr z D36** („indexovatelných 8 122 → 11 032"). Ostatní stránky
modelek nikam nemizí, zůstávají `index, follow` a vedou na ně odkazy z adresáře
i z bloků „podobné" — jen se o ně Google neprosí dřív, než pochytá to podstatné.
Strop se zvedne, až URL Inspection ukáže, že se indexuje víc než homepage.

**Vedlejší nález, který opravuje D36:** Google Indexing API nevrací 403 kvůli
vlastnictví v GSC — service account `openclaw-ga-reader@…` **je** `siteOwner`
na property `https://ecamx.com/`. Vrací 403, protože v Google Cloud projektu
`641536349599` nejsou zapnuté **Web Search Indexing API** ani **Service Usage
API**. Zapnout je jde jen v konzoli: přes API to nejde právě proto, že Service
Usage API je vypnuté.

## D39 — `www` → apex 301 řeší Cloudflare Redirect Rule

`www.ecamx.com` vracelo **200**, ne přesměrování: DNS má proxovaný `AAAA`
záznam pro apex i `www` a Worker obsluhoval oba hostname, takže celý web
existoval dvakrát. Řeší to pravidlo ve fázi `http_request_dynamic_redirect`
(`http.host eq "www.ecamx.com"` → 301 na `concat("https://ecamx.com",
http.request.uri)`, `preserve_query_string`), ne kód Workeru — dynamické
redirecty běží na edge dřív než Worker, takže se na to vůbec neplýtvá výpočtem.
Ověřeno: `/`, `/cams/bbw/` i `/live/aviebby/?x=1` vracejí 301 se zachovanou
cestou i query, apex je nedotčený.

## D40 — 63 % měřené poptávky mířilo na stránky, které neexistovaly

**Změřeno 19. 8. 2026 odpoledne** na všech 1 778 nicích z KV `demand`
(živý HTTP stav každé `/live/{nick}/`):

| stav | nicků | hledání/měs | imprese GSC |
|---|---|---|---|
| 200 živá stránka | 979 | 75 070 | 2 052 |
| 302 (soft 404) | 620 | **85 610** | 412 |
| **tvrdá 404** | 179 | **40 540** | 0 |

**126 150 z 201 220 měřených hledání za měsíc mířilo na stránku, která
neexistuje.** Dvě nejžádanější stránky celého webu vracely tvrdou 404:
`gummies15` (16 000 hledání/měs, KD 15) a `hotfallingdevil` (8 900, KD 8).

D35 a D37 řešily to, co web ztratil podle **GSC historie** (2 464 impresí).
Tohle je ta samá díra měřená z druhé strany — podle **objemu hledání**, a je
o dva řády větší.

**Tři příčiny, všechny v `scripts/sync-cams.ts`:**

1. **Slug se přiděloval jen tomu, koho sync právě vidí ve feedu** (krok 2 jede
   přes `models`). Modelka, která je v registry z minula a teď nevysílá, slug
   nikdy nedostala — a bez slugu ji přeskočí krok 3 (nemá co postavit) i krok 4
   (`!e.page`, takže ani přesměrování). Odtud 179 tvrdých 404. Nově je krok
   **2b**: slug dostane i záznam bez slugu, pokud je po něm měřená poptávka.
2. **`!!e.snap` v kroku 3** vyřadil stránku s poptávkou, jakmile jednou zanikla
   — krok 4 totiž při zániku snapshot maže (`delete e.snap`, kvůli limitu KV
   25 MB). **`!e.gone`** to blokoval i zpětně. Nově poptávka přebíjí obojí
   a stránka bez snapshotu se postaví z toho, co registry pořád má: **nick
   a síť** (`minimalArchive`, stejný tvar jako `src/lib/legacy-pages.ts`).
   Nic dalšího se nedoplňuje.
3. **Krok 5 mazal záznamy podle stáří bez ohledu na poptávku.** Bez výjimky by
   příští běh smazal přesně to, co jsme právě zachránili — přesně takhle
   z registry zmizely `lunarspark` a `hoaarisa`, které dnes registry nezná
   vůbec a stránku pro ně postavit nejde.

Naměřeno v dry-runu proti produkčnímu registry (99 485 záznamů): **+189 nových
slugů podle poptávky a 930 stránek postavených jen z nicku a sítě**.

**`MAX_MODEL_PAGES` sníženo 17 000 → 16 000.** K stropu se nepočítá 674
archivních stránek z `legacy-pages.ts` (staví se až při buildu ze seed souboru),
takže 17 000 + 674 + rozcestníky by se dostalo na dohled limitu 19 000 souborů,
na kterém CI zastaví. Rozdíl vypadne z nejmíň hledaných stránek — řadí se podle
poptávky.

## D41 — Google Indexing API: vrací 200, ale notifikace nezaznamenává

API bylo 19. 8. 2026 zapnuté v Google Cloud (projekt 641536349599) a
`scripts/ecamx/indexnow.py google` odeslal 81 URL — všechny HTTP **200**.

**Jenže to nic neznamená.** Odpověď `urlNotifications:publish` neobsahuje pole
`latestUpdate` (jen `urlNotificationMetadata.url`) a `urlNotifications/metadata`
tytéž URL **nezná ani po pěti minutách** (ověřeno na třech). Google volání
přijímá a zahazuje — nejpravděpodobněji proto, že notifikaci zaznamená jen
u obsahu, který sám uzná za `JobPosting` nebo `BroadcastEvent`.

Skript se proto **nedává do cronu**, dokud metadata nevrátí `latestUpdate`.
Zůstává ale opravený: posílá **výhradně stránky, které `BroadcastEvent` opravdu
nesou** — ověřuje se to stažením stránky a hledáním řetězce v HTML, ne odhadem
z katalogu (schema se vydává jen když síť pošle `onlineSeconds`). Kategorie,
rozcestníky ani offline stránky se neposílají, i kdyby měly sebevětší poptávku.

Funkční kanály zůstávají sitemapa, vnitřní prolinkování a Bing IndexNow.

**Past v diagnostice:** dřívější 403 z tohohle API **nebyl** o vlastnictví
v GSC. Service account je `siteOwner` na `https://ecamx.com/` a 403 vracel
proto, že v Cloud projektu nebyla zapnutá `indexing.googleapis.com` (ani
`serviceusage.googleapis.com`, takže to nešlo zapnout ani přes API). Text
chyby to říkal přesně — číst hlášku, nehádat oprávnění.

## D42 — Chaturbate API: dvojnásobek pokrytí, země z „location" a guard na provizi

Kenny 19. 8. poslal tokeny k affiliate API (uložené v
`~/ai/credentials/.ecamx-credentials.env`). Stats API ukázalo jen to, že provoz
je úzké hrdlo (99 raw hits za 4 dny, 0 engaged, $0). Užitečné pro web bylo něco
jiného: **`onlinerooms` posílá o každém pokoji víc, než jsme z něj brali.**

### Bereme polovinu Chaturbate — a chybí ta spodní

Feed hlásil `count` **7 944**, my jsme brali **4 000** (8 stránek × 500). Chyběla
přitom právě spodní polovina, tedy nicky s nejmenší konkurencí v SERPu — a
retenci od D40 řídí měřená poptávka, takže o výběr se není třeba bát.
`maxPages` 8 → **20** (rezerva na špičku; sync na prázdné stránce skončí sám).

Katalog: **9 202 → 13 051 živých modelek**, kategorií 319 → 354.
`minExpected` zvednuto 800 → 3 000: osm set by prošlo i při odpovědi, ze které
zbyla desetina.

### Země si modelka píše do `location`, ne do `country`

`country` je prázdné u **2 561 ze 7 944 pokojů (32 %)** — ale `location` má
100 % z nich a bývá to „Antioquia, Colombia". Poslední úsek za čárkou projde
`canonicalCountry()` a zemi to doplní u **951 pokojů**. Do `COUNTRY_ALIASES`
k tomu přibyly tvary, které feed opravdu posílá: „The Netherlands" (56×),
„Czech" (10×), „Bulgary", „The Poland".

Výsledek: země zná **80 %** chaturbatích pokojů (6 580 z 8 172) a stránek zemí
je **22 → 29** (nově mj. `nl`, `ee`, `cz`, `be`, `fi`).

Úsek PŘED zemí je kraj/město — **1 966 modelek** má „Antioquia", „Bogota D.C.",
„California", „Nairobi County". Jde do faktů, do textu („from Antioquia,
Colombia") a do `Person.homeLocation` + `PostalAddress`. Stránka z něj **nevzniká**
(315 unikátních hodnot s mediánem 1 modelka = thin content).

**Dlouhý název se nezkracuje, zahodí se.** První běh vyrobil
„Llanfairpwllgwyngyllgogerychwyrndrobwlll" — ořezané jméno místa vypadá jako
rozbitá stránka a ořezat ho jinak než špatně nejde.

### `spoken_languages` je volný text a starý parser z něj dělal jazyky

Feed posílá „English,Spanish, French (a bit)", „Spanish and English (translator)",
„English(preferred), French, German", „Chinese，English" (plnošířková čárka),
„𝐄𝐧𝐠𝐥𝐢𝐬𝐡-𝐒𝐩𝐚𝐧𝐢𝐬𝐡". Rozdělení na `[,\s]+` z toho udělalo **423 různých tokenů** a
protože se neznámý token delší než 3 znaky bral jako jazyk, vznikly „jazyky"
`translator` (14×), `only`, `little`, `learning`, `english-preferred` — a **šly
do výpisu na stránce modelky** („Languages: Spanish, and, English").

Nově `parseLanguages()`: závorky pryč, oddělovač `, ; / | & + _ . ，` i slovo
„and", pak **whitelist** 60 jazyků (`LANGUAGES`) plus aliasy. Co v seznamu není,
se zahodí. Z 423 tokenů je **28 skutečných jazyků**; bez jazyka zůstalo 35 pokojů
ze 7 944 a jsou to „moan", „👅", „none", „Turdish".

Renderuje se to i na stránce znovu — archivní stránky běží ze snapshotů, které
starý parser uložil, a čekat na další výskyt modelky by znamenalo nechat ten
šum svítit.

### Věk z data narození, ne z feedového čísla

`birthday` má 69 % pokojů a je to lepší zdroj: přepočítá se při každém buildu,
takže se nikdy nerozejde s realitou. U **27 pokojů** je to ale výplň
(`1901-01-26` spolu s věkem 99), takže se ověřuje rok, odvozený věk (18–80)
i soulad s feedovým `age` (rozdíl > 1 rok = nepoužije se ani jedno).
V katalogu má datum **5 682** modelek. Na stránce je z něj „Birthday:
20 February" — **bez roku**, ten už je ve věku.

### Kdy vysílá (`hours`) — jediný údaj, který nemá odkud opsat konkurence

Nové pole v registry: **12 dvouhodinových přihrádek v UTC, base36, 12 znaků na
záznam** (~1,1 MB na 56 000 záznamů, a maže se u záznamů bez stránky).
Otáčí to pravidlo 4 v `src/lib/model-copy.ts` („nehlásíme hodiny"), které
vzniklo z obavy o velikost KV — po změření je ta obava 1,1 MB z 25 MB.

**Přihrádky jsou dvouhodinové kvůli cronu:** sync jede `0 */2 * * *`, takže
hodinové přihrádky by měly polovinu navždy nulovou a rozvrh by lhal.

`usualHours()` mlčí, dokud není **7 různých dnů a 12 vzorků**, a pak vrací
nejkratší souvislé okno pokrývající 60 % vzorků. Data se sbírají od 19. 8. 2026,
takže na většině stránek začne věta svítit až po pár týdnech — a to je správně:
rozvrh ze dvou dnů by byl výmysl s číslem.

### Guard na jediný odkaz, který vydělává

Feed posílá u každého pokoje `chat_room_url_revshare`, tedy hotový revshare
deeplink — autoritu na tvar. `auditEarnings()` ho porovnává s tím, co staví
`deepLink()`, a **sync na rozdílu padá**. Ověřeno na 2 388 pokojích: `tour` je
stabilní (`LQps` revshare, `yiMH` PPS) a náš odkaz se shodoval do znaku.

Smysl: kdyby Chaturbate kód programu změnil, kliky by dál fungovaly a jen by
přestaly vydělávat — tiše, bez jediné chyby v logu.

Při té příležitosti smazáno **73 řádků mrtvého kódu**: `embedUrl`/`deepLink`
u všech 7 sítí v `scripts/cam-networks.ts`. Nikdo je nevolal (živé jsou ty
v `src/lib/affiliate.ts`), ale neškodné nebyly — chaturbatí kopie měla neplatící
tvar `/{nick}/?campaign=…` a cam4 tu 404 cestu `/en/embed/{nick}`, takže oprava
„na špatné kopii" by nic neudělala.

### Pokoj v private show už nehlásí „Live now"

`current_show` má čtyři hodnoty: `public` (92 %), `private`, `hidden`, `away`.
Pole `status` se přitom na webu **vůbec nepoužívalo**, takže 445 pokojů
v private/hidden show hlásilo „Live now" a přehrávač pak ukázal placenou zeď.
`hidden` se mapuje na `private` (pro návštěvníka je to totéž) a odznak říká
„Private show in progress" / „Away from cam".

### Co API nabízí a vědomě nepoužíváme

- **`chatvideocontext`** (satisfaction score, cena private show, `hls_source`)
  je interní endpoint stránky pokoje, ne affiliate API. Jeden request na
  modelku = 8 000 requestů na sync, a `hls_source` by znamenalo servírovat cizí
  stream mimo sankcionovaný embed. Nesaháme na to.
- **`display_name`** je marketingový text („NEW PREMIUM OF:🍬 𝕍𝔼𝕊𝕀𝔸 🍬
  instagram: …"), ne jméno. Zůstává `username`.
- **Stats API neumí breakdown podle `campaign`/`track`** a datové parametry
  (`start_date`, `from`, `days`) **ignoruje** — vrací vždy celou historii po
  dnech. Placementy se proto musí měřit u nás (GA4 `go_click`), ne u nich.

### Co to odhalilo v angličtině na stránce

Rozšířené pokrytí přineslo 7 nových zemí — a ukázalo tři věci, které web psal
jako stroj:

1. **`COUNTRY_NAMES` mělo jen 28 zemí „těch, které reálně máme".** Jakmile prahem
   prošly nové, dostaly do H1 „Live Cams from **EE**" (`countryName` padá na velký
   kód). Práh 20 modelek se hýbe každé 2 hodiny, seznam názvů se hýbat nesmí →
   doplněno na **117 kódů**, tedy všechno, co umí vrátit `canonicalCountry()`.
2. **„from United Kingdom"** na tisících stránek. `countryPhrase()` doplní člen
   u sedmi zemí, které ho v angličtině mají („the Philippines", „the Netherlands").
3. **„is a 18-year-old cam girl"**. Člen se řídí výslovností, ne písmenem:
   8, 11, 18 a osmdesátky mají „an".

A jedna věc navíc, která není gramatika, ale tvar dotazu: geo dotazy se píšou
**přídavným jménem** („british sex cams", „colombian cams"), ne názvem země.
`countryAdjective()` proto dává titulek „Colombian Cam Models" místo „Colombia
Cam Models". **„Cam Girls" tam ale nesmí** — u zemí se podíl žen nepočítá a ta
fráze má podle D23 povolení jen s ověřeným `girls === true`.

### Co u toho hlídat

Dvojnásobné pokrytí znamená dvojnásobek unikátních nicků v registry. Jeden běh
přidal **4 859 záznamů** (51 357 → 56 216) a s polem `hours` má JSON **11,4 MB
z 25 MB limitu KV**. Ustálený stav je „unikátní modelky za 45 dní", takže se
čeká růst k odhadovaným 16–17 MB. **V logu CI se kouká na řádek
`registry: … % limitu KV`;** kdyby šlo nad ~80 %, zkrátit `GRACE_DAYS` nebo
tvrději mazat záznamy bez `page` — ne zvyšovat limit, ten je Cloudflare.

Druhá věc: `/api/online/chaturbate` bere kvůli 10 ms CPU jen **300 pokojů**, což
je teď 3,7 % katalogu místo 7,5 %. Nevadí to (chybějící modelka = „nevíme",
ne „offline", viz D11) a mřížky jsou řazené podle diváků, tedy přesně přes ty
pokoje, které v odpovědi jsou. Kdyby se to mělo zvednout, cesta je `pickText`
regexem jako u CamSody, ne vyšší `limit` s `JSON.parse`.

## D43 — Registry rozdělena na dvě hodnoty v KV (84 % limitu po zvětšení pokrytí)

První CI sync po D42 nahlásil **22,02 MB z 25 MB (84 %)** a varování „naplánovat
prořez". Guard by build zastavil na 100 % — a s ním by přestala fungovat
stabilita profilových URL, kvůli které registry existuje (D3).

**Rozbor 102 117 záznamů (stažená produkční hodnota, 19. 8.):**

| co to je | záznamů | velikost |
|---|---|---|
| zaniklé stránky (jen přesměrování) | 71 180 | **11,69 MB (53 %)** |
| živé a archivní (snapshot, rozvrh, stránka) | 16 000 | 8,59 MB |
| bez stránky, bez snapshotu | 14 937 | 1,74 MB |

Nejdřív jsem chtěl zkrátit `REDIRECT_DAYS` (180 dní). **Změřeno: neuvolnilo by
ani bajt** — všech 71 180 přesměrování má `last` mladší 30 dnů. Není to stará
zátěž, je to čerstvá: web běží od 16. 8., strop 16 000 stránek je vyčerpaný na
kus, takže z něj modelky vypadávají a každá si odnese přesměrování.

Řešení není v retenci, ale v tom, že v jedné hodnotě bydlely dvě různé věci.
**Limit 25 MB platí na HODNOTU, ne na namespace:**

```
registry       30 937 záznamů  10,33 MB  (39 %)   živé + archivní
registry-gone  71 180 záznamů  11,69 MB  (45 %)   jen přesměrování
```

Kód nad tím pracuje s jedním objektem — `loadRegistry()` obě hodnoty sesype,
`saveRegistry()` je rozdělí podle `gone`. Retenční logika D35/D40 se tím nesahá.
Migrace je samočinná: co se načte ze starého klíče, se při zápisu rozdělí.

**Pořadí zápisu je součást řešení, ne detail.** Jsou to dva PUTy a zapisuje se
**nejdřív `registry-gone`**: kdyby druhý zápis selhal, starý klíč `registry`
pořád obsahuje i zaniklé záznamy a příští načtení stav dopočítá. V opačném
pořadí by pád mezi zápisy smazal 71 000 přesměrování natrvalo a ta URL by se
vrátila na 404 — tedy přesně to, co D35 opravovalo.

`~/ai/scripts/ecamx/demand.py` čte registry taky a je upravený na oba klíče.
Musí vidět i zaniklé stránky: měřená poptávka je právě to, co stránku vrátí
z přesměrování zpátky (D40).

## D44 — Stránky faset blikaly; publikace má hysterezi

`/country/be/` bylo v jednom buildu stránka (23 modelek) a v dalším vracelo
**404** (19 modelek). Prahy z `THRESHOLDS` se totiž měří proti JEDNOMU snapshotu
a sync jde 12× denně — takže o existenci URL rozhoduje dvouhodinový výkyv supply.

Změřeno 19. 8. 2026 na plném katalogu: **7 zemí a 58 kategorií** leží do 1,5×
prahu, tedy ~65 URL, které mohou mezi dvěma builds zmizet a vrátit se. Pro Google
je URL, která se objevuje a mizí, nejhorší možný signál — a `check-links` to
nezachytí, protože zmizelá faseta zmizí i z odkazů.

**Publikace má teď hysterezi** (KV klíč `facets-published`, slug → datum
posledního překročení prahu):

- nad prahem → publikuj a zapiš datum,
- pod prahem → stránka **zůstane**, dokud je supply aspoň **poloviční**
  a od posledního překročení neuběhlo víc než **7 dní**,
- pak zmizí — kategorie, která opravdu vymřela, URL držet nemá.

Ověřeno na vzorku 2 100 modelek místo 13 800: **65 faset drženo** (`ar` 13,
`lv` 11, `gb` 10 při prahu 20), zbytek správně vypadl. Paměť je 412 slugů
a čistí se sama.

Nedotýká se to kurátorských „money" kategorií — ty mají vlastní pojistky
`MIN_MEMBERS`/`MIN_LIVE` a `fresh` (D23).

## D45 — Consent Mode v2 v existující věkové liště (otáčí část D31)

D31 nechalo consent mode nenasazený jako Kennyho vědomě přijaté riziko. 19. 8.
padlo rozhodnutí ho dodělat — protože bez něj by nebylo pravdivé prohlášení,
které GA4 vyžaduje k Measurement Protocol (viz D46).

**Souhlas se vyžaduje tam, kde ho vyžaduje právo, ne všude.** Věková lišta
záměrně NEBLOKUJE obsah (rozhodnutí 16. 8.: HTML musí zůstat crawlovatelné),
takže „bez kliknutí neměříme" by u všech znamenalo neměřit skoro nikoho — na
nezavírající lištu klikne zlomek lidí. Pro EU/EHP/UK je opt-in povinný, mimo ně
stačí zveřejnění a možnost odmítnout.

Region se rozhoduje z **časové zóny prohlížeče** (`Europe/*` + Kanáry, Madeira,
Azory, Island, Kypr, Ceuta; UK spadá pod `Europe/London`). Není to autorita na
jurisdikci, ale je zdarma, bez requestu a bez latence — a **když se zóna
nepřečte, bere se to jako EU**. Statický web jinou možnost nemá: HTML je pro
všechny stejné, takže o obsahu lišty rozhoduje třída na `<html>`.

**V EU se `gtag.js` do rozhodnutí VŮBEC NENAČTE.** To je silnější než jen
`analytics_storage: denied` — při odmítnutém consentu by Google posílal
cookieless pingy, a to je pořád zpracování dat, které nikdo nepovolil. Události
zatím čekají v `dataLayer`; po souhlasu se odešlou (včetně `page_view`), po
odmítnutí se zahodí.

**Obě tlačítka mají stejnou velikost i tvar** („Accept & continue" /
„Essential only") a odmítnutí lištu zavře stejně jako souhlas. Schovat odmítnutí
do drobného odkazu je dark pattern, kvůli kterému by souhlas nebyl platný — a
pak by nebylo pravdivé ani to prohlášení v GA4.

**Ověřeno v Chromiu na čtyřech případech** (každý ve vlastním kontextu, jinak
si `localStorage` z předchozího běhu rozhodne test za nás):

| případ | lišta | requesty na Google před volbou | po kliku |
|---|---|---|---|
| mimo EU | „I'm 18 or older" | 2 (GA jede) | — |
| EU, bez volby | dvě tlačítka | **0** | — |
| EU, souhlas | dvě tlačítka | 0 | 2 requesty, `consent=granted` |
| EU, odmítnutí | dvě tlačítka | 0 | **0 requestů**, `consent=denied` |

**CLS zůstalo 0** ve všech čtyřech variantách (mobil, slow 4G, 4× CPU) — lišta
je vidět od prvního snímku, takže ani větší obsah nic neposouvá. To byla hlavní
past: CLS 0,1204 z 19. 8. vzniklo přesně tady (D29).

## D46 — Serverové měření prokliků (`go_click_server`) je živé; kdo odklikl souhlas

Zbývající kus z D31. GA4 nedovolí vytvořit Measurement Protocol secret, dokud na
property není odsouhlasené *User Data Collection Acknowledgement* — a to
**není technický přepínač**: povinné pole je prohlášení v první osobě, že mám
„potřebná zveřejnění **a práva od svých návštěvníků**". Metoda
`properties.acknowledgeUserDataCollection` chce jen scope `analytics.edit`, který
service account jako Editor má odjakživa; **owner k tomu potřeba nebyl a nikdy
nebyl důvod, proč to leželo.** Leželo to proto, že to prohlášení je Kennyho, ne moje.

Kenny 19. 8. rozhodl cestu „nejdřív souhlas, pak odkliknout" a pokyn dal
explicitně. Odklikl to skript (`ga4.py acknowledge`), aby ten úkon byl v kódu
a dohledatelný, ne jednorázový curl — a **až po tom, co web to tvrzení opravdu
kryje** (D45 živě, privacy policy popisuje volbu i cookies).

### Jak hit funguje

`/go/{síť}/{nick}/` po vrácení 302 pošle přes `waitUntil` událost
`go_click_server` do Measurement Protocolu. Smysl: klientské `go_click` chodí
přes gtag.js, který na adult webu blokuje velká část návštěvníků, takže
**rozdíl mezi oběma čísly je změřená míra blokování** — dosud jen tušená.

Tři pravidla, která ten kód drží:

1. **Nesahá to na přesměrování.** Celé je to v `try`, odesílá se přes
   `waitUntil` a `fetch` má `.catch()`. Když MP spadne, proklik o tom neví.
   Ověřeno lokálně přes `wrangler dev`: 302 i `Location` jsou identické se
   souhlasem, s odmítnutím i bez cookies.
2. **Respektuje souhlas.** Jinak by zadní cesta rušila to, co lišta slíbila.
   Zemi bere z hlavičky **`cf-ipcountry`** (autorita Cloudflare, ne časová zóna
   jako na klientovi): v EU/EHP/UK se pošle jen s `ecamx_consent=granted`, jinde
   se nepošle při `denied`. Volba proto musí být v **cookie**, ne jen
   v localStorage — do toho Worker nevidí.
3. **Žádné náhodné `client_id`.** GA4 by z každého prokliku udělala nového
   uživatele a metrika „users" by byla smetí. Bere se `ecamx_cid` — naše
   first-party cookie, kterou blokátor googletagmanageru nesundá, a právě proto
   serverový hit vidí i kliky, které klientské GA nezachytí. Když cookie není
   (JS vypnutý, odmítnutý souhlas), **hit se nepošle vůbec.**

`session_id` se tahá z cookie `_ga_JSSZP2XFBL`, aby se hit přilepil ke stejné
návštěvě; když GA blokované je, vynechá se a GA4 si sezení založí sama.

Tvar payloadu ověřen proti `debug/mp/collect`: **`validationMessages: []`**.
Parametry se drží registrovaných dimenzí (`network`, `placement`) — GA4 zahazuje
neregistrovaný parametr už při sběru (D31).

Secret je v `credentials/.ecamx-credentials.env` (600) a ve Worker secretu
`GA4_MP_API_SECRET`. **Hodnota se nikde nevypisuje** — `ga4.py mp-secret` ji
zapíše a nezobrazí.

## D47 — Cloudflare JavaScript Detections vypnuté

Kenny 19. 8. řekl, ať si to udělám přes API sám. Hotovo:
`PUT /zones/{zone}/bot_management` s `enable_js: false`.

Ověřeno v Chromiu (mobil, slow 4G, 4× CPU, 3 běhy): request na
`/cdn-cgi/challenge-platform/scripts/jsd/main.js` **už nechodí vůbec**, ze
`/cdn-cgi/` zůstává jen `speculation` (Speculation Rules, jiná věc a levná).
Medián TBT je teď **102 ms**. Cena JS Detections změřená 18. 8. byla 188 ms
(D30) — s lazy načítáním GA z 18. 8. je to dohromady důvod, proč je stránka
takhle nízko.

**Past v tom API: `bot_management` má jen PUT, ne PATCH** (PATCH vrací 405),
takže se **přepíše celý objekt** a co v těle není, spadne na default. Při prvním
zápisu jen s `enable_js` vrátila odpověď `ai_bots_protection: disabled`, i když
předtím bylo `block`. Uložená konfigurace se ale po chvíli ukázala nezměněná
(`block`) — ta hodnota v odpovědi byla přechodná. **Přesto: před zápisem si
stáhnout celý objekt** (`backups/ecamx-botmgmt-before-20260819.json`) a po zápisu
ho porovnat položku po položce, ne se spolehnout na to, co PUT vrátí.

Scoped token z `.ecamx-credentials.env` na tohle **nemá právo** (HTTP 10000
Authentication error) — jde to jen globálním klíčem z `.cloudflare-credentials.env`.

**Co to stojí bezpečnostně:** JS Detections je pasivní JS challenge, která pomáhá
odlišit bota od prohlížeče. Bot Fight Mode je vypnutý už dřív a `ai_bots_protection`
zůstává `block`. WAF pravidla z 2. 7. (challenge na wp-login/xmlrpc mimo CZ+SK)
na tomhle webu nic neřeší, protože WordPress tu není. Riziko je tedy víc bot
provozu v číslech Cloudflare — a ta jsou už dnes horní odhad (D30).

## D48 — Přidaná hodnota: měříme sítě sami (srovnávač, dvojčata, kalkulačka)

Kenny 19. 8.: *„nechci zapadnout jako jen další adult cam agregátor, chci
featuru, která přivede lidi a zvedne SEO."* Plán je
`~/.claude_account4/plans/lovely-waddling-curry.md`; tohle je, co z něj vzniklo
a proč zrovna to.

**Jediná výhoda, kterou máme, je měření.** Katalog ze 7 sítí umí každý; nikdo
ale ty sítě nepočítá každé 2 hodiny a nedrží si z toho historii. Všechny tři
věci níž stojí na tomhle jednom aktivu.

### Co se vědomě NEDĚLÁ: „cam girl finder" (2 300/měs)

Nejsilnější dotaz ze zadání, a přesto se po něm nejde. Vítěz `camgirlfinder.net`
je **face-search nad 2,5 miliardy tváří z 15 sítí** — záměr toho dotazu je
biometrická identifikace osob. Nepostavíme to a stavět nebudeme. Jejich vlastní
texty ale potvrzují potřebu, kterou obsloužit umíme a smíme: *„check if your
favorite model also uses other cam sites"* — obsluhuje se **podle jména**.

SERP je přitom slabý (na #2 stránka s DR 3, na #8 taky DR 3), takže to nikdy
nebyla soutěž o odkazy.

### 1. Pokrytí cam4 a BongaCams bylo useknuté o 40 %

Než mohl vzniknout srovnávač, musela padnout tahle chyba — jinak by publikoval
jako „velikost sítě" **náš vlastní strop**. Obě sítě se tahaly s `limit=1000`
a přesně 1 000 vracely. Ověřeno proti živému API: **cam4 při `limit=3000` vrátí
1 778, BongaCams 1 395**, `offset` obě ignorují. Po opravě: cam4 1 798,
bongacams 1 361, katalog **13 762 → 15 052 živých modelek**.

Stejná třída chyby jako u Chaturbate (D42). **Kulaté číslo rovné limitu je
příznak useknutí, ne velikost sítě.**

### 2. `/site/` — rozcestník, který chyběl

`href="/site/…"` je na **16 830 stránkách**, ale rodič neexistoval: kdo URL
zkrátil, dostal 404 z catch-allu. Drobeček na recenzích měl navíc nepravdivý
cíl — „Cam sites" mířilo na `/cams/`, tedy na kategorie. Opraveno obojí.

**Které sloupce v tabulce smí být, rozhodlo měření vyplněnosti polí:**

| pole | CB | CS | Cam4 | Am | BC | XL | LJ |
|---|---|---|---|---|---|---|---|
| gender | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| viewers | 98 | 99 | 100 | 95 | 100 | **0** | **0** |
| age | 70 | **0** | 100 | 94 | 100 | 100 | 100 |
| isHd | 80 | **0** | **0** | **0** | 28 | **0** | **0** |

**Nula znamená „síť to nehlásí", ne „nemají to".** „CamSoda: HD 0 %" by byla lež
— a shodou okolností lež lichotící Chaturbate, tedy našemu největšímu zdroji
provizí. To je přesně ten affiliate bias, kterým se nechceme lišit. Srovnává se
proto jen to, co měříme sami stejně u všech sedmi (počet, gender, medián diváků
tam, kde se hlásí, podíl viděných i na jiné síti); u zbytku se **napíše slovem**,
že to síť nezveřejňuje.

**Zamítnutá metrika:** „nových modelek za týden" vyšla 8 471 z 8 795 u Chaturbate
— jenže `first` je datum, kdy jsme ji poprvé viděli MY, a katalog je starý tři
dny. Neměřilo by to síť, ale nás.

### 3. Stejný nick na jiné síti — na 2 075 stránkách

Unikátní odstavec přesně tam, kde je problém „Crawled – currently not indexed",
a **nula nových URL**. Počítá se při buildu (`src/lib/cross-network.ts`), takže
to nestojí ani bajt v KV.

**Tři tiery, protože se tvrdí shoda JMÉNA, ne totožnost osoby.** Původní pravidlo
(shodná země / nekonfliktní gender / věk ±4) bralo „údaj známý jen na jedné
straně" jako shodu — to shoda není. Při oboustranném ověření: **1 087 stránek
korroborovaných, 896 jen podle nicku, 92 rozporných.**

**Rozdílná země NENÍ rozpor.** Změřeno: ze 111 párů s jinou zemí má **63 %
shodný věk (±1 rok)** — je to nastavená lokalita, ne dva lidé. Jde to tedy jako
poznámka („performers often set a different location on each site"), ne jako
důkaz. Rozpor je jen jiný gender nebo věk nad ±4.

**Nikdy `sameAs` ani `identifier` v JSON-LD** mezi dvěma našimi `/live/` URL —
strojové tvrzení o identitě neumíme podložit ani u tieru A. Blok nesahá na
`<title>` ani na meta description.

Adresář `/models/same-nickname/` vysvětluje pravidlo celé (aby ho blok nemusel
opakovat 2 075×) a je to **druhá crawl cesta z ne-`/live/` stránky** — jediný typ
odkazu, který guard sirotků počítá.

### 4. Kalkulačka tokenů: postavená, ale bez URL

Kenny vědomě rozhodl, že chce ceny balíčků, ačkoli `networks.ts` je záměrně nemá
(„špatná cena je horší než žádná"). Měřeno: „chaturbate token calculator"
288/měs KD 5, „tokens to dollars" 104 **KD 0**, CPC $11.

**Jenže ceny nejde ověřit.** Ověřeno 19. 8.: Chaturbate 302-uje na login,
CamSoda a BongaCams vracejí 403, XLoveCam a LiveJasmin 404 — **ani jedna ze
sedmi sítí je veřejně nevystavuje.** Nedají se tedy ani automaticky hlídat.

Řešení: stránka i datový soubor jsou hotové, ale `TOKEN_RATES` je prázdné a
`getStaticPaths()` z něj generuje URL jen pro sítě s daty. **Bez ověřených cen
stránka neexistuje** — prázdná kalkulačka je horší než žádná. Až je někdo opíše
z přihlášeného účtu, stránka se objeví sama, a **guard v CI build zastaví**,
jakmile bude `checkedOn` starší než 90 dnů.

### Rozpočet

Souborů 17 689 → 17 863 (strop CI 19 000). Většina přírůstku není z nových
sekcí, ale z většího katalogu po opravě pokrytí (kategorií 355 → 393, zemí
30 → 34). Sitemapa 657 → 696 URL.

## D49 — `/finder/`: hledání podle jména, klientský index 123 kB

Fáze 2 plánu z D48. Měřený cluster (Ahrefs US): „cam girl search engine"
800/měs, „cam girl search" 300, „find cam girl" 250, „cam model search" 150.
Po hlavním „cam girl finder" (2 300/měs) se **nejde** — je to face-search
(viz D48).

### Klientský index, ne Worker

Rozhodly limity, ne pohodlí:

- `/api/online/[network]` má naměřeno, že **BongaCams při 300 záznamech = 14 ms
  CPU, tedy nad free stropem 10 ms.** `JSON.parse` 280kB indexu by padal na CPU
  dřív, než by se dostal k hledání.
- KV neumí substringový dotaz → v každé invokaci by se načítal celý index.
- Typeahead = 4–6 requestů na dotaz, a `/api/*` sdílí **rate limit 40 req/10 s
  s `/go/`**. Riskovat 429 na vydělávající cestě kvůli hledání je nepřijatelné.

Statický asset = **0 invokací Workeru, 0 requestů proti dennímu limitu.**

### Formát a proč je tak malý

`{JSON meta}\n{nick}\n…\n{base64 sloupců}` — **280 kB raw / 136 gzip /
123 brotli**, staví se 145 ms při buildu. Tři triky, každý ověřený měřením:

1. **Žádné `page` řetězce.** `page` je u všech 16 327 řádků buď `slug`, nebo
   `slug-network` → 1 bit. 201 výjimek (103 legacy ze starého WP, kde slug drží
   podtržítka) je v override mapě za 3 kB.
2. **Žádné `displayName`** — rovná se nicku u **všech** řádků.
3. **Žádný sloupec popularity** — řádky jsou předřazené `online desc, peak desc`,
   takže **pořadí řádku JE ranking**.

Bajty na řádek: `net<<5 | gender<<2 | online<<1 | pageSuffix`, index země, věk
s příznakem dvojčete v horním bitu. Přesně 3 B.

**Textový, ne JSON**, ze stejného důvodu, proč má `api/online` u CamSody
`pickText` regexem místo `JSON.parse` („11 ms → jednotky ms").

**Stabilní cesta, žádný hash v názvu.** Sync deployuje 12× denně, takže
hashovaná URL = 12 nových URL denně a **nulové znovupoužití cache**. Cachování
řeší `_headers` (`max-age=900, stale-while-revalidate=86400`) + ETag z assets
layeru.

Generuje se **při buildu z `MODEL_PAGES`**, ne v syncu — jede tím ze stejného
zdroje pravdy jako stránky (poučení D24). Guard v `check-links.ts` ověřuje, že
**počet řádků == počet adresářů v `dist/client/live/`**, jinak by výsledky
hledání vedly na 404, a že v indexu není žádná tajná hodnota z env (D17,
`AMATEUR_API_KEY` je zároveň affiliate ID i credential k feedu).

### Dvě chyby, které našel až test v prohlížeči

**CLS 0,2724.** První verze měla celý nástroj v `hidden` a odkrýval ho engine —
tedy **přesně ta chyba, kterou tenhle web řešil u věkové lišty** (D29): odložený
skript vsune obsah nad zbytek stránky. Opraveno tak, že blok je v HTML od
prvního snímku, pole je `disabled` (bez JS to řekne stavová řádka) a výsledky
mají **pevnou výšku se scrollem uvnitř** — přidání ani odebrání řádku pak nikdy
neposune stránku. Po opravě **CLS 0,0000**.

**„Live now" schovávalo hledanou modelku.** Filtr je defaultně zapnutý (pro
procházení správně), ale u dotazu na konkrétní jméno je „nenašli jsme nic"
horší odpověď než „není teď online". Filtr se proto u jmenného dotazu sám
povolí a **řekne to**: „1 match, but none are live right now — showing them
anyway."

### Změřená kvalita hledání

| test | výsledek |
|---|---|
| přesný nick z 50 nejžádanějších (KV `demand`) | **50/50 top-1** |
| zkrácený nick na 60 % délky | **19/20 top-3** |
| vypuštěný znak uprostřed | **0/20** |
| jeden dotaz nad 16 327 řádky | **0,53 ms** |
| filtry (2 přepnutí) → requesty na `/api/online/` navíc | **0** |

Překlep uvnitř slova `indexOf` neodpustí a **vědomě se s tím nic nedělá** —
Damerau distance by znamenala procházet řádky místo jednoho `indexOf`. Levná
záchrana existuje jen pro složené nicky: když dotaz nenajde nic, zkusí se jeho
nejdelší úsek (`sandy_candycrush` → `sandy`) a řekne se, že se hledalo jinak.

**Nenajít nick je legitimní stav** a stavová řádka to přiznává: modelka, která
dlouho nevysílala, z katalogu vypadne (strop 16 000 řadí podle poptávky) a její
URL obsluhuje přesměrování z `gone.json`.

### Co v MVP není

- **`hours`** („obvykle online v…") — `usualHours()` dnes mlčí u 100 % katalogu
  (max 5 vzorků z požadovaných 12). Filtr se přidá až od ~500 kvalifikovaných
  řádků, ne dřív.
- **Pole v hlavičce na všech stránkách** — v hlavičce je jen pilulka „Find
  a model". Input na 17 000 stránkách by přidal bajty a riziko posunu na mobilu
  tam, kde po něm nikdo neptal.
- **Filtry na tagy a jazyky** — byl by to druhý soubor (~45 kB) a jde stáhnout
  až při otevření filtru; do MVP to nepatří.

## D50 — Ceny tokenů: publikuje se jen to, na čem se shodly dva zdroje

Kenny 20. 8.: „nechci pořizovat fotky, chci abys mi to udělal vše za mě."
Takže jsem ceny sháněl sám. Tady je, co z toho vyšlo — a proč stránka nakonec
neuvádí u velkých balíčků číslo, ale rozpětí.

### Co se zkoušelo, v tomhle pořadí

1. **Vlastní nákupní stránka Chaturbate** — `curl` 302 na login, **skutečný
   Chromium 403 „Just a moment…"** (Cloudflare anti-bot) a redirect na
   `/auth/login/`. CamSoda, BongaCams a Amateur.tv vracejí 403 stejně.
2. **Nápovědy a FAQ všech sedmi sítí** — 4× 403, zbytek redirect na homepage
   bez cen.
3. **Veřejná stránka pokoje** (jestli nejsou balíčky vložené v HTML) — nejsou:
   žádné `token_packages`, `pricing`, nic.
4. **Archiv** — Wayback má snapshot nákupní stránky z 6. 8. 2026, **ale i archiv
   zachytil jen login** („title: Login - Chaturbate", 1 717 znaků textu).
5. **Nezávislé výpisy** — tři, a tady to začalo dávat data.

**Anti-bot challenge se neobchází.** Důvod je obchodní, ne principiální:
prolamovat ochranu sítí, které nám platí provize, z naší IP je nejkratší cesta
k vypnutému affiliate účtu. To by stálo přesně ten příjem, kvůli kterému web
existuje.

### Zdroje si nad 200 tokenů protiřečí

| balíček | DatingScout (11. 7. 2026) | NavThemes (1. 7. 2026) | UFO VPN (16. 7. 2025) |
|---|---|---|---|
| 100 | **$10,99** | **$10,99** | **$10,99** |
| 200 | **$20,99** | **$20,99** | — |
| 500 | — | $44,99 | $49,99 |
| 1 000 | — | $79,99 | $90,99 |
| další | 50/$5,99 · 400/$39,99 · 550/$49,99 | 750/$62,99 · 2025/$159,99 | 2000/$179,99 |

Shoda je **jen u dvou nejmenších balíčků**. Obě stránky samy uvádějí, že ceny
závisí na regionu a promo akcích.

### Co z toho stránka dělá

- **Balíček dostane číslo jen se dvěma nezávislými zdroji.** Publikováno tedy
  100/$10,99 a 200/$20,99. Nadpis říká „The bundles we can confirm" a pod ním
  věta, že větší balíčky existují, ale nikdo dva je nekvótuje stejně —
  bez toho by stránka tvrdila, že Chaturbate prodává jen dva.
- **Nad tím rozpětí, a obě hranice něco znamenají:** dolní je nejlepší kurz,
  jaký zdroje uvádějí; **horní je JISTÁ** — tolik stojí opakovaný nákup
  největšího ověřeného balíčku. U 1 000 tokenů $80,00–$104,95, a oba nalezené
  údaje ($79,99 a $90,99) leží uvnitř.
- **Provenience je na stránce**, ne v kódu: „Chaturbate does not publish token
  prices to anyone who is not signed in, so these come from independent listings
  rather than from the checkout page." Plus tři odkazy na zdroje s daty.
- **Guard v CI** zastaví build, když `checkedOn` zestárne nad 90 dnů **nebo když
  se cena opře o jediný zdroj**.

### Tři chyby, které našel až smoke test šablony

Šablona se nikdy nevykreslila (bez dat se URL negeneruje), tak jsem ji protáhl
nadhozenými čísly:

1. **Tabulka nabízela nekoupitelné ceny.** Počítala `tokeny × nejlepší kurz`,
   takže u „100 tokenů" vyšlo $8,00 — kurz z tisícového balíčku, za který ti sto
   tokenů nikdo neprodá. `cheapestFor()` teď skládá reálné balíčky: 1, 10 i 50
   tokenů stojí $10,99 a je u toho „(for 100)".
2. **Bonus za první nákup se opakoval** — do výpočtu jdou jen balíčky bez `note`.
3. **Titulek „tokens to Dollars"** (`unit` je z dat malými) a FAQ tvrdící „bulk
   saves 27 %", zatímco tabulka „+37 %" — totéž číslo ve dvou směrech.

Poučení do příště: **šablona, která se nikdy nevykreslila, není hotová šablona.**
Když se data teprve chystají, protáhni ji nadhozenými.

## D51 — Práh `minExpected` musí sedět pod denním minimem, ne u maxima

Build 20. 8. spadl na `check-links`: **1 rozbitý interní odkaz — `/site/bongacams/`,
odkazovaný z 6 501 stránek modelek.** Guard fungoval správně a nasazení zastavil.

### Co se stalo

BongaCams v tom běhu **vypadl celý** („celkem stáženo: 9 671 modelek ze 6 sítí").
Sync výpadek jedné sítě toleruje a jede dál, takže:

- `FACETS.networks` se staví z živých modelek → bez BongaCams tam síť není
  → `/site/bongacams/` se **nevygeneruje**,
- ale její modelky v katalogu **zůstanou** ze snapshotů a z legacy stránek,
  a ty na `/site/bongacams/` dál odkazují.

### Byla to moje regrese

19. 8. jsem spolu se zvýšením `limit` zvedl i `minExpected` — u cam4 z 300 na
1 200 a u BongaCams z 200 na 1 000 — **podle jediného měření** (1 778 a 1 361).
Skutečné hodnoty se ale hýbou podle hodiny:

| běh | cam4 | bongacams |
|---|---|---|
| 19. 8. večer | 1 798 | 1 391 |
| 20. 8. 07:53 | 1 422 | 1 045 |
| 20. 8. 09:xx | 1 362 | 1 032 |
| 20. 8. 10:13 | 1 342 | **vypadl** |
| 20. 8. 11:00 (po opravě) | 1 311 | **1 002** |

BongaCams vrátil **1 002 modelek při prahu 1 000** — dva nad hranicí. Ze šesti
CI běhů síť vypadla ve třech. Guard, který má chytat rozbitý feed, tak
**převáděl normální denní variaci na výpadek celé sítě**.

Prahy sníženy na **cam4 700** a **bongacams 400** — bezpečně pod pozorovaným
minimem a pořád řádově nad tím, co by vrátil rozbitý feed.

**Pravidlo: práh se nastavuje pod POZOROVANÉ MINIMUM, ne k maximu.** Jedno
měření na to nestačí; když se sahá na `minExpected`, patří k tomu pohled na
několik běhů v různých hodinách.

### Druhá oprava: výpadek sítě nesmí rozbít odkazy

I se správným prahem síť jednou vypadne. Proto přidán `linkableNetwork()` —
stejné pravidlo, jaké u zemí platí od 19. 8. (`linkableCountry`, AGENTS 24):
**na `/site/{síť}/` se odkazuje jen přes něj.** Když stránka sítě neexistuje,
drobeček na profilu míří na rozcestník `/site/` (ten existuje vždy) a pilulka
„{síť} cams" se vynechá.

Bez toho by každý výpadek feedu znamenal spadlý deploy — tedy guard, který místo
ochrany blokuje vydávání oprav.

## D52

**„Your models" — osobní vrstva místo dalšího výpisu (20. 8. 2026)**

Zadání bylo „něco, kvůli čemu nás Google nezařadí jen mezi agregátory a lidi se
sem budou vracet". Agregátor je komodita — výpis se filtry napříč sítěmi se
prodává jako WordPress plugin. Komodita **není** 7 sítí × čas × identita napříč
sítěmi: jediný známý hráč, který to dělá (SIREN), je Telegram bot bez jediné
indexovatelné stránky.

Postaveno tedy: **Follow na profilu a v řádku finderu**, stránka **`/my/`**,
odznak „N z tvých je live" v hlavičce a `/for-models/` (opt-out + odznak ke
sdílení). Vlastní hodnota `/my/` je věta, kterou žádná cam síť říct neumí:
**„její pokoj na CamSodě je zhasnutý, ale právě teď vysílá na Chaturbate"** —
ověřeno na dvojčeti `a-vanellopecute`, řádek nabídne živou síť a odkáže na ni.

### Proč je stav v prohlížeči, a ne u nás

| blokátor | změřená hodnota |
|---|---|
| KV zápisy | 1 000/den na namespace, sync z nich bere ~36 → ~150 aktivních lidí a je vyčerpáno |
| KV binding za běhu | žádný (`kv_namespaces: []`), KV jen přes REST při buildu |
| Worker CPU | 10 ms/invokace; BongaCams naměřeno 14 ms už při 300 záznamech |
| cron ve nasazeném configu | `"triggers":{}` |

Notifikace „až začne vysílat" by potřebovaly scheduler i per-user stav — ani
jedno na free plánu není. Watchlist v `localStorage` + polling existujícího
`/api/online/[network]` nepotřebuje nic z toho, a drží linii „žádné účty, žádná
PII" (D45).

### Jedno čtení živého stavu pro hlavičku i stránku

Odznak a `/my/` se ptají týchž feedů, takže je čte **jedna funkce**
(`liveFor()` ve `watchlist.ts`): rozdělaný request drží mapa v modulu (Astro
z něj dělá jeden sdílený chunk, takže hlavička i stránka běží nad touž instancí)
a výsledek se cachuje v `sessionStorage` na 60 s = TTL endpointu. Než to
vzniklo, `/my/` stahovala `camsoda` **dvakrát**; po opravě 0 requestů při druhém
otevření do minuty. Request navíc není zdarma — `/api/` sdílí okno rate limitu
40 req/10 s s vydělávajícím `/go/` (D49).

### Měření: `?p=watchlist`, ne nová událost

Klik z `/my/` jde existujícím `/go/{síť}/{nick}/?p=watchlist`, takže se objeví
v `go_click`/`go_click_server` s `placement=watchlist`. Samostatná událost
`watch_live_click` by tentýž klik počítala dvakrát (past 32). Nové jsou jen
`watch_add`/`watch_remove` a jejich parametry (`network`, `model`, `placement`)
už jako dimenze v property existují — ověřeno `ga4.py show`, žádná registrace
před deployem tedy nebyla potřeba.

### Opt-out je podmínka, ne funkce navíc

Publikujeme, **kdy konkrétního člověka vídáme online**. Bez ventilu je to přes
čáru, takže opt-out platí i pro rozvrh samotný. Dělá se kódem `ecamx-out`
v room subjectu — do subjectu svého pokoje může psát jen ona, takže je to
self-service a nikdo tím neodstraní konkurentku; `<form>` nejde, CSP má
`form-action 'none'`. Ověřeno: **0 shod na 10 659 reálných subjectech**
(žádný falešný poplach na „ecamx outfit" ani „ecamx-outs") a dry sync
s dočasně přenastaveným kódem vyřadil 23 modelek **ještě před** taxonomiemi,
registry i indexem finderu. Registry u vyřazené zahodí `snap` i `hours`
a nastaví `gone`, takže URL dá 302, ne 404 (D35). XLoveCam subject nehlásí
vůbec (0 %) — tam zbývá e-mail.

### CLS: rezervace se nehádá číslem

Plán žádal CLS 0 a stálo to tři opravy. Naměřeno a spraveno:

| co | před | po |
|---|---|---|
| `/my/` s 5 sledovanými (řádky dosype klient) | 0,1208 | 0 |
| `/finder/` — odkrytí „Show more" | 0,0128 | 0 |
| totéž po první „opravě" bez `!important` | 0,0421 | 0 |

Počet řádků `/my/` posílá **blokující skript v `<head>`** jako `--watch-rows`
a seznam má **pevnou výšku se scrollem** (25 sledovaných = box 512 px, obsah
1 222 px), ne `min-height`: na mobilu se řádek podle obsahu zalomí do dvou i tří
linek, takže rezervace „na jednu linku" neplatí. Tentýž vzor drží na nule
výsledky finderu (past 52).

## D53

**Retence byla slepá na Bing — web mazal vlastní pozice (24. 8. 2026)**

Týden po nasazení srovnávače sítí, finderu a cross-network bloku jsem měřil, co
to udělalo. Výsledek: **Bing ano, Google ne.**

| kanál | 17. 8. | 23. 8. |
|---|---|---|
| Bing: URL v indexu | 40 916 | **52 380** |
| Bing: crawl/den | 2 356 | 9 457 |
| Bing: imprese/den | 25–33 | **971** (22. 8.) |
| Google: imprese/týden | 15 | 38 |

Google indexoval z minulého týdne `/site/chaturbate/` a `/site/camsoda/`, ale
`/cams/`, `/cams/asian/` a `/country/us/` hlásí URL Inspection po týdnu
v sitemapě pořád **„URL is unknown to Google"** a `/girls/`, `/finder/`,
`/models/` „Discovered – currently not indexed". Historie to vysvětluje:
imprese padly z **2 011 (11/2025) na 36 (12/2025)** — osm měsíců před migrací na
Astro, tedy v době, kdy WP server jel na load 83. Google se z toho dostane
odkazy a časem, ne obsahem.

### Nález, který převážil všechno ostatní

Za měřené okno Bingu (38 týdenních přihrádek, 5. 12. 2025 – 21. 8. 2026):
**2 108 URL** něco vydělalo a **97 % hodnoty nesou stránky modelek** (5 985
impresí, **1 048 kliků**, CTR 19 %, medián pozice 7).

Náhodný vzorek 24 těch vydělávajících stránek proti živému webu:
**13× 404, 9× 302 jinam, 2× 200.** Nejsilnější dotaz celého webu — „kotogal live
cam", pozice 3 — vracel 302 na `/cams/muscle/`.

Příčina není v datech, ale v tom, čí data to jsou. Retenci řídí KV klíč `demand`
a ten se plnil z **GSC a Ahrefsu**. GSC nám dává ~5 impresí denně, takže
poptávku fakticky nezná — a Bing, který posílá tisíc kliků, nebyl zdroj vůbec.
Změřeno po přidání: Bing zná **2 050 stránek modelek**, překryv s GSC je
**16 slugů (1 %)**, a **2 001 stránek drží jedině Bing**. Ty všechny šly po
`GRACE_DAYS = 45` do přesměrování a po `REDIRECT_DAYS = 180` na 404 — přesně ve
chvíli, kdy rankovaly. Dotaz na nick totiž nezmizí, když modelka přestane
vysílat; poptávka žije dýl než naše stránka.

**Opraveno:**

1. `demand.py` má **třetí zdroj** (Bing WM `GetPageStats`) s vlastními poli
   `bing_impressions` / `bing_clicks` — GSC se nepřepisuje, aby bylo poznat, kdo
   stránku drží. `demandScore()` v syncu bere Bing **stejnou vahou jako Google**.
   KV `demand`: 1 882 → **3 883 stránek**.
2. Poptávka se obnovuje **denně** (`measure --limit 0`, tedy bez Ahrefs
   jednotek); týdenní běh s Ahrefsem zůstal. Dva záznamy v cronu schválně —
   mají jinou cenu, ne jinou logiku.
3. Rozpočet stránek **hlásí, co odřízl** (dřív bylo v logu jen kolik jich
   poptávka ochránila) a při vyhození stránky s měřenou poptávkou píše chybu.

### `/live/` už nesmí vrátit 404 (D35 platilo na polovinu)

D35 zavedlo „zaniklá stránka nikdy nesmí padat na 404", ale mapa `gone` zná jen
slugy, které u nás stránku někdy měly. Nick ze starého WordPressu, který
registry nikdy nevidělo, padal na tvrdou 404 — a to je 54 % vzorku výše. Teď
každý slug ve tvaru nicku končí na `/models/{písmeno}/`, tedy na seznamu profilů,
ne na náhodné kategorii. Písmena, pro která adresář existuje, píše sync do
`facets.json` (`letters`); Worker si `MODEL_LETTERS` z `data.ts` vzít nemůže,
ten tahá 13 MB katalogu. Co nick netvarem není (`/live/<script>/`), **zůstává
404** — soft 404 na všechno je horší než 404.

### Staré WP taxonomie: vzory místo tisíce pravidel

37 legacy URL má měřenou poptávku (103 impresí, 21 kliků) a žádný cíl:
`/webcam_category/underwear/`, `/webcam_category/big-tits/page/5/`,
`/webcam_category/milfniche-47-name/` (rozbitá slugifikace starého pluginu,
past 3), `/webcam_languages/nicedoll54/`. `_redirects` má 338 pravidel, ale jen
základní tvary — a stránkované varianty jsou tisíce URL, takže do limitu 2 000
pravidel nepatří. Vzory proto řeší Worker: term se odsekne od `niche-NN-name`,
projde kanonizací (`taxonomy.ts`, past 20) a ověří proti aktuálním fasetám.
Legacy je **301** (trvale zaniklá struktura), stránka modelky zůstává 302.
Jazykové URL stránku nemají → `/cams/`; nick v jazykové taxonomii → `/live/{nick}/`.

### Sitemapa: index, a modelky celé

Strop `SITEMAP_MODELS = 150` z 19. 8. měl Googlu ušetřit crawl budget. Po týdnu
je změřeno, že nekoupil nic — Google nepřečetl ani rozcestníky. Bing naopak
crawluje 9 500 URL/den a nese 97 % kliků, takže mu držet seznam schovaný nemělo
smysl. `sitemap.xml` je teď **sitemapindex**: `sitemap-hubs.xml` (531 URL)
+ `sitemap-models-{n}.xml` po 5 000. Nabízených URL: **681 → 6 660** (jen
indexovatelné). Guard v `check-links.ts` chodí i po odkazovaných souborech —
bez toho by 13 000 URL z kontroly vypadlo.

### IndexNow místo kvóty 100/den

`indexnow.py` tlačil URL přes Bing API, kde je **kvóta 100/den** (ověřeno:
`GetUrlSubmissionQuota` hlásí `DailyQuota: 0`, `MonthlyQuota: 700`). Protokol
IndexNow bere 10 000 URL na požadavek a pokrývá i Yandex, Seznam a Naver; klíč
je veřejný soubor v `public/`. Posílá se **čerstvé a žádané** (cooldown 7 dní,
řazení podle poptávky včetně bingové), ne 13 000 URL denně — protokol je na
změněný obsah, ne na spam.

## D54

**Čtyři nové sítě přes CrakRevenue — a odpověď na „jednotné API, nebo vlastní?" (25. 8. 2026)**

Kenny dal přístup k `performers-ext` od CrakRevenue, jednomu API nad sedmi cam
brandy. Změřeno vlastními dotazy, ne z dokumentace: token pouští všech sedm,
z toho **tři už máme přímo** (chaturbate, bongacash = BongaCams, awempire =
LiveJasmin) a **čtyři ne**:

| brand | živých 25. 8. | vzato | data (vzorek 100 živých) |
|---|---|---|---|
| stripchat | 5 790 | 800 | tagy 10,4 · bodyType 100 % · country 40 % · **age 10 %** |
| streamate | 1 292 | celá | tagy 19,8 + 5,6 · **country i age 100 %** · snapshot 100 % |
| mfc | 842 | **100 (sonda)** | tagy 3,6 · **jazyky, postava, vlasy 0 %** |
| imlive | 107 | celá | tagy 19 · age 100 % · **country 0 %** |

### Jednotné, nebo vlastní API? Obojí — ale ne na tutéž síť

**Přímé feedy tam, kde je máme, agregátor jen na sítě, které přímo nemáme.**
Měřeno: přímé API Chaturbate vrátilo v tomtéž běhu **7 720** modelek, přes
CrakRevenue je jich 5 721 — chybí ty nejmenší pokoje, tedy přesně náš longtail
(97 % kliků nese stránka modelky). Agregátor navíc **nedává počty diváků,
`subject` ani `goal`**, takže bychom u převedené sítě přišli o řazení mřížek,
o `peak` i o opt-out kód `ecamx-out` (past 60). A token je vázaný na domény
a CrakRevenue ho může zrušit „s upozorněním i bez něj" — jedno zrušení by
sebralo čtyři sítě naráz, kdežto přímé feedy padají nezávisle (`linkableNetwork`).

Naopak pro nové sítě je to jasná výhra: čtyři sítě bez čtyř žádostí o účet,
jedno schéma, jedna kontrola provize — a u streamate/imlive **bohatší data než
u půlky našich přímých feedů**.

**Tvrdé pravidlo: tutéž síť nikdy ze dvou zdrojů.** Byly by z toho dvě stránky
téhož člověka pod dvěma „sítěmi" (D48) a strop souborů by to sežralo zdarma.

### Co to stálo na stropu souborů

Free plán má 20 000 souborů, CI zastavuje na 19 000. Sekvence měření:

1. Kvóta 3 000 nových stránek a `MAX_MODEL_PAGES = 17 300` → build **19 320
   souborů**, tedy nad stropem CI. Odhad v syncu přitom hlásil 17 836 a „rezervu
   2 164" — počítal jen fasety a stránky modelek, ne stránkované mřížky
   a adresáře. Rozdíl **1 484 souborů**.
2. Odhad opraven na měřenou konstantu `NON_MODEL_FILES = 2 100`, strop na
   **16 400**, kvóta Stripchatu z 1 500 na **800** → build **18 432 souborů**
   (rezerva 568) a 16 723 stránek modelek.

K tomu `GRACE_DAYS_NO_DEMAND = 14`: stránka **bez měřené poptávky** ztrácí
stránku po 14 dnech offline, s poptávkou nikdy (D53). Změřeno, že z 2 410
archivních stránek má poptávku jen 602.

### Tři pasti, které to vyhodilo

1. **Do `model=` patří `nameClean`, ne `name`.** Feed posílá nick malými
   písmeny; s originální kapitalizací `auditEarnings` sync zastavil (a měl —
   parametr by nesouhlasil s tím, co síť čeká). Ověřeno na 398 modelkách všech
   čtyř sítí, že `nameClean` je vždy prostý lowercase. **Přehrávač to má
   naopak** — `suaplf.live?name=` s malými písmeny vrací prázdno.
2. **Seznam sítí je na TŘECH místech.** `NetworkId` v `data.ts`
   i `cam-networks.ts`, `IDX_NETWORKS` v `search-index.ts` a `NETWORKS`
   v `/go/[network]/[user].ts`. Stránky se vygenerovaly, CTA vedla na `/go/`
   — a Worker vracel **404 na všech nových sítích**, tedy proklik zdarma pro
   síť. Tsc odhalí jen první dvě.
3. **Index finderu měl na síť tři bity** (max 8 hodnot) a `indexOf` u neznámé
   sítě vrací −1 → v `Uint8Array` z toho je 224, tedy index 7. Finder by
   u 2 750 modelek tvrdil „Amateur.tv" a guard „řádků == stránek" by to
   nepoznal. Formát je teď **4 bajty na řádek** (síť má celý bajt, index
   319 kB místo 280 kB) a generátor na neznámé síti **padá**.

### Co nové sítě nemají

Živý stav se u nich **nedotahuje** — `/api/online/` pro ně feed nemá, stejně
jako pro cam4. Runtime dotaz na CrakRevenue by potřeboval API klíč ve Workeru,
15 requestů na jednu invokaci proti stropu 10 ms CPU a ukrajoval by z rate
limitu, který chrání `/go/`. Karty tedy jedou ze stavu z buildu, který se mění
každé 2 h. Až ty sítě prokážou provoz, dá se to přehodnotit.

Popisky (`description`, `expertise`, `turnOns`) jsou jen ve **full verzi** API,
kterou zapíná affiliate manažer — lite má `i18n` prázdné. Je to unikátní text na
tisíce stránek, takže o to stojí za to požádat.

### Bonus: slovo „Free" v titulku přestalo lhát

Šablona profilu slibovala „Free {síť} Webcam Show – no signup" u **všech** sítí,
včetně těch, kde se show platí po minutě a volný je jen náhled. Nově to slovo
dostanou jen freemium sítě; LiveJasmin, XLoveCam, Streamate a ImLive mají
„Free preview; private shows are billed by the minute." Recenze v
`src/content/networks.ts` to říkaly správně už předtím — titulek jim odporoval.

## D55

**SEO texty: kontext z vlastního měření místo generických frází (26. 8. 2026)**

Kenny: *„full descriptions to nejspíš ani nemá, musíme vymyslet generický text,
který se bude měnit podle cam, lokace atd."* Ověřeno — lite verze CrakRevenue
API má `i18n` prázdné, takže popisky od modelek nemáme a mít nebudeme.

Generický text ale nesmí být vata. Pravidlo z D26 platí dál: **každá věta
odpovídá poli, a když pole není, věta se vynechá.** Otázka tedy zní, jaká
pravdivá data máme navíc — a odpověď je **poloha modelky v katalogu, který
sami měříme**. To je jediná věc, kterou konkurence nemá jak opsat: feed má
každý, ale „kolik pokojů té sítě vedeme a jak velké publikum má ona proti
ostatním" vzniká jen tím, že to 12× denně měříme.

Přibyly tři bloky (`src/lib/catalogue-stats.ts` + `model-copy.ts`):

1. **Kontext z katalogu** — kolik pokojů sítě vedeme, kam spadá publikem
   (hrubé přihrádky proti mediánu a 90. percentilu sítě), kolik modelek máme
   z její země, kolik pokojů nese její hlavní tag, a u menšinových jazyků
   i kolik modelek jím mluví.
2. **Věta „co to stojí"** podle typu sítě (tipy vs. minuty).
3. **FAQ ve tvarech, ve kterých se to opravdu hledá** — 3 141 dotazů z Bingu
   za 9 měsíců vypadá jako `{nick} cam` (1 917 impresí), `{nick} webcam` (690),
   `{nick} chaturbate` (218). Blok odpovídá na „je teď live", „na jaké je síti",
   „je to zdarma", „kolik jí je", „odkud je", „jakým jazykem mluví", „kdy bývá
   online". Bez `FAQPage` JSON-LD: Google ho pro rich results u běžných webů od
   2023 nepoužívá, takže by to na 16 000 stránkách byly jen bajty.

**Změřeno na 300 náhodných stránkách:** medián **450 → 650 slov**, podíl vět,
které jsou na webu jen jednou, **52 %**. Zbytek je poctivé boilerplate
(disclosure o provizi, rámování otázek).

Cestou vyhozeno, co vypadalo jako text, ale nic neneslo:
- „12 000+ modelek uvádí angličtinu" stálo na 192 z 300 stránek — jazyk se teď
  zmíní, jen když ho má **míň než čtvrtina** katalogu,
- cenová věta byla dvakrát (v kontextu i ve FAQ), zůstala jen v FAQ,
- „ukazuje se pro hnědé oči" — u sítí z CrakRevenue nese `characteristicsTags`
  vzhled, ne činnosti; do věty o tématu pokoje teď jdou **`autoTags` první**
  a tagy, které jen opakují vzhled, se filtrují,
- disclosure „Free to watch… if you buy tokens" na síti, která tokeny nemá
  a účtuje po minutě.

### A jedna strukturální oprava, kterou to odhalilo

Alarm z D53 se ozval: **„strop vyhodil 332 stránek S MĚŘENOU POPTÁVKOU"**.
Příčina: `MAX_MODEL_PAGES` omezoval **jen archiv** — živá modelka dostala
stránku vždycky. Počet živých pokojů se přitom mezi syncy hýbe o tisíce
(naměřeno v jednom dni **15 844 → 17 523**), takže při přílivu zbylo na archiv
nula míst a build přetekl přes strop CI (19 910 souborů).

Strop teď platí i na živé. Ubírá se v pořadí: **měřená poptávka** (nikdy),
**už má stránku** (jinak URL blikají podle hodiny, D44), pak publikum a počet
viděných dnů. Kdo se nevejde, **zůstává v registry** a stránku dostane, až se
místo uvolní — z 2 023 odložených bylo 1 476 nově objevených, tedy existující
URL zůstala. Výsledek: 15 500 živých + 831 archivních = 16 331 stránek,
**0 archivních odříznuto**, 18 352 souborů.

K tomu odhad souborů v syncu **počítá stránkování** (mřížky po 180, adresář po
250) místo konstanty: hlásil rezervu 2 164, když už byl build 320 souborů nad
stropem. Teď 18 738 odhad proti 18 352 skutečným — přestřeluje, což je správný
směr.

## D56

**Web deset hodin nezmizel z místa — a mřížka k tomu lhala (26. 8. 2026)**

Kenny: *„když přijdu na stránku, občas mi zmizí všechny streamy."* Změřeno na
produkci: homepage měla **120 karet, z nich 4 viditelné a 116 označených
offline**, přičemž všech sedm feedů `/api/online/` vrátilo 200 a data v pořádku
(CamSoda hlásila 1 426 živých pokojů). Z 18 chaturbatích karet byla ve feedu
**nula**.

Mřížka se tedy chovala správně — ty pokoje opravdu nevysílaly. Chyba byla
o úroveň výš: **poslední úspěšný deploy byl 25. 8. ve 22:29 a od 01:24 padlo
pět běhů CI v řadě.** Na webu ležel seznam z předchozího večera.

Příčina pádu je vnější: EasyList přidal `||bongacams.com^$subdocument,third-party`
(včerejší kopie seznamu ho neměla, dnešní má), takže guard `check-blocklists.ts`
build zastavil — správně, protože Chrome takový rámec označí za reklamu a po
4 MB ho odstraní (D13). BongaCams byl navíc v `AUTOPLAY_SAFE`, tedy se jeho
iframe načítal **bez kliknutí**: u ad-tagged rámce nejhorší možná varianta.

### Tři opravy, každá na jiné úrovni

**1. BongaCams bez přehrávače.** `embedUrl('bongacams')` vrací `''` a síť je
mimo `AUTOPLAY_SAFE`. Zrcadla (`bongacams10.com`) mají dnes jen `$popup`, ale do
seznamů se přidávají průběžně — spoléhat na ně by znamenalo další zamrznutí za
týden. Provize se nemění: `bongacams.com/track?…` je navigace, ne rámec.

Cestou se ukázala díra, která platila i pro Streamate a ImLive bez `embedRef`
(D54): při prázdném `embed` se vyrenderovalo tlačítko „Watch live", jehož
obsluha padá na `if (!src) return;` — **tlačítko, které nejde zmáčknout**. Nově
`hasPlayer` rozhoduje, jestli se rámec i tlačítko vůbec vykreslí; bez přehrávače
je z celé plochy náhledu odkaz do pokoje.

**2. Stará stránka nesmí tvrdit, že nikdo nevysílá.** Klient neměl jak poznat,
nad jak starou stránkou běží — `META.generatedAt` se do HTML nedostalo. Nově je
v hlavičce `<meta name="ecamx-built">` a když je výpis starší než **3 h** (sync
jede každé 2 h), hláška u zhasnuté mřížky se změní z „Nobody in this category is
live right now" na *„This listing was built N hours ago, so most of these rooms
have closed since"* + odkaz, který obchází cache. Karty se dál skrývají — mrtvý
pokoj je mrtvý a klik do něj je ztracený proklik; mění se jen to, co se u toho
tvrdí. Do GA jde `grid_stale` s věkem, takže se to dá měřit.

**3. Hlídač, protože ticho bylo dražší než ta chyba.** `bin/ecamx-deploy-watch.py`
(cron každých 30 min) hlídá **symptom, ne konkrétní guard**: věk nasazeného
buildu (z té nové značky) a stav posledního běhu CI. Když build zestárne nad 3 h
nebo CI selže, pošle zprávu do Discordu **včetně příčiny z logu** — token bere
z `/home/kenny/Discord/.env`, kde už je, ID kanálu z creds. Neopakuje se
(stav v `tmp/`, znovu až po 6 h) a po opravě pošle „zase to jede".

Ověřeno: guard `check-blocklists` je zelený a bongacams z iframe hostů zmizel ·
stránka BongaCams modelky nemá rámec ani tlačítko, má náhled s odkazem ·
Chaturbate má dál serverový iframe, Streamate klikací play · při podvrženém
buildu 5 h dozadu píše mřížka novou hlášku, při 30 min starém původní ·
hlídač v dry-runu ohlásil přesně tuhle poruchu i s příčinou.

## D57

**Klient mřížku nepřeskládává, jen zaplňuje díry (26. 8. 2026)**

Kenny: *„je možné, že když jsem si načetl stránku, viděl jsem stream a najednou
mi zmizeli a objevily se jiné?"* Bylo. Změřeno na produkci (homepage, 1280×900):

| | |
|---|---|
| viditelných po dopadu / po živém průchodu | 60 / 60 |
| **vyměněno za jiné** | **28** |
| zůstalo, z toho na stejné pozici | 32 → **jen 5** |
| kdy | 300–700 ms po dopadu |
| CLS | 0,00004 |

Příčina: živý průchod nezhasínal jen mrtvé karty, ale **přeskládal celou
mřížku** — postavil pole `order`, seřadil podle aktuálních diváků, proložil sítě
a `appendChild` je naskládal znovu. Pro uživatele to znamenalo, že mu karta,
na kterou se koukal, uskočila jinam. **Žádná metrika to nehlásila**: mřížka
nemění výšku, takže CLS je nula a `grid_sparse` se neozve — vidí to jen člověk.

Teď se plní pouze díry: projdou se viditelné karty v DOM pořadí a jen ta
s `rank === 2` se **na svém místě** nahradí kartou z rezervy (`replaceWith`),
zhaslá jde skrytá dozadu, aby zůstala v evidenci pro „Show more". Přeživší
karty se nedotkne nikdo. Pořadí tak určuje build, který sítě prokládá a řadí
podle poptávky — klient do něj jen doplní, co zhaslo.

Prokládání sítí zůstalo, jen se přesunulo **na rezervu**: bez něj by díry zaplnil
jeden web (Chaturbate hlásí řádově vyšší čísla, XLoveCam a LiveJasmin je nehlásí
vůbec) a nejlépe platící síť by se do mřížky nedostala.

Ověřeno na lokálním buildu: **vzájemné pořadí přeživších zachováno, 0 posunutých**
· „Show more" slibuje 5 a odkryje 5 · při prázdných feedech zůstanou viditelné
jen karty sítí BEZ feedu (čtyři z CrakRevenue), o kterých klient nic netvrdit
nemůže — to je `rank 1` z D11, ne chyba.

## D58

**UX pro konverze: filtr podle sítě, lepivé CTA, konec „7 sítí" (26. 8. 2026)**

Kenny chtěl co nejvíc konverzí a filtrování podle webu. Změřeno nejdřív, kde
konverze vznikají (GA4, 14 dní, `go_click` = 32):

| placement | kliků |
|---|---|
| `player` (plocha přehrávače) | 12 |
| `profile` (tlačítko „Chat") | 10 |
| `card` (karta v mřížce) | 8 |
| `offline` | 2 |

**Stránka modelky nese 22 z 32** a dopadá na ni skoro celý organický provoz
(nick dotazy z Bingu). Objem je malý — 58 organických sessions za 14 dní —
takže smysl má vytěžit ty, co přijdou, ne ladit promile.

### Filtr podle sítě nad mřížkou

Karta už nesla `data-network`, takže filtrování nestálo ani bajt v HTML
(past 31). Chipy jsou v HTML ze serveru, jen pro sítě, které na stránce opravdu
jsou, volba se pamatuje v `localStorage` a **aplikuje ji blokující skript
v `<head>`** stylem `.card:not([data-network="…"]){display:none}` — kdyby ji
skrýval odložený modul, posunul by obsah (past 52, 73).

Tři věci, které vyskočily až z měření a bez nich by to bylo horší než nic:

1. **Filtr umí mřížku vyprázdnit.** Živý průchod už zhaslé karty skryl, takže po
   zapnutí filtru na `/cams/bbw/` + Chaturbate zbylo **0 karet ze 10** a stránka
   poskočila o **CLS 0,146** — bez kliknutí, takže se to do metriky počítá.
   Řešení: ve filtrovaném pohledu se zhaslé karty té sítě **vrátí zešedlé**
   (`is-offline`, opacity .55) do dvanácti kusů a hláška nabídne plnou mřížku
   sítě. Nefiltrovaná mřížka se chová jako dřív — tam je čím doplnit (D57).
2. **Hláška si protiřečila** („No Chaturbate cams" hned po kliknutí vs. „Only 10"
   po reloadu), protože se psala před živým průchodem. Teď se počítá po něm.
3. **Počet „just ended" sčítal i jiné sítě** včetně mřížky podobných modelek —
   číslo bylo vyšší, než kolik ta síť na stránce vůbec měla.

Po opravách: 12 viditelných karet po kliknutí i po reloadu, **CLS na mobilu
0,0001–0,0003** ve všech stavech (bez filtru, s filtrem na homepage, s filtrem
na kategorii). Kombinace nad rámec sítě řeší odkaz do finderu s předvybraným
filtrem v **hashi** (`/finder/#net=chaturbate&cc=co`) — `?` má `robots.txt`
zakázaný, takže dotazové parametry by dělaly URL, kam crawler nesmí.

### Lepivé CTA na mobilu

Na stránce modelky je od 26. 8. 650 slov textu (D55), takže hlavní tlačítko
odscrolluje z obrazovky po druhém odstavci. Pásek dole se objeví, až přehrávač
vyjede z výřezu (`IntersectionObserver`), místo pro něj drží CSS od prvního
snímku (`body:has(.sticky-cta)`), takže **CLS zůstává 0** — na `position: fixed`
by se stejně nechytilo, tak by to nikdo nezměřil. Měří se jako **nový placement
`sticky`**, přidaný na OBĚ místa (union i `PLACEMENTS`, past 51); ověřeno, že
proklik nese `track=sticky` u Chaturbate a `aff_sub1=sticky` u CrakRevenue.
U offline modelky vede na profil (`?p=offline`), ne do prázdného pokoje.

### Offline stránka: živé alternativy nad ohyb

Kdo přišel na nick, který právě nevysílá, má jedinou užitečnou odpověď — kdo
vysílá teď. Dřív k ní vedlo jen tlačítko „See who's live instead ↓" a mřížka byla
o 650 slov níž. Teď jsou **čtyři živé karty hned pod náhledem** (ze stejného
`similarLive()`, takže to nic nestojí) a odkaz „See 26 more live cams ↓".

### Web si přestal protiřečit

Homepage tvrdila „all 7 sites" a `/my/` „all seven cam sites", ve stejném
odstavci homepage přitom stálo správné číslo z dat — sítí je od 25. 8. jedenáct.
Počet se teď všude bere z `META.networks.length` (i v popisku gender stránek).
Do hlavičky přidán chip **„Cam sites"** → `/site/`; ta stránka existovala, ale
vedla na ni jen patička homepage a drobečky. A hláška u poloprázdné mřížky
(73× za 14 dní) místo obecného „Browse everyone who is live" **jmenuje síť
s nejvíc živými pokoji** podle právě stažených feedů.

## D59

**Audit odchozích odkazů: dvě chyby, jedna naše a jedna cizí (26. 8. 2026)**

Kenny nahlásil, že „BongaCams proklik hází chybu", a chtěl projít všechny odkazy.
Prošel jsem všech jedenáct sítí proti produkci — živý nick, prohlížečové UA,
řetěz přesměrování až na cílovou stránku, a kontrola, jestli na ní ta modelka
vůbec je.

| síť | výsledek |
|---|---|
| chaturbate | ✅ `chaturbate.com/{nick}/?campaign=…` (u offline pokoje padá na homepage — jejich chování) |
| camsoda, cam4, amateur, xlovecam, livejasmin | ✅ |
| stripchat | ✅ `stripchat.com/{nick}?affiliateId=…` |
| streamate | ✅ `jerkmate.com/cam/{nick}` (white label) |
| imlive | ✅ `imlive.com/…/{nick}/` (z datacentra občas botová zeď Radware) |
| **bongacams** | ❌ mířilo na `chat-popup` |
| **mfc** | ❌ každý nick končil na `myfreecams.com/?cam=30352` |

### BongaCams: brali jsme z feedu tu nejhorší ze čtyř variant

Jejich feed dává čtyři URL a my použili `chat_url` = `csurl=…/chat-popup/{nick}`,
tedy **vyskakovací přehrávač**. V novém tabu z něj vyleze obecná titulka
BongaCams a přes datacentrovou IP dokonce Cloudflare challenge (403 „Just
a moment…"). Správná je `chat_url_on_home_page` = `csurl=…/{Nick}`, tedy pokoj.
Blokovací seznamy v tom nehrály roli — pravidla na `track?` jsou kosmetická
(`##a[href^=…]`) a na naše první-strany `/go/` odkazy nedosáhnou.

### MyFreeCams: rozbitá nabídka na straně CrakRevenue → síť vypnuta

Tři různé nicky **a i URL vzatá přímo z jejich feedu** končí na
`myfreecams.com/?cam=30352` — pořád totéž ID. Nabídka 3648 parametr `model=`
ignoruje, takže člověk klikne na jméno a dostane cizí modelku. To není jen
ztracená provize, to je podvod na návštěvníkovi. Síť je vypnutá (byla to sonda
se 100 stránkami a nejhoršími daty, D54); stránky zmizí standardní retencí,
tedy **302, ne 404** (D35). Zpátky až po ověření, že offer `model=` respektuje.

### Autoplay: měřit, ne hádat

Kenny se ptal, jestli může stream naskočit sám. Podmínky jsou dvě a obě se
změřily:

1. **host není na blokovacích seznamech** — jinak Chrome rámec označí za reklamu
   a po 4 MB ho odstraní (D13, a přesně tak dnes umřel BongaCams embed),
2. **embed opravdu hraje bez interakce.** Ověřeno s restriktivní politikou
   (`--autoplay-policy=document-user-activation-required`): stripchat a imlive
   přes `suaplf.live` hrají **ztišené samy**, streamate (`purecam`) Chrome
   **zablokuje** (video není ztišené), takže tam zůstává klik.

`AUTOPLAY_SAFE` je tedy `chaturbate, camsoda, cam4, stripchat, imlive`.
XLoveCam a LiveJasmin jsou na EasyListu → klik navždy. Klikací vrstva
(`STREAM_LINK`) zůstává jen u Chaturbate: u CrakRevenue přiřadí provizi klik
uvnitř jejich rámce (mají to v dokumentaci), takže vrstva navíc by jejich
obsluhu jen překryla.

### Z auditu je teď guard

`scripts/check-redirects.ts` dělá z jednorázové kontroly opakovatelnou:

- nick bere **z nasazené stránky sítě** (`/site/{síť}/`), ne z lokálního
  katalogu — testovat se má to, na co člověk doopravdy klikne. (Lokální
  `models.json` lže dvakrát: může být starší než produkce a nemusí obsahovat
  sítě, které rozpočet stránek zrovna odložil.)
- kontroluje **dvě věci zvlášť**: tvar naší URL (u sítí, kde ho známe z feedu —
  BongaCams musí mířit na pokoj, Chaturbate na `/in/?tour=`) a jestli cílová
  stránka nese ten nick. „Skončí to u správné modelky" totiž neodhalí, že jsme
  poslali na špatný DRUH stránky.
- botovou zeď (Radware, Cloudflare challenge) hlásí jako **neověřeno**, ne chybu.
- **Neběží při každém deployi**: jedenáct affiliate prokliků každé dvě hodiny by
  vypadalo jako klikací fraud. Jede týdně cronem (po 5:40) a ručně.

Cestou guard našel i past ve svém vlastním testu: feed vrací **slugy**
(`Anal_Queen` → `anal-queen`) a cam4 na slug odpoví `error-no-profile`. Web
posílá `username`, takže produkce byla v pořádku — ale guard musí testovat
přesně ten tvar, který je v odkazu na webu.

## D61 — Odchozí odkaz jde z náhledu do patičky karty (27. 8. 2026)

**Kenny:** „když kliknu na cam, tak mě to přesměruje a hned mi to vypne." Klikl
na kartu v mřížce a otevřela se záložka, která se sama zavřela.

Karta má **dva odkazy**. Plocha (`.stretch::after`, `z-index: 10`) vede na naši
stránku modelky — změřeno na `/site/bongacams/`, prvních 8 karet, všech 8 vrací
200. Ven vede jedině tlačítko „Chat →" (`.card-cta`, `target="_blank"`). To ale
sedělo **vpravo dole uvnitř náhledu** a na dotyku **svítilo pořád** — skrýt ho
umělo jen `@media (hover: hover)`, tedy myš. Bylo vysoké ~28 px (pod
doporučeným minimem 44 px) a leželo v ploše, na kterou člověk klepe, když chce
otevřít modelku.

To sebezavírající se okno byl `chat-popup`: do 26. 8. 17:30 UTC posílalo
tlačítko u BongaCams na `csurl=…/chat-popup/{nick}`, což je stránka pro
vyskakovací okno (jejich feed ji používá jako embed URL) a mimo svůj kontext se
sama zavírá. Opraveno v D59 na pokoj; z Maliny se to potvrdit nedá (BongaCams
challenguje datacentrové IP, 403 „Just a moment…"), ověří to Kenny telefonem.

**Plán byl tlačítko zvětšit na pás 44 px přes spodek náhledu. Měření ten plán
otočilo:**

* Na 390 px je karta 173×188 px a náhled jen 128 px vysoký. Pás 44 px by zabral
  **23 % plochy karty** (dosavadní pilulka 4,9 %) a **geometrický střed karty**
  by padl přímo do něj — `document.elementFromPoint` na středu karty vracel
  `a.card-cta`. Odpovědí na „omylem jsem se dostal ven" nesmí být čtyřnásobně
  větší odchozí plocha, i když je zřetelně označená.
* GA4 (14 dní, `go_click` × `deviceCategory`): z 8 prokliků `?p=card` je
  **7 z dotykového zařízení** a 1 z myši. Ty kliky vznikají právě tam, kde si
  Kenny stěžuje.

**Rozhodnutí:** odkaz jde z náhledu **do patičky karty** a v DOM je poslední.
Náhled je pak celý náš — klepnutí na modelku nikdy nevede ven. Na dotyku je
z odkazu **pás v toku**, 44 px, plné pozadí (karta o něj povyroste, nic
nezakrývá); na myši zůstává dnešní pilulka nad spodním okrajem náhledu,
viditelná až na hoveru. Tlačítko se **neruší** — deliberátní proklik zůstává
možný a měřitelný.

Pilulku na myši nejde pozicovat přes `bottom`, protože patička karty mění výšku
podle zalomení jména. `.card` je proto `container-type: inline-size` a pilulka
sedí na `top: calc(75cqw - 2.25rem)` — náhled má poměr 4/3, takže jeho výška je
75 % šířky karty. Změna nepřidá na kartu ani bajt (past 31: 180 karet na URL).

K tomu `-webkit-tap-highlight-color` na ploše karty: dosud nebyla po klepnutí
žádná zpětná vazba a na pomalé stránce to působí jako „nic se nestalo".

**Guard obecně, ne jen na BongaCams:** `scripts/check-redirects.ts` teď u **všech**
sítí odmítne první hop, který obsahuje `chat-popup`, `popup`, `/embed` nebo
`iframe`. Jsou to stránky pro rámce a okna; z kódu se to nepozná a projeví se to
až návštěvníkovi. Prošlo 10/10 sítí.

**Změřeno v prohlížeči** (`scripts/check-card-taps.mjs`, nový nástroj — do CI
nepatří, chce prohlížeč a postavené `dist/`): na 390 px vede 18 sond po kartě
ven jen ve třech bodech, a to v pásu; náhled i jméno míří na `/live/`; pás má
44×171 px; počet diváků je čitelný; CLS 0 na `/` i `/cams/bbw/`. Na myši sedí
pilulka na 1440/1024/768/640 px vždy 8 px nad spodkem náhledu, tedy přesně tam,
kde byla dřív s `bottom: .5rem`. Past prostředí: headless Chromium na Malině
hlásí `hover: none` a `Emulation.setEmulatedMedia` s tím nepohne — myší větev se
musí vynutit přepsáním media queries v doručeném CSS, jinak „desktopový" test
měří dotykový styl.

**Za týden změřit** (`ga4.py money 7` + rozpad po zařízeních): kolik prokliků
`card` zbude ze sedmi dotykových. Setrvání znamená, že to lidi chtěli; pokles,
že to byly omylem trefené kliky — a pak patří ta plocha úplně jinam.

## D62 — BongaCams: vlastní HLS přehrávač a proklik, který se nedá zabít (27. 8. 2026)

**Kenny:** „BongaCams mi stále nejde prokliknout nebo mi nebezi zadny stream."
Na dotaz odpověděl, že **blokovač reklam nepoužívá** — tím padla první hypotéza
a musely nastoupit dvě měření.

### Co se změřilo

**Proklik je technicky v pořádku a přesto skončí na obecné titulce.** Skutečný
prohlížeč (headless Chromium, mobilní UA) na produkčním
`/go/bongacams/EmmaEmber/?p=player`:

```
302 ecamx.com/go/…            (naše)
302 bongacams.com/track?c=…&csurl=…
302 bngtrak.com/hit.php?c=…
301 bongacams.com/EmmaEmber?bcs=…
200 bongacams.com/emmaember?bcs=…   ← pokoj modelky, s jejich tracking tokenem
```

Řetěz tedy dojde až do pokoje. Teprve pak převzala řízení **Cloudflare výzva
BongaCams** (`/cdn-cgi/challenge-platform/…`) a konečná URL byla
`https://bongacams.com/`, titulek „Just a moment…". To je ten příznak „vyleze
z toho obecná titulka" z D59 a **na naší straně na tom není co spravit** — je to
jejich bot ochrana. Z datacentrové IP se spouští vždycky.

**Stream na naší stránce neexistoval vůbec.** Od D56 vracel
`embedUrl('bongacams')` prázdný string (EasyList `||bongacams.com^$subdocument,
third-party`), takže na stránce modelky byl jen náhled s odkazem. Cam stránka
bez streamu je pro návštěvníka rozbitá — a přesně tohle Kenny hlásil.

### Řešení: stream jejich, přehrávač náš

Feed BongaCams u každého záznamu posílá `stream_feed_url`, tedy HLS playlist na
`bcvcdn.com`. Změřeno na plném feedu: **1 293 z 1 293 záznamů ho má**, HTTP 200
i bez jakýchkoli hlaviček, `access-control-allow-origin: *`, varianty
240p/480p/720p (488 / 1 258 / 3 396 kbps), segmenty `video/m2ts` taky s CORS.
Host **není na EasyListu ani EasyPrivacy** — a protože `<video>` není rámec,
neplatí na něj `$subdocument` ani Heavy Ad Intervention (D13). Žádná Cloudflare
výzva: stream jede z CDN, ne z jejich webu.

Použil se existující mechanismus, ne nový: adresu nese `Model.embedRef` (dosud
jen Streamate a ImLive) a `embedUrl()` vrací marker `hls:…` — stejný princip
jako `widget:` u Amateur.tv, aby se to nedalo omylem strčit do `iframe.src`.
BongaCams se vrací do `AUTOPLAY_SAFE`: důvod vyřazení byl rámec, a ten je pryč.

Tři věci, na kterých by to jinak spadlo, a všechny jsou změřené:

1. **HTTP 200 neznamená stream.** Playlist neexistující nebo skončené modelky
   má 25 bajtů (`#EXTM3U` + verze) a nula variant. Detekce musí jít po obsahu.
2. **Adresa zastarává.** Nese shard (`ded6740-edge20.bcvcdn.com`) a ten se
   z nicku **odvodit nedá** — tentýž nick na cizím shardu vrací 404, shardů je
   34 na 1 293 modelek. Medián `online_time` je 1,2 h a jen 33 % modelek vysílá
   déle než 2 h, takže po reconnectu je uložená adresa neplatná. Přehrávač si
   proto jednou vyžádá čerstvou z `/api/stream/bongacams/{nick}/` (viz níž).
3. **Mrtvý přehrávač je horší než žádný.** Když ani čerstvá adresa nezabere,
   `<video>` zmizí a odkryje se odkaz do pokoje — tedy přesně stav do 27. 8.

**Obnovu adresy jsem napoprvé postavil špatně a měření to ukázalo.** První
verze posílala do `/api/online/?s=1` mapu 150 nejsledovanějších modelek
(`slug → host`). Pak jsem změřil vzorek 25 modelek 40 minut po syncu: **14 adres
pořád hrálo, 11 bylo mrtvých** — 8× modelka skončila, 3× změnila shard. A
všechny tři, které shard změnily, byly **z dlouhého ocasu** (10, 26 a 49 diváků,
hranice top 150 je 102). Mapa tedy pokrývala právě ty, které ji nepotřebují:
populární modelka vysílá dlouho a shard jí drží.

Proto se ptáme na **jednu modelku**: BongaCams to umí přes
`api_v=2&username={nick}` (potřebuje `client_ip`, jinak vrátí jen chybovou
zprávu) a odpověď je **2,8 kB místo 4,4 MB** celého feedu — vejde se do 10 ms
CPU s velkou rezervou. Obsluhuje to nová route
`/api/stream/bongacams/{nick}/` (třetí a poslední dynamická na webu), edge cache
45 s na nick. Nick je tam **case-sensitive** a offline modelka vrací
`{"message":"Invalid model username or offline model"}`, což je čistší signál než
prázdný playlist s HTTP 200. Klient se ptá jen když adresa z buildu selže, takže
56 % zobrazení nestojí ani jeden request navíc.

`/api/online` tím zůstalo nedotčené — a s poznámkou pro příště: kdo tam přidá
parametr, který mění obsah odpovědi, musí ho přidat i do cache klíče (ten se
skládá z `origin+pathname` bez query, schválně kvůli `?cb=`), jinak dostane
mřížka odpověď určenou někomu jinému.

Knihovna: `hls.js/light` (Apache-2.0), dynamickým importem a jen tam, kde je
potřeba — Safari a iOS přehrají HLS nativně. **113 kB gz** (ne 36, jak jsem
odhadoval v plánu), což jsou při 488 kbps zhruba dvě sekundy streamu; načítá se
jako lazy chunk, takže nic neblokuje. `startLevel: 0` drží start na 240p.

### Odchozí odkaz do stejného tabu

Při té příležitosti se změřilo něco, co Kennyho případ nevysvětluje, ale ostatní
návštěvníky pálí: **BongaCams je jediná z jedenácti sítí s plošným
`$popup,third-party` pravidlem na celé doméně.** Blokovače považují za popup
i odkaz s `target="_blank"`, takže tomu, kdo blokovač má, se záložka otevře
a hned zavře. Ostatní sítě mají jen úzká pravidla na cesty a subdomény, která
naše odkazy netrefí (`chaturbate.com*popunder`, `cam4.com/?`,
`imlive.com/wmaster.ashx?`, `crt.livejasmin.com`).

Odkazy takové sítě proto navigují na místě (`POPUP_BLOCKED_NETWORKS`
v `src/lib/popup-blocked.ts` — vlastní modul, protože `data.ts` s sebou táhne
13 MB katalogu a guard si ho dovolit nemůže, past 64). Měření nepadá: klientský
`go_click` se při navigaci pryč nemusí stihnout odeslat, ale `go_click_server`
ve Workeru je nezávislý (D46).

Hlídá to nová kontrola v `check-blocklists.ts`, která porovnává seznam se
seznamy **v obou směrech** a hosty si odvozuje z `deepLink()` — z `dist/` se to
vyčíst nedá, odchozí URL jsou first-party `/go/…`. Kontrola musí být oddělená od
`matches()`, které `$popup` schválně přeskakuje. Napoprvé sama nahlásila cam4:
`||cam4.com^*&utm_source=$popup` vypadalo jako plošné, protože jsem četl jen
část před `^`. Plošné je jen pravidlo, kterému za hostem nic nezbývá.

### Předpoklad

`stream_feed_url` je pole z affiliate feedu, tedy určené pro naše promo plochy.
Kdyby to BongaCams rozporovala, návrat je jednořádkový (`embedUrl` → `''`)
a stránka se vrátí k posteru s odkazem.

## D63 — Mřížka bez skoku, Chaturbate nahoru, technický a bezpečnostní úklid (28. 8. 2026)

Kenny: projít web jako UX specialista i senior vývojář, ať je technicky
v pořádku a zabezpečený; **aby se neukazovaly streamy, které neběží**; aby
**karty po načtení nemizely a nenahrazovaly se jinými**; a aby se **Chaturbate
tlačil nahoru**, protože nese nejvíc peněz.

### Skok v mřížce: co se s ním dá a nedá dělat

Změřeno na produkci (390 px, mobilní UA): **13 z 60 karet se vymění ~400 ms po
načtení**. Počet viditelných karet se nemění a CLS je 0,0001 — D57 drží. Mění se
obsah, protože data z buildu jsou až 2 h stará a část modelek mezitím dovysílá.

**Předpovědět, která karta umře, nejde.** Dva snímky feedu Chaturbate s odstupem
27 minut (8 043 modelek): přežije 82 %, a napříč skupinami stejně — vysílá
< 30 min 79 %, 1–2 h 81 %, 2–4 h 85 %, > 8 h 78 %. Podle publika totéž
(78–84 %), pokoje nad 500 diváků přežívají nejhůř (69 %). Riziko konce je v čase
konstantní. **Řadit karty podle „šance na přežití" by byla práce s nulovým
efektem** — a je dobré to mít změřené, aby to příště nikdo nezkoušel znovu.

Zbývaly dvě páky a Kenny zvolil druhou:
* zkrátit build z 2 h na 1 h (dnes 13 běhů denně × 11 min; zdvojnásobilo by
  spotřebu Actions nad free limit soukromého repa),
* **opravu udělat dřív a plynule.** Feedy se teď přednačítají z `<head>`
  (`<link rel=preload as=fetch>`), první průchod nečeká na `requestIdleCallback`
  (ten má `timeout: 1200`, takže si klidně počkal sekundu) a nahrazená karta se
  prolne (0,18 s, jen krytí — CLS zůstává 0).

### Sítě, které neuměly zhasnout

Stripchat, Streamate a ImLive neměly `/api/online/` vůbec, takže jejich karty
měly navždy stav „nevíme" — **18 z 60 karet na homepage tvrdilo „Live" bez
ohledu na skutečnost**. Ruční kontrola přes CrakRevenue ukázala, že zrovna
v tu chvíli vysílalo 18 z 18 (sync je bere podle `score`, tedy jejich nejlepší
pokoje), ale bylo to slepé místo.

Teď mají feed: jeden request na top 100 podle score (98 kB, levný parse).
Odpověď je useknutá, takže **chybějící modelka pořád znamená „nevíme"** — jen se
potvrzuje, kdo vysílá. Klíčem je nový příznak `viewersUnknown`: CrakRevenue
diváky nehlásí (samé nuly), takže by z heuristiky `floor` vyšlo, že offline je
každá modelka mimo odpověď — a mřížka by zhasla skoro celá. Dotaz na konkrétní
nick (`name={nick}`) API umí, ale jen po jednom, takže na mřížku je to moc.

### Chaturbate nahoru

GA4 za 28 dní: **19 z 38 prokliků (50 %) je Chaturbate**, přitom rovnoměrné
prokládání mu dávalo 6 karet z 60 (10 %). Druhá BongaCams (6), pak LiveJasmin
a XLoveCam (4). Nejsilnější plocha je přehrávač na stránce modelky
(`?p=player`, 11 z 19 CB prokliků) a 61 % zobrazení jsou stránky modelek.

Váhy jsou v `src/lib/network-weight.ts` (vlastní modul, aby na ně dosáhly
i guardy bez katalogu — jako `popup-blocked.ts`): chaturbate 4, ostatní 1.
`diversify()` je teď **vážené** prokládání — síť s vahou 4 bere v každém kole
čtyři sloty a kolo jí začíná, takže má i nejlepší pozice. Totéž platí pro
klientské doplňování rezervy (jinak by se poměr po opravě mřížky rozpadl)
a pro `similarLive()`, který dosud žádné prokládání neměl a vracel pořadí
z předpočítaných košů.

Uvnitř Chaturbate rozhoduje `payingScore()`: běžící tip goal, interaktivní
hračka a publikum v pásmu, kde je jednotlivý dárce vidět (50–800). Pokoj se
40 000 diváky je špatná první karta — velryba v něm zanikne a navíc takové
pokoje končí nejdřív. **Tohle je hypotéza, ne měření**: při 38 proklicích za
28 dní se to A/B testem vyhodnotit nedá, ověří se na objemu `?p=player`.

### Na mobilu bylo nad ohybem všechno kromě camů

Na 390×844 začínala první karta na **~1 480 px**: věková lišta se souhlasem
350 px, navigace 200 px, H1 s odstavcem 350 px, chipy deseti sítí 300 px.
U agregátoru, jehož produkt JE mřížka, je to nejdražší chyba na webu.

Lišta má teď jednu větu místo odstavce (právní obsah zůstal, jen se nevypráví),
H1 je menší, **úvodní odstavec se přesunul pod mřížku** (vyhledávači je jedno,
kde na stránce je) a podnadpis „Live right now…" zmizel, protože říkal totéž co
H1 o dva řádky výš. Chipy jdou na jeden řádek s vodorovným posuvem.

**Číslo u chipu bylo špatně.** Ukazovalo počet karet té sítě na stránce, takže
na homepage svítilo u všech deseti „12" — vedle titulku „15 500+ live cams" to
vypadalo, že je web prázdný. Teď je to počet živých pokojů sítě z faset.

### Mrtvý přehrávač na stránce modelky

Na `/live/keirasworld/` odznak správně přepnul na OFFLINE, ale v ploše zůstal
bílý rámec Chaturbate s „Room is currently offline" přes celou šířku tmavé
stránky. Kód uměl povýšení offline→online, opačný směr ne. Teď se rámec
i `<video>` odstraní a odkryje se blok „just ended the stream" s odkazem na
profil a na to, kdo vysílá teď. Blok je v HTML od začátku a leží v ploše
s pevným poměrem stran, takže neposune nic.

### Bezpečnost

1. **Klíč k feedu Amateur.tv ležel čitelně ve zdroji 274 stránek** — jejich
   widget ho vyžaduje jako `data-id` a je to týž řetězec jako credential
   k feedu (past 19). Cíl D17 tím byl splněn jen z poloviny. Widget je pryč
   (Kennyho volba; Amateur.tv má 1 proklik za 28 dní) a s ním **jediný cizí
   skript na webu** (`cdn.a00s.net`) — což teprve umožnilo plnou CSP.
2. **`PUBLIC_XLOVE_API_KEY` a `PUBLIC_LIVEJASMIN_API_KEY` byly zapečené
   v `dist/server/chunks/*.mjs`.** Build je nečte (v `src/` je používá jen
   runtime endpoint z Worker secrets), byly jen v `.env` — a `import.meta.env`
   se do bundlu vkládá celé, protože se na něj sahá výrazem. CI je nepředává,
   ale ruční `pnpm deploy` by je nahrál do produkčního Workeru. Z `.env` pryč,
   nahoře je varování, co tam smí.
3. **Guard proti únikům skenoval jeden soubor z osmnácti tisíc** (jen
   `dist/search/idx.txt`), takže oba nálezy výše by jím prošly. Teď projde
   `dist/client/**` i `dist/server/**` a hlídá i `TOKEN` a `WIDGET_ID`; veřejná
   affiliate ID má na výjimce, protože ta v odchozí URL být musí.
4. **Plná CSP** (`scripts/build-csp.ts`, běží jako `postbuild`). Hosty se
   **neopisují, měří** — skript projde postavené HTML a vytáhne z něj hosty
   rámců, obrázků a videí plus hashe inline skriptů. Nová síť tím CSP rozšíří
   sama; cizí skript naopak build zastaví. `style-src` zůstává
   `'unsafe-inline'`, protože filtr sítí vyrábí `<style>` za běhu a hash na něj
   nesedne. Do Workeru se stejná hodnota vloží za `__ECAMX_CSP__` — na Worker
   routy `_headers` neplatí a 404 byla jediná HTML odpověď bez hlaviček.
5. **`imlive` embed** šel do `iframe.src` jako syrový řetězec z feedu; teď musí
   začínat `https://`. Byl to jediný takový sink na webu.
6. Drobnosti: timeout na GA4 Measurement Protocol (držel `waitUntil` naživu),
   `Object.hasOwn` u výběru feedu, v CI `permissions: contents: read`
   a `pnpm exec wrangler` místo `npx` (ten obchází zamčený strom závislostí).

### Co ukázalo až nasazení

Tři věci, které se z kódu ani z lokálního buildu poznat nedaly:

1. **Čekání na nejpomalejší feed.** Po prvním nasazení dopadla oprava mřížky
   za **663 ms**, ne za slíbených 250. Přednačtení fungovalo (feedy startují
   ve 135 ms), ale `allSettled` čeká na všech deset — a ty dobíhají mezi 230
   a 736 ms. První průchod jde teď na čas (300 ms) s tím, co dorazilo, a po
   doběhnutí zbytku se projede znovu; průchod musel být idempotentní („Show
   more" i hláška se z předchozího kola odstraní, GA události jen z posledního).
   Naměřeno po opravě: **168 ms**.
2. **CSP kontroluje cíl přesměrování.** Náhledy Amateur.tv míří v HTML na
   `www.amateur.tv/captures/…`, ale ten host je přesměruje na
   `f-stream-captures.a0s.net` — a prohlížeč je proto blokoval. Generátor to
   z HTML vyčíst nemůže, takže je ten host v ručním seznamu s vysvětlením.
3. **`media-src` musí povolit `blob:`.** hls.js nedává `<video>` adresu
   playlistu, ale MediaSource přes `URL.createObjectURL`, a k transmuxeru si
   pouští worker z blobu. Bez `blob:` BongaCams přehrávač na desktopu tiše
   nehrál — **a v konzoli se to neprojevilo**, protože prohlížeč, ve kterém
   jsem CSP kontroloval, umí HLS nativně a hls.js vůbec nespustil. Chytil to
   až regresní test `check-hls-player.mjs`, který si tu cestu vynucuje.

Změřený stav po nasazení: oprava mřížky 168 ms, Chaturbate 24 z 60 karet
(40 %) a první karta, deset sítí v mřížce, první karta na 301 px (bylo
~1 480), CLS 0, žádné porušení CSP na jedenácti typech stránek, klíč
Amateur.tv nikde, odchozí odkazy 10/10.

### Co se při té příležitosti našlo a spravilo hned

Sync přestal ukládat: `registry-gone` mělo 26,17 MB proti limitu KV 25 MB
a noční běh CI spadl. Řešení a proč nepomohla retence je v samostatném commitu
a v pasti 93 — zkráceně: zaniklá stránka je jen přesměrování, takže se ukládá
zhuštěně a je z toho 8,33 MB.

Sync taky hlásí dvě věci, které tenhle commit **neřeší** a čekají na
rozhodnutí: strop `MAX_MODEL_PAGES` vyhodil 851 stránek s měřenou poptávkou
a odřízl 5 907 archivních, takže retence je fakticky kratší než 45 dnů.

## D64 — Stránkování mřížek za archivní stránky s poptávkou (28. 8. 2026)

Kenny: „rozhodni to nejlépe za tebe, já sám nevím."

Sync hlásil dvě věci naráz: **strop vyhodil 851 stránek s měřenou poptávkou**
(tedy URL, které v Bingu reálně vydělávají, D53) a **odřízl 5 907 archivních**,
takže retence byla fakticky kratší než slíbených 45 dnů. Zvednout strop nejde
naslepo — free plán Cloudflare má 20 000 souborů na deployment a CI zastavuje
na 19 000; build měl 18 648.

### Co jsem změřil, než jsem něco obětoval

Rozpad souborů: 14 165 stránek modelek + 1 937 nemodelových + ~2 550 ostatních
(chunky, sitemapy, index finderu). **Z nemodelových je 1 103 jen stránkování
mřížek** — `/cams/{slug}/2/`, `/country/{kód}/3/` a tak dál.

Co ho používá (GA4, 28 dní): **23 zobrazení na 11 URL, z toho polovina jsou
legacy WP adresy z přesměrování**. Vlastní stránkování mřížek má tedy jednotky
návštěv měsíčně. Přitom crawl cestu ke stránkám modelek nenese ono, ale textový
adresář `/models/` (D33): 250 odkazů na stránku proti 60.

### Rozhodnutí

**Stránkování mřížek se zastropovalo na 3 stránky na fasetu** (540 karet do
hloubky) a uvolněných ~670 souborů dostaly stránky modelek. Strop je
`MAX_GRID_PAGES` v `src/lib/paging.ts` a **cestuje s rozměrem mřížky**
(`GridSize.maxPages`), takže se na něj nedá zapomenout: `gridWindow()` a
`gridPageCount()` ho aplikují jak na `getStaticPaths()`, tak na stránkovací
lištu. Kdyby platil jen na jednom místě, lišta by odkazovala na stránky, které
se negenerují — 404 na vlastním webu. Adresáře (`/models/`) strop nemají a mít
nesmí.

Samotné zvednutí stropu ale nestačilo: `MAX_MODEL_PAGES` na 17 200 nechalo
pořád 539 vyhozených stránek s poptávkou a odhad souborů vyskočil na 18 977,
tedy 23 pod hranicí, kde CI zastavuje. Živých modelek je totiž 15 400 a **každá
dostávala stránku dřív než jakákoli archivní** — archiv bral jen zbytek.

Proto se změnil i poměr: `ARCHIVE_RESERVE` z 900 na **2 400**. Živý rozpočet je
14 600, takže ~860 nejtenčích živých profilů (bez poptávky, bez publika, první
den) stránku nedostane a počká v registry, až se místo uvolní. Cena je nulová:
mřížka ukazuje 60 karet z 15 000 a ty profily jsou stejně `noindex`.

**Výsledek proti stavu před zásahem:** stránek s měřenou poptávkou vyhozených
**851 → 0**, archivních odříznutých **5 907 → 237**, indexovaných stránek
**14 165 → 15 888**, odhad souborů 18 747 → 18 745 (rezerva 255 do zastavení CI).

Hluboké stránkování, které se přestalo generovat, obsluhuje Worker: místo 404
posílá 302 na rozcestník (`gone.ts`). Crawleři ty adresy znají a 404 by z nich
udělal mrtvé odkazy zbytečně.

## D65 — Provoz zdarma: čtyři buildy denně místo dvanácti (28. 8. 2026)

Kenny: „chci aby to běželo free, tak to nastav tak nejlépe."

GitHub 28. 8. odmítl spustit deploy: *„recent account payments have failed or
your spending limit needs to be increased"*. Změřená spotřeba za srpen —
a limit 2 000 minut je na **účet**, ne na repo:

| repo | běhů | průměr | odhad za měsíc |
|---|---|---|---|
| ecamx | 181 | 9,8 min | ~1 782 min |
| rankizo | 114 | 1,6 min | ~186 min |
| rankmat | 39 | 1,6 min | ~64 min |
| | | | **~2 032 z 2 000** |

Přetékalo to tedy o vlásek a viník je ecamx. Poslední běhy trvají 12,6 min:
build 8,3 · deploy 2,5 · sync 0,8 · zbytek ~1.

### Co jsem zvažoval a proč to vyšlo takhle

**Zmenšit web a stavět častěji** vyšlo hůř, než jsem čekal. Běh se skládá
z pevné části (~2,3 min) a části úměrné počtu stránek, takže 5 běhů denně by
vyžadovalo katalog kolem 13 000 stránek a stálo **~1 770 min** — víc než
4 běhy s plným katalogem 17 000 (**~1 512 min**). A obsah je cennější než
frekvence: stránka, která neexistuje, nemůže nikdy začít vydělávat, kdežto
o hodinu starší karta pořád vede na stránku, která od D63 umí říct „právě
dovysílala" a nabídnout profil (což je pořád affiliate odkaz).

**Nerovnoměrný rozvrh podle provozu** jsem zahodil: GA4 sice ukazuje 65 %
zobrazení mezi 03:00 a 15:00 UTC, ale špičky (213 zobrazení v 07:00) vypadají
spíš na crawlery než na lidi, a stavět rozvrh na šumu se nevyplácí.

### Nastavení

* **cron `0 0,6,12,18 * * *`** — 4 běhy denně, nejhorší mezera 6 h,
  ~1 512 min měsíčně. S ostatními repy ~1 760 a zbývá ~240 min na pushe.
* **`cancel-in-progress: true`** — 28. 8. spolklo osm pushů za sebou osm
  plných běhů. Novější běh nese novější data, takže se rušením nic neztrácí.
* **`paths-ignore`** navíc na ruční kontrolní skripty (`check-grid.mjs`,
  `check-card-taps.mjs`, `check-hls-player.mjs`, `check-redirects.ts`) — CI je
  nespouští, takže jejich změna nemá co nasazovat.
* Prahy „zastaralého" stavu se musely posunout, jinak by křičely každou noc:
  hláška v mřížce 3 h → **8 h**, hlídač nakopne na 7 h a hlásí na 8,5 h.

### Co to kompenzuje

Se šestihodinovým buildem přibývá **zombie karet** — karta tvrdí Live, ale
modelka je ve výřezu feedu nedohledatelná (feed vrací jen nejsledovanějších N),
takže se dosud nechávala být. Klientský průchod proto nad 3 h stáří stránky
vymění i tyhle nejisté karty za ty, o kterých VÍ, že vysílají — dokud takové
v rezervě jsou. Na čerstvé stránce se nemění nic navíc, aby se mřížka zbytečně
nehýbala (D57).

**Co tím web ztrácí:** data v mřížce jsou až 6 h stará místo 2 h. Klientská
oprava to dorovná u sítí s živým feedem (od D63 jich je všech deset), takže se
to projeví hlavně na méně sledovaných modelkách. Kdyby Kenny někdy chtěl zpátky
dvouhodinový rytmus, stojí to ~$19 měsíčně navýšením spending limitu — a je to
jediná věc, kterou se to koupit dá.

### Dodatek k D65 — Malina jako záchranná brzda

Když GitHub 28. 8. přestal spouštět joby, web zamrzl na jednom buildu a nedalo
se s tím udělat nic. Malina přitom build **utáhne** — trvá jí 17 minut a projde,
jen když má volnou paměť (dvakrát ten den ho zabil earlyoom při 2,1 GB volných,
při 4,6 GB doběhl). Nasazení z Maliny proběhlo a ověřilo se na produkci.

`bin/ecamx-pi-deploy.sh` (cron `15 */2`) je proto **záchranná brzda, ne druhý
plánovač**: nejdřív se podívá na `<meta name="ecamx-built">` na živém webu a
když je build mladší než 7 h, hned skončí. Rozjede se jen tehdy, když CI
selhalo — a jakmile se CI vrátí, sám se odmlčí. Před buildem kontroluje volnou
paměť (pod 3 GB nezačíná, aby po sobě nenechal rozdělaný `dist/`), build pouští
v čistém prostředí (past 96) a **nenasadí nic, co neprojde guardy**.

Pokrývá to i výpadky, které s fakturací nesouvisí: EasyList shodil guard na deset
hodin (D56) a GitHub jednou sedm hodin nespustil naplánovaný běh (D60).

## D66 — Chybějící modelka ve feedu nedokazuje, že nevysílá (28. 8. 2026)

Po nasazení vah zmizely z homepage tři sítě úplně (CamSoda, cam4, LiveJasmin)
a mřížka spadla na 57 karet z 60. Vypadalo to na vyčerpanou rezervu; při měření
se ukázalo něco horšího.

**Ty karty nebyly mrtvé — jen je náš vlastní endpoint prohlásil za mrtvé.**
Změřeno proti surovým feedům z Maliny ve stejnou chvíli:

| síť | karet na homepage | živých podle feedu z Maliny | živých podle `/api/online/` |
|---|---|---|---|
| CamSoda | 18 | **14** | 0 |
| cam4 | 18 | **11** | 0 |
| LiveJasmin | 17 | **15** | 0 |

Průnik našeho endpointu s feedem z Maliny byl u CamSody **190 z 1 689** klíčů,
u cam4 **11 z 300**. Přitom oba feedy jsou z jedné IP deterministické (dva
dotazy po sobě daly identický seznam, i s obejitím jejich cache).

Rozdíl je tedy ve **vantage pointu**: build běží z Maliny nebo z GitHubu,
runtime z Cloudflare — a tyhle sítě servírují jiný lineup podle IP volajícího.
Heuristika „chybí v odpovědi a měla víc diváků než nejslabší v ní → offline"
(D11) pak sestřelí desítky živých pokojů naráz. U LiveJasminu a XLoveCamu se to
sčítá s druhým problémem: **počty diváků nehlásí vůbec**, takže `floor` je nula
a podmínka platí na každého.

Chaturbate, BongaCams a Amateur.tv tím netrpí — jejich roster sedí (Chaturbate
47 živých ze 72 karet), a Chaturbate je od D63 40 % mřížky, tedy plocha, kde na
zhasínání nejvíc záleží.

**Řešení:** příznak `absenceUnproven` (nahrazuje užší `viewersUnknown`).
U sítě, která ho má, se karta nikdy nezhasne kvůli tomu, že ve feedu chybí —
jen se potvrzuje, kdo vysílá. Má ho CamSoda, cam4, LiveJasmin, XLoveCam
a všechny tři sítě z CrakRevenue; nemá ho Chaturbate, BongaCams a Amateur.tv.

**Co to stojí:** karta, která opravdu dovysílala, u těch sítí zůstane viset.
Je to menší zlo než schovat živý pokoj, který vydělává — a od D63 vede i taková
karta na stránku, která umí říct „právě dovysílala" a nabídnout profil.

**Poučení do příště:** než se z feedu vyvozuje „tahle modelka nevysílá",
musí se ověřit, že runtime vidí **tentýž seznam** jako build. Stačí porovnat
průnik klíčů `/api/online/{síť}/` s feedem staženým odjinud; u čtyř sítí z deseti
to nesedí.

### Dodatek k D65 — co se stane 1. 9.

Free minuty Actions se resetují 1. dne měsíce, takže se buildy mají rozjet samy
s novým rozvrhem. Do té doby drží web záloha z Maliny.

Problém je, že **mlčení je v ten den dvojznačné**: buď šlo o vyčerpaný limit
(pak se to rozjede), nebo o platební metodu (pak ne, a musí to spravit člověk).
`bin/ecamx-actions-check.py` (cron denně 6:35) proto sečte minuty všech tří
soukromých rep — limit 2 000 je na účet, ne na repo; naměřeno **1 724 min od
1. 8., z toho ecamx 1 469** — promítne je na konec měsíce a **1. dne v měsíci
pošle verdikt tak jako tak**: buď „buildy jedou, projekce X min", nebo „ani po
resetu nejedou, je to platební metoda".

Dál mluví jen při změně stavu a jednou měsíčně, když projekce přeleze 1 800 min
(rezerva na pushe). Dokud jsou buildy zastavené, varování o projekci se drží
zpátky — to už není předpověď.

Hlídač deploye se zároveň ztišil: spadlé CI při čerstvém webu hlásí **jednou
denně** místo po šesti hodinách. Za víkend by z toho bylo šestnáct zpráv o témže.

## D67 — klik na kartu musí dát stream, ne hlášku (29. 8. 2026)

Kenny: *„chci aby fungoval stream když na ně kliknu a neobjevovalo se mi tam
just ended the stream."*

**Změřeno na produkci**, na 13,9 h starém buildu: z 60 viditelných karet na
homepage bylo potvrzeně živých **12**. Čtyři z pěti kliků tedy skončily na
stránce s hláškou. Rozpad po sítích ukázal i druhý efekt: Chaturbate měl na
homepage 2 karty (jeho mrtvé karty se poctivě zhasínají a rezerva došla),
zatímco mřížku držely sítě s `absenceUnproven` (D66) — tedy zombie.

To nebyla jen výjimka kvůli zastavenému CI. **I při plánovaných čtyřech
buildech denně je stránka až 6 h stará** a za tu dobu dovysílá většina pokojů
(za 27 minut přežije 82 %, po šesti hodinách jednotky procent). Statická karta
živý stream zaručit neumí. Umí to jedině živý feed — a ten už web čte.

### Co se změnilo

**1. Endpoint umí vrátit hotové karty.** `/api/online/{síť}/?cards=N` (strop 40)
přidá do odpovědi `cards: [{ s, n, t, v, e }]` — slug, nick, náhled, diváci
a adresa přehrávače z `embedUrl()`. Klíče zůstávají na serveru (past 19).
Bez parametru je odpověď bajt po bajtu stejná jako dřív, takže mřížka
i watchlist zůstaly beze změny; parametr je **v cache klíči** (past 86).

Náhled musí posílat endpoint: odvodit ho z nicku jde jen u Chaturbate
(`thumb.live.mmcdn.com/ri/{nick}.jpg`) a Streamate — cam4 má v adrese podpis,
CamSoda číselný shard, BongaCams/LiveJasmin/XLoveCam/Amateur hash.

**2. Stránka dovysílané modelky hraje někoho jiného.** Když živá kontrola
zhasne modelku, na kterou se člověk dívá, mrtvý rámec zmizí a do plochy se
vloží první živá ze **stejné sítě**, která má přehrávač. Nad ní je proužek
`„{jméno} just ended — now playing {nová}."` a odkaz na profil původní modelky
zůstává (provize se neztrácí). Nadpis, drobečky ani JSON-LD se **nemění**:
stránka je pořád o té modelce, kvůli které sem člověk přišel. Přesměrovat by
znamenalo lhát návštěvníkovi i Bingu, který má stránky zaindexované.

**3. Mřížka si dotáhne záchranné karty.** Po posledním živém průchodu se spočítá,
kolik viditelných karet je potvrzeně živých; když je jich míň než polovina cíle
a stránka je starší tří hodin, dotáhne se `?cards=40` u sítí, které na stránce
jsou, a nejisté karty se **na svém místě** nahradí (D57: přeživší se nehýbou).
Karta se klonuje z existující a přepíšou se jen pole — markup zůstává
v `ModelCard.astro`.

**Kam záchranná karta vede:** `/live/{slug}/?r={síť}&n={nick}`. Když u nás
stránka existuje, servíruje ji statika a parametrů si nikdo nevšimne. Když ne,
dojde požadavek na catch-all ve Workeru, který udělá 302 na
`/go/{síť}/{nick}/?p=rescue` — tedy rovnou do pokoje. Je to „naše stránka,
jinak pokoj" bez jakéhokoli seznamu slugů na klientovi; `robots.txt` má
`Disallow: /*?`, takže crawler tam nechodí. Placement `rescue` je zaregistrovaný
na obou místech (past 75), jinak by proklik spadl na `card` a měření by lhalo.

### Co se NEDĚLÁ

Přesměrování offline stránky na jinou modelku (rozbilo by, co má Bing
zaindexované) · karty vedoucí vždycky ven (61 % návštěvnosti je na stránkách
modelek) · sahání na `absenceUnproven` (D66 platí — záchranné karty ten problém
obcházejí tím, že nabídnou POTVRZENĚ živé, místo aby hádaly, kdo zhasl).

### Měření

Nové události `player_substitute` (network, model) a `grid_rescued` (count),
dimenze registrované **před** nasazením (past 32). Za týden se z `ga4.py money 7`
pozná, jestli náhrada něco nese a jestli neubylo `player`.

**Ověřeno proti živým feedům** (endpoint spuštěný lokálně proti osmi sítím,
bez buildu): karty i náhledy dojdou všude, adresy náhledů sedí na hosty
v `THUMBNAIL_HOSTS` a jsou https. Přehrávač chybí jen u dvou sítí — BongaCams
(adresa se bere z `/api/stream/bongacams/{nick}/`, protože feed má 4,4 MB;
náhrada si o ni proto řekne zvlášť, nejvýš třikrát kvůli rate limitu) a
Amateur.tv (přehrávač nemá od D63 vůbec, tam zůstává hláška).

### Jak to dopadlo (29. 8., měřeno na produkci)

| | před D67 | po D67 |
|---|---|---|
| živých z 60 karet na 8 h starém buildu | **2 (3 %)** | — |
| živých po průchodu, stránka podstrčená jako 10 h stará | — | **60 z 60 (100 %)** |
| z toho karet dotažených z feedu | — | 52 |
| Chaturbate podíl | 0 z 20 živých | 24 z 60 karet (40 %) |
| CLS · přeživší karty posunuté | — | 0 · 0 |

Na čerstvé stránce (0,5 h) je živých 49 z 60 (82 %) a záchrana se nespouští —
mřížka se tedy nehýbe zbytečně (D57).

Náhrada na stránce dovysílané modelky ověřena na `/live/vesia/`: v ploše běží
gracieparker a proužek říká „vesia just ended — now playing gracieparker.".
Řetězec záchranné karty ověřen end-to-end: `/live/{neznámý}/?r=chaturbate&n=X`
→ 302 → `/go/chaturbate/X/?p=rescue` → 302 do pokoje s `track=rescue`.

**Vedlejší nález:** záložní deploy z Maliny **nikdy z cronu neběžel** — cron má
holé `PATH` bez `pnpm`, takže v 02:15 i 04:15 tiše spadl na „command not found"
a web zůstal 15,8 h na starém buildu. Opraveno; v 16:15 se poprvé v životě
rozjel sám a nasadil.

## D68 — žádné přesměrování k partnerovi, stream si nikdo nemá pouštět sám (29. 8. 2026)

Kenny na živém D67: *„některé Chaturbate mi rovnou přesměruje na
Chaturbate.com a některé mi přesměruje nejdřív na /live/…?r=chaturbate&n=…,
ale stream neběží a musíme zmáčknout play. Já bych chtěl aby na všech, žádné
přesměrování k partnerovi hned, potřebujeme ty lidi co nejdýl udržet na webu
a mít /live/ abychom měli co indexovat."*

Obě věci měly jednu příčinu a jednu podmínku navíc, kterou D67 neuhlídal.

### 1. Čtvrtina záchranných karet vedla ven

Feed vrací modelky, které vysílají teď — jenže část z nich u nás **stránku
nemá**. Změřeno: chaturbate 19 z 20, camsoda 16 z 20, cam4 13 z 20,
livejasmin 15 z 20, **stripchat 12 z 20**. D67 to řešil zkratkou
`/live/{slug}/?r={síť}&n={nick}` → Worker → pokoj partnera. Fungovalo to, ale
znamenalo to, že **každý čtvrtý záchranný klik opustil web bez jediné naší
stránky** — přesný opak toho, k čemu web je.

**Řešení:** karta vznikne jen pro modelku, jejíž stránku máme. Seznam píše sync
do `public/live-pages.json` (per síť; `p` = stránka se jmenuje jako slug,
`x` = jmenuje se `{slug}-{síť}`, dnes 1 472 kolizí ze 17 000).

Proč statický soubor a ne data ve Workeru: 400 kB literál v modulu endpointu by
se parsoval při startu každého isolate a `/api/online/` má strop 10 ms CPU —
u CamSody se kvůli němu 1,2 MB JSONu tahá regexem místo `JSON.parse`. Takhle to
stojí jeden asset (~120 kB po gzipu), stáhne se **jen když se záchrana opravdu
spouští**, a Worker se toho netýká vůbec. Bez seznamu se záchrana neprovede —
starší mřížka je pořád lepší než člověk poslaný pryč.

Zkratka je pryč i ze serveru (`redirectFor()` už `?r=&n=` nezná), takže ji
nemůže vyvolat ani stránka z cache. Odkaz karty je čistý `/live/{page}/`,
k nerozeznání od karty z buildu. CTA „Chat →" má dál `p=rescue` — to je vědomý
klik ven, ne přesměrování.

### 2. Povýšená stránka jen odkryla tlačítko

Když se stránka stavěla jako offline a živá kontrola zjistí, že modelka vysílá
(D19), dosud se **jen odkrylo tlačítko Play**. Kenny na to narazil rovnou.
Teď se u sítí, kde autoplay měřeně projde (`AUTOPLAY_SAFE`: chaturbate, camsoda,
cam4, stripchat, imlive, bongacams), rámec vloží sám — `startEmbed('auto')`,
tentýž kód jako klik, jen bez kradení fokusu. U zbytku zůstává tlačítko
schválně: streamate nemá ztišené video a Chrome mu autoplay zablokuje,
XLoveCam a LiveJasmin jsou na EasyListu, takže rámec by stejně nehrál —
mrtvý přehrávač je horší než tlačítko. Rozhoduje o tom stránka modelky
(`data-autoplay`), ne Layout; ten jen pošle `ecamx:model-online`.

GA rozlišuje `mode: 'click'` vs `'auto'`, takže se dá změřit, kolik zobrazení
tohle zachránilo.

### Guardy

`check-rescue.mjs` nově trvá na tom, že **žádná karta nevede jinam než na
`/live/`**, a u vzorku záchranných karet ověří, že ta adresa opravdu vrací 200.
`check-hls-player.mjs` dostal případ „povýšená stránka": feedu se podstrčí, že
konkrétní offline stavěná modelka vysílá, a měří se, že se stream rozjel sám,
tlačítko zmizelo a klikací vrstva nad videem se vrátila (jinak by klik do
streamu nevydělal nic).

**Past při psaní toho testu** (napálila mě na první pokus): síť se musí číst
z bloku `data-player`, ne z celého HTML. Dole na stránce jsou karty souvisejících
modelek z jiných sítí, takže hledání `data-network="chaturbate"` v dokumentu
vybralo stránku BongaCams — test pak podstrkoval feed sítě, o kterou vůbec
nešlo, a nahlásil tři chyby, které na webu nebyly.

### Ověřeno po nasazení (29. 8., produkce)

`check-rescue`: **60 z 60 karet potvrzeně vysílá**, 53 z nich z feedu,
**každá vede na `/live/`, žádná ven**, osm ověřených adres vrací 200,
Chaturbate 25 z 60 (42 %), CLS 0. `check-hls-player`: povýšená stránka
`/live/aashleyx/` **pustí stream sama**, hláška zmizí, klikací vrstva se vrátí;
náhrada na `/live/nicolle-mitchelle/` hraje onlykira a říká to. Neznámý
`/live/…/?r=&n=` končí na `/models/u/`, tedy u nás.

**Vedlejší oprava:** build na Malině dostal strop haldy
(`--max-old-space-size`, ~volná paměť minus 900 MB). Bez něj V8 rostl, dokud ho
earlyoom v půlce prerenderu nesestřelil — 29. 8. se to stalo při 2 680 MB
volných (SIGTERM, exit 143). Se stropem prošel build při 3 030 MB za 16 minut.

## D69 — „Cam4 nefunguje": prázdné karty (29. 8. 2026)

Kenny: *„Cam4 nefunguje, oprav mi je."*

**Změřeno v prohlížeči na `/site/cam4/`: 8 ze 40 karet nemělo obrázek** (20 %).
Na homepage se to skoro neprojeví (1 z 60), proto to dosud nikdo nechytil —
a žádný guard se na náhledy nedíval.

Příčina není expirace ani offline, jak to vypadalo:
`snapshots.xcdnpro.com/thumbnails/{Nick}?s=…` vrací pro část modelek
**HTTP 404 s `text/html`**, což prohlížeč u obrázku zahodí (ORB,
`ERR_BLOCKED_BY_ORB`) a po kartě zbude prázdné místo. Ověřeno, že to nezachrání
ani čerstvá adresa z feedu, ani adresa bez podpisu, ani jiný tvar hostu —
a děje se to i modelkám, které **právě vysílají** (`cerrysta` byla ve feedu
jako online a její snapshot přesto 404).

### Řešení: Cam4 na to má vlastní pole, jen jsme je nečetli

Feed vedle `thumb` posílá **`profile_thumb`** (skutečná profilovka, ověřeno
HTTP 200 image/jpeg) a **`thumb_error`** (generický avatar podle pohlaví,
tři adresy pro všechny). Sync je ukládá do nového `thumbnailFallback` a karta
je nese v `data-thumb-fallback`; endpoint je posílá i v `?cards=` jako `f`,
takže se stejně chovají i záchranné karty (D67). Pole plní **jen Cam4**, takže
katalog naroste jen o ~430 kB.

Pořadí je: živý snapshot → profilovka → avatar. Teprve když selže všechno,
**ustoupí modelka jiné**: na její místo nastoupí rezerva (přednostně ze stejné
sítě, ať se nerozhodí poměr, D63) a původní karta jde skrytá dozadu — počet
viditelných karet se nemění a nic se neposune (D57). Rozbitá karta je z rezervy
napořád venku, jinak by ji živý průchod vrátil zpátky.

Odchytává se to jedním posluchačem na mřížku v **capture** fázi (`error`
nebublá), takže to pokryje i lazy obrázky načtené až při scrollování, plus
jedno projití na startu kvůli obrázkům, které selhaly dřív, než se skript
stihl navěsit.

### Guard

`check-grid.mjs` nově trvá na tom, že **každá viditelná karta má náhled** —
lazy obrázky se k tomu donutí načíst až po zbytku měření, aby to nezkreslilo
CLS ani ohyb. A dá se zamířit na cestu, ne jen na homepage
(`node scripts/check-grid.mjs https://ecamx.com /site/cam4/`), protože právě
rozcestník sítě je ten tvrdý případ; kontroly poměru sítí se tam přeskočí.

### Práh v guardu byl špatně, ne web

Po nasazení hlásil `check-grid.mjs` na `/site/cam4/` „potvrzeně vysílá jen
13 ze 40 (33 %)". Prověřeno proti feedu staženému z Maliny: **z 27 nedoložených
karet jich 19 vysílá** — a rozhoduje vantage point, ne velikost feedu (prvních
300 z feedu na Malině pokrývá 31 ze 40 karet, Worker se stejným limitem 13;
zvětšení limitu na 1 000 nepřidá nic). Je to přesně D66.

Práh „aspoň 80 % doložených" tedy měřil něco, co u sítí s `absenceUnproven`
nejde splnit. Guard teď hlídá to, co je skutečná vada: **karta, kterou feed
vyvrací** (chybí v odpovědi u sítě, kde absence něco znamená — chaturbate,
bongacams, amateur) a přesto je vidět. Podíl doložených se vypisuje jako
informace a hlídá se jen proti úplnému výpadku feedů (pod 25 %).

Naměřeno po opravě: homepage **60 z 60 karet s náhledem**, žádná vyvrácená,
doloženo 70 %; `/site/cam4/` **40 ze 40 s náhledem** (bylo 8 prázdných),
žádná vyvrácená, doloženo 33 %.

### Co ještě Cam4 posílá a zatím nepoužíváme

`preview_url` je HLS stream (`stackvaults-hls.xcdnpro.com`), takže Cam4 by šel
přehrávat ve vlastním `<video>` jako BongaCams (D62) místo v rámci. A jejich
embed `/{nick}/embed` **nenese žádné affiliate ID** — na rozdíl od odchozího
odkazu, který má `sid`/`aid`/`rp`. Klik uvnitř rámce tedy nejspíš nevydělá nic;
u Chaturbate se to řeší klikací vrstvou (`STREAM_LINK`, D34). Obojí je
samostatná položka, ne součást téhle opravy.

## D70 — Cam4 hraje v našem přehrávači, ne v jejich rámci (30. 8. 2026)

Kenny: *„cam4 když kliknu na /live/ tak mi to píše Tento obsah je blokován.
Požádejte vlastníka webu, aby tento problém vyřešil."*

To je hláška prohlížeče pro zablokovaný rámec. **Z Maliny to nešlo zopakovat**
ani jednou ze 14 modelek, na desktopu ani na mobilním UA: rámec se načetl,
`www.cam4.com` není na EasyListu ani EasyPrivacy (ověřeno `check-blocklists.ts`),
Cam4 neposílá `X-Frame-Options` ani CSP `frame-ancestors`, naše CSP má
`www.cam4.com` ve `frame-src` a embed nikam nepřesměrovává. Blokuje to tedy
něco u návštěvníka — rozšíření, přísnější nastavení, DNS — a **proti tomu se
cizím rámcem bránit nedá**.

Přesně tenhle problém už jednou nastal u BongaCams (EasyList, D56) a řešením
bylo přestat používat cizí rámec. Cam4 to umožňuje taky: jejich feed posílá
u **286 z 300** modelek `preview_url`, což je plnohodnotný živý HLS playlist —
změřeno 1280×720, `avc1.42c020,mp4a.40.2`, `access-control-allow-origin: *`,
segmenty ~665 kB, master → varianta → segment celé projde.

Cam4 proto od teď jede v našem `<video>` přes hls.js, stejnou cestou jako
BongaCams. Na `<video>` neplatí blokovací pravidla na `$subdocument` ani Heavy
Ad Intervention a host je `stackvaults-hls.xcdnpro.com` / `cam4-hls.xcdnpro.com`,
což ani jménem nepřipomíná cam4.

**Vedle toho to spraví díru v provizi.** Jejich `/{nick}/embed` nenese žádné
affiliate ID — na rozdíl od odchozího odkazu, který má `sid`/`aid`/`rp` — takže
klik uvnitř rámce nevydělal nic. Nad vlastním `<video>` leží `.player-hit`,
který klik pošle přes `/go/`, tedy s trackingem.

### Adresa je krátkodobá, takže se tahá čerstvá vždycky

12 h stará `preview_url` vracela **404 u 8 z 8** zkoušených. Build je i za
nejlepších okolností 6 h starý, takže adresa z HTML by se netrefila nikdy —
Cam4 si proto bere čerstvou z `/api/stream/cam4/{nick}/` **rovnou**, ne až po
selhání. BongaCams zůstává u dosavadního chování (40 minut po syncu jich hrálo
14 z 25, D62), takže tam se stará adresa vyplatí zkusit.

`/api/stream/` pro Cam4 sahá pro celý feed, protože dotaz na jednu modelku
jejich API nemá. Odpověď má **1,5 MB**, takže `JSON.parse` je vyloučený
(strop 10 ms CPU) — hledá se **cíleně jen ten jeden nick** a adresa se bere
z úseku po další `"nickname":`. Globální regex by musel mít okno přes 1 100
znaků (tolik je mezi `nickname` a `preview_url`) a u modelky bez streamu —
14 z 300 ho nemá — by přeskočil do dalšího záznamu a vrátil **cizí stream**.
Odpověď se cachuje na edge, takže upstream se ptáme jednou za TTL.

Bez adresy (5 % modelek) zůstává rámec jako dřív — pořád lepší než prázdno.

### CSP a guard

`media-src`/`connect-src` dostaly `https://*.xcdnpro.com` (dva různé hosty
podle modelky), a to i natvrdo v `EXTRA` — kdyby v jednom buildu nebyla ani
jedna živá modelka Cam4, direktiva by se zúžila a přehrávač by se rozbil až
při dalším buildu, tedy chyba, kterou nikdo nespojí s příčinou.

`check-hls-player.mjs` umí obě sítě (`… [adresa] [síť]`). U Cam4 se
nekontroluje, jestli hraje adresa z HTML — ta je mrtvá záměrně.

### Deploy může skončit s nulou, a přesto se nenasadit

30. 8. se `wrangler deploy` zastavil v půlce nahrávání — **11 898 z 18 271
souborů** — skončil s návratovým kódem 0 a skript ohlásil „hotovo". Na webu
přitom zůstal šest hodin starý build a poznalo se to jen náhodou, protože
nasazená CSP neobsahovala nový host. Předchozí běhy končí řádkem
`✨ Success! Uploaded N files`, tenhle ne.

`bin/ecamx-pi-deploy.sh` proto po nasazení **ověřuje, že se to projevilo**:
porovná `<meta name="ecamx-built">` z postaveného `dist/client/index.html`
s tím, co servíruje produkce (šest pokusů po deseti vteřinách, Cloudflare
propaguje pár vteřin). Když se to neshoduje, skončí chybou místo „hotovo" —
takže spadlý deploy vypadá jako spadlý deploy.

## D71 — z karty se ven nechodí (3. 9. 2026)

Týden po D67/D68 změřeno, kudy lidi odcházejí ven (`ga4.py money 7`,
serverové `go_click_server`, 36 prokliků):

| placement | 7 dní po změně | 14 dní před ní |
|---|---|---|
| **`player`** — klik do streamu na `/live/` | **27** | 15 |
| `profile` | 4 | 10 |
| `grid` + `offline` | 5 | 3 |
| **`card`** — tlačítko „Chat →" na kartě | **0** | 10 |

Tlačítko na kartě tedy za celý týden nevydělalo **nic**, zatímco `player`
vyskočil ze 7,5 na 27 za týden (3,6×). Kenny rozhodl kartu nechat vést jen na
naši stránku — sedí to i s tím, co chtěl od začátku: *„potřebujeme ty lidi co
nejdýl udržet na webu a mít /live/ abychom měli co indexovat."*

Odchozí odkaz je tedy z karty pryč (`ModelCard.astro` a deset volajících míst
s `outLink`), i s CSS pilulky a dotykového pásu (D61) a s `data-same-tab`
(záchranná karta si už `target` nemá kam přepisovat). Zůstávají jen odchozí
odkazy, které měřeně vydělávají: klikací vrstva nad streamem, CTA na profilu
a velké CTA na rozcestníku sítě.

**Dvě věci, které na tom tlačítku visely:**

*Záchranné karty* se podle něj poznávaly (`?p=rescue` v CTA). Teď nesou
`data-rescued="{síť}"` — v DOMu i v testech se poznají, ale odkaz mají čistý
`/live/`, k nerozeznání od karty z buildu.

*Velké CTA „Open {síť}"* na rozcestníku sítě si z něj bralo cíl, když modelka
z buildu dovysílala. Teď si živý nick dotáhne z `/api/online/{síť}/?cards=1`,
ale **jen když je ten z buildu prokazatelně mrtvý** — v běžném případě to
nestojí ani jeden request navíc.

`check-card-taps.mjs` místo geometrie pilulky hlídá silnější vlastnost:
z 18 bodů po ploše karty nesmí **ani jeden** vést ven, a to ani po najetí myší.
Kdyby se odchozí odkaz do karty vrátil, spadne to tam, ne až v číslech za měsíc.

## D72 — tři buildy denně místo čtyř (3. 9. 2026)

CI se po resetu free minut 1. 9. rozjelo samo, takže srpnový výpadek byl
vyčerpaný limit, ne platební metoda. Jenže projekce za první dva zářijové dny
byla **1 831 z 2 000 minut** — stejně těsně jako v srpnu, kdy to přeteklo
a GitHub joby na dva dny vypnul.

Čtyři běhy denně tedy nestačí. Tři dávají ~1 134 min a nechávají rezervu na
pushe i na rankizo a rankmat (v srpnu 255 min).

**Proč to jde ubrat právě teď:** stárnutí stránky dnes bolí mnohem míň než
v srpnu. Od D67/D68 si mřížka nad tři hodiny stáří dotáhne živé karty z feedu —
za týden se to stalo **63×** (`grid_rescued`) — takže osmihodinová mezera
neznamená mrtvé karty, jen pomalejší zakládání stránek novým modelkám.
V srpnu by totéž znamenalo mřížku plnou zombie karet.

S intervalem musely nahoru i prahy, jinak by hlídač strašil každou noc:
záloha z Maliny 7 → 9 h, hlídač 7 → 9 h (nakopnutí) a 8,5 → 10,5 h (poplach).

## D73 — proč web nejede v Googlu (4. 9. 2026)

Kenny chtěl prohlídku webu a možnosti SEO. Web sám je v pořádku: klíčové cesty
200 za 85–160 ms, 404 vrací skutečnou 404 s rozcestníkem, sitemapy 17 069 URL,
CI po resetu 1. 9. zelené, a všech **56 starých URL, které zná Bing,
přesměrovává správně**.

SEO má ale jeden příběh, a je ostrý:

| | imprese / 28 dní | prokliky |
|---|---|---|
| **Bing** | **6 726** (z 1 234, tedy 5,5×) | **233** |
| Google | 165 | 8, průměrná pozice 47 |

**Bing dělá 97 % viditelnosti** — a nese ji přesně to, na co je web stavěný:
2 990 stránek modelek se 6 177 impresemi (kategorie jen 6 stránek / 21 impresí).
Longtail na nicky funguje, jen zatím jen tam.

Google web skoro nezná. Vzorek 40 stránek modelek přes URL Inspection API:

| stav | počet |
|---|---|
| URL is unknown to Google | 20 |
| Discovered – currently not indexed | 8 |
| Crawled – currently not indexed | 5 |
| Soft 404 | 3 |
| Submitted and indexed | **2** |
| Server error (5xx) | 2 |

**Není to prolinkování ani sitemapa.** `/cams/skinny/` je „unknown", a přitom
na něj `/cams/` odkazuje; sitemapy nesou všech 17 069 URL. Je to crawl budget
při DR 14 (0 organických klíčových slov podle Ahrefs, 408 odkazujících domén
z 492 po disavow z 19. 8.). Ze 81 URL, které v Googlu imprese mají, je
**46 starých `/webcam_category/` přesměrování**, část na pozicích 2,8–8 — tedy
líp než cokoli nového; equity pořád sedí na starých adresách.

Ty 5xx a soft 404 jsou stav z posledního crawlu, ne dneška: všech pět URL teď
vrací 200 za ~90 ms a má kompletní obsah včetně bloku podobných modelek
(ověřeno; první měření hlásilo prázdný blok, ale to byla chyba měření —
`grep -c` počítal řádky, a HTML je na jednom řádku).

### Google Indexing API: hotové, nezapnuté — a možná k ničemu

`VideoObject` + `BroadcastEvent` stránky vydávají od 19. 8. a
`scripts/ecamx/indexnow.py` má příkaz `google`, který posílá jen ověřené živé
stránky podle poptávky. Skript v hlavičce píše, že to nejede kvůli vypnuté
`indexing.googleapis.com` — **to už neplatí**: dotaz na `urlNotifications/metadata`
se scope `auth/indexing` vrací 404 „entity not found" (očekávaná odpověď pro
dosud neposlanou URL), ne 403. Příkaz ale **nikdy nebyl v cronu**.

Spuštěno jako **měřený pokus**, ne plošně: `scripts/ecamx/indexing-test.py`
vzal 60 způsobilých URL, rozdělil je **střídavě** podle pořadí poptávky (aby
měly obě skupiny srovnatelné skóre), 30 poslal a 30 zapsal do
`google_control` ve stavu `indexnow.py`, který je od teď přeskakuje. Výchozí
stav obou skupin je změřený (indexováno 2 : 1).

**První pozorování je varovné:** publish vrací HTTP 200, ale odpověď obsahuje
jen `{urlNotificationMetadata:{url}}` **bez `latestUpdate`/`notifyTime`**,
a `metadata` na tutéž URL dál vrací 404. Google volání přijímá, ale záznam si
nedělá — buď je endpoint opožděný, nebo u adult obsahu notifikaci zahazuje.
**Cron se proto zatím nepřidává**; rozhodne porovnání se kontrolní skupinou za
týden (`indexing-test.py report`). Je legitimní, aby to nezabralo — pak se
pokus uzavře a energie půjde do Bingu, kde měřitelně funguje.

### Drobná oprava

`/webcam_country/молдова/` vracelo 404, i když `/country/md/` existuje.
Poznámka z 19. 8. tvrdila, že protějšek nemá — mezitím vznikl. **Stránky zemí
vznikají a zanikají s katalogem**, takže se ten seznam musí při kontrole 404
projít znovu, ne se spolehnout na minulý závěr. Jamajka, Zimbabwe a Fidži
protějšek pořád nemají a zůstávají 404 schválně (řetěz 301→404 je horší).

## D74 — technická prohlídka: co bylo v pořádku a tři drobnosti (4. 9. 2026)

Kenny: *„projdi mi i technicky web… i technicky SEO je v pořádku."*
Změřeno na produkci — a technicky **je** v pořádku:

hlavičky (HSTS rok + subdomény, CSP `default-src 'none'`, `nosniff`,
`X-Frame-Options: DENY`, referrer i permissions policy) · HTTP/2 + brotli,
homepage 163 kB HTML → **20,8 kB** přenosu, odezva 85–160 ms · 1 skript,
1 styl, 180 obrázků z toho 170 lazy · vlastní canonical na všech typech,
stránkování `noindex, follow` · `http→https` i `www→bez www` 301, velká
písmena 404 · staré WP URL jednoskokové na 200, **všech 56 známých Bingu
správně** · sitemapy 17 069 URL, vzorek 30 → 30× 200 a indexovatelné ·
JSON-LD validní na všech typech · 404 skutečná, ne soft · UTF-8 a `lang="en"`.

**Adresář modelek pokrývá 100 %.** `/models/{písmeno}/` je stránkovaný
(`/models/a/2/` … `/8/`, plus `0-9` pro nicky od číslic) a na písmenu „a"
dává 1 992 odkazů proti 1 877 URL v sitemapě, tedy **0 chybějících**.
První měření hlásilo 34 % — bylo chybné, počítalo jen první stránku každého
písmene. Stejná past jako u `grep -c` na jednořádkovém HTML: **ověřit, co
vlastně počítám, než z čísla udělám závěr.**

### 1. Titulky a popisky se ořezávaly na nejcennějším místě

Změřeno na vzorku 65 stránek: 14 % titulků nad 65 znaků (nejdelší 79) a **46 %
popisků nad 160**. Popisky se skládají v pořadí „kdo to je · téma pokoje · na
co je známá · **výzva k akci**", takže SERP ořezával právě tu výzvu.

U titulků kategorií byla příčina zdvojený štítek („Interactive Vibrator Cams –
500+ **Interactive Vibrator** Models Live Now"). Ten je záměr — cílí na dvě
změřené fráze — ale co se nezobrazí, druhou frázi nepokryje.

Zavedeny dvě funkce v `src/lib/seo.ts`: `fitTitle(...variants)` vezme první
variantu, která se vejde do 65 znaků (u modelek se obětuje nejdřív „Free",
pak „Webcam Show"; nick a „Live Sex Cam" zůstávají vždycky), a
`fitDescription(lead, optional[], tail)` přidává vsuvky jen dokud se se
závěrem vejdou do 155. **Nikdy se neseká uprostřed slova.**

Popisky kategorií opakují štítek dvakrát až třikrát, což u dlouhých názvů
(„full private chat for 90 tokens") přeteklo na 183 znaků — nad rozpočtem se
opakování vypustí. Doměřeno na produkci a doplněno v druhém kole; ve stejném
kole se zkrátil i pevný popisek `/models/same-nickname/` (164 znaků).

Změřeno na celém katalogu po opravě (13 414 stránek modelek + 451 kategorií):

| | před | po |
|---|---|---|
| titulky modelek nad 65 znaků | 8 % (max 80) | **0 %** (max 65) |
| popisky modelek nad 160 | 46 % (max 255) | **0 %** (max 155) |
| titulky kategorií nad 65 | 14 % (max 79) | **0 %** (max 65) |
| unikátnost | 100 % | **100 %** (13 414 / 13 414 / 453) |

Unikátnost se ověřovala schválně: zkrácení mohlo dvě modelky sloučit na tentýž
titulek, a duplicita by byla horší než dlouhý titulek. Nesloučila.

### 2. Cloudflare přepisuje náš robots.txt — a je to tak dobře

Nasazený `robots.txt` má **dvě skupiny `User-agent: *`** a bloky pro AI boty
(GPTBot, ClaudeBot, CCBot, …) plus `Content-Signal`. Ve zdroji
(`src/pages/robots.txt.ts`) je přitom jen jedna skupina: ten zbytek **vkládá
Cloudflare** (AI Crawl Control).

Funkčně to vada není — Google i Bing skupiny se stejným user-agentem slučují
a `Disallow: /*?` je specifičtější než `Allow: /`, takže zákazy platí. Necháno
zapnuté: Cloudflare si seznam AI botů udržuje sám, což má větší cenu než
kosmetika. **Kdo bude „opravovat" duplicitu v kódu, nenajde ji tam** — je to
nastavení zóny, ne náš soubor.

### 3. Chybějící lomítko dává 307, a nedá se s tím nic dělat

`/cams/hd` → **307** → `/cams/hd/`. Dělá to vrstva statických assetů
Cloudflare (výchozí `html_handling: auto-trailing-slash`) a status je daný
platformou; `wrangler.json` má u `assets` jen `binding` a `directory`.
Přepsat by to znamenalo `html_handling: "none"` a obsluhovat statiku Workerem,
tedy velký zásah kvůli malému zisku. Neexistující cesta mimochodem dá **308**,
protože tam už rozhoduje náš Worker (`trailingSlash: 'always'`).

Dopad je malý: interní odkazy i sitemapy lomítko mají, takže 307 potká jen
ručně psané a cizí odkazy, a cíl má vlastní canonical.

### Dvě pasti v měření, ne na webu

Obě mě dnes napálily a obě dávaly čísla, ze kterých by vyšel špatný závěr.

**1. `requests` dekóduje naše HTML jako Latin-1.** Odpovědi mají
`content-type: text/html` **bez `charset`**, a `requests` pak podle HTTP
specifikace zvolí ISO-8859-1 — takže z UTF-8 pomlčky (3 bajty) jsou 3 znaky
a z emoji ještě víc. Titulek se tím „prodloužil" z 65 na 67 znaků a popisek
ze 152 na 176. Ověřovací měření proto tvrdilo, že oprava nezabrala, i když
zabrala. **Při auditu vždycky `r.encoding = 'utf-8'`.** (Prohlížeče ani
Googlebot problém nemají — čtou `<meta charset>` z hlavičky dokumentu. Přepsat
Content-Type přes `_headers` by u složkových URL zasáhlo i ostatní soubory,
takže se to nechává být.)

**2. První stránka v běhu prohlížeče není měření.** LCP homepage vyšlo
5 224 ms, zatímco stejně velká kategorie 388 ms — do prvního měření se
naúčtoval start prohlížeče a kompilace CSS. Se zahřívacím průchodem a vypnutou
cache vyšlo 1 112 ms.

K tomu potřetí totéž poučení jako u `grep -c` na jednořádkovém HTML a u počtu
odkazů v adresáři: **než z čísla udělám závěr, ověřit, co vlastně měřím.**

### Rychlost: výchozí hodnoty (4. 9. 2026)

Měřeno v prohlížeči na emulovaném mobilu se **4× zpomaleným CPU** a sítí
1,6 Mbps / 150 ms latence, každá stránka v čistém kontextu s vypnutou cache:

| stránka | TTFB | LCP | CLS | přeneseno |
|---|---|---|---|---|
| homepage | 88 ms | **1 112 ms** (2. měření 1 012) | 0,0000 | 180 kB |
| kategorie | 90 ms | **924 ms** | 0,0000 | 330 kB |
| stránka modelky | 92 ms | **624 ms** | 0,0000 | 1 141 kB (běží stream) |

Google má za „dobré" LCP do 2 500 ms, takže je v tom velká rezerva.

**Past v měření, ne na webu:** první průchod hlásil u homepage LCP 5 224 ms,
zatímco stejně velká kategorie 388 ms. Byl to start prohlížeče a kompilace CSS
naúčtované první měřené stránce — po přidání zahřívacího průchodu a vypnuté
cache vyšlo 1 112 ms. **První stránka v běhu se nesmí brát jako měření**;
proto je v tabulce homepage dvakrát.

### Past: záloha z Maliny nasazuje pracovní kopii, CI commitnutý stav

Opravy titulků a redirectu byly 4. 9. v 10:40 nasazené z Maliny — a v **13:16
je CI přestavělo pryč**. Není to chyba deploye: `ecamx-pi-deploy.sh` staví
z **pracovní kopie**, kdežto CI z toho, co je v repozitáři. Nezacommitovaná
změna tedy žije jen do dalšího běhu CI (dnes 3× denně, D72), a pak tiše zmizí.

Ověřeno podle značky buildu: živá byla `13:16:16Z`, lokální `dist`
`10:16:52Z` — tedy živý web byl **novější** a přesto bez opravy.

**Z Maliny se nasazuje jen jako záchrana, když CI nejede.** Když jde o změnu
kódu, patří commit a push PŘED deploy, jinak se měří něco, co za pár hodin
neexistuje.

### Poznatek o `_redirects`: Cloudflare cestu dekóduje

Do mapy byly nejdřív zapsané obě podoby (`%D0%BC…` i `молдова`) s tím, že se
po nasazení uvidí, která platí. Build odpověděl jasně: *„Ignoring duplicate
rule for path /webcam_country/%D0%BC…/"* a zahodil tu v azbuce. **Cloudflare
si cestu normalizuje na procentní kódování**, obě podoby jsou pro něj jeden
záznam — zapisuje se tedy zakódovaně.

## D75 — sitemapa přestala lhát: kolotoč stránek je strukturální (7. 9. 2026)

Kenny: *„zjisti jestli nemáme technické chyby na webu, a jestli stále
zobrazujeme modelky jak máme a není tam nějaké mrtvé body nebo hodně dlouho
neaktivní které tam držíme na webu které není potřeba."*

### Mrtvé body tam nejsou — retence funguje přesně podle kódu

Změřeno na buildu ze 7. 9.: nejstarší archivní stránka má `last` 36 dní
(strop 45), a ze 479 stránek starších 14 dnů má **všech 479 měřenou poptávku**;
bez poptávky **nula**. `GRACE_DAYS_NO_DEMAND = 14` tedy platí do posledního
záznamu.

Zdravé je i všechno ostatní: sitemapa 30/30 vzorku → 200, mřížka 0 karet,
o kterých feed říká, že nevysílají (19 vyměněno v prohlížeči, CLS 0), záchrana
při podstrčeném 10 h starém buildu 60/60 potvrzeně živých, 18 z 18 bodů karty
zůstává na webu, 10 z 10 odchozích odkazů nese provizi, všech 180 odkazů z karet
na homepage vrací 200.

### Problém je opačný: zahazujeme stránky, které něco umí

Porovnání dvou po sobě jdoucích buildů (04:00 z Maliny a 05:49 z CI, stejný
commit, stejné limity):

* **zmizelo 5 037 z 15 927 indexovaných stránek (31,6 %)**, přibylo 5 357,
* vzorek 25 zmizelých: **25× 302**,
* mezi zmizelými **2 034 stránek se `seen >= 14`** a 2 180 modelek, které byly
  v předchozím buildu ještě živé,
* se změřenou poptávkou zmizelo **0** — ta ochrana drží.

Ověřeno proti registry: ze 5 037 zmizelých už **ani jedna** nedrží stránku,
takže to nebyla změna indexovatelnosti, ale skutečná eviction.

### Proč to jde a proč to nejde spravit řazením

Sync to říká sám: registry zná **193 414 modelek**, stránku má **17 000**
a kdo právě vysílá, tu stránku dostane (D8 — klik z karty nesmí odejít z webu).
Každý běh se tedy o slugy přihlásí tisíce vracejících se modelek a stejný počet
právě offline stránek musí jít pryč: **10 750 kandidátů na archiv, 5 364 se
vešlo, 5 419 odříznuto**. Kolotoč se nezastaví, dokud je strop 17 000 proti
free limitu 20 000 souborů — a zvednout ho nejde, build je na 18 199 souborech.

**Řazení tedy nerozhoduje KOLIK stránek odejde, jen KTERÉ.** A tam byla chyba:
po poptávce se řadilo podle `last`, což je hodnota, která se **přepíše každý
běh každému, kdo vysílal**. Tail u hranice rozpočtu se proto přehazoval třikrát
denně. Druhá vada: první tiebreak byl `peak`, ale **pět sítí počty diváků vůbec
neposílá** (XLoveCam, LiveJasmin, Streamate, Stripchat, ImLive → `peak = 0`
u 100 % modelek), takže v každé remíze systematicky prohrávaly — Streamate
ztratil 48 % a Stripchat 46 % stránek proti 28 % u Chaturbate.

Nové řazení je **poptávka → `seen` → `last` → `peak` → klíč**. `seen` roste
nejvýš o 1 za den, takže publikovaná množina drží; klíč nakonec zaručuje, že
remízu nerozhodne pořadí v objektu (to se mezi běhy mění). Změřeno: nejvyšší
`seen` mezi vyhozenými spadl z 30 na **14**, medián 9 — odcházejí nejmladší
profily, tedy ty, které nejméně pravděpodobně něco vydělaly.

### Co se opravilo doopravdy: sitemapa

Zbytek je nevyhnutelný, ale **nemuseli jsme ho Googlu slibovat**. Sitemapa,
kde třetina URL vrací přesměrování, je pro web s DR 14 aktivně škodlivá — je to
přesně vzorec „Crawled – currently not indexed", který GSC u stránek modelek
hlásí. Za 28 dní má web v GSC **36 stránek s impresemi, z toho 3 stránky
modelek**, proti 2 424 stránkám s impresemi na Bingu.

Od teď jde do sitemapy jen `stable`: stránka s měřenou poptávkou **nebo** se
`seen` nad prahem, který se **počítá z rozpočtu, ne od oka** (`seenCut` =
`seen` na pozici `archiveBudget × 0,5` mezi držiteli stránek). Pevný práh by
byl past — `seen` roste s věkem webu, takže tvrdá dvacítka by za pár měsíců
pustila dovnitř zase všechny.

Naměřeno na dnešním katalogu: práh **19**, v sitemapě **5 183 z 17 000** URL
(2 877 díky poptávce, 2 306 díky `seen`). Práh 19 leží **nad** frontou eviction
(nejvyšší vyhozený `seen` je 14), takže co sitemapa slibuje, to eviction
nesebere.

**Pojistka, kterou si žádá paměť `seo-dr0-sitemapa-neni-discovery`** („práh
nikdy nezvedat bez změření proti URL s impresemi"): zúžení nevyhodí ani jednu
z **2 877** stránek s poptávkou — ověřeno na vygenerovaných datech, 2 877
z 2 877. Poptávka práh obchází vždycky, a `demand` je právě „má imprese v GSC
nebo na Bingu, nebo měřený objem na nick" (D53).

Stránky **zůstávají `index, follow`** — noindex by deindexoval i to, co dnes
vydělává na Bingu. Discovery drží adresář `/models/{písmeno}/`, který pokrývá
100 % modelek (D33), takže Google si stránku pořád najde; jen mu ji
nepodstrkujeme jako trvalou. A jakmile si ji někdo opravdu najde, `demand` ji
do sitemapy pustí sám.

Hlídá `scripts/check-sitemap-churn.mjs`.

### Rozpočet CI: platili jsme každou noc dvakrát

GitHub plánované běhy zdržuje, a hodně: cron `0 1,9,17` se 4.–7. 9. spouštěl
v **05:49 / 12:41 / 18:55 UTC**, tedy o ~4,5 h později. Noční mezera proto není
plánovaných 8 h, ale změřených **10,9 h** — a to překročilo devítihodinový práh
hlídače. Každou noc ve 04:00 UTC se tedy *současně* nakopl běh CI **a** stavěla
Malina; obojí totéž, ve tutéž minutu.

Důsledek: 4,14 běhu denně a projekce **1 721 z 2 000 minut** místo zamýšlených
1 134 (D72). V srpnu přetečení při ~2 032 min znamenalo, že GitHub buildy na dva
dny vypnul.

Nové rozvrstvení: noční mezeru zalévá **Malina** (vlastní železo, minuty
nekupujeme, práh 9 h), nakopnutí CI je záloha zálohy až ve **12 h** (nad
změřenou mezerou) a poplach ve **14 h** znamená „neuspěla ani Malina, ani CI".
Protože je Malina od teď plánovaný zalévač, hlásí do logu, když nasazuje
pracovní kopii se změnami (past 117).

### Tři drobnosti k tomu

**Typecheck v CI vůbec neběžel.** Na `main` proto tiše ležela chyba TS2339
v `/api/online/[network].ts` (mapper cam4 přidával pole `f`, které v typu
nebylo). Krok `pnpm exec tsc --noEmit` je teď **před** syncem, ať to spadne za
dvacet sekund, ne za deset minut.

**Hlídač přehrávače Cam4 hlásil planý poplach** — osm chyb. Vybíral si modelku
z karty starého buildu a pak vyžadoval běžící stream; `salixbby` byla offline
(`{"offline":true}`). Cam4 na rozdíl od BongaCams adresu z buildu zahazuje
a bere čerstvou z `/api/stream/`, takže test musí živost ověřit tamtéž. Web
v pořádku byl: master → variant → segment s `ACAO: *`, CSP `*.xcdnpro.com`
povoluje. Po opravě **0 problémů**, stream se rozjede sám (currentTime 9,4 s).

**Dvě skupiny `User-agent: *` v robots.txt nejsou naše a nemají se opravovat.**
Zdroj vydává jednu; tu první předsazuje Cloudflare — zóna má
`is_robots_txt_managed: true` v `zones/{zone}/bot_management`. Vypnout to nemá
cenu: reálné vynucení dělá `ai_bots_protection: "block"` na hraně, ne
robots.txt, ale ta injektáž nese `Content-Signal: search=yes,ai-train=no,
use=reference`, což je výslovná rezervace práv podle čl. 4 směrnice EU
2019/790. A duplicita nic nekazí — podle RFC 9309 crawler skupiny se stejným
user-agentem slučuje. Změřeno: ze 36 stránek s impresemi v GSC má **0** vzor
`/go/`, `/api/` nebo `?`, takže naše `Disallow` platí.

### Dodatek k D75: strop 17 000 → 22 000, protože máme Workers Paid

Kenny: *„my máme Workers Paid, ale nechci aby se přeplácal celý náš limit, tak
to nastav tak aby to bylo optimální pro nás."*

Nejdřív ověřit, ne uvěřit: `GET /accounts/{id}/subscriptions` vrací
**`workers_paid`, stav Paid, 5 USD** (a `r2_paid`). A dokumentace Cloudflare
říká, že limit statických assetů je **20 000 souborů na free, ale 100 000 na
paid**. Celá úvaha o dynamickém renderování z Workeru, R2 a per-model KV tedy
padá — nic z toho není potřeba, stačilo zvednout konstantu.

**Zavazující limit se tím přesunul na minuty GitHub Actions.** Změřeno na
12 skutečných bězích: medián **11,8 min** při 18 199 souborech, z toho ~2,3 min
pevná část → ~33 ms na soubor. Strop 22 000 stránek vychází na ~14,6 min/běh.

Aritmetika, proč to vyjde LEVNĚJI než předtím: dnešní projekce byla **1 728
z 2 000** min, protože běželo 4,1 běhu denně (tři plánované + noční nakopnutí).
Zrušení toho nakopnutí ubere ~11,9 min/den, zvětšení katalogu přidá 3 × 2,8 =
8,4 min/den. Netto **−3,5 min/den**, tedy projekce ~1 470 při o 29 % větším
katalogu.

Změřeno hned po zvednutí:

* `6 979 kandidátů na archiv, 6 979 se vešlo, **0 odříznuto**` — eviction je nula
  (kandidátů je zatím méně než změřených 10 750, protože předchozí běh se starým
  stropem jich 5 400 přesměroval; pool poroste, jak se modelky vracejí),
* stránek celkem **18 585**, odhad souborů **20 274** — tedy nad starým free
  limitem, což potvrzuje, že paid plán opravdu platí,
* `seenCut` spadl z 19 na **16** a sitemapa vyrostla z 5 183 na **8 439 URL**.
  Adaptivní práh z D75 tím ukázal, k čemu je: víc kapacity → víc se toho dá
  poctivě slíbit, bez ručního ladění.

Doprovodné úpravy: guard „Check asset count" v CI hlídá **30 000** souborů
s odůvodněním v minutách (ne v limitu Cloudflare), sync varuje 2 000 souborů
pod tím, `bin/ecamx-actions-check.py` varuje už na **1 700** min (bylo 1 800 —
při dražším běhu by varování přišlo pozdě) a strop haldy na Malině je **2 600
MB** místo 2 048, protože prerender drží o ~30 % víc dat.

**Co se NEDĚLALO a proč:** dynamické `/live/` z Workeru. Nebylo by to zdarma
ani na paid — katalog má 17 MB a do Workeru se nevejde (limit skriptu 3 MB), tedy
čtení per-request z KV/D1, a hlavně sync při vyhození stránky **snapshot maže**
(`delete e.snap`, past 93), takže pro ocas nemáme z čeho stránku postavit.
Vyšly by z toho tisíce stránek „jen nick a síť" — tedy přesně ten thin content,
který zabil starý web. Zvednutí stropu naopak dává stránky jen těm, kdo data
mají.

#### Doměřeno po nasazení (7. 9. 2026, 11:52 UTC)

**Oprava tvrzení „eviction je nula".** Bylo naměřené na stavu hned po předchozím
běhu se starým stropem, který 5 400 stránek zrovna přesměroval — kandidátů bylo
proto jen 6 979. Jak se modelky vracely, pool vyrostl a nasazený běh hlásí:

```
stránky modelek: 11 914 živých + 10 086 z archivu = 22 000, strop 22 000
rozpočet: 13 657 kandidátů na archiv, 10 086 se vešlo, 3 571 odříznuto
POZOR: … nejvyšší seen mezi vyhozenými 10, medián 6
```

Kolotoč se tedy nezastavil — na to by bylo potřeba 11 914 + 13 657 = 25 571
stránek. **Zmenšil se ale z ~5 400 na 3 571 a hlavně změnil charakter:**
nejvyšší `seen` mezi vyhozenými spadl z 30 na **10** (medián 6), takže odchází
jen to nejmladší. Etablované profily zůstávají.

**Klíčový invariant drží:** práh sitemapy vyšel na `seen >= 18`, tedy **nad**
frontou eviction (10). Co sitemapa slibuje, to strop nesebere. V sitemapě je
**8 423 URL** (7 507 stránek modelek + 638 rozcestníků), všechny indexovatelné.

**Cena v minutách je vyšší, než jsem modeloval.** Běh trval **16,2 min** proti
odhadu 14,6. Skutečný marginál je tedy ~**52 ms na soubor**, ne 33 — prodlužuje
se i `check-links` a upload assetů, ne jen prerender. Změřeno: 11,8 min při
18 199 souborech → 16,2 min při 23 274.

Dopředná projekce: 3 běhy × 16,2 min = 48,6 min/den ≈ **1 460 min/měs** plus
pushe (~160) ≈ **1 620 z 2 000**, pokud rankizo a rankmat zůstanou tiché.
Naivní projekce v `ecamx-actions-check.py` hlásí 1 779, ale je zkreslená — počítá
z prvních sedmi dnů září, kdy ještě běželo noční nakopnutí navíc.

Je to uvnitř rozpočtu, ale bez velké rezervy. **Nejlevnější páka, kdyby bylo
třeba ubrat, není katalog, ale četnost:** dva běhy CI denně místo tří ušetří
~490 min a noční mezeru zaleje Malina zdarma. Cena té páky je, že se Malina
stane nosnou pro čerstvost — a ta nasazuje pracovní kopii, ne commitnutý stav
(past 117), což je ve sdíleném workspace riziko. Proto se to zatím nedělá a
hlídá to varování na 1 700 min.

## D76 — guard měřil špatnou věc (23. 9. 2026)

> **⚠️ OPRAVA 23. 9. 2026 (večer): diagnóza níž byla ZČÁSTI ŠPATNÁ.**
>
> Tvrdil jsem, že Worker nese **25,3 MB `.prerender/`** v každém uploadu.
> Není to pravda. Naměřeno dodatečně:
>
> * Nasazený Worker měl `Total Upload: 7167.29 KiB / gzip: 1990.56 KiB` —
>   tedy **7,0 MB**, ne 33,8.
> * `[strip] .prerender tam není — není co mazat` hlásí i CI build, a v celém
>   jeho logu není o `.prerender` ani zmínka.
>
> Těch 25 MB jsem změřil na `dist/`, který tu zůstal po **neúspěšném** lokálním
> buildu (zasekl se na `/index.html` kvůli chybějícímu `PUBLIC_*` ID).
> **Úspěšný build `.prerender` nenechává**, takže se nikdy neuploadoval.
>
> Co z D76 platí dál: **limit bundlu je 64 MiB nekomprimovaně na obou plánech**,
> ne 3 MB po gzipu — to je ověřené v dokumentaci a byl to skutečný důvod, proč
> guard padal na neproblému. A platí i to, že se má měřit **skutečný artefakt**,
> ne proxy.
>
> Co bylo jinak: **skutečná váha bundlu byla mapa přesměrování** — 6,4 z těch
> 7,0 MB. Odstěhovala se do shardovaných assetů a bundle spadl na **719 KiB**
> (D77). To je ta oprava, na které doopravdy záleželo.
>
> `scripts/strip-prerender.mjs` zůstává, ale je to **pojistka, ne oprava** —
> jeho docblock to teď říká. Lekce je stejná jako u pastí 118 a 124: **měření
> na neúspěšném stavu vypadá jako měření.** `dist/` po spadlém buildu není
> artefakt, který se nasazuje, a nedá se na něm nic rozumně měřit.

Kenny poslal alarm: *„ecamx.com: CI nejede, web drží záloha z Maliny"* a v logu
`[links] CHYBA: mapa přesměrování má 6.0 MB — přesuň ji do KV, bundle Workeru
má limit 3 MB po gzipu`.

### Guard padal na premise, která už neplatí

Dokumentace Cloudflare (ověřeno 23. 9. 2026): **limit Worker bundlu je 64 MiB
v NEkomprimované podobě a platí pro Free i Paid**. Gzip, který vypisuje
wrangler, je jen informativní údaj — žádný gzip limit neexistuje. Strop 6 MB
na `gone.json` tedy stál na čísle ze staršího free limitu (3 MB po gzipu),
které už není pravda; guard tak padal na něčem, co problém není.

Nejdřív jsem šel cestou, kterou guard radil — přesunout mapu do KV nebo do
shardovaných assetů. Pak jsem změřil, co je v bundlu doopravdy:

```
Total (83 modules)     33 852 KiB
  .prerender/chunks/data_*.mjs   25 285 KiB   ← build-time katalog
  chunks/_.._*.mjs                6 475 KiB   ← mapa přesměrování
  zbytek                          ~2 100 KiB
```

**Tři čtvrtiny uploadu byl `.prerender`** — katalog, který Astro potřebuje jen
při generování stránek. Prerender proběhne během `astro build` a pak adresář
nikdo nepoužije: Worker obsluhuje pouze routy s `prerender = false` (`/api/`,
`/go/`, `[...path]`) a hotové stránky servíruje **assets layer PŘED Workerem**,
takže se k němu nedostanou. Ověřeno změřením, ne odhadem — po smazání zůstane
**17 modulů / 6,9 MB** a všech 17 jsou runtime routy (entrypoints, catch-all,
`/api/online`, `/api/stream`, `/go/`, affiliate, assets, service); ani jeden
prerender-entry ani stránkový chunk.

Takže jsem mapu nechal být a **sebral 26 MB tam, kde to nic nestojí**.

### Co se změnilo

* **`scripts/strip-prerender.mjs`** maže `.prerender` po buildu. Visí
  v `postbuild` **až za `build-csp.ts`**, ne před ním: ten skenuje
  `dist/server/**` a hledá hosty a hashe pro CSP, takže mazat dřív by
  mimochodem změnilo složení CSP.
* **Guard v `check-links.ts` měří skutečný artefakt**: součet `dist/server`,
  varování v 50 % limitu, chyba v 75 %. K tomu **tvrdě padá, když v bundlu
  `.prerender` je** — mrtvá váha se tak nemůže vrátit potichu.
* **Smoke test kryje catch-all routu.** Statické stránky obsluhuje assets layer
  před Workerem, takže dosavadní test (`/`, `/cams/`, `/terms/`, `/sitemap.xml`,
  `/api/online/`) tu cestu vůbec netestoval. Přidány dvě assertion, obě ověřené
  proti produkci: náhodný nick → **302** na rozcestník (D53) a `/live/@@@/` →
  **404** (aby se z webu nestal soft 404).

Výsledek: upload **33,8 MB → 6,9 MB, tedy 53 % → 11 % limitu**.

### Mapa přesměrování zůstává — je to první kandidát, ne dnešní problém

Po ořezu je mapa **86 % bundlu** (6,0 z 6,9 MB) a v ustáleném stavu (180denní
retence, ~1 800 nových záznamů denně) doroste na ~324 000 záznamů, tedy ~3 MB
po gzipu. To je pořád hluboko pod limitem 64 MiB, takže se nic nemusí dělat;
guard to hlásí jako podíl na bundlu, aby bylo vidět, kdy se to změní. Až se to
změní, patří do shardovaných statických assetů (vzor `public/live-pages.json`,
využije existující `ASSETS` binding) — **ne do KV**, protože ta binding schválně
nemá a Worker k ní za běhu přístup nepotřebuje (D3).

## D77 — mapa přesměrování ze bundlu, rozvrh na dvě buildy (23. 9. 2026)

Kenny: *„nastav klidně i lepší řešení, aby web běžel v pohodě, nepotřeboval
k tomu naši malinu, byl lehký a rychlý."* Navazuje na D76 (guard měřil
zastaralý limit) a ruší závislost webu na záložním deployi z Maliny.

### Mapa přesměrování jde ze bundlu do shardovaných assetů

Po ořezu `.prerender` (D76) zbyl v bundlu Workeru jediný velký modul: mapa
přesměrování. **6,0 z 6,9 MB, tedy 87 %** — 197 700 slugů → 379 cílů, vložených
jako JS literál, který se parsuje při každém studeném startu isolate. Platil ho
tedy každý návštěvník, i když se přesměrování týká jen cest bez statického
souboru.

Sync ji teď zapisuje jako **36 shardů** (`public/gone/{a–z,0–9,_}.json`,
6,0 MB celkem) a Worker si přes binding `ASSETS` stáhne jen ten, který potřebuje
— stejný mechanik, jaký už v `[...path].ts` používá `/404.html`, a stejný vzor
jako `public/live-pages.json`. **Do KV to nepatří**, ta binding schválně nemá
(D3) a Worker k ní za běhu přístup nepotřebuje.

Shard je klíč **prvního znaku slugu**, ne hash: slugy vznikají slugifikací, takže
je rozložení přirozené a ladění čitelné (`gone/s.json`). Hash by rozdělil líp,
ale musel by být bit po bit stejný v Node i ve V8 — zbytečné riziko.

Načtené shardy drží isolate v `Map` a ukládá se **Promise, ne výsledek**:
dva souběžné requesty na tentýž shard vyvolají jeden fetch, ne dva. Cache nemá
evikci schválně — strop je 36 záznamů.

**Výpadek shardu není 404.** Když se soubor nenačte, `redirectForModel()` vrátí
záložní abecední adresář (`/models/{písmeno}/`) — přesměrování bude méně přesné,
ale D53 („zaniklá stránka nikdy nesmí padat na 404") platí dál. Přesně proto je
shard jen **doplněk**: `LEGACY` mapa z `seed/legacy-gone.json` (836 slugů)
zůstává v bundlu, protože je malá a nese nejcennější historické URL.

Guard v `check-links.ts` na shardy tvrdě padá — kdyby v nasazovaném výstupu
chyběly, všech 197 000 přesměrování by se tiše svezlo na rozcestník a nikdo by
si toho nevšiml. Kontroluje počet shardů i počet záznamů proti `gone.json`.

`GONE_COUNT` z `gone.ts` zmizel: neměl žádného volajícího a bez bundlované mapy
se stejně nedá spočítat.

### Rozvrh na dvě buildy denně

Záložní deploy z Maliny se ruší, takže jediná pojistka proti srpnovému scénáři
(vyčerpané minuty → GitHub joby vypne) je **dostatek rezervy**. Změřeno:
projekce při třech bězích 1 548 z 2 000, tedy ~450 min pro rankizo, rankmat
a pushe. Dva běhy (`0 3,15`) dávají ~1 000.

Prahy hlídačů se musejí pohnout s tím: normální mezera je teď 12 h a GitHub
plánované běhy odkládá (naměřeno 2–5 h), takže stáří běžně vystoupá na ~15 h.
Při starých 12/14 h by hlídač kickoval každý den a spálil přesně ty minuty,
které se šetří — což se 22. 9. stalo: všech 48 spuštění zálohy padlo do pásma
9–11 h a ani jedno nebylo mrtvé CI. Nové prahy: kick 16 h, poplach 18 h
(mezera + 4 a + 6, stejný odstup jako dřív).

### Lehkost, která se neprojevila v souborech

`topDemand(24, page)` dělal na **každé** z 22 000 stránek
`MODELS.filter(...).sort(...)`, ačkoli `demand > 0` má jen **238 z 13 846**
modelek. Ostatní výběry (`LIVE_BY_VIEWERS`, koše podle země a genderu)
předpočítané byly; tenhle ne. Ověřeno na datech, že předpočítaný seznam dává
pro všech šest zkoušených `excludePage` stejný výsledek.

Skenování tajemství v `check-links.ts` čítalo ~23 000 souborů (skoro gigabajt)
a pro každý zkoušelo ~15 hodnot `text.includes(v)`. Nahrazeno jedním
`grep -rlF -f`, který strom přečte jednou — **0,35 s** místo minut. Který klíč
to je, se dohledá jen u nalezených souborů, a když `grep` selže, guard to
**hlásí jako chybu** (tiše nezkontrolovat nic je horší než spadnout).

## D78 — audit 28. 9.: web v pořádku, vyhledávače škrtí Cloudflare (28. 9. 2026)

**Provoz.** Homepage 0,17 s, huby 0,18–0,26 s z cache. Sitemapy: 648/648 hubů
a 25/25 vzorku modelek dává 200 (pár `000` byly výpadky spojení z Maliny, při
opakování 200). Bing crawluje 7–14 tis. stránek denně, 4xx ~150, 5xx ~10,
CrawlIssues 0, v indexu 93 956 URL. GSC sitemapu stáhl 27. 9. bez chyb.

**SEO.** Bing nese web: ~38 prokliků denně, stabilně 220–255 týdně od 31. 8.
Google 14 prokliků za 28 dní — příčina zůstává D73 (DR 14, crawl budget), kódem
se to nespraví. Poptávka je z 99 % nick („`<nick>` cam / live cam / webcam"),
generický dotaz je v datech jeden; 73 % impresí je na pozici 4–10.

**Opraveno:**
- Popisky 648 kategorií tvrdily „from **7** major cam sites", homepage
  vyjmenovala sedm sítí. Sítí je jedenáct; počet i výčet teď jdou z `META`.
- `/country/` dávalo 404 a drobeček „Countries" na 43 stránkách zemí vedl
  donikam — stejná díra, jakou do 19. 8. mělo `/site/`. Nový rozcestník
  `src/pages/country/index.astro`, odkaz z drobečku, patičky a sitemapy hubů.

**Záměrně neuděláno:**
- „videos" do popisku modelky, ačkoli je to časté slovo v dotazech: stránka
  žádná videa nemá. Stejná zásada jako u slova „Free" (`profileSeo` v `seo.ts`) — slib,
  který návštěvník vyvrátí prvním kliknutím, stojí víc, než kolik přinese.
- `lastmod` hubů: už je jen datum, mění se jednou denně a hub se opravdu
  denně mění. Vada to není.
- 307 u chybějícího lomítka: pořád D74.

**Cron Worker (dodatek k D77).** Pingy do vyhledávačů z Cloudflare nejdou:
Bing Webmaster API vrací `ErrorCode 17 ThrottleIP` (i po 6 min klidu)
a api.indexnow.org `429 TooManyRequests`, zatímco týž požadavek z Maliny ve
stejnou minutu projde. Je to sdílená egress IP Cloudflaru, ne náš klíč.
`ecamx-cron` proto nese jen hlídač (`*/30`); `indexnow.py` a `demand.py`
zůstávají na Malině. Bez `GITHUB_TOKEN` Worker CI nenakopne, jen ohlásí —
kopání dál dělá malinový hlídač. Kód IndexNow a poptávky ve Workeru zůstává
(ověřený na výběru URL a na GSC) s ručním `/run`, kdyby se to změnilo.

## D79 — kolik web vydělává a kde je páka (28. 9. 2026)

Kenny chce z affiliate **50 000 Kč měsíčně**, rozpočet na odkazy 0 Kč,
priorita „nejdřív peníze z návštěv, co už máme".

**Výchozí stav (28 dní):** 940 organických návštěv (Bing ~1 150 prokliků,
Google 14), **293 prokliků** přes `/go/` (Chaturbate 122, BongaCams 49,
Stripchat 36, Cam4 24…). **Chaturbate od 1. 6. vyplatil 0 $**: 46 engaged
hitů za 28 dní, 0 registrací. „Raw Hits 216 873" v panelu nejsou prokliky —
počítá se do nich každé načtení embed iframu s `campaign`, který provizi
nepřiřazuje (D13, D34). CrakRevenue (Stripchat, Streamate, ImLive) změřit
nejde: uložený klíč je na feed, reporting API ho odmítá.

**Prognóza na rovinu:** 50 000 Kč ≈ 2 150 $. Organický cam affiliate dává
řádově 10–30 $ na 1 000 návštěv, takže cíl chce 70–150 tis. návštěv měsíčně,
~100× dnešek. Brzda je autorita (D73), ne kód. S nulovým rozpočtem je reálný
cíl první tisíce Kč měsíčně a hlavně **změřené EPC**, aby šly prokliky i
případné peníze tam, kde se vrátí.

**Uděláno:**
- `~/ai/scripts/ecamx/revenue.py` — prokliky (GA4 `go_click_server`) proti
  výplatě Chaturbate po síti, EPC; pondělní souhrn na Discord (cron 7:30).
- `MAX_MODEL_PAGES` 22 000 → **25 000**: kandidátů je 24 016 a strop
  odřezával 2 016 stránek každý běh. Dál bez změny `GRACE_DAYS` ne — tu drží
  limit KV registry (19,6 z 25 MB).
- Stránka modelky má vedle „Most searched" (24 stejných živých odkazů na celém
  webu) blok **„Popular cam models"**: 16 odkazů rotujících přes všechny
  indexovatelné stránky s poptávkou, i offline (~2 900–3 200). Okno se
  odvozuje z hashe slugu, takže je stabilní a pokrývá cíle rovnoměrně
  (~140 interních odkazů na každou). Cíl: stránky na pozici 4–10 v Bingu.

**Další krok (až budou 2–4 týdny dat):** z EPC rozhodnout pořadí sítí
v `similarLive()`/sticky CTA a Chaturbate revshare vs. PPS. Bez reporting klíče
CrakRevenue se EPC dá měřit jen u Chaturbate.

## D80 — A/B test titulku offline stránky modelky (28. 9. 2026)

**Proč.** Na Google nemá práce na webu teď vliv: stránky modelek naposledy
crawloval v červnu (ještě WordPress) a Indexing API po 24 dnech nic nezměnilo
(poslané 1/30 v indexu, kontrola 0/30). Návštěvnost dělá Bing a tam je
nejčastější tvar dotazu „`<nick>` live cam" — kotogal live cam má 226 impresí,
nejvíc ze všech. Varianta A offline titulku tu frázi v celku nemá.

**Co.** Polovina stránek podle `hashSlug(page) % 2` (FNV-1a, `data.ts`)
dostává offline titulek B:

    A: <nick> Webcam – <síť> Cam Profile & Live Schedule | eCamx
    B: <nick> Live Cam – <síť> Webcam Profile & Schedule | eCamx

Živé stránky se nemění. Test je na titulku, ne na popisku — jedna proměnná.

**Měření.** `~/ai/scripts/ecamx/title-test.py` (Bing `GetPageStats`, z Maliny):
rozdíl v rozdílech — o kolik se změnily prokliky B proti A, 28 dní před
a po startu. Výchozí stav: A 178 prokliků / 336 impresí, B 179 / 318.
Vyhodnotit nejdřív za 3 týdny; efekt je naředěný živými stránkami.

**Rozhodnutí po testu:** B ≥ 1,10× A → B na všechny offline stránky;
≤ 0,90× → zpět na A; mezi tím prodloužit o 3 týdny. Hash v `title-test.py`
a v `data.ts` musí zůstat stejný (ověřeno na čtyřech slugech 28. 9.).

## D81 — offline CTA: „Follow", ne „See profile" (28. 9. 2026)

Na offline stránku modelky jde většina nick provozu z Bingu (hledající zadá
nick, modelka zrovna nevysílá), ale placement `offline` dal za 28 dní
**9 prokliků** z 293. Tlačítko „See X's profile on Síť" nedávalo důvod kliknout.

Hledající chce vědět, **kdy modelka začne** — a to každá z našich sítí umí
(follow/favorites s upozorněním) po založení účtu zdarma. Registrace je
přesně to, za co affiliate platí (Chaturbate PPS/revshare, CrakRevenue PPS).
Tlačítko je teď „Follow X on Síť →" s větou „Free account — Síť alerts you
the moment X goes live." a sticky lišta „Follow X →". Cíl odkazu se nemění
(`profileLink`, placement `offline`), takže měření navazuje.

Když modelka mezitím začne vysílat, klient přepne CTA na „Chat & tip" jako
dřív a větu o upozornění schová. Vyhodnotit v `revenue.py`/`ga4.py money`:
placement `offline` proti výchozím 9 za 28 dní.
