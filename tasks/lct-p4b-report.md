# Phase-Report: P4b — Vollkosten-Boot-Guard (sichert die Owner-Tarifsenkung ab)

**Plan-Quelle:** Umsetzungsplan P4b — Vollkosten-Boot-Guard (Absicherung der Owner-Tarifsenkung)
**Umfang:** Neue reine WARN-Boot-Entscheidung `voiceTariffFloorFindings` (`src/boot-guard.js`) + Verdrahtung `warnVoiceTariffBelowFullCost` (`src/boot.js`, Ende von `assertBootGates`). Feuert **ausschließlich in der Konjunktion**: der konfigurierte Inlandstarif `VOICE_TARIFF_DOMESTIC_CENTS` liegt unter der neuen Vollkostenschwelle `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` (Default `10`, `config.billing.voiceTariffFullCostFloorCents`) **und** die aus `costTruingCoveragePercent` (P3) gelesene Abgleich-Deckung liegt unter `COST_TRUING_MIN_COVERAGE_PERCENT`. Diese Phase **senkt** `VOICE_TARIFF_DOMESTIC_CENTS` **nicht** — bleibt Default `20`. Sie liefert nur die Absicherung für eine spätere Owner-Aktion.
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p4b-full-cost-guard-fix1`
**headCommit (Runde 1, Implementierung):** `78ef72fdeb4402c8c3ec4eb8eab807628e98a628` (Branch `phase/lct-p4b-full-cost-guard`)
**headCommit (final, nach Fix-Runde r1):** `f2ec846dc02c9a1cf870cf3ca901e17f9e542eda`
**Basis:** `master @ 4984eb0` (docs: Phasen-Report LCT P4 — P1–P5 bereits gemergt)
**Datum:** 2026-07-20/21

---

## 1. Plan (gekürzt)

### 1.1 Scope-Abgrenzung (verbindlich)

Diese Phase liefert **nur** Code für den Guard + die neue Schwellen-Env-Var. Sie senkt `VOICE_TARIFF_DOMESTIC_CENTS` **nicht** (bleibt Default `20`). Die Senkung selbst ist eine spätere **Owner-Aktion** mit einer Betriebs-Vorbedingung (gemessene Deckungsquote ≥ `COST_TRUING_MIN_COVERAGE_PERCENT` über ein Beobachtungsfenster), die heute mangels Deploy/abgeglichener Calls nicht erfüllbar ist. Der Guard warnt genau dann, wenn diese Senkung ohne die Vorbedingungen passiert.

**Blast-Radius laut Plan:** eine neue reine Guard-Funktion + Verdrahtung (WARN, kein `exit`), eine neue Env-Var/Konstante, vier Doku-/Test-Stellen, eine neue Testdatei. **Kein** Diff an `metering.js`, `outbound-gates.js` oder irgendeinem Buchungs-/Gate-Pfad. Der Assistant-Pfad-Rückbau ist ausdrücklich **nicht** Teil dieser Phase (Schwelle deshalb `10`, nicht `5`).

Direktes Muster: der bereits gemergte P4-Deckungs-Guard `costTruingBookingFindings` (`src/boot-guard.js`) und seine Verdrahtung `assertCostTruingBooking`/`warnUnpricedModels` (`src/boot.js`). Die Quote wird **nicht** neu gerechnet, sondern über `costTruingCoveragePercent(store.load())` aus `src/billing/cost-truing.js` (P3, G5) gelesen.

### 1.2 Neue Env-Var/Konstante `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`

`src/config.js`, im billing-Block direkt unter `voiceTariffDomesticCents`/`voiceTariffDefaultCents` (G35). `numEnv`, `fallback: 10`, `min: 0`. Herleitung über die teuerste **aktivierbare** Konfiguration, Kurs 0,92 (USD-Cent → EUR-Cent):

| Zustand Assistant-Pfad | Schwelle | Herleitung |
|---|---|---|
| im Code UND per Env (`TELNYX_AI_ASSISTANT_ENABLED`) aktivierbar | **10** | 10,4 USD-ct × 0,92 = 9,568 → aufgerundet |
| nach vollzogenem Rückbau aus `voice.js`/`config.js` | **5** | 5,4 USD-ct × 0,92 = 4,968 → aufgerundet |

Auslöser für den Wechsel auf 5 ist der **gemergte** Rückbau (ein grep, der `startAssistant`/`ai_assistant_start` nicht mehr findet), nicht die Absicht. Zusätzlich Pflicht: Eintrag in die billing-Whitelist des `guardedConfig`-Proxys (sonst `TypeError` beim ersten Zugriff).

`min:0` statt `min:1`, weil `BASE_ENV` `VOICE_TARIFF_DOMESTIC_CENTS="0"` setzt (test-neutral); mit `min:1` läge die Schwelle in der ganzen Suite bei 10 und `0 < 10` wäre in jedem Spawn-Test wahr → Guard feuerte flächendeckend. `0` deaktiviert den WARN bewusst und sichtbar — er ist Diagnose, kein Geld-Gate.

### 1.3 Der Guard (`src/boot-guard.js`)

```js
export function voiceTariffFloorFindings({ domesticTariffCents, fullCostFloorCents, coveragePercent, minCoveragePercent }) {
  const belowFloor = domesticTariffCents < fullCostFloorCents;
  const thinCoverage = coveragePercent < minCoveragePercent;
  if (!(belowFloor && thinCoverage)) return [];
  return [{ code: VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST, fatal: false, message: "..." }];
}
```

Vergleichsrichtung strikt `<`: Tarif==Schwelle (10<10) → `false` → still (bei/über der Untergrenze ist gedeckt); Coverage==Schwelle (80<80) → `false` → still (konsistent mit `costTruingBookingFindings`-Gleichstand). Default-Tarif 20 ≥ 10 → Guard per Default stumm.

### 1.4 Verdrahtung (`src/boot.js`)

`warnVoiceTariffBelowFullCost(config, store)` nach dem Muster `warnTariffDrift`/`warnUnpricedModels`: liest die Quote über dieselbe P3-Funktion, reicht sie an `voiceTariffFloorFindings` durch, gibt bei Treffer `console.warn` aus. Eingehängt in `assertBootGates(config, store)` als letzte Zeile, nach `warnTariffDrift`. Reine WARN, kein `exit(1)`.

### 1.5 Doku-/Baseline-Dreiheit

`test/helpers.js` (BASE_ENV `VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "0"`), `.env.example` (neuer Block, Default 10), `render.yaml` (neuer Key, `"10"`) — alle drei Pflicht laut CLAUDE.md-Konvention für jede neue Env-Var.

### 1.6 Tests (Plan-Vorgabe)

Neue Datei `test/voice-tariff-full-cost-guard.test.js`, Muster `test/cost-truing-booking-guard.test.js`: Unit-Wahrheitstabelle (Konjunktion, beide Alleinstellungsfälle, beide Gleichstand-Kanten) + Spawn-Boot-Beweise (p)/(q)/(r) inkl. Nenner-0-Fall.

### 1.7 Rot-vor-Fix-Reihenfolge (verbindlich)

1. Nur die neue Testdatei gegen unveränderten `master` anlegen (kein Guard, keine Config-Var, kein BASE_ENV-Eintrag).
2. Lauf gegen unveränderten Stand → Import-RED (härtester RED: Modul lädt nicht) + Verhaltens-RED (Boot bei gesenktem Tarif ist vor dem Guard still).
3. Danach Config + Whitelist + Guard + Wiring + BASE_ENV/.env.example/render.yaml implementieren.
4. Grün-Lauf Datei, danach volle Suite.

---

## 2. Implementierungs-Zusammenfassung

Plan exakt umgesetzt auf Branch `phase/lct-p4b-full-cost-guard` (Commit `78ef72f`, Basis `master@4984eb0`), nach Fix-Runde r1 auf `phase/lct-p4b-full-cost-guard-fix1` (Commit `f2ec846`) überführt. `git diff --stat master..phase/lct-p4b-full-cost-guard-fix1`: 11 Dateien, 315 Zeilen hinzu, 28 entfernt.

**Kern:** `voiceTariffFloorFindings`/`VOICE_TARIFF_FLOOR_FINDING` in `src/boot-guard.js` (reine Funktion, 4 benannte Felder), `warnVoiceTariffBelowFullCost` in `src/boot.js`, `config.billing.voiceTariffFullCostFloorCents` (numEnv, fallback 10, min 0) + Eintrag in der billing-Whitelist. `VOICE_TARIFF_DOMESTIC_CENTS`-Default bleibt bei `20` — bestätigt per `git show ...:src/config.js` (Zeile 441, unverändert `fallback: 20`).

**Testergebnis (final, nach Fix-Runde r1):** volle Suite **2793/2793 grün** (JSON-Backend, mehrfach reproduziert). Die neue Testdatei liefert 10 grüne Fälle: U1–U6 (Unit-Wahrheitstabelle) + (p)/(q1)/(q2)/(r) (Spawn-Boot-Beweise).

### 2.1 Deviations (vom Implementierer selbst benannt)

1. **Zwei Bestandstests mechanisch nachgezogen**, weil die volle Suite sie sonst rot gemacht hätte: `test/config-money-manifest.test.js` (Geld-Manifest-Guard verlangt jedes neue `*Cents`/`*Eur`/`*Usd`-Feld explizit gelistet) und `test/config-namespaces.test.js` (drei gepinnte Zähler: billing-Keys 29→30, Gesamt-Keys 117→118, primitive Blätter im Setter-Durchschlag-Test 109→110). Reine Zahlen-/Listen-Nachziehungen ohne Verhaltensänderung, Präzedenzfall in der Git-History dokumentiert.
2. **`PLAN-SECURITY.md`-Abschnitt `P4B-FULLCOSTGUARD` neu angelegt** — im Plan als Punkt vorgesehen, aber ohne konkreten Textentwurf; Inhalt eigenständig nach dem Muster der Nachbarabschnitte (z. B. `P7A-MODELPRICE`) formuliert. Verifiziert: Abschnitt beschreibt Konjunktion, Schwellen-Herleitung (10 vs. 5) und `min:0`-Begründung deckungsgleich mit dem Plan.

**Nicht angefasst (Plan-Zusage):** `src/billing/metering.js`, `src/outbound-gates.js`, jeder Buchungs-/Gate-Pfad — laut `git diff --stat` bestätigt nicht im Diff enthalten.

---

## 3. Rot-vor-Fix-Nachweis

Testdatei `test/voice-tariff-full-cost-guard.test.js` vollständig **vor** jeder Implementierungszeile gegen unveränderten `master@4984eb0` angelegt und gefahren (`node --test test/voice-tariff-full-cost-guard.test.js`). Wörtliche Fehlermeldung (Import-RED, härtester RED laut Plan):

```
file:///.../test/voice-tariff-full-cost-guard.test.js:8
import { voiceTariffFloorFindings, VOICE_TARIFF_FLOOR_FINDING } from "../src/boot-guard.js";
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^
SyntaxError: The requested module '../src/boot-guard.js' does not provide an export named 'VOICE_TARIFF_FLOOR_FINDING'

tests 1 / pass 0 / fail 1
```

Das Modul lädt nicht → **alle** Fälle inkl. Unit/(p)/(q)/(r) rot — genau der im Plan geforderte härteste RED ("vor dem Guard ist der Boot still — das ist das Rot"). Nach der Implementierung liefen alle 10 Fälle der Datei grün (U1–U6 + (p) + (q1) + (q2) + (r)).

**Flake-Protokoll (Lehre `suite-flake-p5-gate-proof`):** Safety-Review bestätigt einen einzelnen Fehlschlag (`test/cq-p8-briefing.test.js` B1), der nur im Volllast-Suite-Lauf auftrat, in Isolation auf `master` **und** auf dem P4b-Branch grün — vorbestehender Volllast-Flake, Datei nicht im Diff-Scope, keine Regression durch diese Phase.

---

## 4. Die harten Zusagen der Phase (mit Beleg)

| # | Zusage | Status | Beleg |
|---|---|---|---|
| 1 | **Tarif-Default unverändert (`VOICE_TARIFF_DOMESTIC_CENTS=20`)** | ✅ erfüllt | `git show phase/lct-p4b-full-cost-guard-fix1:src/config.js` Zeile 441: `fallback: 20` — byte-identisch zum Bestand. `.env.example`/`render.yaml` unverändert an dieser Stelle. |
| 2 | **Guard ist WARN, kein `exit(1)`** | ✅ erfüllt | `warnVoiceTariffBelowFullCost` ruft ausschließlich `console.warn(...)`, keinen `process.exit`. Test (p)/(r): `assert.doesNotMatch(srv.stdout, /Start abgebrochen/)`, `/healthz` bleibt 200. |
| 3 | **Feuert nur in der Konjunktion** | ✅ erfüllt | `voiceTariffFloorFindings`: `if (!(belowFloor && thinCoverage)) return [];`. Unit U2 (nur belowFloor → `[]`), U3 (nur thinCoverage → `[]`), Spawn (q1)/(q2) bestätigen dieselbe Konjunktion end-to-end (kein Log-Treffer bei nur einer Bedingung). |
| 4 | **Ruft die P3-Deckungsfunktion, statt selbst zu rechnen** | ✅ erfüllt | Nach Fix-Runde r1 gemeinsamer Helper `currentCoverage(config, store)` in `src/boot.js` (`return { coveragePercent: costTruingCoveragePercent(store.load()), minCoveragePercent: config.billing.costTruingMinCoveragePercent }`), per Spread `...currentCoverage(config, store)` von **beiden** Guards (`assertCostTruingBooking` P4 und `warnVoiceTariffBelowFullCost` P4b) konsumiert — eine Quelle, kein zweiter `store.load()`-Call, kein zweiter Coverage-Ausdruck. |
| 5 | **Nenner 0 warnt (kein stiller Freispruch)** | ✅ erfüllt | `costTruingCoveragePercent` (P3, unverändert) liefert bei leerem Spiegel `0%`. Test (r): `VOICE_TARIFF_DOMESTIC_CENTS:"6"`, Schwelle `"10"`, `seedState({ calls: [] })` → eine WARN `.../Abgleich-Deckung 0%/`, `/healthz` 200. Ein leerer Spiegel bei gesenktem Tarif ist damit WARN, nicht Schweigen. |
| 6 | **Keine Literale im Guard-Rumpf** | ✅ erfüllt | `voiceTariffFloorFindings({ domesticTariffCents, fullCostFloorCents, coveragePercent, minCoveragePercent })` — alle vier Werte kommen als benannte Parameter herein; die Zahlen `10`/`80` stehen ausschließlich als `config.billing.voiceTariffFullCostFloorCents`/`config.billing.costTruingMinCoveragePercent` in `config.js`, nie als Literal im Rumpf. Vom Clean-Code-Audit unabhängig bestätigt. |

---

## 5. Safety-Urteil (final)

**Verdikt: APPROVED.**

`voiceTariffFloorFindings` feuert ausschließlich in der Konjunktion (Tarif < Vollkostenschwelle **und** Deckung < Min-Coverage), gibt bei nur einer Bedingung `[]` zurück (U2/U3, q1/q2 belegt), ist reine WARN via `console.warn` ohne `exit(1)`, reicht die Deckungsquote aus der einen P3-Quelle `costTruingCoveragePercent(store.load())` herein statt selbst zu rechnen (gemeinsamer `currentCoverage`-Helper seit Fix-Runde r1), behandelt Nenner 0 als 0% → WARN (kein fail-open, Test r) und trägt keine Literale im Rumpf. Kein Diff an `metering.js`/`state-ops.js` oder irgendeinem Buchungs-/Gate-Pfad. `VOICE_TARIFF_DOMESTIC_CENTS` bleibt 20 in `.env.example` und `render.yaml`. Safety-Gates, Disclosure, Auth unangetastet; keine Secrets/PII im WARN (nur Env-Namen + zwei Zahlen); keine neuen Dependencies; Scope strikt P4b.

**Unabhängige Test-Reproduktion:** JSON-Backend (Live-relevanter Default, von BASE_ENV für alle Spawn-Tests erzwungen) 2793/2793 grün, 0 Fehler. Die zwei Guard-Testdateien direkt: 20/20 (6 Unit-Wahrheitstabelle U1–U6 + Spawn-Beweise p/q1/q2/r + Booking-Guard p1–p3). `config-namespaces` (billing 30, total 118, checked 110) und `config-money-manifest` grün. Der `STORE_BACKEND=pg`-Lauf zeigt 3 rote Dateien (`tenant-erasure`, `turn-fallback-locale`, `voice-render-action-url`) — Ursache belegt: `[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). DB unerreichbar. AggregateError` (kein Postgres in der Sandbox); die drei Dateien werden vom P4b-Diff nicht berührt, P4b-Verhalten ist backend-unabhängig (reine Funktion + BASE_ENV `STORE_BACKEND=json` erzwungen für die Spawn-Tests).

**Concerns (nicht-blockierend):**
1. Betriebliche Rest-Flanke, bewusst dokumentiert (nicht neu): bei hoher Deckung schweigt der Guard auch unter der Vollkostenschwelle — Vorbedingung 1 ist **nicht eigenständig** überwacht (Test q1 pinnt das, Plan + Kommentar + `PLAN-SECURITY.md` benennen es explizit als akzeptierte Kante). Solange der Assistant-Pfad im Code steht, verlangt jede Änderung von `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` eine erneute manuelle Prüfung gegen den Tarif — im Code kommentiert.
2. PG-Backend-Vollauf in der Sandbox nicht durchführbar (keine DB). Kein Hindernis für P4b, da dessen Tests backend-neutral sind; falls eine echte PG-Voll-Suite als Merge-Auflage gilt, muss sie in einer Umgebung mit Postgres laufen.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS — keine S1/S2-Blocker.** Der P4b-Diff (Branch `phase/lct-p4b-full-cost-guard-fix1` gegen `master`) fügt den Vollkosten-Boot-Guard sauber und mit dem P4-Guard geteilter Infrastruktur hinzu. Die zentrale Sorge (Duplizierung der Quoten-Beschaffung gegen den P4-Guard) ist durch die Fix-Runde r1 behoben: `currentCoverage(config, store)` (`src/boot.js`) ist jetzt die eine Quelle für `coveragePercent`+`minCoveragePercent`, von `assertCostTruingBooking` und `warnVoiceTariffBelowFullCost` per Spread konsumiert; der zuvor duplizierte Test-Seed-Bauer (`fiveCallsSeed`/`tenCallsSeed`) wurde zu `outboundCallsSeed()` in `test/helpers.js` zusammengeführt. Schwellen (10, 80) sind durchgehend benannte Konfig-Werte — keine Literale im Guard-Rumpf. Alle 28 direkt betroffenen Tests grün, `node --check` sauber, keine Umlaute, `PLAN-SECURITY.md`/`.env.example`/`render.yaml` konsistent nachgezogen.

**s1 (Blocker):** keine.
**s2 (Blocker):** keine.

**s3 (nicht-blockierend, zwei Funde):**
- **Kein FLAG:** Die triviale Ein-Zeilen-Bedingung `coveragePercent < minCoveragePercent` steht wortgleich in `costTruingBookingFindings` (`src/boot-guard.js`) **und** in `voiceTariffFloorFindings` (`thinCoverage = coveragePercent < minCoveragePercent`). Form-1-Duplizierung (vgl. G5-Beispiel `isEmpty() { return 0 == size(); }`) — eine eigene Funktion für einen einzelnen `<`-Vergleich wäre reine Indirektion ohne Lesbarkeitsgewinn, deshalb nicht als S2 gezählt, nur der Vollständigkeit halber notiert.
- `VOICE_TARIFF_FLOOR_FINDING` (`src/boot-guard.js`) ist ein `Object.freeze` mit genau einem Schlüssel (`BELOW_FULL_COST`) — folgt aber konsequent dem im Repo etablierten Finding-Code-Muster (`SPEND_CAP_FINDING`, `COST_TRUING_BOOKING_FINDING`), also Konsistenz, keine unnötige Fragmentierung.

**s4:** keine.

**topTodos (kein Pflicht-Todo, optional für später):** Wenn der Assistant-Pfad (`TELNYX_AI_ASSISTANT_ENABLED`, `startAssistant`/`ai_assistant_start`) zurückgebaut wird, muss `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`-Default 10→5 in `config.js`, `.env.example` **und** `render.yaml` synchron nachgezogen werden (bereits im Kommentar dokumentiert, hier nur als Erinnerung).

**passNotes (Auszug):** Unit-Wahrheitstabelle U1–U6 deckt beide Gleichstand-Kanten (Tarif==Schwelle, Coverage==Schwelle) und beide Alleinstellungsfälle. Boot-Beweise (p/q1/q2/r) inkl. leerer Spiegel. Schwelle 10 und Min-Coverage 80 ausschließlich als `config.billing.*`-Werte injiziert, nie als Literal im Guard-Rumpf; Herleitung (10,4 USD-ct × 0,92) nachvollziehbar als Kommentar in `config.js`, nicht im Code. Funktionslänge/Verschachtelung: alle neuen/geänderten Funktionen (`voiceTariffFloorFindings`, `currentCoverage`, `warnVoiceTariffBelowFullCost`, `outboundCallsSeed`) kurz (<15 Zeilen), Verschachtelungstiefe 1. Keine Umlaute, kein auskommentierter Code, keine abgeschalteten Sicherungen.

---

## 7. Fix-Runden

### Runde 1 (Commit `f2ec846`)

Zwei G5-Review-Blocker der Phase behoben, minimal und im Scope (4 Dateien geändert: `src/boot.js`, `test/cost-truing-booking-guard.test.js`, `test/helpers.js`, `test/voice-tariff-full-cost-guard.test.js`; 52 Zeilen hinzu, 48 entfernt):

1. **Blocker 1 (`src/boot.js`):** Der wörtlich in `assertCostTruingBooking` (P4-Guard) und `warnVoiceTariffBelowFullCost` (P4b-Guard) duplizierte Ausdruck (`costTruingCoveragePercent(store.load())` + `minCoveragePercent`) ist jetzt in einen gemeinsamen Helper `currentCoverage(config, store)` gezogen; beide Guards konsumieren ihn per `...currentCoverage(config, store)`-Spread. `store.load()` ist gecached, der Doppelaufruf beider Guards kostet kein zweites IO.
2. **Blocker 2 (Test-Duplizierung):** Der zuvor je Testdatei separat kopierte Seed-Bauer (`fiveCallsSeed` in `cost-truing-booking-guard.test.js`, `tenCallsSeed` in `voice-tariff-full-cost-guard.test.js`) ist zu einer gemeinsamen Funktion `outboundCallsSeed(count, proven, prefix)` in `test/helpers.js` zusammengeführt (der `prefix`-Parameter hält Call-IDs je Aufrufer eindeutig: `call_p_`/`call_q_`).

Danach: volle Suite **2793/0** grün, `node --check` ok, `node_modules` nicht committet.

---

## OFFENE OWNER-AKTION (NICHT Teil dieses Code-Diffs)

**Diese Phase senkt `VOICE_TARIFF_DOMESTIC_CENTS` nicht.** Der Tarif bleibt bei seinem Bestands-Default `20` (EUR-Cent/Min). Die tatsächliche Senkung — von `20` auf einen Zielwert um `~10` — ist eine **spätere Owner-Aktion**, die der in dieser Phase gebaute Boot-Guard absichert, aber nicht selbst auslöst. Zwei Vorbedingungen müssen erfüllt sein, **bevor** der Owner den Wert im Render-Dashboard/`.env` ändert:

**Vorbedingung 1 — gemessene Abgleich-Deckung ≥ `COST_TRUING_MIN_COVERAGE_PERCENT` (Default `80`) über ein Beobachtungsfenster.**
Heute **nicht erfüllbar**, weil P1–P5 nie deployed wurden — es liegen **0 abgeglichene Calls** vor. `costTruingCoveragePercent` misst den Anteil der beendeten Outbound-Calls mit `costTruedSource='telnyx_detail_records'`; ohne Live-Betrieb ist der Nenner leer, die Quote damit strukturell `0%` (Test r bestätigt dieses Verhalten als WARN, kein Freispruch). Der Guard aus dieser Phase feuert genau dann, wenn der Tarif trotzdem unter die Vollkostenschwelle gesenkt würde, während diese Quote unter `80%` liegt.

**Vorbedingung 2 — der Tarif muss die teuerste AKTIVIERBARE Konfiguration decken.**
Die Vollkostenschwelle steht heute bei **10 EUR-Cent**, solange der `ai-voice-assistant`-Pfad im Code **aktivierbar** bleibt (über `TELNYX_AI_ASSISTANT_ENABLED`). Grep-Beleg, dass der Pfad noch im Code steht (gegen den aktuellen `src/`-Stand, nicht das Worktree der Phase):

```
src/telnyx-inbound.js:41:      await vc.startAssistant({ callControlId, assistantId: call.assistantId });
src/telnyx-call-control-ingest.js:174:    await voiceControl(call.provider).startAssistant({
src/config.js:264:    enabled: boolEnv("TELNYX_AI_ASSISTANT_ENABLED", process.env.TELNYX_AI_ASSISTANT_ENABLED, {
src/telephony/ports.js:105: * @property {(params: StartAssistantParams) => Promise<void>} [startAssistant]
src/telephony/ports.js:106: *   Haengt den Telnyx-AI-Assistant an den Call-Control-Call an (ai_assistant_start). Telnyx-only.
```

Erst nach dem **gemergten Rückbau** dieses Pfads (ein grep, der `startAssistant`/`ai_assistant_start` nicht mehr im `src/`-Baum findet — nicht die bloße Absicht, den Pfad abzuschalten) darf die Schwelle in `config.js`, `.env.example` **und** `render.yaml` synchron von `10` auf `5` gesenkt werden (Herleitung: 5,4 USD-Cent/Min × Kurs 0,92 = 4,968 → aufgerundet 5).

**Zusätzliche Auflage für P5 (aus dem Plan-Kommentar übernommen):** Für **jeden** gesenkten Tarif-Präfix muss P5 (Tarif-Drift-Alarm) im Beobachtungsfenster einen **echten** Befund liefern (`coverage_below_threshold`/Drift-Vergleich mit tatsächlichen Messwerten), **nicht** `insufficient_samples`. Ein Sweep-Log, das durchgängig nur "zu wenige Proben" meldet, beweist keine Deckung — der Owner darf die Senkung nicht auf Basis eines Nenner-0- oder Nenner-nahe-0-Zustands vornehmen, selbst wenn die rechnerische Quote zufällig über der Schwelle läge.

**Zusammenfassung der Reihenfolge:**
1. P1–P5 live deployen, Live-Betrieb mit echten Outbound-Calls laufen lassen.
2. Beobachtungsfenster abwarten, bis `costTruingCoveragePercent` ≥ 80% **und** P5 für den Tarif-Präfix einen echten (nicht `insufficient_samples`) Befund liefert.
3. Erst dann `VOICE_TARIFF_DOMESTIC_CENTS` auf ~10 senken — der P4b-Guard bleibt dabei stumm, weil beide Bedingungen dann nicht mehr gleichzeitig zutreffen.
4. Schwelle `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` bleibt bei 10, bis der Assistant-Pfad-Rückbau gemergt ist — erst danach synchron auf 5 in `config.js`/`.env.example`/`render.yaml`.

Kein Schritt aus diesem Abschnitt ist Teil des in dieser Phase gelieferten Code-Diffs. Der Guard macht diese spätere Bewegung **sichtbar**, er erlaubt oder verbietet sie nicht.

---

## 8. Deterministisch geprüftes Ergebnis (Zusammenfassung)

- `npm test` grün, **2793/2793** (JSON-Backend, unabhängig reproduziert nach Fix-Runde r1).
- Zwei Guard-Testdateien direkt: **20/20** grün (Unit U1–U6, Spawn p/q1/q2/r, Booking-Guard p1–p3).
- `git diff --stat` bestätigt: `src/billing/metering.js`, `src/outbound-gates.js`, jeder Buchungs-/Gate-Pfad unangetastet.
- `git show ...:src/config.js` bestätigt: `voiceTariffDomesticCents`-Default weiterhin `fallback: 20`.
- `node --check` fehlerfrei für alle geänderten `.js`-Dateien.
- Keine neue npm-Dependency.
- Keine PII im WARN (nur Env-Namen + zwei Zahlen: Tarif-Cent-Wert und Deckungsprozent).
- Ein vorbestehender Volllast-Flake (`test/cq-p8-briefing.test.js` B1) isoliert auf `master` und auf dem P4b-Branch grün bestätigt — keine Regression durch diese Phase.
