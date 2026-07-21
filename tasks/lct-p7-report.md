# Phase-Report: P7 — Fixkosten sichtbar machen (ElevenLabs-Wand, DID-Miete)

**Plan-Quelle:** PLAN-LIVE-COST-TRACING.md (Owner-Entscheidungen bereits getroffen), eigenständiger Phasenplan „Umsetzungsplan P7 — Fixkosten sichtbar machen"
**Umfang:** Ein globaler, nicht-tenant-scoped ElevenLabs-Zeichenzähler plus ein reiner Anzeige-Endpunkt für Fixkosten (ElevenLabs-Kontingent + DID-Listenmiete). Reine Sichtbarkeit: kein Gate, keine Reserve, keine Buchung ändert sich.
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p7-fixed-costs-visible-fix3`
**headCommit (feat, vor Fix-Runden):** `d162d7be1c708fdc6b1721c384c1aaf3dfc383b0` (Kurzform `d162d7b`, Branch `phase/lct-p7-fixed-costs-visible`)
**Basis:** `master @ e964c4c` (nach LCT P1–P6)
**Datum:** 2026-07-20/21

---

## 1. Plan (gekürzt)

### 1.1 Vorab-Feststellungen (bindend vor jedem Edit)

**(A) `public/index.html` existiert nicht.** `ls public/` liefert nur `brand/`, `favicon.ico`, `tenant.html` — gelöscht in der Owner-Removal-Kette (`8dfa98d`), exakt die Feststellung, die bereits P5 traf. Die Plan-Dateiliste nannte `public/index.html` und `src/routes/api-read.js`; beide entfallen für eine Plattform-Aggregation aus demselben Grund wie in P5: `api-read.js`/`tenant.html` liefern tenant-scoped `/api/state` — Fixkosten (ElevenLabs global) und der plattformweite Zeichenzähler dort zu rendern wäre das Cross-Tenant-Leck, das der `usageView`-Riegel verhindert.

**Anzeige-Pfad-Entscheidung: `GET /api/billing/platform-costs` in `src/routes/api-billing.js`** — dieselbe Datei, dieselbe `/api/*`-Basic-Auth und dieselbe Nicht-Tenant-Scoping-Begründung wie das von P5 dort angelegte `GET /api/billing/cost-drift`. PII-frei: nur Cent-Beträge, ein Nummern-**Zähler** (keine E.164), Zeichenzahl, Zyklus-Schlüssel.

**(B) Scope-Grenze des Zählers.** `synthesizeSpeech` (`src/tts/synth.js`) wird ausschließlich von `src/tts/directive-synth.js` aufgerufen (grep-bestätigt) — der Play-TTS-Vorab-Synthese-Pfad, der gegen das eigene ElevenLabs-Kontingent läuft (die Wand aus Entscheidung 7). Der separate `telnyxElevenLabs`-Relay-Pfad läuft nicht durch `synthesizeSpeech` und wird bewusst NICHT gezählt (andere Abrechnung).

**(C) `synth.js` bleibt unangetastet.** Reine, IO-injizierte Funktion (DIP wie `llm.js`); „Text bekannt + `result.ok`" ist bereits eine Ebene höher in `directive-synth.synthToServeUrl` gegeben. Die Verbuchung gehört dorthin — `synth.js` rein zu halten ist die clean-code-korrekte Wahl.

### 1.2 Schema + Env-Variablen

Neue, **nicht-tenant-scoped** Singleton-Tabelle `platform_tts_usage` (Muster `profile`/`profile_global`: `id CHECK(id=1)`, RLS `USING(true)`), Spalten `cycle_key`, `characters BIGINT`, `warned_cycle` — persistiert (Free-Tier-Dyno startet häufig neu, dieselbe Begründung wie `costTruingAttempts` in P2).

Fünf neue Env-Variablen (`config.js`/`billing`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV):

| Env-Var | Default | Einheit | Zweck |
|---|---|---|---|
| `TTS_CHARACTER_QUOTA` | `39981` | Zeichen | belegtes ElevenLabs-Starter-Kontingent |
| `TTS_CHARACTER_QUOTA_WARN_PERCENT` | `75` | 0–100 | Warnschwelle |
| `TTS_QUOTA_CYCLE_ANCHOR_DAY` | `3` | Tag-im-Monat | Reset-Anker = ElevenLabs-Zyklus (**nicht** Kalendermonat) |
| `PLATFORM_FIXED_COST_CENTS_PER_MONTH` | `600` | EUR-Cent | ElevenLabs-Fixkosten (Anzeige) |
| `NUMBER_MONTHLY_COST_CENTS` | `92` | EUR-Cent | DID-Listenpreis (Anzeige, Entscheidung 6) |

`TTS_QUOTA_CYCLE_ANCHOR_DAY` ist eine notwendige Folge aus Entscheidungspunkt 4 (Reset-Anker ≠ Kalendermonat), nicht Scope-Drift — als Magic Number wäre der Anker-Tag sonst ein nacktes Literal (G25) und ein tief vergrabener Konfigurationswert (G35). Doku-Kommentar in `config.js`: „Listenpreis, nicht Rechnungsposten. Reine Anzeige, NIE ein Gate."

### 1.3 Exakte Edits (Kernpunkte)

- **`src/store/defaults.js`**: `emptyPlatformTtsUsage()` — `{ cycleKey: null, characters: 0, warnedCycle: null }`.
- **`src/store/state-ops.js`**:
  - **Riegel-Reuse (G5/S2, Kern-Auflage des Auftrags):** der generische Monotonie-/Zukunftsschlüssel-Kern wird aus `authoritativeSpendMonthKey` als `laterMonotonicKey(storedKey, nowKey)` extrahiert; `authoritativeSpendMonthKey` delegiert unverändert. Einziger Berührungspunkt mit gemeinsamem Safety-Code.
  - `ttsCycleKeyOf(nowIso, anchorDay)` — reine, zeit-freie Funktion; ab `anchorDay` läuft der aktuelle Monat als Schlüssel, davor der Vormonat → Reset fällt auf den Zyklus-Tag, nicht den Monatsersten.
  - `recordTtsCharacters(s, chars, cfg, nowIso)` — verbucht Zeichen, meldet die Warnschwelle genau einmal je Zyklus (Muster `claimPlatformSpendWarning`), Ganzzahl-Arithmetik durchweg, wiederverwendet `PERCENT_SCALE`.
  - `platformTtsUsageView(s, cfg, nowIso)` — reine Leseprojektion für den Anzeige-Endpunkt.
- **`src/store/json.js` / `pg.js`**: `platformTtsUsage` NICHT in die Ephemeral-Strip-Liste aufnehmen (persistiert, wie `spendMonthKey`); `hydratePlatformTtsUsage`/`flushPlatformTtsUsage` nach dem Muster `hydrateProfiles`/`flushProfiles`, global außerhalb der Tenant-Schleife.
- **`src/tts/directive-synth.js`**: `makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning })` — Zählung **nach** dem `result.ok`-Check in `synthToServeUrl`; Fehlerpfad/`<Say>`-Fallback zählt nicht. Kein `await` auf den SMS-Versand (Webhook-Pfad darf nie blockieren).
- **`src/server.js`**: `onTtsQuotaWarning` verdrahtet über den bestehenden P5-Alarmkanal `sendFailSoftAlertSms` (Audit + Fail-soft-SMS, Empfänger-Riegel/Absender-Auflösung bereits in `alert-sms.js`, Ziel nie geloggt).
- **`src/routes/api-billing.js`**: `GET /api/billing/platform-costs` — `didRentCents = numberMonthlyCostCents × aktive Nummern`, `fixedCostCentsPerMonth = platformFixedCostCentsPerMonth + didRentCents`, plus `ttsQuota`-View. Hinter `/api/*`-Basic-Auth, PII-frei, `listPriceNotBilled: true` markiert.

### 1.4 Rot-vor-Fix-Reihenfolge (verbindlich)

1. `test/tts-quota-counter.test.js` zuerst vollständig schreiben, gegen unveränderten Bestand fahren → rot (Modul-/Export-Fehler).
2. Implementieren bis grün.
3. `node --check` auf allen berührten `src/**`-Dateien.
4. Volle Suite `npm test`, fail-closed.
5. Riegel-Extraktions-Beweis: bestehende Spend-Monat-/Budget-Tests bleiben byte-grün.
6. Smoke: Server booten, `curl /api/billing/platform-costs`, `curl /healthz` = 200.

### 1.5 Nicht-Ziele

`src/tts/synth.js` bleibt rein; `public/index.html` existiert nicht; `src/routes/api-read.js`, `metering.js`, `outbound-gates.js` und alle Gate-Pfade werden nicht berührt. Dass ein einzelner Tenant das globale Kontingent aufbrauchen kann, wird nur **sichtbar**, nicht behoben — Folgearbeit, nicht P7.

---

## 2. Implementierungs-Zusammenfassung

Plan exakt umgesetzt auf Branch `phase/lct-p7-fixed-costs-visible`, HEAD `d162d7b`, nach drei Fix-Runden überführt auf `phase/lct-p7-fixed-costs-visible-fix3`.

**Neu:** `test/tts-quota-counter.test.js` (16 Tests: Ops-Ebene a/c/d/e/f/g/h/h2/i, json+pg-Fassaden-Roundtrip j1–j4, directive-synth b1–b3).
**Editiert:** `.env.example`, `render.yaml`, `src/config.js`, `src/db/schema.sql`, `src/routes/api-billing.js`, `src/server.js`, `src/store.js`, `src/store/defaults.js`, `src/store/json.js`, `src/store/pg.js`, `src/store/state-ops.js`, `src/store/views.js`, `src/tts/directive-synth.js`, `test/config-money-manifest.test.js`, `test/config-namespaces.test.js`, `test/directive-synth.test.js`, `test/helpers.js`.

Volle Suite laut Impl-Report: **2840/2840 grün** vor Fix-Runden; nach Fix-Runden (Safety-Review) unabhängig gegengelaufen: **2852/2852 grün**, ~83 s. Der einzige beobachtete Ausreißer (ein Lauf, `test/telnyx-event-ingest-route.test.js`) ist der dokumentierte vorbestehende ~12-%-Voll-Last-Flake — isoliert und im nächsten Volllauf grün, keine Regression.

### 2.1 Deviations (vom Implementierer selbst benannt)

1. **Anzeige-Pfad wie in Abschnitt 1.1 des Plans selbst schon vorweggenommen:** `public/index.html` und `src/routes/api-read.js` entfallen; Anzeige-Pfad ist `src/routes/api-billing.js` → `GET /api/billing/platform-costs`.
2. **`src/tts/synth.js` unverändert (0 Zeilen)** — bleibt rein (DIP), wie im Plan vorhergesehen; die Plan-Dateiliste nannte `synth.js`, faktischer Edit ist null.
3. **Test-Seam für „Fehlschlag zählt nicht" (b1–b3):** `synthesizeSpeech` ist ein harter Import in `directive-synth.js` (kein injizierter Port), kein eigenständiges Fake-`synthesizeSpeech` möglich. Der tatsächliche Seam ist `fetchImpl`/`globalThis.fetch`, das bestehende Muster aus `test/directive-synth.test.js`. Ergebnis (Erfolg zählt, Fehlschlag zählt nicht) ist identisch zum Plan-Ziel.
4. **Zwei vorbestehende Struktur-/Manifest-Tests aktualisiert** (etabliertes Muster jeder vorherigen Phase): `test/config-namespaces.test.js` (billing 31→36, Gesamt 119→124, Setter-Durchschlag 111→116) und `test/config-money-manifest.test.js` (`MONEY_CONFIG_KEYS` um `numberMonthlyCostCents` + `platformFixedCostCentsPerMonth` ergänzt — Letzteres trägt kein Cents-Suffix am Wortende und wäre vom Namens-Scan nicht automatisch erzwungen worden, Präzedenzfall `voiceCapRateCentsPerMin` erlaubt das; bewusst manuell eingetragen). Beides sind Struktur-Tests, keine Gates.
5. **`test/directive-synth.test.js`:** alle 5 Bestandstests brauchten `store`/`onQuotaWarning`-Fakes, weil `makeDirectiveSynth()` seit P7 diese Abhängigkeiten verlangt; Assertions selbst unverändert (`<Play>`-Verdrahtung byte-identisch).
6. **`TTS_QUOTA_CYCLE_ANCHOR_DAY` erhielt eine Ober-/Untergrenze** (`numEnv` min:1, max:28) — im Plan nicht explizit spezifiziert, aus G26 und dem Anker-Zweck abgeleitet (jenseits 28 wäre der Anker im Februar nie erreichbar).
7. **`countActiveNumbers(s)` neu in `src/store/views.js`** ergänzt — der Plan sah dies als möglich nötig voraus („Falls eine solche Zählung noch nicht existiert, minimal ergänzen"); reiner Zähler, PII-frei.
8. **`resolveBootstrapAlertSender` zunächst NICHT aus `cost-truing.js` extrahiert** — inline-Variante in `server.js` gewählt (kleinerer Blast-Radius, im Plan als akzeptable Option genannt). In Fix-Runde 1 (siehe §7) doch als G5-Blocker aufgegriffen und extrahiert.

---

## 3. Rot-vor-Fix-Nachweis

`test/tts-quota-counter.test.js` gegen den unveränderten Bestand (`master @ e964c4c`) gefahren, vor jeder Implementierungszeile:

```
SyntaxError: The requested module '../src/store/state-ops.js' does not provide an export named 'platformTtsUsageView'
```

Nach Teil-Implementierung traten sukzessive weitere rote Fehler auf, bis die Fassaden vollständig ergänzt waren:

```
TypeError: mod.recordTtsCharacters is not a function
TypeError: store.platformTtsUsageView is not a function
```

— jeweils solange `json.js`/`pg.js`/`store.js` die neuen Fassaden-Methoden noch nicht bereitstellten. Nach vollständiger Implementierung: Datei einzeln grün, danach volle Suite grün (2840/2840, später 2852/2852 nach Fix-Runden).

---

## 4. Die harten Zusagen — jede mit Beleg

| Zusage | Beleg |
|---|---|
| **Nur `result.ok` zählt** | `synthToServeUrl` verbucht `store.recordTtsCharacters(...)` erst **nach** dem `result.ok`-Check; der Fehlerpfad kehrt vorher mit `<Say>`-Fallback zurück, ohne den Store zu berühren. Test (b): Fake-`fetch` liefert zuerst `{ok:false}` → Zähler unverändert, Fallback greift; zweiter Aufruf mit Erfolg → zählt. Safety-Review bestätigt „Fehler/Azure-Fallback zählen nie" als eigenständigen, grünen Testfall (b1). |
| **Zähler nicht tenant-scoped** | Eigene Singleton-Tabelle `platform_tts_usage` (`id CHECK(id=1)`), RLS-Policy `USING(true)`/`WITH CHECK(true)` nach dem Muster `profile_global` — kein `app.current_tenant`-Filter, kein Bezug zu `call`/`usage`. Endpunkt-Antwort trägt keine Tenant-ID. Safety-Review: „Der ElevenLabs-Zeichenzähler ist global/nicht-tenant-scoped (Singleton-Tabelle id=1, Policy USING(true))". |
| **Zyklus-Anker statt Kalendermonat** | `ttsCycleKeyOf(nowIso, anchorDay)`: vor dem Ankertag läuft der Schlüssel als Vormonat weiter. Test (d): Zeile auf Zyklus `2026-08` gestempelt, `nowIso = 2026-09-02` (Tag 2 < Anker 3) → weiterhin `2026-08`, kein Reset, Zeichen akkumulieren. Test (g): `nowIso = 2026-09-03` (Tag == Anker) → neuer Zyklus `2026-09`, Reset. Beide Fälle grün. |
| **Zukunfts-Schlüssel löst keinen Reset aus** | `laterMonotonicKey(storedKey, nowKey)` — derselbe Riegel-Kern wie bei der Budget-Spend-Monat-Achse (aus `authoritativeSpendMonthKey` extrahiert, nicht kopiert). Test (e): Zeile vorab auf einen zukünftigen Zyklus-Schlüssel + Zeichen gestempelt, Aufruf mit früherer `nowIso` → Zukunftsschlüssel bleibt, keine Löschung. Test (h): unlesbare Uhr (`"kaputt"`) bei `cycleKey === null` → No-Op, kein Phantom-Zähler. |
| **Genau eine Warnung je Zyklus** | `warnedCycle` (persistiert) verhindert eine zweite Meldung im selben Zyklus. Test (c): Quota z. B. 1000, Warn 75 % — erster überschreitender Aufruf liefert `warning != null`, alle weiteren im selben Zyklus `null`. Safety-Review pinnt: „warnt genau einmal je Zyklus (warnedCycle-Riegel, Test c)". |
| **Fixkosten reine Anzeige, kein Gate-Wechsel** | `GET /api/billing/platform-costs` liest nur, mutiert nichts; kein Aufrufer der neuen Größen in `outbound-gates.js`/`metering.js`/den Gate-Pfaden von `state-ops.js` (grep leer). Test (f): ein Reserve-/Budget-Gate-Aufruf liefert vor und nach beliebig vielen `recordTtsCharacters`-Aufrufen byte-identisch dasselbe Ergebnis (`globalBudgetExceeded` unverändert). Antwort trägt `listPriceNotBilled: true`. Cleancode-Audit: „Route liegt hinter Basic-Auth, Response PII-frei (per Test explizit bewiesen) ... die Route ist ausdrücklich 'reine Anzeige, nie ein Gate' — durch Test (f) bewiesen." |

---

## 5. Safety-Urteil (final)

**FREIGABE (APPROVED).** Auszug aus dem unabhängigen Review-Verdikt:

> „P7 ist eine saubere reine-Anzeige-Phase. Der ElevenLabs-Zeichenzähler ist global/nicht-tenant-scoped ..., zählt ausschließlich bei `result.ok` ..., warnt genau einmal je Zyklus ..., ankert am ElevenLabs-Zyklus-Tag statt am Kalendermonatsersten ... und ist gegen Uhr-Anomalien/Zukunftsschlüssel über `laterMonotonicKey` fail-closed. KEIN Gate/Reserve/Buchung liest den Zähler oder `PLATFORM_FIXED_COST_CENTS_PER_MONTH`/`NUMBER_MONTHLY_COST_CENTS`."

Unabhängiger Testlauf: json-Backend Volle Suite **2852/2852 grün** (~83 s); die vier P7-Testdateien isoliert **41/41 grün**. pg-Backend-Lauf (`STORE_BACKEND=pg`) zeigte 42 Fehlschläge — alle mit `[store] FATAL: pg-Backend nicht initialisierbar / DB unerreichbar` (kein Postgres im Worktree verfügbar) plus kaskadierten Server-Spawn-Fehlern; **keiner davon ein P7-Test**, reine Infrastruktur. `node --check` auf allen 12 geänderten Quelldateien sauber.

Geprüft und bestanden: `testsPassIndependently`, `redBeforeFixCredible`, `safetyGatesIntact`, `disclosureIntact`, `noGateBehaviorChange`, `countsOnlyOnOk`, `fallbackDoesNotCount`, `counterNotTenantScoped`, `cycleAnchorCorrect`, `futureKeyNoReset`, `oneWarnNotPerCall`, `fixedCostDisplayOnly`, `noFailOpenPath`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **Keine Blocker.**

### Concerns (kein Blocker, dokumentiert)

1. **Robustheit (nicht-blockierend):** Der Inbound-Fehlerpfad `voice.js:289` ruft `synthesizeDirectiveAudio` erneut auf, ohne eigenes try/catch. P7 fügt `store.recordTtsCharacters` (unter pg ein DB-Write mit `save()`) als neue Wurf-Quelle in `synthToServeUrl` ein. Ein enger Doppelfehler (erster Synth bereits im catch, ElevenLabs liefert `ok`, Store wirft deterministisch) könnte für genau einen Inbound-Call eine `unhandledRejection` statt XML erzeugen. Rein anzeige-relevant: kein Gate/keine Offenlegung/kein PII betroffen; der dominante Happy-Path wird vom Handler-try/catch (`voice.js:219–291`) vollständig aufgefangen und fällt sauber auf Azure-`<Say>` zurück.
2. **Scope-Hinweis (akzeptabel):** Zwei G5-Konsolidierungen außerhalb der reinen P7-Neubauten — Extraktion von `sendBootstrapAlertSms`/`resolveBootstrapAlertSender` (`alert-sms.js`, geteilt mit dem LCT-P5-Drift-Wächter) und `laterMonotonicKey` (`state-ops.js`, geteilt mit der Spend-Monat-Achse). Beide dienen direkt P7 (gemeinsamer Alarmkanal, gemeinsamer Monotonie-Riegel), sind verhaltens-erhaltend und durch neue Tests gepinnt; P5-Drift-Verhalten (Bootstrap-Absender, Empfänger-Riegel, Ziel nie geloggt) bleibt identisch.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS — kein Blocker.** „Sauberer, gut fokussierter Diff. Beide vom Auftrag hervorgehobenen Duplizierungs-Risiken (Monats-Fortschreibung, Monotonie-Riegel, Prozent-Schwelle, Bootstrap-Alarm-Versand) wurden korrekt ALS Refactor gelöst statt kopiert. Alle geforderten Magic Numbers sind benannte, konfigurierbare Config-Werte. Volle Suite grün (2852/2852)."

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend, im Fix-Zyklus adressiert — siehe §7):**
  - C2 · `src/config.js` (Kommentar bei `platformFixedCostCentsPerMonth`) — der Block-Kommentar versprach generell „USD-Beträge sind vorab mit 0,92 umgerechnet"; der Feld-Kommentar „belegt: 6,00 USD/Monat → 600 EUR-Cent" wendete diese 0,92-Umrechnung faktisch NICHT an (6,00 × 0,92 wäre 552, nicht 600), während `numberMonthlyCostCents` daneben die 0,92-Regel korrekt befolgt. Die Zahl 600 selbst ist eine bewusste Owner-Entscheidung (Plan, Entscheidung 6/D7), nur der Kommentar suggerierte eine nicht stattfindende FX-Herleitung.
  - S4 · `src/store/state-ops.js:1686` (`laterMonotonicKey`) — als `export` markiert, aber außerhalb des Moduls von keiner Quelle importiert (beide Aufrufer sitzen in derselben Datei). Unnötiger öffentlicher Export ohne externen Konsumenten.
- **S4:** keine.

**Pass-Notizen (Auszug):** Beide explizit angeforderten Prüfpunkte bestanden: (1) Monats-Fortschreibung/Monotonie-Riegel wurde nicht kopiert, sondern sauber extrahiert — `laterMonotonicKey` ist jetzt die eine Quelle für beide periodischen Achsen (Spend-Monat P4 und ElevenLabs-Zyklus P7); ebenso eine gemeinsame Prozent-Schwellen-Regel für `claimPlatformSpendWarning` und `recordTtsCharacters`. (2) Alle vier genannten Magic-Number-Kandidaten (Quota 39981, Warn-Prozent 75, Fixkosten 600, DID-Miete 92) sind benannte, per `numEnv` mit min/max validierte Config-Felder, in `.env.example` und `render.yaml` dokumentiert. Zusätzlich wurde die vorbestehende Duplizierung des Bootstrap-Alarm-Versands (`cost-truing.js` vs. neuer TTS-Warn-Pfad) in einen gemeinsamen Baustein zusammengeführt — ein G5-Plus über den Auftragsumfang hinaus. Keine Funktion > 100 Zeilen, keine Verschachtelung > 2, keine toten Schalter, keine Umlaute in Kommentaren, keine Money-als-Float-Stellen. RLS-Policy für die neue Singleton-Tabelle konsistent zum Muster `profile_global`.

---

## 7. Fix-Runden

### Runde 1
Blocker G5 (Sender-Resolver-Duplikation) behoben. Die inline `resolveSender: () => findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID) || null` in `server.js` (`onTtsQuotaWarning`, LCT P7) und die benannte `resolveDriftAlertSender()` in `cost-truing.js` (LCT P5) waren zwei nicht-byte-identische Implementierungen derselben Bootstrap-Absender-Auflösung; extrahiert und von beiden Konsumenten geteilt.

### Runde 2
Alle 5 P7-Review-Blocker sauber und minimal behoben, keiner als falsch verworfen. Unter anderem: (1) T1/S1 — neue Datei `test/api-platform-costs.test.js` als Pendant zu `api-cost-drift`; Spawn-HTTP-Test prüft Response-Form, beide Cent-Rechnungen (`didRentCents = numberMonthlyCostCents × activeNumbers`, `fixedCostCentsPerMonth`) und Auth-fail-closed.

### Runde 3
G5 (S2) behoben: Die wörtlich duplizierte Monats-Fortschreibung (Parse+Guard `new Date(nowIso)`/`Number.isNaN(getTime())` und die Format-Zeile `${getUTCFullYear()}-${padStart(getUTCMonth()+1)}`) zwischen `spendMonthKeyOf` (`state-ops.js:1641`) und dem in dieser Phase neuen `ttsCycleKeyOf` wurde in eine gemeinsame Funktion zusammengeführt.

Nach Runde 3 finaler, freigegebener Stand: `phase/lct-p7-fixed-costs-visible-fix3`.

---

## 8. VOR DEM DEPLOY ZU SETZEN

P7 fügt **fünf** neue Environment-Variablen hinzu. Alle sind reine Anzeigewerte (kein Gate liest sie) und in `.env.example`, `render.yaml` und `test/helpers.js` (BASE_ENV) konsistent nachgezogen.

| Variable | Belegter/erwarteter Wert | Bedeutung |
|---|---|---|
| `TTS_CHARACTER_QUOTA` | **39981** | Belegtes ElevenLabs-Starter-Kontingent (Zeichen). Grundlage für die Warnschwelle und die Anzeige im Endpunkt. |
| `TTS_CHARACTER_QUOTA_WARN_PERCENT` | **75** | Warnschwelle in Prozent des Kontingents. Bei 0 nie eine Warnung (bewusst wie „aus"). |
| `PLATFORM_FIXED_COST_CENTS_PER_MONTH` | **600** (EUR-Cent) | ElevenLabs-Fixkosten, belegt 6,00 USD/Monat — **nominal** als 600 EUR-Cent geführt (Owner-Entscheidung 6/D7, keine 0,92-Kursumrechnung für diese Position; Kommentar-Präzisierung aus dem Clean-Code-Audit siehe §6). Reine Anzeige, kein Rechnungsposten. |
| `NUMBER_MONTHLY_COST_CENTS` | **92** (EUR-Cent) | DID-Listenpreis: 1,00 USD × 0,92-Umrechnungskurs. Reine Anzeige, kein Rechnungsposten. |
| `TTS_QUOTA_CYCLE_ANCHOR_DAY` | **3** (Tag im Monat), belegter Reset-Anker **2026-08-03** | ElevenLabs-Zyklus-Reset-Tag — **nicht** der Kalendermonatserste. Ober-/Untergrenze `numEnv` min:1/max:28 (Fix-Runde-abgeleitet, jenseits 28 im Februar nie erreichbar). |

**Wichtig:** Alle fünf Werte sind reine Anzeige-Konfiguration. Kein Boot-Guard macht sie zur Startvoraussetzung, kein Gate/keine Reserve/keine Buchung liest sie (Test f, §4). Ein falsch gesetzter Wert (z. B. abweichende Quota) verfälscht nur die Anzeige im Endpunkt `GET /api/billing/platform-costs` und die Warnschwelle für die Fail-soft-SMS — niemals einen Money-Pfad.

---

## 9. Deterministisch geprüftes Ergebnis (Zusammenfassung)

- `npm test` grün, 2852/2852 (unabhängig reproduziert nach den drei Fix-Runden).
- `grep` in `outbound-gates.js`/`metering.js`/den Gate-Pfaden von `state-ops.js` liefert keinen Treffer für die neuen Größen — kein Gate liest sie.
- Test (f): `globalBudgetExceeded` byte-identisch vor/nach beliebig vielen `recordTtsCharacters`-Aufrufen.
- `GET /api/billing/platform-costs` hinter `/api/*`-Basic-Auth (401 ohne Credentials), Antwort PII-frei (kein E.164, keine Tenant-ID, kein Secret), `listPriceNotBilled: true`.
- Smoke: Server bootet, `/healthz` = 200, `/api/billing/platform-costs` liefert korrekt gerechnete JSON-Antwort (600 EUR-Cent ElevenLabs + 92 EUR-Cent × 1 aktive Nummer = 692 `fixedCostCentsPerMonth`).
- Riegel-Extraktions-Beweis: bestehende Spend-Monat-/Budget-Tests bleiben byte-grün — Nachweis, dass `laterMonotonicKey` verhaltens-erhaltend extrahiert wurde.
