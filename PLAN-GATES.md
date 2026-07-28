# PLAN-GATES — Schnittplan fuer die 36 roten Launch-Gates

Stand: 2026-07-27 | Messbasis: `25bae50` (master, Arbeitsbaum sauber)
Basis der Fix-Kette ist der Commit DIESES Dokuments — `git log -1 --format=%h -- PLAN-GATES.md`
Vorgaenger: [`PLAN-I18N-TESTS.md`](PLAN-I18N-TESTS.md) (Katalog), [`PLAN-I18N-FIX.md`](PLAN-I18N-FIX.md)
(15 Fix-Phasen), [`tasks/i18n-tests/28-w3-checkliste.md`](tasks/i18n-tests/28-w3-checkliste.md) (W3-Protokolle)

**Das ist ein SCHNITT-Dokument, kein Design-Dokument.** Die Anforderungen liegen bereits als
ausfuehrbare Tests vor — jeder rote Gate IST seine eigene Spezifikation. Die Frage lautet
deshalb nicht "was ist der Sollzustand", sondern: **welche Gates teilen sich einen
Aenderungsort, was darf parallel laufen, was erzwingt eine Reihenfolge.**

---

## 1. Ausgangslage (gemessen, 2026-07-27)

| Messung | Kommando | Ergebnis |
| --- | --- | --- |
| Regressionsschutz | `npm test` | **3295 / 0 rot** (roh 3316, minus 21 Datei-Wrapper) |
| Launch-Gates | `npm run test:gates` | **131 / 36 rot** (roh 515, minus 384 Datei-Wrapper) |
| Verteilung | — | 36 rote Gates in **22 Testdateien** |

**Stand nach Welle 1** (gemessen 2026-07-27, master nach den Merges P1/P2/P3/P6/P8/P13):
`npm test` = **3298 / 0** (die Welle hat drei Regressionstests mitgeliefert),
`npm run test:gates` = **131 / 22 rot**. **Vierzehn Gates sind gefallen:** PAY-19 x2,
GAP-08 x2, DID-05, DID-09, LANG-19, GAP-09 x2, GAP-34 x2, WEB-07, WEB-19, GAP-30. Kein
neues rotes Gate. P2 brauchte drei Fix-Runden (die ersten beiden verliessen den Scope,
s. `tasks/gates-fix-chain.md` P2). Die unten genannte Zahl "3295 / 0" ist damit die Zahl
der AUSGANGSLAGE — massgeblich als Abnahme ist `fail = 0` plus "kein bestehender Test wird
rot", nicht eine feste Gesamtzahl.

---

## 2. Triage — alle 36 Gates gegen den heutigen Code

Methode: 20 Triage-Agenten (Sonnet, Effort `medium`), gebuendelt nach Testdatei, je Gate ein
Beleg am Code. Alle 20 lieferten, keine Platzhalter-Rueckgaben. **Ergebnis der Agenten:
36 von 36 `GUELTIG`.**

**Die Lead-/Owner-Nachpruefung hat davon drei korrigiert.** Das ist die wichtigste Zahl
dieses Dokuments: eine Triage, die nur Agenten-Urteile sammelt, haette drei Phasen gebaut,
die entweder nichts bewirken oder das Gegenteil dessen tun, was das Produkt will.

| # | Gate | Testanker | Klasse | Beleg am Code | Aenderungsort |
| --- | --- | --- | --- | --- | --- |
| 1 | **PAY-19** | `pay-19-…:108` | GUELTIG | beide Faelle liefern `{"type":"Error","own":{}}`; `stripe.js:158` nutzt `assertOk` (`:92-94`), das den Body nie liest | `src/billing/stripe.js`, `src/billing/errors.js` |
| 2 | **PAY-19** | `pay-19-…:121` | GUELTIG | `assertOkWithDetail` (`stripe.js:114-128`) kennt nur `isMissingCustomerDetail`, nicht `authentication_required` | `src/billing/stripe.js`, `src/billing/errors.js` |
| 3 | **GAP-08** | `fx-single-source:54` | GUELTIG | `src/config.js:1071` `usdToEur: 0.93` — Literal, kein `numEnv` | `src/config.js`, `.env.example` |
| 4 | **GAP-08** | `fx-single-source:63` | GUELTIG | `0.93` (LLM-Achse) vs. `920000` Mikro = `0.92` (Provider-Achse, `config.js:404-406`) | `src/config.js` |
| 5 | **GAP-30** | `dashboard-i18n-surface:89` | GUELTIG | `api.js:442-446` = `[agentName, allowBooking, allowCalendar, language]` vs. `self-service.js:20` = `[agentName, agentStyle, language]` | `apps/web/src/lib/api.js` |
| 6 | **WEB-07** | `dashboard-i18n-surface:40` | GUELTIG | `grep -rn agentStyle apps/web/src` → **0 Treffer** | `apps/web/…/SettingsIsland.astro`, `apps/web/src/lib/api.js` |
| 7 | **WEB-19** | `dashboard-i18n-surface:79` | GUELTIG | `grep -rn privateNumber apps/web/src public/tenant.html` → **0 Treffer** (Server-Seite fertig) | `apps/web/…/SettingsIsland.astro`, `apps/web/src/lib/api.js` |
| 8 | **WEB-08** | `dashboard-i18n-surface:47` | **entfaellt** | zeigt auf `public/tenant.html` — die Datei wird geloescht (Owner, 2026-07-27) | — (P14) |
| 9 | **FMT-15** | `bk1-plan-price-format:102` | **entfaellt** | dito | — (P14) |
| 10 | **FMT-15** | `bk1-plan-price-format:108` | **entfaellt** | dito | — (P14) |
| 11 | **GAP-23** | `did-reputation-metric:73` | **FALSCH_SPEZIFIZIERT** | siehe 2.1 — der Test schaltet in Zeile 32 (`maxNumbersPerTenant: 9`) genau den Schutz ab, dessen Fehlen er beklagt | — (stillgelegt) |
| 12 | **GAP-23** | `did-reputation-metric:85` | **FALSCH_SPEZIFIZIERT** | siehe 2.1 — die Verdrahtung passiert bereits im Bestell-Schritt | → Boot-Guard in P7 |
| 13 | **LANG-19** | `f1-geo-store:192` | GUELTIG | `isOptionalEnumOverride` (`state-ops.js:2646-2649`) prueft `includes(value)` ohne `toLowerCase`; `updateSettings:2679` macht stilles `continue` | `src/store/state-ops.js` |
| 14 | **GAP-09** | `tts-quota-counter:365` | GUELTIG | `directive-synth.js:64` ruft nur `store.recordTtsCharacters` (Plattform-Zaehler), kein Tenant-Schreibpfad | `src/tts/directive-synth.js`, `src/store/state-ops.js`, `src/routes/voice.js` |
| 15 | **GAP-09** | `tts-quota-counter:391` | GUELTIG | kein Quota-Check vor `synthesizeSpeech`; `recordTtsCharacters` warnt einmalig, kennt keinen Zustand >100 % | `src/tts/directive-synth.js`, `src/store/state-ops.js` |
| 16 | **GAP-06** | `metering-unit:167` | GUELTIG | `recordNumberMonthMeter` hat **einen** Aufrufer (`provisioning-orchestrator.js:175`, Aktivierung), keinen wiederkehrenden Pfad → 1 statt 3 Belege | `src/worker/provisioning-orchestrator.js`, `src/billing/metering.js` |
| 17 | **DID-05** | `f1-provisioning-geo:128` | GUELTIG | `COUNTRY_SEARCH_PARAMS` (`provisioning-geo.js:34-38`) kennt nur FR/GB/US → CA, IE, AU, CH, AT, ES, IT fallen auf den Default | `src/telephony/provisioning-geo.js` |
| 18 | **DID-09** | `f1-provisioning-geo:141` | GUELTIG | kein Eintrag setzt `phoneNumberType` → Provider-Default entscheidet | `src/telephony/provisioning-geo.js` |
| 19 | **GAP-11** | `f1-provisioning-geo:200` | **FALSCH_SPEZIFIZIERT** | siehe 2.2 — verlangt eine hartkodierte Preistabelle, waehrend der echte Preis in der Provider-Antwort steht und verworfen wird | `src/telephony/adapters/telnyx/numbers.js` (neu gefasst) |
| 20 | **GAP-34** | `f1-geo-store:399` | GUELTIG | `migrate()` (`migrate.js:160-167`) fasst `number.language` nirgends an | `src/db/migrate.js` |
| 21 | **GAP-34** | `f1-geo-store:421` | GUELTIG | keine Vorwahl-Ableitung fuer Bestandszeilen | `src/db/migrate.js` |
| 22 | **GAP-19** | `outbound-gates-order:448` | GUELTIG | voller Kettendurchlauf mit US-DID + DE-Tenant + DE-Ziel → `denial === null` | `src/telephony/outbound-gates.js` |
| 23 | **GAP-19** | `boot-prod-footguns:67` | GUELTIG | `bootLog` enthaelt `FORCE_NUMBER_COUNTRY` nicht | `src/boot.js` |
| 24 | **OUT-14** | `outbound-gates-order:519` | GUELTIG | Kommentar `outbound-gates.js:466` nennt "16 Glieder", `gates.length` ist **17** | `src/telephony/outbound-gates.js` |
| 25 | **GAP-26** | `max-duration-live-cap:94` | GUELTIG | `terminateCappedCall` (`call-lifecycle.js:50-70`) ruft nie `recordFailureReason` | `src/telephony/call-lifecycle.js` |
| 26 | **VOICE-12** | `telnyx-elevenlabs-render:80` | GUELTIG | `sayVoiceAttrs` (`render.js:73-76`) liest nur `opts.elevenLabs.voiceId`, ignoriert `voiceProfile` | Renderer + `registry.js` + `config.js` |
| 27 | **GAP-31** | `locale-field-consumers:36` | GUELTIG | `grep -rn "\.sttLocale\b" src/` → **0 Treffer**; beide Renderer fuehren stattdessen eine hart kodierte `VOICE_MAP` | `src/i18n/locales.js`, beide `render.js` |
| 28 | **MCP-14** | `mcp-tools-i18n:137` | GUELTIG | `mcp-tools.js:688/691/717` halten `"Keine offenen Action Items."`, `"(Termin) "`, `` `${e.start} bis ${e.end}` `` hart deutsch | `src/mcp-tools.js` |
| 29 | **LANG-15** | `p15-mcp-…:149` | GUELTIG | `mcp-tools.js:494` traegt weiterhin `language` mit `describe("… default 'de'.")` | `src/mcp-tools.js` |
| 30 | **GAP-24** | `telnyx-p8-inbound:135` | GUELTIG | `telnyx-inbound.js:41` ruft `vc.startAssistant()` ohne `language` (Adapter kann es, `voice.js:761`) | `src/telnyx-inbound.js` |
| 31 | **WEB-10** | `self-service-error-codes:81` | GUELTIG | `self-service-routes.js:366` liefert `{ error: "PUBLIC_URL fehlt" }` | `src/self-service-routes.js` (+ `src/routes/api-billing.js:55`) |
| 32 | **WEB-13** | `web-auth:352` | GUELTIG | `web-auth.js:32-37` `SESSION_EXPIRED_PAGE` ist deutsches HTML mit `lang="de"` | `src/web-auth.js` |
| 33 | **GAP-05** | `gap-05-number-hold:45` | **GETRAGEN** | `stripe.js:284` setzt `allow_promotion_codes` bedingungslos — Owner 2026-07-27: bleibt so | — |
| 34 | **GAP-15** | `gap-15-…:45` | GUELTIG (Owner-Text) | `imprint.de.json:5` enthaelt woertlich "Platzhalter-Fassung" | `apps/web/src/data/legal/*.de.json` |
| 35 | **GAP-15** | `gap-15-…:60` | GUELTIG (Owner-Text) | nur `*.de.json` vorhanden, keine `*.en.json` | `apps/web/src/data/legal/*.en.json` (neu) |
| 36 | **GAP-37** | `render-buildfilter:83` | GUELTIG | `ignoredPaths` enthaelt `apps/web/**`, obwohl derselbe Service `buildCommand`+`WEB_DIST_DIR=apps/web` traegt | `render.yaml` |

### 2.1 GAP-23 — warum beide Tests fallen

Der Owner hat den Befund gekippt, nicht die Triage. Zwei Einwaende, beide am Code bestaetigt:

**"Ein User kann gar nicht selbstaendig eine zweite Nummer kaufen."** Stimmt:
`MAX_NUMBERS_PER_TENANT` steht auf **1** (`src/config.js:738` Fallback, `.env.example:164`,
`render.yaml:156-157`), und `requestNumber` lehnt die zweite Nummer bereits ab
(`src/store/state-ops.js:1387`, Grund `tenant_cap`). Das ist **zweimal gruen gepinnt**:
`test/number-lifecycle.test.js:129` und `test/bk3-auto-provision.test.js:125-130`. Der
GAP-23-Test sieht die Luecke nur, weil er in Zeile 32 `maxNumbersPerTenant: 9` setzt — er
schaltet den Schutz ab und beklagt dann sein Fehlen.

**"Fuer eine neue Nummer muesste er einen neuen Account machen."** Ebenfalls richtig — und
damit ist die Kennzahl prinzipiell blind: ein frischer Tenant hat keine Anrufhistorie. Der
Hebel gegen Account-Rotation ist die Identitaets-Dedup, die bereits gebaut ist.

**Teil 2 (kein `active` ohne Registrierung) hat keinen Inhalt.** Die `connection_id` reist im
Bestell-Body mit — Telnyx setzt das Voice-Routing in *einem* Schritt
(`src/telephony/adapters/telnyx/numbers.js:9-10,85-88`), und `activateNumber` laeuft erst nach
erfolgreicher Bestellung (`src/onboarding.js:121`). Uebrig bleibt genau eine Restluecke:
`if (connectionId) body.connection_id = connectionId` — ist die Config leer, geht die Nummer
ohne Routing raus und trotzdem auf `active`.

> **ENTSCHIEDEN (Owner, 2026-07-27):** beide Tests werden stillgelegt; Teil 2 wird zu einem
> **Boot-Guard auf `TELNYX_CONNECTION_ID`** umgewidmet (faehrt in P7 mit).

> **NACHGEMESSEN (2026-07-27):** `MAX_NUMBERS_PER_TENANT` ist im Render-Dashboard **gar nicht
> gesetzt** (Owner abgelesen). Damit greift der Code-Fallback `numEnv(…, {fallback: 1})`
> (`src/config.js:738-741`) — live gilt **1**. Die Begruendung oben ist damit gemessen und
> nicht mehr aus dem Blueprint geschlossen.

### 2.2 GAP-11 — der Preis liegt schon auf der Leitung

Der Test verlangt je Kauf-Land einen hartkodierten `holdAmountCents`-Eintrag. Der Owner haelt
dagegen: *"Es gibt nichts Hartkodiertes, die Preise werden live bei Telnyx angefragt."* Fuer
die **Anruf**-Kosten stimmt das (Cost-Truing-Sweep). Am **Nummernkauf** ist es umgekehrt, und
zwar schlimmer als der Test vermutet: `searchNumbers`
(`src/telephony/adapters/telnyx/numbers.js:67-77`) mappt die Telnyx-Antwort auf
`{ e164: d.phone_number }` — **`cost_information` (upfront_cost, monthly_cost, currency) wird
weggeworfen**. Danach haelt der Code die Pauschale `numberSetupFeeCents`.

> **ENTSCHIEDEN (Owner, 2026-07-27):** der Preis aus der Provider-Antwort wird behalten und
> als Hold verwendet. **GAP-11 wird neu gefasst** — der heutige Test prueft
> `holdAmountForCountry` und wuerde diesen Fix nicht als gruen erkennen.

### 2.3 Kauf-Land — Korrektur einer Lead-Aussage

Der Plan behauptete zunaechst, ein Kunde ohne Tabellen-Eintrag bekomme "still eine deutsche
Nummer". **Falsch fuer live:** `render.yaml:176-177` setzt `FORCE_NUMBER_COUNTRY: "US"`,
Kommentar woertlich *"US = jeder User bekommt eine US-Nummer"*. `PROVISIONING_COUNTRY: "DE"`
ist nur der Fallback, den der Override aussticht (beide Bestands-DIDs sind `+1`).

**Folge fuer P3:** der Override greift **vor** der Laender-Tabelle.

> **ENTSCHIEDEN (Owner, 2026-07-27): der Override bleibt** — jeder Tenant bekommt weiterhin
> eine US-Nummer.

Damit zerfaellt P3 in zwei ungleiche Haelften:

- **DID-05** (Laender ohne Tabellen-Eintrag kaufen im eigenen Land) wird **latent**: der
  Override sticht die Tabelle, live aendert der Fix nichts. Er ist trotzdem richtig — er
  wirkt in dem Moment, in dem der Override faellt.
- **DID-09** (`phone_number_type` explizit je Land) bleibt **live-relevant**: der US-Kauf
  laeuft heute ohne `filter[phone_number_type]`, also entscheidet der Telnyx-Default, ob wir
  `local`, `toll-free` oder `mobile` bekommen. Das beruehrt Zustellbarkeit und Preis jeder
  einzelnen gekauften Nummer — unabhaengig vom Kauf-Land.

---

## 3. Kollisionen mit gruenen Tests

Die Triage klassifiziert je Gate. Sie beantwortet **nicht**, ob der Fix einen heute gruenen
Test umwirft — die eigentliche Gefahr fuer die Zusage "Regression bleibt 3295 / 0":

| Gate | Kollidiert mit | Beleg |
| --- | --- | --- |
| **GAP-37** | `render-buildfilter.test.js:30` (W0, gruen) | `:30` `assert.match(… apps/web/\*\*)` gegen `:83` `assert.doesNotMatch(… apps/web/\*\*)` — dieselbe Zeile, gegensaetzlich beurteilt |
| **GAP-05** | `stripe-setup-checkout.test.js:199`, `p4-setup-fee-hold.test.js:86` | beide pinnen `allow_promotion_codes === "true"` |
| **WEB-13** | `web-auth.test.js:337` (AM2-Ist-Pin) | `assert.match(res.body, /Sitzung abgelaufen/)`; `:346` benennt WEB-13 selbst als Gegenstueck |
| **LANG-15 / GAP-24** | `EXPECTED_MARKERS` bzw. der Byte-Identitaets-Test | in beiden Testdateien als Kopplung dokumentiert |

**Verallgemeinerung:** jede Phase faehrt `npm test` VOLLSTAENDIG. Ein roter Regressionstest ist
Blocker — ausser er steht namentlich in Abschnitt 7.

---

## 4. Pre-Mortem (CLAUDE.md-Pflicht)

Ein Jahr spaeter, die Kette ist gescheitert. Was ist passiert?

**PM-1 — Ein Geld-Gate wurde gruen, ohne dass sich das Verhalten geaendert hat.**
Praezedenzfall belegt: In W2 wurde **VOICE-12 lautlos zu einer Bestaetigung des Defekts**
("eine Voice-ID fuer alle Sprachen — das IST der Beweis"), **beide Reviews gaben ihn frei**,
gefunden hat es erst die Lead-Pruefung. Bei PAY-19 waere die Variante: ein Test, der statt
eines echten SCA-Zweigs nur die Fehlermeldung umformuliert.
*Gegenmittel:* Diff-Pflicht auf `src/`/`public/`/`apps/` (mechanisch) **und** die abschliessende
Liste zulaessiger Testaenderungen in Abschnitt 7 — was dort nicht steht, ist ein Blocker.

**PM-2 — Zwei Phasen kollidierten.** `src/config.js` ist ein Hub (Clean-Code-Audit
2026-07-17: "config.js-Hub bleibt"); drei Phasen wollen daran (P2, P7, P9).
*Gegenmittel:* die Reihenfolgen in Abschnitt 6 sind bindend, nicht empfehlend.

**PM-3 — Eine Migration lief zweimal.** P8 schreibt `number.language`/`number.country` an
Bestandszeilen. Zu breit oder nicht idempotent heisst: sie ueberschreibt eine **explizit
gesetzte** Tenant-Sprache — genau den Wert, mit dem der Owner am 27.07. live den DE-Anruf
hergestellt hat. Der Schaden ist still: der Agent spricht die falsche Sprache, niemand sieht
einen Fehler.
*Gegenmittel:* nur Zeilen mit Altwert `de` UND bekanntem Land; ohne `e164`-Anker bleibt das
Feld leer (E2, "kein Raten"); zweimal hintereinander lauffaehig.

**PM-4 — Ein Gate wurde gebaut, das es nicht gibt.** Beinahe passiert: GAP-23 haette zwei
Sperren in den Nummern-Lebenszyklus gebaut, gegen eine Bedrohung, die die Ein-Nummer-Grenze
laengst ausschliesst — und der erste echte Kunde waere moeglicherweise nie an eine Nummer
gekommen. Gefunden hat das der Owner, nicht die Triage und nicht der Test.
*Gegenmittel:* siehe 2.1. Fuer die Ausfuehrung: **ein roter Test ist eine Behauptung, kein
Beweis.** Wo eine Phase eine neue Sperre baut, gehoert der gluecklichen Pfad mitgetestet.

**PM-5 — Die TTS-Deckelung hat Anrufe verstummen lassen.** P6 fordert bei erschoepftem
Kontingent "einen definierten Zustand". Waehlt die Phase die Sperre statt der Degradation,
laeuft ein Anruf ohne Stimme — bei einem Produkt, dessen einziger Zweck Sprechen ist.
*Gegenmittel:* **Degradation auf Azure-`<Say>`**, als Vorgabe im Phasen-Prompt, nicht als
Ermessen.

**PM-6 — Das Loeschen des alten Dashboards hat den Geld-Pfad gekappt.** P14 loescht
`public/tenant.html`. Diese Datei ist die **Stripe-Rueckkehr-Adresse**
(`src/self-service-routes.js:46-57`: `/tenant.html?card=ok`, `?sub=ok`, …). Faellt sie ohne
Ersatz, landet ein Kunde nach dem Hinterlegen seiner Karte auf einer Seite, die ihm nicht
bestaetigt, dass es geklappt hat — oder auf einem 404.
*Gegenmittel:* P14 muss die Rueckkehr-Adressen auf `/app` umstellen UND pruefen, dass `/app`
die Parameter auswertet. Ohne diesen Nachweis kein Merge.

**PM-7 — Der Blueprint wurde angewendet und hat das Produkt abgeschaltet.** `render.yaml`
fuehrt `MULTI_TENANT=false` und `SELF_SERVICE_ENABLED=false`, live steht beides auf `true`
(W3, gemessen). P15 fasst `render.yaml` an — wer die Datei danach anwendet, schaltet
Multi-Tenancy und Self-Service ab.
*Gegenmittel:* P15 aendert **ausschliesslich** `buildFilter.ignoredPaths`. Jede weitere
Zeile in `render.yaml` ist ein Blocker.

**PM-8 — Die Kette wurde nie deployt.** Alle Phasen gruen, gemergt, und dann liegt es — wie
`PLAN-POLISH-A` (komplett, nicht deployed) und die i18n-Fix-Kette (15 Phasen, "NICHTS
deployed").
*Gegenmittel:* der Deploy ist Teil des Abschlusses, mit Live-Beleg (`/healthz` `commit`,
Boot-Banner).

---

## 5. Owner-Entscheidungen vom 2026-07-27 (bindend fuer die Kette)

| Thema | Entscheidung | Folge |
| --- | --- | --- |
| **GAP-23** | Beide Tests stilllegen, Teil 2 als Boot-Guard auf `TELNYX_CONNECTION_ID` umwidmen | −2 Gates, +1 kleiner Guard in P7 |
| **GAP-11** | Preis aus der Telnyx-Antwort behalten statt Tabelle | Test wird neu gefasst; eigene Phase P4 |
| **GAP-06** | **Kein Cron.** Uhr = die **Stripe-Abo-Verlaengerung** (`customer.subscription.updated`, wird bereits verarbeitet: `src/billing/webhook.js:22`), Netz = ein Schritt im bestehenden stuendlichen Sweep (`src/boot.js:424,444`) | kein bezahlter Tier noetig; zwei unabhaengige Ausloeser, Buchung idempotent (ein Beleg je Nummer und Monat) |
| **GAP-06 / Betrag** | Der Monatsbetrag stammt aus dem **Angebot des Anbieters** (`cost_information.monthly_cost` aus P4), gespeichert am Nummern-Datensatz — **nicht** aus der ersten Buchung geschaetzt und **nicht** monatlich neu abgefragt | erzwingt **P4 → P5** |
| **VOICE-12** | Stimme loest **regional** auf: US-Stimme fuer die USA, **britisch als Default** fuer alles uebrige Englisch | P9 waechst (Regionalaufloesung, Entscheidung 7.5) |
| — IDs | `de` = heutige `ELEVENLABS_VOICE_ID` · `fr` = `FFXYdAYPzn8Tw8KiHZqg` · `en-US` = `EST9Ui6982FZPSi7gCHi` · `en-GB` = `wOPou4MhRIYEqQHVxjmp` (Default) | |
| **GAP-37** | Regel entfernen (`ignoredPaths` kuerzen), W0-Test neu fassen | eigene Phase P15 |
| **`public/tenant.html`** | **Loeschen** | eigene Phase P14; WEB-08 + FMT-15 x2 entfallen ersatzlos |
| **GAP-05** | So lassen (Rabattcode-Feld bleibt) | getragenes Risiko, keine Phase |
| **Rechtstexte** | **Zurueckgestellt** — spielen derzeit keine Rolle | GAP-15 x2 fallen aus dem Arbeitsvorrat; Risiko bleibt dokumentiert (7.13 Punkt 3) |
| **`FORCE_NUMBER_COUNTRY`** | **Bleibt `US`** — jeder Tenant bekommt eine US-Nummer | DID-05 wird latent (kein Live-Effekt), DID-09 bleibt live-relevant (s. P3-Anmerkung) |

---

## 6. Phasen und Parallelitaet

Abnahme ist IMMER: *die Gates der Phase gruen* + *`npm test` 3295 / 0* + *Diff beruehrt
`src/`, `public/`, `apps/` oder `render.yaml`*.

| Phase | Titel | Gates | Dateien (Parallelitaets-Grenze) | Risiko | Nach |
| --- | --- | --- | --- | --- | --- |
| **P1** | SCA-Sackgasse | PAY-19 x2 | `src/billing/stripe.js`, `src/billing/errors.js` | **Geld (Launch-Blocker)** | — |
| **P2** | Wechselkurs — eine Quelle | GAP-08 x2 | `src/config.js`, `.env.example` | Geld | — |
| **P3** | Kauf-Land-Tabelle | DID-05, DID-09 | `src/telephony/provisioning-geo.js` | Geld | — |
| **P4** | DID-Preis aus der Provider-Antwort | GAP-11 (neu gefasst) | `src/telephony/adapters/telnyx/numbers.js`, `src/onboarding.js`, `src/telephony/provisioning-geo.js` | **Geld** | P3 |
| **P5** | DID-Monatsmiete im Ledger | GAP-06 | `src/billing/metering.js`, `src/billing/webhook.js`, `src/boot.js`, `src/worker/provisioning-orchestrator.js` | Geld | **P4** |
| **P6** | Store-Vertraege + TTS-Kontingent | LANG-19, GAP-09 x2 | `src/store/state-ops.js`, `src/tts/directive-synth.js`, `src/routes/voice.js` | Geld/Sprache | — |
| **P7** | Absender-Herkunft + Boot-Guards | GAP-19 x2, OUT-14, `TELNYX_CONNECTION_ID`-Guard | `src/telephony/outbound-gates.js`, `src/boot.js` | **Safety** | P2 |
| **P8** | Geo-Backfill-Migration | GAP-34 x2 | `src/db/migrate.js` | **Migration** | — |
| **P9** | Stimme regional + Locale-Felder | VOICE-12, GAP-31 | beide `render.js`, `…/telnyx/elevenlabs-voice.js`, `src/telephony/registry.js`, `src/i18n/locales.js`, `src/config.js` | Sprache | P2, P7 |
| **P10** | MCP-Oberflaeche | MCP-14, LANG-15 | `src/mcp-tools.js` | Sprache | — |
| **P11** | Telefonie-Kleinvertraege | GAP-24, GAP-26 | `src/telnyx-inbound.js`, `src/telephony/call-lifecycle.js` | Sprache/Ops | — |
| **P12** | Deutsche Klartexte am Server | WEB-10, WEB-13 | `src/self-service-routes.js`, `src/routes/api-billing.js`, `src/web-auth.js` | Web | — |
| **P13** | Dashboard `apps/web` | WEB-07, WEB-19, GAP-30 | `apps/web/src/lib/api.js`, `apps/web/…/SettingsIsland.astro` | Web | — |
| **P14** | Altes Dashboard loeschen | (WEB-08, FMT-15 x2 entfallen) | `public/tenant.html`, `src/app.js`, `src/self-service-routes.js`, `src/middleware.js`, 21 Testdateien | **Geld-Pfad!** | P12, P13 |
| **P15** | Deploy-Filter | GAP-37 | `render.yaml` (NUR `ignoredPaths`) | Ops | — |
| **P16** | **US-Stimme (Rest von VOICE-12)** | — (offen, kein eigenes Gate) | `src/i18n/locales.js`, `src/telephony/registry.js`, Call-Record oder `SUPPORTED_LANGUAGES` | Sprache | **P9** |

**P16 — was P9 offen gelassen hat (Lead-Entscheidung 2026-07-28).** P9 hat die
Owner-Tabelle nur zur Haelfte geliefert: `de`, `fr` und `en-GB` sind verdrahtet, **`en-US`
(`EST9Ui6982FZPSi7gCHi`) steht in keiner Zeile Code**. Der Grund ist strukturell, nicht
Nachlaessigkeit: `call.language` traegt die Sprache, **nicht das aufgeloeste Land**.
`tenant.country`/`number.country` existieren als Daten — es fehlt der Weg von dort bis zum
Renderer. Zwei Wege, beide zu gross fuer eine Fix-Runde: `country` am Call-Record mitfuehren
(Migration + jede Call-Erzeugungsstelle) **oder** `SUPPORTED_LANGUAGES` um `en-US`/`en-GB`
erweitern (bricht den harten Pin in `f1-i18n-locale.test.js` und braucht eine eigene
Testfreigabe).

**Die Owner-Tabelle in Abschnitt 5 bleibt unveraendert** — die Entscheidung "US-Stimme fuer
die USA" ist nicht zurueckgenommen, nur **sequenziert**. Bis P16 laeuft, sprechen
US-Anrufer mit der britischen Default-Stimme. **Achtung beim Lesen der Gate-Bilanz:**
VOICE-12 ist gruen und deckt nur die Sprach-Achse (drei verschiedene IDs) — der
Gruenstand ueberzeichnet die Lieferung um genau diese US-Haelfte.

### Anmerkungen, die den Schnitt begruenden

- **P1** ist die einzige Phase, bei der ein Kunde **zahlen will und nicht kann**. Die Wurzel
  liegt an der Adapter-Grenze (`assertOk` verwirft den Stripe-Code), nicht im Aufrufer.
- **P3** ist zweigeteilt (siehe 2.3): DID-09 wirkt live (Nummerntyp beim US-Kauf), DID-05
  ist latent, solange der Kauf-Land-Override steht. **Konsequenz fuer die Reihenfolge:** P3
  ist kein Frueh-Kandidat mehr, DID-09 allein traegt sie.
- **P4** loest GAP-11 anders als der Test es verlangt — der Test wird mitgeliefert neu gefasst
  (Abschnitt 7). Der Fix ist klein: `searchNumbers` reicht `cost_information` durch.
- **P5** hat **zwei** Ausloeser und **einen** Betrag:
  - *Uhr:* die monatliche Abo-Verlaengerung (`customer.subscription.updated`) — der Webhook
    existiert und wird bereits verarbeitet (`src/billing/webhook.js:21-24`). Kein neuer
    Endpunkt, keine neue Ressource, und die Buchung liegt auf genau der Periode, fuer die der
    Kunde bezahlt.
  - *Netz:* ein Schritt im bestehenden stuendlichen Sweep (`src/boot.js:424,444`) fuer aktive
    Nummern ohne Beleg im laufenden Monat — faengt Tenants ohne Abo-Ereignis ab.
  - *Betrag:* der beim Kauf uebernommene `monthly_cost` (aus P4), gespeichert am
    Nummern-Datensatz.
  - **Zwei Defekte, die die Phase mitnehmen muss** (2026-07-27 gefunden):
    `recordNumberMonthMeter` (`src/billing/metering.js:92-100`) bucht heute
    `holdAmountForCountry(…, numberSetupFeeCents)` — die **Einrichtungsgebuehr**, nicht die
    Miete. Und `NUMBER_MONTHLY_COST_CENTS=92` (`.env.example:382`, `src/config.js:604`) ist
    eine hartkodierte Schaetzung derselben Groesse, die an dieser Stelle gar nicht benutzt
    wird. Nach P4/P5 ist sie hoechstens noch Fallback.
  - **Idempotenz ist Pflicht**, nicht Kuer: zwei Ausloeser duerfen denselben Monat nicht
    zweimal buchen (ein Beleg je Nummer und Kalendermonat).
- **P9** ist groesser als zunaechst geplant: die Stimme loest **regional** auf (US vs. GB),
  das beruehrt `SUPPORTED_LANGUAGES`/Locale-Aufloesung, nicht nur eine Tabelle.
  **Nachtrag 2026-07-28 (Review-Runde 1):** die US-Haelfte (`en-US`) ist NICHT geliefert —
  `call.language` traegt nur die Sprache, nicht das aufgeloeste Land, es gibt keinen
  Laufzeit-Signal fuer "US vs. GB". Richtigstellung (Review-Runde 2): `tenant.country` und
  `number.country` existieren bereits als Datenfelder (`src/store/state-ops.js:1278`,
  `src/store/pg.js:1545`) — es fehlt NICHT das Datum, sondern der Weg von dort bis zum
  Renderer (`call.language` haengt heute nur an der Sprache, nicht am Land). Eine echte
  Aufloesung braucht entweder `country` am Call-Record mitfuehren (kein neues Feld an der
  Quelle, aber Migration + jede Call-Erzeugungsstelle) oder eine `SUPPORTED_LANGUAGES`-
  Erweiterung um `en-US`/`en-GB` — Letzteres bricht den harten Pin
  `f1-i18n-locale.test.js:70` und ist ausserhalb der Zulaessige-Testaenderung-Liste
  (Abschnitt 7). **Owner-Entscheidung noch offen (nicht von dieser oder einer
  Fix-Runde autonom getroffen):** entweder (a) eigene Folgephase fuer eine der beiden
  Erweiterungen, oder (b) die bindende Owner-Tabelle in Abschnitt 5 (VOICE-12-Zeile) formal
  auf "en-GB Default, en-US zurueckgestellt" kuerzen. Bis dahin bleibt die Tabelle
  unveraendert stehen und der Delta zur Umsetzung sichtbar dokumentiert
  (Details: `tasks/gates-fix-chain.md` P9-Nachtrag). Der Play-TTS-Vorabsynthese-Pfad
  (`src/tts/directive-synth.js`) wurde in derselben Runde nachgezogen und folgt jetzt
  ebenfalls der Sprachaufloesung (vorher: eine globale Stimme, unabhaengig vom Renderer-Fix).
- **P14** ist keine Datei-Loeschung, sondern eine Phase mit Geld-Pfad-Beruehrung (PM-6) und
  einer Sicherheits-Nebenwirkung: `src/middleware.js:4` lockert die CSP ausdruecklich **wegen**
  dieser Datei (Inline-`<script>`/`onclick`). Faellt sie, kann die CSP enger werden — das ist
  aber **nicht** Teil dieser Phase, sondern ein Folgeauftrag.
- **P15** aendert genau eine Liste in `render.yaml`. Alles andere ist Blocker (PM-7).
  **Gemessen am Live-Dienst (2026-07-27, Render-API):** der Gateway steht auf
  `autoDeploy: "no"` / `autoDeployTrigger: "off"` und sein Build-Kommando enthaelt
  `npm --prefix apps/web run build`. Ein `buildFilter` wirkt nur auf Auto-Deploys — also
  wirkt er hier **gar nicht**, und jeder manuelle Deploy baut `apps/web` ohnehin neu. Die
  befuerchtete Folge (`/app` bleibt veraltet) tritt live **nicht** ein. P15 ist damit reine
  Blueprint-Kohaerenz, kein Betriebsfix — entsprechend niedrig zu priorisieren.

### Wellen (4-6 parallel, Dateilisten innerhalb einer Welle paarweise disjunkt)

| Welle | Phasen | Begruendung |
| --- | --- | --- |
| **W1** | P1, P2, P3, P6, P8, P13 | `billing/stripe.js` ｜ `config.js` ｜ `provisioning-geo.js` ｜ `state-ops.js`+`tts/*` ｜ `db/migrate.js` ｜ `apps/web` |
| **W2** | P4, P7, P10, P12 | `numbers.js`+`onboarding.js`+`provisioning-geo.js` ｜ `outbound-gates.js`+`boot.js` ｜ `mcp-tools.js` ｜ `web-auth.js`+Routen |
| **W3** | P5, P9, P11, P14, P15 | `metering.js`+`webhook.js`+`boot.js` ｜ Renderer+`config.js` ｜ `telnyx-inbound.js`+`call-lifecycle.js` ｜ `tenant.html`+`app.js`+`self-service-routes.js` ｜ `render.yaml` |

**Harte Reihenfolgen:** `P2 → P7 → P9` (alle drei an `config.js`) · `P3 → P4 → P5` (erst die
Laender-Tabelle, dann der echte Preis, dann die monatliche Buchung — bucht P5 vor P4, wird der
falsche Betrag monatlich vervielfacht) · `P12 → P14` (`self-service-routes.js`) · `P13 → P14`
(die Privatnummer-UI muss in `apps/web` stehen, bevor das alte Dashboard verschwindet).

**P7 gegen P5:** beide beruehren `src/boot.js` — deshalb liegen sie in verschiedenen Wellen.

**Bindende Betriebsregeln** (jede war schon einmal teuer):

- **Nicht mergen, solange parallele Workflows laufen** — sonst falsch-positive
  Stale-Base-Blocker.
- **`isolation: worktree` legt Worktrees NICHT zuverlaessig auf `master` an** — "Regel 0" im
  Phasen-Prompt erzwingen UND im Lead per `git merge-base` nachpruefen.
- **`git stash` ist worktree-GETEILT** — waehrend laufender Worktree-Workflows niemals.
- **Vor JEDEM Merge `git diff --stat`** — ein toter Impl-Agent hinterlaesst einen leeren
  Branch trotz PASS-Meldung.
- **Kein `git add -A`.**
- **Modell-Politik:** Opus fuer Plan und Safety-Review, Sonnet fuer Implementierung, Audit,
  Fix und Bericht — Pins explizit je `agent()`, nie das geerbte Modell.

---

## 7. Zulaessige Testaenderungen — abschliessend

> **Ein Gate geht gruen, WEIL sich das Produkt geaendert hat — nicht, weil der Test
> umgeschrieben wurde.** Ein Diff, der ausschliesslich `test/` beruehrt, ist ein
> Verdachtsfall.

Diese Liste ist **vollstaendig**. Was hier nicht steht, ist ein Blocker und wird gemeldet,
nicht angepasst:

| Phase | Zulaessige Aenderung | Grund |
| --- | --- | --- |
| **P4** | `f1-provisioning-geo.test.js:200` (GAP-11) neu fassen: Hold == Preis aus der Provider-Antwort statt Tabelleneintrag | Owner-Entscheidung 2026-07-27 (2.2) |
| **P9** | `telnyx-elevenlabs-render.test.js` (der W2-Ist-Pin "eine Voice-ID fuer alle Sprachen") auf den VOICE-12-Sollzustand heben (zwei sprachaufgeloeste IDs) | **FREIGEGEBEN (Lead, 2026-07-28, vor dem Merge).** Der alte Test pinnte woertlich den Defekt, den VOICE-12 misst — sein eigener Kommentar sagte, er beweise die Tatsache und pinne NICHT den Sollzustand. Nach dem Fix MUSS er sich aendern: er traegt keine Katalog-ID, laeuft also im Regressionslauf und waere sonst rot. Die urspruengliche Aufnahme kam aus demselben Impl-Commit (Selbstautorisierung, zu Recht blockiert); diese Zeile ist die nachgeholte Freigabe |
| **P7** | `did-reputation-metric.test.js` beide Tests stilllegen; Ersatz: Boot-Guard-Test fuer `TELNYX_CONNECTION_ID` | Owner-Entscheidung (2.1); Deckung bleibt ueber `number-lifecycle.test.js:129` + `bk3-auto-provision.test.js:125-130` |
| **P10** | `EXPECTED_MARKERS` in `p15-mcp-tool-descriptions-en.test.js` | der entfernte `language`-Param ist dort als Marker gelistet |
| **P11** | der Byte-Identitaets-Test ueber `telnyx-p8-inbound.test.js:135` | pinnt den Aufruf ohne `language`; Kopplung im Testkommentar `:128-131` |
| **P12** | `web-auth.test.js:337` (AM2-Ist-Pin `/Sitzung abgelaufen/`) | pinnt genau den Ist-Zustand, den WEB-13 abloest |
| **P14** | `bk1-plan-price-format.test.js` (FMT-15 x2) und `dashboard-i18n-surface.test.js:47` (WEB-08) stilllegen; die **21 Testdateien**, die `public/tenant.html` lesen, anpassen | die gemessene Oberflaeche existiert nach der Loeschung nicht mehr |
| **P15** | `render-buildfilter.test.js:30` (W0) neu fassen | prueft das Gegenteil von GAP-37 an derselben Zeile (Abschnitt 3) |

Mechanische Pflichtpruefung je Phase:

```
git diff --name-only <base>..<branch> -- src/ public/ apps/ render.yaml   # NICHT leer
npm test                                                                  # 3295 / 0
npm run test:gates                                                        # Gates der Phase gruen
```

---

## 8. Owner-Punkte — alle geschlossen (2026-07-27)

| Punkt | Inhalt | Stand |
| --- | --- | --- |
| Rechtstexte | finale Fassungen DE/EN | **zurueckgestellt** — GAP-15 x2 raus aus dem Arbeitsvorrat |
| `FORCE_NUMBER_COUNTRY` | bleibt bei "jeder bekommt eine US-Nummer" | **entschieden** — Folge in 2.3 |
| `MAX_NUMBERS_PER_TENANT` | im Dashboard **nicht gesetzt** → Code-Fallback **1** | **gemessen** — bestaetigt die GAP-23-Stilllegung |
| Render-Tier fuer den Cron | entfaellt — GAP-06 laeuft ueber Abo-Verlaengerung + Sweep | **entschieden** |

**Kein Punkt mehr offen. Alle 15 Phasen sind startbar.**

Gemessener Tarif-Stand am Rande (2026-07-27, Render-API), weil er ausserhalb dieser Kette
Folgen hat: `hermes-db` steht auf `basic_256mb` (bezahlt, Upgrade vom 23.07.), der Gateway
`vodafone-agent` auf **`"plan":"free"`**. Render rechnet pro Ressource ab — das DB-Upgrade
hat den Web-Dienst nicht mitgenommen.

> **NACHGEMESSEN und ENTKRAEFTET (2026-07-27, Render-Logs):** die Sorge, ein freier Dienst
> koenne einschlafen und einen eingehenden Anruf in einen Kaltstart laufen lassen, trifft
> hier **nicht** zu. Der stuendliche Sweep tickt 14 Stunden ohne Luecke (26.07. 18:03 bis
> 27.07. 07:03, jede volle Stunde bei `:03:22`, dieselbe Instanz `srv-…-tl7b9`), und dieselbe
> Instanz lief vom 25.07. 09:03 bis 27.07. 07:05 durch — rund 46 Stunden. Der Dienst laeuft
> durchgehend.

**Nebenbefund aus denselben Logs (nicht Teil dieser Kette):** `[cost-truing] sweep
kandidaten=3 … uebersprungen=3 anfragen=0` und `deckung=10% schwelle=80%` stehen **stuendlich
identisch** im Log. Das passt auf den bekannten Befund "drei failed-Calls ohne Leg frieren
`since` ein"; der Fix dafuer ist gemergt, aber offenbar **nicht deployt**. Live noch offen.

---

## 9. Kickoff-Prompt fuer die Ausfuehrungs-Session

> In einer FRISCHEN Session einfuegen.

---

Wir setzen die Fix-Kette aus `PLAN-GATES.md` um: **15 Phasen**. Lies zuerst `PLAN-GATES.md`,
`CLAUDE.md` und `.claude/refs/workflow.md`.

**Gemessene Basis** (selbst nachpruefen, nicht uebernehmen): `npm test` = 3295 / 0,
`npm run test:gates` = 131 / 36 rot. Basis der Kette ist der Commit dieses Dokuments
(`git log -1 --format=%h -- PLAN-GATES.md`), nicht die Messbasis `25bae50` davor.

**Ausfuehrungsmodell.** Pro Phase EIN `phase-impl-lean`-Workflow, parallel innerhalb einer
Welle (Abschnitt 6), niemals ueber Wellengrenzen hinweg. Der Lead liest KEINEN
Produktionscode und merged erst nach eigener Pruefung.

**Je Phase gilt als Abnahme:** (1) die Gates der Phase gruen, (2) `npm test` = 3295 / 0,
(3) `git diff --name-only <base>..<branch> -- src/ public/ apps/ render.yaml` nicht leer,
(4) der Bericht nennt, welche Datei welche Verhaltensaenderung traegt.

**Ein Gate geht gruen, WEIL sich das Produkt geaendert hat.** Faellt dabei ein heute gruener
Test, ist das ein Blocker — ausser er steht in Abschnitt 7 von `PLAN-GATES.md`. Diese Liste
ist abschliessend; keine neuen Ausnahmen ohne Rueckfrage beim Owner.

**Ein roter Test ist eine Behauptung, kein Beweis.** GAP-23 war zwei rote Tests lang ein
Befund und ist am Ende keiner gewesen (siehe 2.1). Wo eine Phase eine neue Sperre baut,
gehoert der gluecklichen Pfad mitgetestet.

**Bindend:** Modell-Pins explizit je `agent()` (Opus fuer Plan und Safety-Review, Sonnet fuer
Implementierung/Audit/Fix/Bericht) · "Regel 0" (Worktree auf `master`, im Lead per
`git merge-base` pruefen) · nicht mergen waehrend parallele Workflows laufen · kein
`git stash` waehrend Worktree-Workflows · vor jedem Merge `git diff --stat` · kein
`git add -A`.

**Vier Vorgaben, die die Phase NICHT selbst entscheiden darf:**
- **P5 (GAP-06):** Uhr = Stripe-Abo-Verlaengerung (`customer.subscription.updated`, Webhook
  existiert), Netz = ein Schritt im bestehenden stuendlichen Sweep. **Kein Cron, kein neuer
  Endpunkt.** Der Betrag ist der beim Kauf uebernommene `monthly_cost` (P4) — nicht die
  Einrichtungsgebuehr, die heute faelschlich gebucht wird, und nicht `NUMBER_MONTHLY_COST_CENTS`.
  Ein Beleg je Nummer und Kalendermonat, auch wenn beide Ausloeser feuern.
- **P6 (GAP-09):** bei erschoepftem Kontingent **Degradation auf Azure-`<Say>`**, nicht Sperre.
- **P8 (GAP-34):** nur Zeilen mit Altwert `de` UND bekanntem Land; ohne `e164`-Anker bleibt
  das Feld leer; zweimal hintereinander lauffaehig.
- **P15 (GAP-37):** in `render.yaml` **ausschliesslich** `buildFilter.ignoredPaths` aendern.
  Jede weitere Zeile ist ein Blocker (der Blueprint wuerde sonst Multi-Tenancy abschalten).

**P14 hat eine eigene Abnahmebedingung:** die Stripe-Rueckkehr-Adressen
(`src/self-service-routes.js:46-57`, heute `/tenant.html?card=ok`) muessen auf `/app`
umgestellt sein UND `/app` muss die Parameter auswerten. Ohne diesen Nachweis kein Merge —
sonst landet ein Kunde nach dem Hinterlegen der Karte auf einer Seite ohne Bestaetigung.

**Sichtbarkeit.** Melde JEDEN Workflow-Start mit Umfang (Phase, Zahl der Agenten, erwartete
Dauer) und nach dem Lauf den Verbrauch. Ein Hintergrundlauf ueber mehrere hunderttausend Token
darf nicht in einem Nebensatz verschwinden — der Owner will sehen, was gerade laeuft.

Beginne mit Welle 1 (P1, P2, P3, P6, P8, P13) und berichte nach jeder Welle, bevor du die
naechste startest.

---

## 10. Bilanz

| | Anzahl |
| --- | --- |
| rote Launch-Gates | **36** |
| davon von der Nachpruefung korrigiert | **3** (GAP-23 x2 falsch spezifiziert, GAP-11 neu gefasst) |
| davon durch Loeschung der Oberflaeche gegenstandslos | **3** (FMT-15 x2, WEB-08) |
| davon getragen bzw. zurueckgestellt | **3** (GAP-05 getragen, GAP-15 x2 zurueckgestellt) |
| als Phase fahrbar | **28 Gates in 15 Phasen** (2+2+2+1+1+3+3+2+2+2+2+2+3+0+1) |
| Phasen ohne offene Vorbedingung | **15** von 15 |
| davon ohne Live-Wirkung | **P15** (Blueprint-Kohaerenz) und die DID-05-Haelfte von P3 |
| harte Reihenfolgen | `P2→P7→P9` · `P3→P4` · `P12→P14` · `P13→P14` |
