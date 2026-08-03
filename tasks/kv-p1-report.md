# Phase KV-P1 - Die Kosten-Landkarte wird Struktur statt Konvention

Gate = **PASS**
finalBranch = `phase/kv-p1-kosten-landkarte`

Hinweis zur Quelle dieses Berichts: `tasks/kv-p1-tables.md` fehlte im Haupt-Repo (wie im
Auftrag vorgesehen zu pruefen). Die Datei wurde im Worktree
`.claude/worktrees/wf_c27b553a-054-1/tasks/kv-p1-tables.md` gefunden und ist unten woertlich
uebernommen.

## Vorgeschichte dieses Laufs

Die Implementierung entstand im Lauf `wf_af632311-4d5` und wurde als `049bacd` committet.
Dieser Lauf starb danach am StructuredOutput (16-KB-Nutzlast, nicht parsebar), weshalb
Verifikation und Review separat nachgeholt wurden.

## (A) Die Landkarte - woertlich aus `src/billing/cost-ledger-map.js`

| Kosten-Art | USAGE_EVENT_KIND | ledger | gate | preisquelle |
|---|---|---|---|---|
| voice_minute_outbound | VOICE_MINUTE | true | true | callTariffCentsPerMin (metering.js) ueber tariffCentsPerMin (outbound-gates.js); unbekannte Herkunft faellt fail-closed auf den teuersten Satz. Ledger nur unter PAYMENT_ENABLED (call-finish.js), Gate (reconcileOutboundVoiceBudget) IMMER. |
| voice_minute_inbound | VOICE_MINUTE | true | false | dieselbe Quelle wie outbound (callTariffCentsPerMin). Ledger nur unter PAYMENT_ENABLED. Gate: reconcileOutboundVoiceBudget filtert call.direction!=='outbound' -> return, das ist die Hauptluecke (KV-P2 kippt sie). |
| ai_token | AI_TOKEN | true | true | tokenCostUsd (state-ops.js) ueber config.llm.modelPricesUsd; unbekannte Modell-ID faellt fail-closed auf die teuerste Rate (priceForModel/mostExpensivePrice). Ledger rundet pro Buchung auf volle EUR-Cent (aiCostCents, Math.round) - ein einzelner kleiner Turn kann als 0-Cent-Event erscheinen. Gate (trackUsage) akkumuliert denselben Betrag in Mikro-Cent (costMicroCentsRem) und verliert den Rest NIE - die zwei Achsen divergieren dadurch schon bei GLEICHER Preisquelle. |
| research_fee | null | false | true | config.research.researchSearchFeeCents (Vorab-Recherche) bzw. lookupSearchFeeCents (In-Call-Suche), feste ENV-Werte. usage_event kennt kein research-kind - der Ledger-Pfad existiert fuer diese Kosten-Art STRUKTURELL nicht (bewusste Entscheidung AL-P10, s. Kommentar in llm-usage.js). |
| sms | SMS | true | false | config.billing.smsCostCents, Default 0 (kein Fail-closed, min:0 in config.js) - ein fehlender Preis ist hier lautlos 0, nicht 'nicht erfasst'. Gate: kein addUsageCostCents/trackUsage-Aufruf im SMS-Pfad, strukturell nie vorgesehen. |
| number_month | NUMBER_MONTH | true | false | number.monthlyCostCents, NUR der beim Kauf gelernte Provider-Preis (Owner-Entscheidung 2026-07-27, KEIN Fallback). Fehlt er, bucht recordNumberMonthMeter fail-closed NICHTS (monthlyRentCents liefert null). Heute (KV-M2) hat KEINE reale Nummer einen gelernten Preis - die Zeile beschreibt die STRUKTUR (mit Preis-Fixture feuert der Ledger), nicht den aktuellen Bestand. Gate: kein addUsageCostCents-Aufruf, unabhaengig vom Preis - strukturell nie vorgesehen. |
| play_tts_characters | null | false | false | KEIN Preis-Parameter existiert repo-weit fuer Play-TTS-Zeichen (recordTtsCharacters/recordTenantTtsCharacters zaehlen NUR Zeichen, nie Cents). Weder Ledger noch Gate sind erreichbar, weil es nichts zu buchen gibt, das einen Betrag traegt. |

Vollstaendigkeits-Riegel: `USAGE_EVENT_KIND` hat genau 4 Werte (VOICE_MINUTE, AI_TOKEN, SMS,
NUMBER_MONTH), alle 4 sind oben durch mind. eine Zeile gedeckt (KV-P1-8/9). Die zwei
`kind: null`-Zeilen (research_fee, play_tts_characters) sind bewusst enum-lose Kosten-Arten,
keine Luecke im Enum.

## (B) Die Ausloeser-Tabelle - Test gegen echten Buchungspfad

| Kosten-Art | Echter Ausloeser im Test | Assertion Buch A (Ledger/usage_event) | Assertion Buch B (Gate/costCents bzw. costMicroCentsRem) |
|---|---|---|---|
| voice_minute_outbound | `recordVoiceMinuteMeter(call)` + `reconcileOutboundVoiceBudget(call)` aus echtem `makeMetering()`, Test KV-P1-1 | `events.length === 1`, `events[0].costCents === tariffCentsPerMin(...)` | `usageOf(s, tenant).costCents === tariffCentsPerMin(...)` |
| voice_minute_inbound | dieselben zwei echten Metering-Funktionen, Call mit `direction:'inbound'`, Test KV-P1-2 | `events.length === 1` (Ledger kennt keine Richtung) | `gateCents === 0` (Filter in reconcileOutboundVoiceBudget) |
| ai_token | `bookTokenUsage({...})` aus echtem `src/llm-usage.js` gegen echten `src/store.js`-Singleton, 3x hintereinander, Test KV-P1-3 | `ledgerEvents.length === 3`, jede Buchung `costCents === 0` | `costMicroCentsRem` monoton wachsend ueber 3 Turns, `>0` nach Turn 1 |
| research_fee | `bookResearchSearchFee(...)` + `bookLookupSearchFee(...)`, echte Funktionen aus llm-usage.js, Test KV-P1-4 | `eventsNachher === eventsVorher` (kein neuer Event) | `gateNachher - gateVorher === researchSearchFeeCents + lookupSearchFeeCents` |
| sms | `finishCall(call)` aus echtem `makeCallFinish()` (nur Metering-Aufrufe gemockt, SMS-Pfad echt), Test KV-P1-5 | `events.length === 1`, `events[0].costCents === SMS_COST_CENTS_FIXTURE` | `gateCents === 0` |
| number_month | `recordNumberMonthMeter(number, ...)` aus echtem `makeMetering()`, Nummer-Fixture mit `monthlyCostCents`, Test KV-P1-6 | `events.length === 1`, `events[0].costCents === MONTHLY_RENT_CENTS` | `gateCents === 0` |
| play_tts_characters | `recordTenantTtsCharacters(s, tenant, 42)`, echte state-ops-Funktion, Test KV-P1-7 | `s.usageEvents.length === 0` | `usage.costCents === 0`; einziger Effekt `usage.ttsCharacters === 42` |

Jede der 7 Zeilen hat einen echten Ausloeser - keine Zeile ist als "KEIN echter Ausloeser"
markiert. Zusaetzlich zwei Riegel-Tests ohne Buchungspfad-Ausloesung (Struktur-Pruefung, kein
Verhaltenstest): KV-P1-8 (Enum-Deckung) und KV-P1-9 (verwaiste ledger:true-Zeilen), sowie
KV-P1-10 (Ein-Aufrufer-Riegel per Datei-Scan `grep store\.addVoiceUsageCostCents\(` gegen alle
`src/*.js`).

## Tautologie-Urteil

Der Test ist KEINE Tautologie: alle 7 Zeilen loesen einen echten Produktions-Buchungspfad aus
(recordVoiceMinuteMeter/reconcileOutboundVoiceBudget, bookTokenUsage,
bookResearchSearchFee/bookLookupSearchFee, finishCall, recordNumberMonthMeter,
recordTenantTtsCharacters) und lesen danach beide Buecher. Mutationsprobe (a) beweist das
direkt: eine geluegene Zeile wird rot, weil die Beobachtung (echtes Verhalten) sich nicht
mitaendert.

Einschraenkung: der Ein-Aufrufer-Riegel (KV-P1-10) ist datei- statt vorkommens-basiert und
faengt einen zweiten Aufruf im selben File nicht (s. Mutationsprobe d unten).

## Zeilen ohne echten Ausloeser

Keine. Alle 7 Zeilen der Landkarte haben einen in Tabelle (B) benannten echten Ausloeser; die
Verifikation bestaetigt `rowCount: 7`, `rowsWithRealTrigger: 7`, `unreachableRows: []`.

Zusaetzlich unentdeckt bleibende Reichweiten-Grenzen (kein "kein Ausloeser", aber eine
Einschraenkung der Aussagekraft):

- **number_month**: der Ausloeser feuert nur mit einer Preis-Fixture (`monthlyCostCents=92`).
  Heute hat KEINE reale Nummer im Bestand einen gelernten Preis - der Test beweist die
  Struktur (der Ledger wuerde feuern, WENN ein Preis vorliegt), nicht den aktuellen
  Produktionszustand. Das ist im Kommentar der Landkarte selbst offengelegt und wird vom
  Safety-Review als bewusste, ehrliche Abweichung von der Realitaet vermerkt (kein Blocker).
- **KV-P1-10 (Ein-Aufrufer-Riegel)**: prueft nur Dateien, nicht Vorkommen. Ein zweiter Aufruf
  von `addVoiceUsageCostCents` in DERSELBEN Datei (metering.js) bleibt unentdeckt (s.
  Mutationsprobe d).

## Die vier Mutationsproben mit Ergebnis

1. **sms.gate false->true** (Luege in der Tabelle): KV-P1-5 wurde ROT ("Tabelle sagt gate=true,
   beobachtet wurde false"). Keine Tautologie - der Test misst echtes Verhalten, nicht die
   Tabelle gegen sich selbst.
2. **Neuer Wert `KV_P1_PROBE_B` in `USAGE_EVENT_KIND` ohne Tabellenzeile**: KV-P1-8 wurde ROT
   ("USAGE_EVENT_KIND kv_p1_probe_b hat keine Tabellenzeile"). Vollstaendigkeits-Riegel
   funktioniert.
3. **number_month-Zeile entfernt** (Kosten-Art existiert weiter in USAGE_EVENT_KIND): KV-P1-6
   (undefined.ledger TypeError) UND KV-P1-8 wurden ROT. Riegel funktioniert.
4. **Zweiter Aufrufer von `addVoiceUsageCostCents`**: ein zweiter Aufrufer im SELBEN File
   (metering.js) bleibt GRUEN - der Riegel prueft nur Dateien, nicht Vorkommen (`.filter` auf
   Datei-Ebene). Ein zweiter Aufrufer in einem ANDEREN File (call-finish.js) wurde ROT wie
   erwartet.

Alle vier Mutationen wurden danach zurueckgenommen; `git diff` gegen `049bacd` war anschliessend
leer (`mutationsReverted: true`, unabhaengig durch das Safety-Review mit eigenem `git status`
vor/nach jeder Probe bestaetigt).

## Der Vollstaendigkeits-Riegel und der Ein-Aufrufer-Riegel

- **Vollstaendigkeits-Riegel** (KV-P1-8/9): deckt jeden `USAGE_EVENT_KIND`-Wert und jede
  `ledger:true`-Zeile gegen verwaiste Eintraege ab. Durch Mutationsproben (2) und (3) belegt
  funktionsfaehig.
- **Ein-Aufrufer-Riegel** (KV-P1-10): struktureller Scan
  `grep store\.addVoiceUsageCostCents\(` gegen alle `src/*.js`, pinnt den heutigen
  Ein-Aufrufer-Zustand. Durch Mutationsprobe (4) mit einer belegten Einschraenkung: dateibasiert,
  nicht vorkommensbasiert - ein zweiter Aufruf im selben File wird nicht erkannt.

## Safety-Urteil

Safety-Review: **approved = true**. Alle Pruefpunkte PASS: `testsPassIndependently`,
`scopeRespected`, `noBehaviourChange`, `noGapClosed`, `testIsNotTautological`,
`completenessGuardWorks`, `singleCallerGuardWorks`, `tableReadableInReview`,
`unreachableRowsHonest`, `noSecretsLeaked`, `existingAssertionsNotWeakened`,
`disclosureIntact`, `safetyGatesIntact`. Keine Blocker.

Einziger Concern (kein Blocker): die number_month-Zeile demonstriert Ledger-Feuern nur mit
einer Preis-Fixture (`monthlyCostCents=92`) - heute hat keine reale Nummer einen Preis; der
Kommentar in der Landkarte sagt das ehrlich, ist aber eine bewusste Abweichung von der
Realitaet (s. Abschnitt "Zeilen ohne echten Ausloeser" oben).

Alle drei Pflichtmutationen (sms.gate auf true, neuer `USAGE_EVENT_KIND`-Wert ohne Zeile,
zweiter Aufrufer von `addVoiceUsageCostCents` in call-finish.js) wurden selbst durchgefuehrt -
jede faerbte den jeweils richtigen Test rot, danach zurueckgenommen; `npm test` danach wieder
komplett gruen (3833/3833). Diff auf `src/` ist bei metering.js/llm-usage.js/call-finish.js
AUSSCHLIESSLICH additive Kommentarzeilen (git diff selbst gelesen, keine Bedingung/kein
Betrag/kein Filter geaendert). Die Tabelle liegt an einer Stelle (122 Zeilen,
cost-ledger-map.js), ist kurz und im Diff vollstaendig lesbar. Luecken
(voice_minute_inbound/sms/number_month: gate=nein) bleiben unangetastet und werden durch echte
Buchungspfade (recordVoiceMinuteMeter, finishCall, recordNumberMonthMeter) bestaetigt, nicht
durch Deklaration gegen Deklaration. Keine neue Route/Env/Spalte, keine Auth-Aenderung,
Disclosure unberuehrt, Safety-Gates unberuehrt.

Unabhaengiger Testlauf (Safety-Review): `npm test` lokal ausgefuehrt, 3833/3833 gruen, 0 rot,
`git status` vor und nach allen Mutationsproben sauber.

## Clean-Code-Audit

**Verdict: PASS.** KV-P1 fuegt `src/billing/cost-ledger-map.js` (deklarative,
`Object.freeze`'te Tabelle mit Modul-Import-Validierung), 4 Kommentar-Ergaenzungen
(metering.js/llm-usage.js/call-finish.js) und `test/kv-p1-cost-ledger-map.test.js` hinzu.

- G27 erfuellt: Mutationsprobe (sms.gate testweise auf true) liess KV-P1-5 sofort rot werden -
  die Struktur erzwingt echt, ist keine Konvention.
- Keine Tabellen-Duplizierung; alle 3 Pflichtfelder werden beim Import per `typeof`-Check hart
  geprueft (kein Kommentar-Versprechen).
- Alle referenzierten state-ops-Symbole per grep verifiziert (recordUsageEvent,
  addVoiceUsageCostCents, recordCallEstimatedCostCents, usageOf, recordTenantTtsCharacters,
  aiCostCents - alle existieren).
- Fixture-Werte sind je Zeile unterscheidbar (7/3/4/42/92 Cent), Build-Operate-Check sauber
  getrennt, ein Konzept pro Test.
- npm-test-Vollauf im Audit: 3812/3813 gruen; der eine rote Test (B1 in
  cq-p8-briefing.test.js) ist von KV-P1 unberuehrt und laeuft isoliert gruen (bestaetigter
  Last-Flake, keine Regression).
- S1/S2 (Blocker-Kategorien): keine Befunde. S3 (Kommentare/Docstrings): lang, aber sachlich
  praezise und deutsch ohne Umlaute - PASS, kein Flag. S4 (oeffentliche API-Flaeche): das Modul
  exportiert ausser `COST_LEDGER_MAP` nichts, `assertRow` bleibt privat - korrekt minimal, PASS.
- Keine offenen To-dos aus diesem Audit.

Volle Testdatei (10 Tests) isoliert gruen; Vollauf 3812/3813 gruen, 1 Flake unabhaengig von
KV-P1 bestaetigt (isoliert gruen). Mutationsprobe an sms.gate durchgefuehrt und zurueckgesetzt,
Worktree danach sauber (`git status` leer).

## Fix-Runden inkl. Fehlalarme

Keine Fix-Runde noetig. Der `FIXES`-Abschnitt der Quelle ist leer - kein Blocker aus Safety
oder Clean-Code hat einen Fix ausgeloest, kein Fehlalarm ist dokumentiert.

## Wie die naechsten Phasen diese Tabelle benutzen

Jede Bau-Phase kippt GENAU EINE Zeile von `nein` auf `ja` (gate-Spalte), und der
Kreuz-Test (Ausloeser-Tabelle B) erzwingt, dass die Realitaet mitkippt - nicht nur die
Deklaration. Naechster Schritt: **KV-P2 kippt `voice_minute_inbound`** (der in Landkarte-Zeile
2 explizit als "Hauptluecke" benannte Filter `call.direction!=='outbound' -> return` in
`reconcileOutboundVoiceBudget`).

Der Mechanismus, der das erzwingt: KV-P1-2 pruefte bisher `gateCents === 0` fuer den
inbound-Fall. Sobald KV-P2 das Gate fuer inbound aktiviert, MUSS dieser Assert (und die
gate-Spalte in `cost-ledger-map.js`) angepasst werden, sonst wird der Test rot - die Tabelle
kann nicht unbemerkt von der Implementierung abweichen, weil derselbe Test beide Seiten
gegeneinander liest (kein Ledger-Buch gegen sich selbst, sondern Ledger-Buch gegen
Gate-Buch gegen echten Aufruf).

## Deviation dieses Berichts

`tasks/kv-p1-tables.md` existierte im Haupt-Repo NICHT (wie vom Auftrag verlangt zuerst
geprueft). Fundort: Worktree `.claude/worktrees/wf_c27b553a-054-1/tasks/kv-p1-tables.md`. Beide
dort enthaltenen Tabellen (A und B) sind oben woertlich uebernommen. Diese Deviation ist die
bereits im ausliefernden Lauf dokumentierte: der Sandbox-Schutz verweigerte dem Verifikations-
Agenten das Schreiben/Kopieren ausserhalb seines Worktrees.

## Nachbesserung KV-P1b - Ein-Aufrufer-Riegel zaehlt Vorkommen

**Befund:** KV-P1-10 filterte bisher DATEIEN, nicht Vorkommen. Ein zweiter Aufruf von
`store.addVoiceUsageCostCents(` innerhalb derselben Datei (`src/billing/metering.js`) blieb
gruen - und genau dort liegt der bestehende, einzige Aufruf. Der Riegel deckte damit den
wahrscheinlichsten Fall einer Doppelbuchung (Pre-Mortem TOD 2) NICHT ab.

**Aenderung:** Nur `test/kv-p1-cost-ledger-map.test.js` geaendert. KV-P1-10 zaehlt jetzt
Vorkommen ueber `matchAll` statt Dateien ueber alle `src/*.js`; Erwartung genau 1 Treffer in
`src/billing/metering.js`. Die Fehlermeldung nennt TOD 2, Anzahl und Fundstellen. Konstante
`ERWARTETE_VORKOMMEN=1` (G25).

**Mutationsproben (gleiche Datei / andere Datei), Implementierer und Reviewer unabhaengig:**

- Implementierer: zweiter Aufruf in `metering.js` -> ROT, "gefunden: 2 Vorkommen
  [src/billing/metering.js:2]", 2 !== 1. Zweiter Aufruf in `cost-truing.js` -> ROT
  (Bestandsverhalten erhalten), "gefunden: 2 Vorkommen [src/billing/cost-truing.js:1,
  src/billing/metering.js:1]", 2 !== 1.
- Reviewer (Safety, unabhaengig selbst mutiert): `guardCatchesSameFile: true`,
  `guardCatchesOtherFile: true` - beide Mutationen faerbten den jeweils richtigen Test rot,
  danach zurueckgenommen, `git status` sauber.

**Gate = PASS**, finalBranch = `phase/kv-p1b-aufrufer-riegel`. Volle Suite gruen (3813/3813),
nur die Testdatei angefasst, Mutationen zurueckgenommen und committet (63252aa).

**Ehrliche Restgrenze:** der Riegel ist ein Textmuster-Scan ueber `src/` - er faengt einen
Aufruf, der ueber eine Variable, eine Umbenennung oder einen dynamischen Zugriff laeuft, NICHT.
Das ist bewusst getragen; die Alternative waere eine Laufzeit-Zaehlung, die den
Produktionscode veraendern wuerde, was diese Phase ausdruecklich nicht tut.
