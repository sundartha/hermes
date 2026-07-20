# Phase-Report: P1 — CDR-Seam am Voice-Port

**Plan-Quelle:** `PLAN-LIVE-COST-TRACING.md` §6 „P1", Kap. 2.6 + Kap. 4
**Umfang:** CDR-Seam am Telnyx-Voice-Port (`getVoiceCostRecords`) — **kein Aufrufer, keine Buchung, kein Schema**
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p1-cdr-seam`
**headCommit (Kurzform, wie im Impl-Report verwendet):** `26342b5`
**Basis:** `master` — Plan-Kopf nennt `82b6f18`, die Impl-Zusammenfassung nennt `43e9cd1`; die Quellen widersprechen sich hier, nicht aufgeloest (Diskrepanz an den Lead durchgereicht statt geraten).
**Datum:** 2026-07-20

---

## 1. Plan (gekürzt)

Autoritative Quelle: `PLAN-LIVE-COST-TRACING.md` §6 „P1". Blast-Radius laut Plan: 1 neue Quelldatei, 1 neue Testdatei, 4 additive Edits (`ports.js` nur JSDoc, `voice.js` +1 Methode, `config.js` +1 Feld, 3 Env-Dokumentationsstellen).

### 1.1 Vorab entschiedene Designfragen

| Frage | Entscheidung | Begründung |
| --- | --- | --- |
| Vorzeichen `+`/`-` | Beides ungültig → kein Record (eigener Grund `negativ`) | Unterbuchung des Ist ⇒ Überbuchung des Kunden = fail-closed |
| Exponent-Grenzen | Modul-Konstanten `COST_EXPONENT_MIN=-12` / `COST_EXPONENT_MAX=6` in `cost-parse.js`, nicht in `config.js` | Kein Betriebsknopf; beobachtet sind -7…-4, die Spanne ist bewusste Sicherheitsmarge |
| Leg-Zuordnung | Nur Records mit exakt passender Leg-ID werden emittiert; kein Treffer → Record fällt weg, Zähler `leg_unresolved` (PII-frei) | Joinbarkeit je `record_type` ist laut Plan UNBELEGT; ein fremder Record wäre eine Fehlbuchung, ein fehlender Record ist nur „incomplete" |
| `billed_sec` unparsebar | Record bleibt, `billedSec: null` | Keine Geldgröße; P4-Prädikat verlangt `billedSec > 0`, `null` fällt dort konservativ durch |
| Teil-Erfolg über die 7 Typen | Ein fehlgeschlagener Typ-Request → `{ ok:false }` für den gesamten Aufruf | Verhindert die Verwechslung „vollständig abgefragt, weniger gefunden" |
| Volle Seite | `records.length === COST_RECORDS_PAGE_SIZE` → `{ ok:false, reason:"page_truncated" }`, keine Paginierungsschleife | Struktureller Riegel statt stillem Datenverlust; Schleife ohne Aufrufer wäre Code auf Verdacht |
| Zeitfenster-Filter | Server-Filter gesendet + zusätzliche client-seitige Prüfung gegen `[startedAt, endedAt]` und `legId` | Exakte Telnyx-Query-Parameternamen fürs Zeitfenster sind laut Plan UNBELEGT (nur `filter[record_type]` + `page[size]` belegt) |
| Request-Timeout | **Nicht in P1** — rejectendes `fetch` fängt der `try/catch` | Kein Aufrufer, kein Hot-Path; Auflage an P3, wo die Methode im 6-h-Sweep läuft |

### 1.2 Neue Datei `src/telephony/adapters/telnyx/cost-parse.js`

Reine Funktionen, kein IO. `parseDecimalToMicroCents(raw)`: Dezimal-/Exponentialstring (Provider-Hauptwährung) → ganzzahlige Mikro-Cents, rein string-basiert per Stellen-Schieben (kein `parseFloat`, kein `Number` auf dem Geldstring selbst). Nicht parsebar/negativ/Exponent außer Bereich/zu lang → `null` = kein Record, **niemals 0**. Faktor `MICRO_CENTS_PER_CURRENCY_UNIT = CENTS_PER_EUR * MICRO_CENTS_PER_CENT` (aus bestehenden Konstanten zusammengesetzt, keine nackte 10^8). `parseNonNegativeInteger(raw)` separat für `billed_sec` (keine Geldgröße).

### 1.3 Edit `voice.js`

Neue Konstanten: `DETAIL_RECORDS_BASE` (`/v2/detail_records`), `COST_RECORD_TYPES` (7 HTTP-200-verifizierte record_types — `sip-trunking`, `call-control`, `speech-to-text`, `text-to-speech`, `recording`, `inference`, `ai-voice-assistant`; `"call"` existiert laut Messung NICHT), `COST_RECORDS_PAGE_SIZE=250`, `LEG_ID_FIELDS`. Neue Helfer `recordLegId`, `toCostRecord`, `fetchCostRecordPage`. Neue Port-Methode `getVoiceCostRecords({ legId, startedAt, endedAt })`: wirft nie, liefert Ergebnis-Objekt, ein PII-freier Log über die Ergebnisklassen (nie `legId`, nie Rufnummer, nie Key).

### 1.4 Edit `ports.js`

Nur JSDoc: neue Typedefs `VoiceCostRecordsParams`, `VoiceCostRecord`, `VoiceCostRecordsResult`, neues optionales `@property getVoiceCostRecords` an `VoiceControl`. Keine Laufzeitänderung.

### 1.5 Edit `config.js`

Neues Feld `providerCurrency` (Default `"USD"`, aus `PROVIDER_CURRENCY`, uppercased) im billing-Block, plus Eintrag in `CONFIG_NAMESPACES.billing`. Kein `numEnv`/`boolEnv`, kein `assertConfig`-Eintrag (kein Aufrufer in P1).

### 1.6 Env-Dokumentation

`PROVIDER_CURRENCY` in `.env.example`, `render.yaml` und `test/helpers.js` (`BASE_ENV`) dokumentieren (CLAUDE.md verlangt alle drei Stellen; Lehre aus `test-base-env-drift`).

### 1.7 Neue Testdatei `test/telnyx-cost-records.test.js`

Offline, kein Spawn, `global.fetch` gestubbt. Testfälle (a) Parser-Tabelle inkl. Exponentialnotation und Ablehnungsfälle, (a2) Einheiten-Riegel gegen 10^6-Rückdreher, (a3) Notations-Riegel, (b) gemischte `record_type`s mit den real gemessenen Werten + Summenprobe, (c) HTTP 500 / Netzfehler → `ok:false`, kein Wurf, (d) Fremdwährung verworfen / case-insensitive USD akzeptiert, (e) Grenzfälle (`params_missing`, fremde Leg-ID, `page_truncated`), (f) Twilio-Riegel (`getVoiceCostRecords` bleibt `undefined`), (g) Kein-Aufrufer-Riegel per Datei-Scan.

### 1.8 Rot-vor-Fix-Nachweis (zweistufig, vom Plan vorgeschrieben)

Stufe 1 vor jeder Implementierung: `ERR_MODULE_NOT_FOUND` auf `cost-parse.js`. Stufe 2 nach `cost-parse.js`, vor der Adapter-Methode: Parser-Tests grün, Seam-Tests rot mit `TypeError: telnyxVoice.getVoiceCostRecords is not a function`.

### 1.9 Deterministisch prüfbares Ergebnis (Akzeptanzkriterien, Auszug)

`node --check` sauber; `node --test test/telnyx-cost-records.test.js` → `# fail 0`; `npm test` unverändert grün ggü. Baseline; `grep -rn "getVoiceCostRecords" src/` liefert genau zwei Dateien (`ports.js`, `adapters/telnyx/voice.js`); `grep` bestätigt kein `parseFloat`, genau zwei `Number(`-Vorkommen, kein nackter `1e8`/`100000000`-Faktor; `PROVIDER_CURRENCY` in allen vier Dokumentationsstellen; `git diff --stat` berührt keinen Schema-/Store-/Gate-/Routen-/Webhook-Pfad. Die Live-Abnahmebedingung („Einheit belegt") gilt laut Plan bereits als erfüllt durch die Messung vom 2026-07-20 (`sip-trunking` rate `0.0401` / cost `0.0802` bei `billed_sec 120`, `currency USD`).

**Offene Auflage an P3** (kein P1-Scope): `getVoiceCostRecords` hat bewusst keinen Request-Timeout — P3 ruft die Methode im 6-h-Sweep auf, dort ist ein konfigurierbarer Timeout Pflicht.

---

## 2. Implementierungs-Zusammenfassung

PLAN-LIVE-COST-TRACING P1 vollständig auf Branch `phase/lct-p1-cdr-seam` umgesetzt, ein Commit.

**Neu:**
- `src/telephony/adapters/telnyx/cost-parse.js` — reine Funktionen, kein IO. `parseDecimalToMicroCents` parst Telnyx-Geldstrings (Dezimal + wissenschaftliche Notation, groß-/klein-E) rein string-basiert per Stellenschieben zu ganzzahligen Mikro-Cents (Faktor 10^8 = `CENTS_PER_EUR * MICRO_CENTS_PER_CENT`, keine nackte Zahl); ungültig/negativ/Exponent außer `[-12,6]`/Ergebnis > 15 Ziffern → `null` = kein Record, niemals 0. `parseNonNegativeInteger` separat für `billed_sec`.
- `test/telnyx-cost-records.test.js` — 39 Tests, alle Fälle a–g aus dem Plan, isoliert 3× stabil grün.

**Bearbeitet:**
- `src/telephony/adapters/telnyx/voice.js` — neue Methode `getVoiceCostRecords({legId, startedAt, endedAt})` fragt alle 7 live-verifizierten `record_type`s gegen `GET /v2/detail_records` ab (`filter[record_type]` + `page[size]=250`), prüft jeden Roh-Record client-seitig gegen Währung (`config.billing.providerCurrency`, case-insensitiv), Leg-ID, Zeitfenster, Kosten-Parsebarkeit; wirft nie (Ergebnis-Objekt `{ok, records|reason}`); kein Teil-Erfolg bei einem fehlgeschlagenen Typ; volle Seite → `page_truncated` statt stiller Untermenge.
- `src/telephony/ports.js` — nur JSDoc/Typedefs, keine Laufzeitänderung.
- `src/config.js` — neues Feld `providerCurrency` (Default `USD`, Namespace `billing`).
- `.env.example`, `render.yaml`, `test/helpers.js` — `PROVIDER_CURRENCY` dokumentiert/nachgezogen.
- `test/config-namespaces.test.js` — gepinnte Config-Key-Counts nachgezogen (billing 18→19, gesamt 106→107, primitive Blätter 99→100; mechanische Konsequenz der neuen `providerCurrency`-Zeile, keine Verhaltensänderung).

**Testergebnis:** `npm test` 2677/0 (Baseline 2638 + 39 neue Tests, keine Regression laut Impl-Report).

**Clean-Code-Selbstprüfung des Implementierers:** G5 (keine Duplizierung), G25/G26 (keine Magic Numbers außer 0/1/-1, Geld nie als Float — grep bestätigt 0× `parseFloat`, genau 2× `Number(` auf längengeprüften reinen Ziffernstrings), G30/G34 (eine Aufgabe je Funktion), F1 (≤3 Argumente, Optionsobjekte), Nesting ≤3, G31 (Ergebnis-Objekt statt nackter Zahl), C5/G9 (kein toter/auskommentierter Code), G12 (keine ungenutzten Imports/Parameter). Während der Selbstprüfung ein Kommentar-Wiring-Fehler (falscher Funktionsverweis, C2) gefunden und korrigiert; ein nested Ternary zugunsten eines if/else aufgelöst (Repo-Konvention).

### 2.1 Deviations (Abweichungen vom Plantext, alle vom Implementierer begründet)

1. **Import-Platzierung:** Der Import von `cost-parse.js` liegt (anders als im Plan-Codebeispiel, das ihn nach `const SPEAK_ACTION` zeigt) im Kopf-Import-Block bei den übrigen Imports — Konvention im Package (G24), alle Dateien halten Imports oben. Die CDR-Konstanten selbst bleiben wie geplant direkt nach `SPEAK_ACTION`.
2. **`fetchCostRecordPage(recordType)` nimmt einen statt der im Plan skizzierten zwei Parameter** (kein `window`-Argument): Die Zeitfenster-Query-Parameter sind laut Plan selbst UNBELEGT; ein nie gelesener zweiter Parameter wäre ein ungenutztes Argument (G12). Fenster-/Leg-Prüfung läuft vollständig client-seitig in `toCostRecord`, inhaltlich wie vom Plan verlangt.
3. **`RECORD_TIMESTAMP_FIELDS`** (Kandidaten `recorded_at`/`created_at`) ist eine im Plan nicht genannte Konstante für den client-seitigen Zeitfenster-Check, weil der Plan explizit keinen Feldnamen für den Record-Zeitstempel nennt. Fehlt das Feld, wird NICHT verworfen (konservativ, konsistent mit der Behandlung fehlender Leg-Referenzen); in den Plan-Fixtures kommt ohnehin kein Zeitstempelfeld vor.
4. **Testdatei:** Die vom Plan verlangte Kontrollassertion „`0.07 + 0.01 === 0.08` ist in JS falsch" ist faktisch unzutreffend (IEEE754 rundet hier zufällig exakt). Die eigentliche Exaktheits-Zusicherung (`parseDecimalToMicroCents("0.07") + parseDecimalToMicroCents("0.01") === 8000000`) blieb unverändert; die fehlerhafte Kontrollannahme wurde durch das tatsächlich falsche Paar `0.1 + 0.2 !== 0.3` ersetzt.
5. **Companion-Edit `test/config-namespaces.test.js`** war im Plan nicht als betroffene Datei gelistet — `git diff --stat` zeigt daher 9 statt der im Plan genannten 7 Dateien (7 geändert + 2 neu statt 5+2). Ohne diesen mechanischen Nachzug wäre `npm test` mit 2 Failures rot geblieben (Pinned-Count-Test). Reine strukturelle Konsequenz der plan-vorgeschriebenen neuen `providerCurrency`-Zeile, gleiches etablierte Muster wie ein Vorgänger-Commit. Alle übrigen Akzeptanzkriterien aus Plan §8 unverändert erfüllt (kein `src/db/`, `src/store/`, `src/routes/`, `src/billing/`, `src/telephony/registry.js` berührt).

---

## 3. Rot-vor-Fix-Nachweis (wörtliche Fehlermeldungen)

**Stufe 1 — vor jeder Implementierung** (Testdatei angelegt, Quellcode unverändert):

```
node --test test/telnyx-cost-records.test.js
```

Wörtliche Fehlermeldung:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/telephony/adapters/telnyx/cost-parse.js' imported from .../test/telnyx-cost-records.test.js
```

ℹ tests 1 / ℹ pass 0 / ℹ fail 1 (isoliert rot, kein Voll-Last-Flake).

**Stufe 2 — nach `cost-parse.js`, vor der Adapter-Methode `getVoiceCostRecords`:**

Derselbe Befehl. Parser-Tests (a/a2/a3) grün (26 pass), Seam-Tests rot mit:

```
TypeError: telnyxVoice.getVoiceCostRecords is not a function
```

(an jeder Aufrufstelle in den Tests b–g). ℹ tests 38 / ℹ pass 26 / ℹ fail 12 (isoliert rot).

Erst danach wurden `voice.js`, `ports.js`, `config.js` implementiert.

**Unabhängige Reproduktion durch den Safety-Reviewer:** `src/` auf Master-Stand zurückgesetzt + `cost-parse.js` beiseitegelegt → gesamte Testdatei rot (`ERR_MODULE_NOT_FOUND` auf `cost-parse.js`), 0 pass / 1 fail. Danach `git reset --hard`, Worktree sauber. Damit ist Stufe 1 unabhängig reproduziert (nicht nur vom Implementierer berichtet).

**Flake-Protokoll (Plan-Vorgabe):** ein roter Test zählt nur, wenn er isoliert (`node --test test/<datei>.test.js`) ebenfalls rot ist — der vorbestehende ~12-%-Voll-Last-Flake (Seed-vor-Boot-Race) wird nie als Befund dieser Phase gewertet.

---

## 4. Safety-Urteil (final)

**Verdikt: FREIGEGEBEN (approved).**

Alle geprüften Achsen positiv: Tests unabhängig reproduziert, Rot-vor-Fix glaubwürdig, Safety-Gates unangetastet, Offenlegungssatz unangetastet, kein Fail-open-Pfad, kein Float auf dem Geld-Pfad, Einheiten-Faktor korrekt, Auth fail-closed unangetastet, keine Secrets geleakt, Verhalten wie beabsichtigt, Scope eingehalten.

**Unabhängiger Testlauf des Reviewers:** Volle Suite (`npm test`, eigener Worktree): 2677 Tests, 2676 pass / 1 fail (165 s). Der eine rote Test — `test/outbound-reconcile-finishcall.test.js:51` ("Outbound Inland: Minuten × Inlandstarif gebucht", `actual 0 !== expected 100`) — isoliert 9× nachgefahren: 1× rot, 8× grün (~11 %), deckt sich mit dem dokumentierten ~12-%-Voll-Last-Flake (Seed-vor-Boot-Race). Diff berührt weder `metering.js` noch `call-finish.js` noch `outbound-gates.js` (per `git diff --name-only` verifiziert) — kein Kausalpfad vom P1-Diff zu diesem Test. Master-Gegenprobe im selben Worktree war nicht möglich (master war im Haupt-Worktree ausgecheckt); Zuordnung daher über Nicht-Berührung + Nicht-Determinismus, nicht über einen Master-Vergleichslauf.

Neue Testdatei `test/telnyx-cost-records.test.js` isoliert: 39/39 grün. Parser-Arithmetik unabhängig nachgerechnet (Formel `shift = 8 - fracLength + exponent`), Stichprobe deckt sich mit dem Plan.

### 4.1 Concerns (keine Blocker, aber vor P3 zu klären)

1. **Silente Seiten-Kappung:** `fetchCostRecordPage` sendet nur `filter[record_type]` + `page[size]=250` und erkennt Überlauf allein an `raw.length === 250`. Kappt Telnyx `page[size]` serverseitig auf einen kleineren Wert, feuert der `page_truncated`-Riegel nie und es entsteht lautlos eine Teilmenge. Verschärfend: kein serverseitiger Leg- oder Zeitfilter (Parameternamen laut Plan unbelegt) — die Abfrage holt die N jüngsten Records kontoweit und filtert erst clientseitig. Bei Volumen kann eine Teilerfassung innerhalb eines `record_type` auftreten → Summe zu niedrig → in P4 eine Korrektur in Rückerstattungsrichtung, ohne dass das Vollständigkeits-Prädikat anschlägt. In P1 folgenlos (Seam inert), aber **vor dem ersten Aufrufer in P3 zu klären**: `page[size]`-Obergrenze + Sortierreihenfolge empirisch belegen, über `meta`/`page_number` paginieren statt über Längengleichheit.
2. **Kein Request-Timeout:** `fetch` in `fetchCostRecordPage` läuft ohne `AbortSignal`/Deadline. Ein hängendes Provider-Socket blockiert den `await` unbegrenzt. Kein Fail-open zu 0, repo-konform (ein `fetchWithTimeout`-Helfer existiert nirgends in `src/`, dort als bewusst offene Schuld geführt), in P1 ohne Aufrufer folgenlos. **Gehört vor P3 gesetzt**, sonst hängt der Cost-Truing-Job.
3. **Port-Vertrag „WIRFT NIE" nicht vollständig gehalten:** `toCostRecord` greift ungeschützt auf `raw.currency` zu. Liefert der Provider ein Nicht-Objekt im `data`-Array (z. B. `data:[null]`), fliegt ein `TypeError` aus `getVoiceCostRecords` — außerhalb des `try` in `fetchCostRecordPage`. Richtung ist fail-closed (Wurf = keine Records = keine Korrektur = Schätzung bleibt stehen), aber der im Port dokumentierte Vertrag ist verletzt und kein Test deckt den Fall ab.
4. **`+0.01` wird verworfen** (Vorzeichen wird immer mitgelesen, jedes Vorzeichen → `null`). Strenger als das Plan-Akzeptanzkriterium, im Code und Test als bewusste Design-Entscheidung begründet („nie beobachtet") und fail-closed. Nur als Abweichung notiert, kein Mangel.
5. **Bei durchgehendem Währungs-Mismatch liefert der Seam `ok:true` mit `records:[]`** (Test (d) pinnt das). Die Typ-Trennung „gemessen 0" vs. „nicht gemessen" hält (`ok:false` trägt nie `records`), aber die Unterscheidung „leere Menge weil nichts gefunden" vs. „leere Menge weil alles verworfen" liegt nur im Log-Zähler, nicht im Rückgabetyp. P4 muss das über `COST_TRUING_REQUIRED_RECORD_TYPES` abfangen — im Plan so vorgesehen, hier nur als Übergabepunkt festgehalten.

---

## 5. Clean-Code-Audit (final)

**Verdikt: PASS — keine S1/S2-Befunde. Kein Blocker.**

> „P1 ist ein sauberer, disziplinierter Vertical Slice exakt im Rahmen des Plans (CDR-Seam am Telnyx-Voice-Port, optional am Port, kein Aufrufer). Money-Handling ist strikt G26-konform, der 10^8-Faktor/die 8 Nachkommastellen sind wie explizit gefordert aus vorhandenen Konstanten abgeleitet statt hartcodiert."

**S1 (Blocker):** keine.
**S2 (schwerwiegend):** keine.

**S3 (Politur, kein Blocker):**
1. `cost-parse.js:91-94` — Kommentar „Erlaubter Exponentbereich. Beobachtet: -7 bis -4" steht direkt über `COST_EXPONENT_MIN=-12`/`COST_EXPONENT_MAX=6`; liest sich wie ein Widerspruch statt einer bewussten Marge. Empfehlung: Kommentar präzisieren („Beobachtet -7..-4; Grenzen bewusst weiter gefasst als Sicherheitsmarge, nicht als beobachtete Spanne").
2. `voice.js:246-248` (`toCostRecord`) — Grund `currency_mismatch` deckt sowohl fehlende als auch tatsächlich abweichende Währung ab; in den PII-freien Rejection-Logs später nicht mehr unterscheidbar. Empfehlung: `currency_missing` vs. `currency_mismatch` auftrennen.

**S4 (Kosmetik):** keine.

**Geprüfte Kategorien laut Audit:** Magic-Number-Prüfpunkt (10^8-Faktor zusammengesetzt, `MICRO_CENT_DECIMALS` aus dem Faktor abgeleitet statt zweite 8), G26 (Geld nie als Float — manuell gegen alle 9 Positiv- und 12 Negativ-Testfälle nachgerechnet), Verschachtelung/Funktionslänge/Argumente durchweg im Zielbereich (tiefste Verschachtelung 3, Limit 4), G31 (Ergebnis-Objekt, nie nackte Zahl, kein Teil-Erfolg), keine toten Schalter, keine Umlaute in neuen Kommentaren, Secrets-frei, Kein-Aufrufer-Riegel strukturell getestet (nicht nur behauptet), S2-Duplikations-Check gegen bestehende Mikro-Cent-Buchhaltung in `store/state-ops.js` negativ (unterschiedliche Zuständigkeit: Akkumulation vs. String→Ganzzahl-Parsing, gemeinsame benannte Konstanten statt Duplikat).

**Top-Todos aus dem Audit:**
- Kommentar in `cost-parse.js` (~Zeile 91) präzisieren (siehe S3-1).
- `currency_mismatch` in `toCostRecord` auftrennen, bevor P3 auf den Ablehnungsgründen aufbaut (siehe S3-2).
- Prozess-Hinweis (nicht aus dem Diff entscheidbar): Live-Verifikation des 10^8-Faktors gegen einen echten `detail_records`-Aufruf ist laut Plan Abnahmebedingung vor P2 — im Phasen-Report belegen, falls noch nicht geschehen (siehe Abschnitt 7 „Offen").

---

## 6. Fix-Runden

**Keine Fix-Runde erforderlich.** Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf auf PASS/FREIGEGEBEN; der `FIXES`-Abschnitt der Quelle ist leer. Die vier Safety-Concerns und zwei Clean-Code-S3-Punkte wurden als „vor P3 zu klären" bzw. „Politur" eingestuft, nicht als Blocker dieser Phase — kein Self-Fix-Zyklus ausgelöst.

---

## 7. OFFEN

- **Live-Verifikation der Einheit macht der Lead.** Plan §8 Punkt 9 verlangt, dass die Abnahmebedingung „Einheit live belegt" (10^8-Faktor gegen einen echten `GET /v2/detail_records`-Aufruf) im Phasen-Report dokumentiert ist, bevor P2 startet. Die Messung vom 2026-07-20 (`sip-trunking` rate `0.0401` / cost `0.0802` bei `billed_sec 120`, `currency USD` → `8020000` Mikro-Cent = 8,02 Cent = 2 × 4,01 Cent/min) liegt als historische Messung vor und ist im Testfall (a2/Ende-zu-Ende-Riegel) gepinnt; ein **frischer** Live-Aufruf gegen den echten Telnyx-Endpunkt als Abnahmenachweis für diese Phase steht laut Clean-Code-Audit-Prozesshinweis noch aus und ist vom Lead durchzuführen.
- Vor dem ersten Aufrufer in P3: `page[size]`-Obergrenze/Sortierreihenfolge von `/v2/detail_records` empirisch belegen (Concern 1) und Request-Timeout ergänzen (Concern 2).
- S3-Politur aus dem Clean-Code-Audit (Exponent-Kommentar, `currency_mismatch`-Auftrennung) — optional vor P3.

---

## Anhang: Quellenhinweis zu personenbezogenen Daten

Die Quelltexte (Plan, Impl-Report, Safety-Urteil, Clean-Code-Audit) wurden vor dem Schreiben dieses Reports auf personenbezogene Daten geprüft (Telefonnummern, Namen, E-Mail-Adressen, Kunden-IDs). Es wurden keine Kundendaten gefunden. Lokale Dateisystempfade in den wörtlichen Fehlermeldungen (Rot-vor-Fix-Nachweis) enthalten den Benutzernamen des Repo-Betreibers auf dessen eigener Entwicklungsmaschine — keine Daten Dritter — und wurden aus technischer Genauigkeit unverändert übernommen.
