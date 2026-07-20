# Phase-Report: P5 — Drift-Wächter statt Selbstjustierung

**Plan-Quelle:** PLAN-LIVE-COST-TRACING.md (Owner-Entscheidungen bereits getroffen), eigenständiger Phasenplan `PLAN — LCT P5: Drift-Wächter statt Selbstjustierung`
**Umfang:** Ein reiner Vergleichs-Rechner misst den **Ist**-Minutensatz je Ziel-Präfix (p95 der jüngsten abgeglichenen Calls) gegen den **konfigurierten** Reserve-Tarif und meldet die Abweichung an zwei Stellen (Boot-Log, laufender Sweep). Der Wächter **justiert nichts** — kein Tarif-, Gate- oder Buchungscode wird angefasst. Keine rollende Selbstkalibrierung (Owner-Entscheidung 3).
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p5-drift-watchdog-fix2`
**headCommit (feat, vor Fix-Runden):** `3b1765996d92b929b9ffc28619fb43f7d58e1acd`
**Fix-Runde 1 Commit:** `f673c78`
**Basis:** `master @ 7682dc1` (nach LCT P3)
**Datum:** 2026-07-20

---

## 1. Plan (gekürzt)

### 1.1 Vorab-Korrekturen am Plan-Text (vor der Umsetzung erkannt)

Der Planungstext enthielt drei Annahmen, die der reale Code widerlegte:

| # | Plan sagte | Code sagte | Konsequenz |
|---|---|---|---|
| B1 | Anzeige in `public/index.html` (Owner-Dashboard) | Diese Datei existiert seit der Owner-Removal-Kette nicht mehr; `apps/web` liest nur die Tenant-Sicht `/api/self-service/state` | Anzeige kann nicht ins Owner-HTML |
| B2 | Anzeige „im Owner-Dashboard" | `/api/state` hat einen expliziten Cross-Tenant-Leck-Riegel (usageView darf nichts aus dem globalen Cap/globalen Verbrauch ableiten); ein präfixweites p95 über alle Tenants ist genau so eine Plattform-Aggregation | `/api/state` bleibt unangetastet |
| B3 | `PLATFORM_ALERT_SMS_TO` hat keinen Boot-Guard | Bestätigt (leer in config.js-Fallback, BASE_ENV, `.env.example`, `render.yaml`) | Neuer Guard feuert ab Tag eins in jedem Spawn-Test — gewollt |

Konsequenz aus B1/B2: Statt eines Dashboards bekommt der Report den Platz, den P3 für Plattform-Zahlen bereits etabliert hat — ein neuer Endpunkt `GET /api/billing/cost-drift` neben dem bestehenden Sweep-Endpunkt, hinter derselben `/api/*`-Basic-Auth, PII-frei, plattformweit statt tenant-gescopt.

### 1.2 Neue Datei `src/billing/cost-calibration.js` (rein, zeitfrei, config-frei)

- `measuredCentsPerMinByPrefix(calls, prefix)` — nur **bewiesen vollständig abgeglichene** Calls (`costTruedSource === telnyx_detail_records`) zählen als Stichprobe; `incomplete` ist systematisch zu niedrig und würde sonst künstlich `overestimate` erzeugen.
- Fenster: die jüngsten `DRIFT_SAMPLE_WINDOW = 100` Calls je Präfix (feste Konstante, keine ENV — Begründung: eine zweite Zahl mit fast gleicher Bedeutung wie die Mindest-Stichprobe liefe bei Nachzug auseinander).
- Perzentil: **p95, nicht Mittelwert** (Ganzzahl, Nearest-Rank, keine Interpolation) — der Mittelwert verdünnt genau den ersten teuren Anruf einer neuen Destination; p95 statt Max, damit ein einzelner Ausreißer den Wächter nicht dauerhaft schreien lässt.
- `providerMicroCentsToBucketCents(...)` — die eine Währungskante: PROVIDER-Währung (USD, Mikro-Cent) → BUCKET-Währung (EUR, ganze Cent), **multipliziert** mit `providerToBucketRateMicro`, aufgerundet, mit `Number.isSafeInteger`-Riegel gegen stillen Überlauf.
- Drei Befund-Codes (`TARIFF_DRIFT_FINDING`): `underestimate` (Tarif unter p95 — Reserve deckt den Anruf nicht, **ohne Toleranz**), `overestimate` (Tarif über p95 um mehr als `warnPercent`), `insufficient_samples` (zu wenig Daten — kein Alarm, aber sichtbar).
- `alertableDriftFindings(report)` — die eine Stelle, an der „insufficient_samples alarmiert nicht" als Filter steht, nicht als verstreute Bedingung.

### 1.3 Zwei Auslöser (kein dritter, kein Selbstjustierungs-Pfad)

1. **Boot** (`src/boot.js`) — genau **eine** Log-Zeile für alle Präfixe zusammen (nicht eine je Präfix, gegen WARN-Müdigkeit); `console.warn` nur wenn mindestens ein Befund `code !== null` vorliegt, sonst `console.log`. Kein SMS-Alarm hier (Boot feuert nur einmal je Prozessstart).
2. **Laufender Sweep** (`src/billing/cost-truing.js`, am Ende von `sweepAllCandidates`) — der einzige zeitliche Auslöser, der auch Wochen nach dem letzten Boot noch greift. Entprellung teilt sich **dieselbe** Map wie der bestehende P3-Mechanismus (`shouldEmitFinding`/`lastFindingMs`), nur der Schlüssel wird um den Präfix erweitert (`"<präfix> <code>"`) — bewusst kein zweiter Mechanismus.

### 1.4 Alarmkanal-Guard (`src/boot-guard.js`)

`alertChannelFindings(platformAlertSmsTo)` — WARN, **nie fatal**, wenn `PLATFORM_ALERT_SMS_TO` leer ist: „Plattform-Warnung und Tarif-Drift-Alarm laufen nur ins Audit-Log, es geht KEINE SMS an einen Menschen." Der besetzte Fall liefert `[]` und loggt die Nummer selbst **nie**.

### 1.5 Bewusst nicht angefasst

`src/telephony/outbound-gates.js` (`tariffCentsPerMin` wird von P5 weder importiert noch verändert), `src/store/state-ops.js`, `src/routes/api-read.js` (`/api/state`), `public/`, `apps/web/`, kein neues MCP-Tool.

---

## 2. Implementierungs-Zusammenfassung

Plan exakt umgesetzt auf Branch `phase/lct-p5-drift-waechter`, HEAD `3b17659`, nach Fix-Runde 1 überführt auf `phase/lct-p5-drift-watchdog-fix2` (Commit `f673c78`).

**Neu:** `src/billing/cost-calibration.js`, `test/cost-calibration.test.js`, `test/cost-drift-boot.test.js`.
**Editiert:** `.env.example`, `render.yaml`, `src/billing/cost-truing.js`, `src/billing/metering.js` (nur `voiceMinutesOf` aus dem Factory-Closure auf Modulebene gehoben, Rumpf **byte-identisch** — eine Minuten-Quelle für Stripe-Meter, Budget-Reconcile **und** Drift-Wächter), `src/boot-guard.js`, `src/boot.js`, `src/config.js`, `src/routes/api-billing.js`, `src/server.js`, `test/boot-guard.test.js`, `test/config-namespaces.test.js`, `test/cost-truing-observe.test.js`, `test/helpers.js`.

28 neue Testfälle, alle grün. Volle Suite laut Impl-Report: 2736 pass / 0 fail (ein isolierter Ausreißer in einer von P5 unberührten Datei erwies sich als der dokumentierte vorbestehende ~12-%-Flake). Nach Fix-Runde 1 unabhängig gegengelaufen: **2748 pass / 0 fail**.

### 2.1 Deviations (vom Implementierer selbst benannt)

1. **Branch-Name** `phase/lct-p5-drift-waechter` (deutsch, aus dem Plan-Text) statt `phase/lct-p5-drift-watchdog` — der Plan ist die präzisere/jüngere Quelle.
2. **`test/config-namespaces.test.js` als 5. Testdatei angefasst**, obwohl der Plan von „4 Testdateien" sprach — notwendige, im Plan selbst verlangte Konsequenz (`costCalibrationMinSamples` in `CONFIG_NAMESPACES.billing` aufnehmen), sonst brechen die gepinnten Namespace-Zählwerte (27→28 billing, 115→116 gesamt, 107→108 primitive Blätter).
3. **P5-12-Testassertion präzisiert:** statt eines pauschalen „String `tariffCentsPerMin` darf im Quelltext nirgends stehen" (das der Plan-Text selbst so formulierte) wird konkret geprüft, dass **kein Import-Statement** `tariffCentsPerMin` importiert — der vom Plan vorgegebene Modul-Kopfkommentar nennt den Namen wörtlich, um zu erklären, warum er *nicht* importiert wird; ein Blanket-Substring-Verbot hätte den eigenen Plan-Text durchfallen lassen.
4. **P5-S6 als zwei Tests** (asynchrones Reject vs. synchrones Werfen) statt eines kombinierten Falls — ein Konzept pro Test.

---

## 3. Rot-vor-Fix-Nachweis (wörtliche Fehlermeldungen)

Vier Nachweise, isoliert gegen den unveränderten `master`-Stand gefahren, **vor** jeder Implementierungszeile:

1. `test/cost-calibration.test.js` →
   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/billing/cost-calibration.js' imported from test/cost-calibration.test.js
   ```
2. `test/boot-guard.test.js` →
   ```
   SyntaxError: The requested module '../src/boot-guard.js' does not provide an export named 'ALERT_CHANNEL_FINDING'
   ```
3. `test/cost-truing-observe.test.js` (Fall P5-S1) →
   ```
   AssertionError [ERR_ASSERTION]: genau eine Audit-Meldung ... 0 !== 1
   ```
4. `test/cost-drift-boot.test.js` (Fälle P5-B3, P5-B5) →
   ```
   AssertionError [ERR_ASSERTION]: erwartet genau eine WARN-Zeile ... 0 !== 1
   ```
   bzw.
   ```
   erwartet genau eine Zeile ... 0 !== 1
   ```

Nach Implementierung: alle vier Dateien einzeln grün, danach volle Suite grün.

---

## 4. Die harten Zusagen — jede mit Beleg

| Zusage | Beleg |
|---|---|
| **p95, nicht Mittelwert** | Testfall P5-06: 15× 4 ct + 5× 40 ct, konfiguriert 20 ct. Mittelwert (13) hätte `overestimate` gemeldet; der Code liefert p95 = 40 → `underestimate`. Unabhängig nachgerechnet (Safety-Review, eigenes Skript): 18× 2 ct + 2× 60 ct, Tarif 20 → Mittelwert (7,8) hätte `overestimate` gemeldet, der Code liefert `measuredCentsPerMin: 60`, Befund `underestimate`. Es ist nachweislich ein p95 (Nearest-Rank, `rank = ceil(n·95/100) − 1`), kein Mittelwert. |
| **Drei Befund-Codes** | `TARIFF_DRIFT_FINDING = { UNDERESTIMATE, OVERESTIMATE, INSUFFICIENT_SAMPLES }`, alle drei über Tests P5-01/P5-02/P5-03 einzeln ausgelöst und gepinnt. |
| **`insufficient_samples` alarmiert nicht, ist aber sichtbar** | `alertableDriftFindings()` filtert `insufficient_samples` an der einzigen Stelle heraus (Test P5-14). Gleichzeitig ist der Befund immer mit `samples`-Zahl im Boot-Log, Sweep-Log und am Endpunkt sichtbar (Test P5-03, P5-S3, P5-11). Safety-Review-Sonde: leere Liste, Call ohne Felder, Call mit `actualCostMicroCents = NaN` → jeweils `{code: 'insufficient_samples', samples: 0, measuredCentsPerMin: null}`, nie `code: null`. |
| **Beide Auslöser real verdrahtet** | Boot-Zeile (`warnTariffDrift` in `src/boot.js`, Test P5-B5). Laufzeit-Auslöser unabhängig vom Boot: `reportTariffDrift(store.load(), nowMs)` hängt am Ende von `sweepAllCandidates` in `src/billing/cost-truing.js` — Test P5-S1 beweist das an einem Prozess, in dem `assertBootGates` nie lief. |
| **Entprellung je Präfix UND Code** | Schlüssel `"<präfix> <code>"` in derselben Map wie P3 (`shouldEmitFinding`/`lastFindingMs`), P3-Schlüssel bleiben nackte Codes ohne Leerzeichen → keine Kollision. Test P5-S2 pinnt: 1 SMS im Fenster, keine zweite, wieder eine nach Ablauf von `costAlertDebounceMs`. |
| **Währungsrichtung** | `providerMicroCentsToBucketCents` **multipliziert** mit `rateMicro` (920000 = 0,92 EUR/USD im Live-Wert). Safety-Nachrechnung: `providerMicroCentsToBucketCents(100e6, 920000) = 92` (100 USD-Cent → 92 EUR-Cent). Die invertierte Richtung hätte 108/109 geliefert und fälschlich `underestimate` gemeldet. Test P5-07 pinnt denselben Fall im Unit-Test. |
| **Leerer Alarmkanal warnt** | `alertChannelFindings("")` → genau ein Befund `ALERT_CHANNEL_FINDING.UNSET`, `fatal: false` (Test P5-B1); besetzter Fall → `[]` (Test P5-B2). Spawn-Beweis P5-B3: BASE_ENV (leerer Kanal) → genau eine WARN-Zeile mit `PLATFORM_ALERT_SMS_TO` im Boot-Log, kein „Start abgebrochen". Die Nummer selbst wird nirgends geloggt (P5-B4). |

---

## 5. Safety-Urteil (final, nach Fix-Runde 1)

**FREIGABE.** Auszug aus dem unabhängigen Review-Verdikt:

> „P5 ist genau das, was der Plan verlangt: ein messender Wächter, der nichts justiert. Die drei Stellen, an denen diese Phase laut Auftrag umfallen könnte, halten alle stand — und zwar in meiner eigenen Nachrechnung, nicht nur in den mitgelieferten Tests."

Eigener Testlauf (frischer Worktree, Branch `phase/lct-p5-drift-watchdog-fix2`): **2748 pass / 2748, 0 fail, 0 skipped**, 77,7 s, kein Flake. Isolierter Nachlauf der acht P5-relevanten Dateien: 82/82 grün.

Geprüfte Kernpunkte, alle bestanden: `safetyGatesIntact`, `disclosureIntact`, `noPiiInAlerts`, `tariffAndBookingUnchanged`, `p95NotMean`, `underestimateCodeExistsAndFires`, `insufficientSamplesDistinctFromSilence`, `runtimeTriggerNotOnlyBoot`, `debounceCorrect`, `currencyDirectionCorrect`, `noRealSmsPossibleInTests`, `noFailOpenPath`, `authFailClosedIntact`, `noSecretsLeaked`. **Keine Blocker.**

### Verbliebene Concerns (kein Blocker, Nachziehe-Arbeit)

1. Kein Spawn-Test bootet einen geseedeten 4×-Drift-Store und beweist direkt die `console.warn`- statt `console.log`-Verzweigung in `boot.js:warnTariffDrift` — die Klassifikation selbst ist dicht getestet, nur dieser eine Verzweigungspfad hat keinen direkten Boot-Beweis.
2. Der 401-Beweis für `GET /api/billing/cost-drift` (Fall D) trägt `skip: !EXTERNAL_IP` — auf einem Runner ohne externe Interface-IP liefe der einzige Auth-fail-closed-Test der neuen Route still nicht mit (lokal lief er).
3. `tariffDriftReportFromConfig` scannt bei jedem Sweep, jedem Boot **und** jedem Request auf `/api/billing/cost-drift` die vollständige Call-Liste (O(n) je Aufruf) — für den heutigen Datenbestand irrelevant, bei Millionen-Skala als Seam nicht tragend.
4. Der Branch hängt am Merge-Base `7682dc1`; `master` ist inzwischen weiter (u. a. Report-Commit für P1–P3) — beim Merge darauf achten, dass `tasks/lct-p1..p3-report.md` nicht versehentlich gelöscht werden (Branchpunkt-Artefakt, keine P5-Absicht).
5. Die Phase widmet den Plan-Punkt „Anzeige" selbst um (`public/index.html` → `GET /api/billing/cost-drift`, s. §1.1) — inhaltlich am Code korrekt begründet und konsistent nachgezogen, aber eine Selbst-Umwidmung des Auftrags durch den Umsetzer, die der Owner bewusst quittieren sollte.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS — keine S1/S2-Befunde. Kein Blocker.**

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine. Insbesondere: keine zweite Entprellungs-Logik neben P3 (dieselbe Map, Schlüssel nur um Präfix erweitert); der zuvor an zwei Stellen fast identische fail-soft-SMS-Versand wurde in `src/telephony/alert-sms.js` extrahiert und von beiden Aufrufern (`outbound-gates.js`, `cost-truing.js`) geteilt (8 dedizierte Tests); `voiceMinutesOf` einmal auf Modulebene, kein Nachbau in `cost-calibration.js`.
- **S3 (nicht blockierend, dokumentiert):**
  - `DRIFT_PERCENTILE = 95` ist eine benannte, aber nicht ENV-konfigurierbare Konstante (im Gegensatz zu `COST_CALIBRATION_MIN_SAMPLES`, `costDriftWarnPercent`, `costAlertDebounceMs`) — begründet dokumentiert, konsistent mit der Nachbar-Konstante `DRIFT_SAMPLE_WINDOW`. Geprüft und als bewusste Ausnahme eingestuft.
  - Zwei `insufficient_samples`-Frühausstiege in `driftEntryForPrefix` wiederholen dieselben fünf Objekt-Keys fast identisch — sehr klein, kein echter Duplizierungsschaden, bei nächster Berührung extrahierbar.
- **S4 (Kosmetik):** `makeCostTruing` wächst durch P5 um vier weitere kleine, sauber getrennte innere Funktionen; jede einzelne bleibt klein/eine Aufgabe, die Datei folgt dem etablierten Fabrik-Muster — keine neue Struktur-Verletzung.

Magic Numbers: alle neuen Konstanten (`DRIFT_SAMPLE_WINDOW`, `DRIFT_PERCENTILE`, `PERCENT_BASE`, `MICRO_RATE_UNIT`) benannt und kommentiert. Geld durchgehend Ganzzahl-Arithmetik mit `Number.isSafeInteger`-Riegeln. Kein toter/auskommentierter Code, keine `eslint-disable`/TODO-Marker. Verschachtelungstiefe ≤ 2, keine Funktion > 3 Argumente außer Options-Objekten. `node --check` sauber für alle geänderten Quelldateien.

---

## 7. Fix-Runden

### Runde 1 (Commit `f673c78`)
Beide gemeldeten Blocker aus der ersten Review-Runde adressiert, Suite danach 2748/0 grün. Dokumentierte Abweichung: Der Auftrag hatte als Basis-Branch `phase/lct-p5-drift-watchdog` genannt — dieser existiert nicht; der reale P5-Branch trägt den deutschen Namen `phase/lct-p5-drift-waechter` aus dem Plan-Text. Fix-Branch wurde entsprechend von dort abgezweigt.

### Runde 2
Keine Code-Änderung. Die für Runde 2 übergebene Blocker-Liste war explizit leer (`[]`) — das finale Safety-Review (§5) und das finale Clean-Code-Audit (§6) ergaben **keine Blocker**, nur nicht-blockierende Concerns/S3/S4-Hinweise. Da nichts Blockierendes vorlag, wurden bewusst keine Blocker erfunden und keine Code-Änderung vorgenommen — der Gate-Zustand nach Runde 1 (`phase/lct-p5-drift-watchdog-fix2`, Commit `f673c78`) ist damit der finale, freigegebene Stand dieser Phase.

---

## 8. VOR DEM DEPLOY ZU SETZEN

P5 fügt **eine** neue Environment-Variable hinzu und ändert das Laufzeitverhalten einer bereits bestehenden Variable (neuer Boot-Guard, kein neuer Pflichtwert). Beide sind in `.env.example`, `render.yaml` und `test/helpers.js` (BASE_ENV) konsistent nachgezogen und über Test P5-13 cross-verifiziert.

| Variable | Neu in P5? | Live-Wert (`render.yaml`) | Bedeutung |
|---|---|---|---|
| `COST_CALIBRATION_MIN_SAMPLES` | **Ja, neu** | `20` (= Code-Default, explizit ausgeliefert nach dem P1/P3-Muster) | Mindest-Stichprobe je Ziel-Präfix. Darunter: keine Tarif-Aussage, kein Alarm, aber der sichtbare Befund `insufficient_samples` samt Zahl. Ein Wert über `DRIFT_SAMPLE_WINDOW` (100, fest im Code) friert den Wächter dauerhaft auf `insufficient_samples` ein — laut, nicht still, aber eine Fehlkonfiguration. |
| **`PLATFORM_ALERT_SMS_TO`** | Bestand, **neues Verhalten seit P5** | **`""` (leer) — heute unverändert leer** | Betreiber-Zielnummer (E.164) für die Tarif-Drift-SMS **und** die bestehende Plattform-Spend-Frühwarnung. **Solange dieser Wert leer bleibt, geht bei einem echten Tarif-Drift-Befund (`underestimate`/`overestimate`) KEINE SMS an einen Menschen — nur ein Audit-Log-Eintrag und eine Log-Zeile.** Seit P5 meldet der Boot-Guard (`alertChannelFindings`) diesen Zustand bei **jedem** Prozessstart als WARN (nicht fatal, blockiert den Boot nicht). Der Wert selbst wird dabei nie geloggt. **Vor dem Deploy bewusst entscheiden:** entweder eine Betreiber-Nummer eintragen (Owner-Konzept ist aus dem Code entfernt — es gibt aktuell keine „natürliche" Zielnummer für eine Plattform-Größe, s. Kommentar in `.env.example`) oder den leeren Zustand als akzeptiertes Risiko bewusst quittieren, statt ihn stillschweigend laufen zu lassen. |

Keine weiteren neuen Pflicht-Variablen. Kein Tarif-, Gate- oder Budget-Wert wurde durch P5 verändert (`tariffCentsPerMin`, `voiceTariffDomesticCents`, `voiceTariffDefaultCents` byte-identisch zu vor der Phase).

---

## 9. Deterministisch geprüftes Ergebnis (Zusammenfassung)

- `npm test` grün, 2748/2748 (unabhängig reproduziert, kein Flake).
- `grep -rn "tariffCentsPerMin" src/telephony/outbound-gates.js` liefert dieselben Treffer wie vor der Phase — der Tarif ist byte-identisch.
- Keine Schreibstelle auf `voiceTariffDomesticCents` im Diff — keine Selbstjustierung existiert im Code.
- Sweep-Rückgabewert und `costTruingCoveragePercent` unverändert (Test P5-S7) — kein Gate, kein Meter, keine Buchung liest ein P5-Artefakt.
- Boot-Log auf leerem `PLATFORM_ALERT_SMS_TO`: genau eine `[boot] Tarif-Drift:`-Zeile und genau eine `PLATFORM_ALERT_SMS_TO`-WARN, `/healthz` = 200.
- Kein Pfad in den Tests kann eine echte SMS auslösen (`messaging` durchgehend gestubbt/injiziert, BASE_ENV hält den Kanal leer).
