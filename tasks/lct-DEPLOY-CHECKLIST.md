# Deploy-Checkliste: PLAN-LIVE-COST-TRACING (P1-P8)

Konsolidiert aus `tasks/lct-p1-report.md` bis `tasks/lct-p8-report.md` (inkl. P4b),
`.env.example`, `render.yaml` und `PLAN-LIVE-COST-TRACING.md` Kap. 7. Alle 9 Phasen
(P1, P2, P3, P4, P4b, P5, P6, P7, P8) sind auf `master` gemergt (Gate PASS je Phase),
**aber NICHT deployed**. Diese Checkliste ist Bedingung für den ersten Deploy dieser
Kette, nicht für den Merge.

---

## 1. Neue Env-Variablen über die ganze Kette

| Variable | eingeführt in | Default (`.env.example`/`render.yaml`) | was live gesetzt werden muss | Konsequenz wenn falsch/leer |
|---|---|---|---|---|
| `PROVIDER_CURRENCY` | P1 | `USD` | Default fahren lassen (293/293 Live-Records am 2026-07-20 waren `USD`). | Falsche Währung → jeder Record wird als `currency_mismatch` verworfen, Sweep liefert strukturell 0 Treffer (fail-closed, aber lahmt den ganzen Kanal). |
| `PROVIDER_TO_BUCKET_RATE_MICRO` | P2 | `920000` (= 0,92 EUR/USD) | Default fahren lassen, außer der Kurs hat sich seit der letzten Owner-Prüfung wesentlich bewegt. **Muss im Band [0,5×..2,0×] um den Anker `920000` liegen** (also 460000–1840000), sonst verweigert der Boot fatal (ab P4; in P2/P3 nur WARN). | Zehnerpotenz-Vertipper (z.B. `920` statt `920000`) → Boot-Refusal `exit(1)` seit P4 unkonditional, unabhängig vom Stand jeder anderen Variable. |
| `COST_TRUING_DELAY_MINUTES` | P3 | `180` | Default fahren lassen; CDR-Latenz beim Provider ist laut Plan unbelegt, Wert nach erstem Live-Beleg empirisch nachziehen, nicht raten. | Zu kurz: Sweep versucht Abgleich, bevor der Provider die Records hat, verbraucht Versuche unnötig. Zu lang: verzögert Sichtbarkeit, kein Sicherheitsrisiko. |
| `COST_TRUING_MAX_ATTEMPTS` | P3 | `5` | Default fahren lassen. | Zu niedrig: Calls werden nach wenigen Versuchen dauerhaft als `unavailable` abgeschlossen, bevor der Provider die Daten geliefert hat. |
| `COST_TRUING_REQUIRED_RECORD_TYPES` | P3, seit P4/P8 **fatal** | leer (`""`) | **BLOCKIEREND, siehe Abschnitt 2.** Muss vor jedem Deploy dieser Kette aus einem frischen Live-Beleg gesetzt werden — **ohne `inference`** (nicht zuordenbar, seit LCT-FIX-1 ebenfalls Boot-Refusal). | Leer + `COST_TRUING_BOOKING_ENABLED` existiert seit P8 nicht mehr als Abschalter → Boot verweigert **unkonditional** (`exit(1)`, jeder Deploy, jeder Prozessstart). Enthält die Menge einen Wert außerhalb der sechs zuordenbaren Typen (`inference`, aber auch jede abweichende Schreibweise oder ein Tippfehler), verweigert der Boot ebenfalls (`exit(1)`) — sonst wäre sie dauerhaft unerfüllbar: keine Rückerstattung, jede Nachforderung gebucht. |
| `COST_TRUING_MIN_COVERAGE_PERCENT` | P3 | `80` | Default fahren lassen; ist die Vorbedingungs-Schwelle für die Aussagekraft der Korrekturbuchung und darf laut Plan **nie gesenkt werden**, um eine Vorbedingung künstlich zu erfüllen. | Zu niedrig gesenkt: die Deckungsquoten-Warnung verliert ihre Aussagekraft, Owner-Aktionen (P4b-Tarifsenkung) stützen sich auf eine zu dünne Datenbasis. |
| `COST_TRUING_COVERAGE_STALL_SWEEPS` | P3 | `8` (≈ 2 Tage bei 6h-Kadenz) | Default fahren lassen. | Prozess-lokaler Zähler, wird bei Free-Tier-Restart genullt — bekanntes akzeptiertes Restrisiko, kein Blocker. |
| `COST_DRIFT_WARN_PERCENT` | P3 | `50` | Default fahren lassen. | Die Drift-Prozentzahl aus P3 vergleicht USD-Mikro-Cent gegen EUR-Cent ohne Umrechnung (bewusste Log-only-Vereinfachung); P5 rechnet korrekt um. Reiner Log-Wert, kein Gate. |
| `COST_ALERT_DEBOUNCE_MS` | P3 | `86400000` (24h) | Default fahren lassen. | Kein Sicherheitsrisiko, nur Alarm-Frequenz. |
| `COST_CALIBRATION_MIN_SAMPLES` | P5 | `20` | Default fahren lassen. | Ein Wert über `DRIFT_SAMPLE_WINDOW` (100, fest im Code) friert den Drift-Wächter dauerhaft auf `insufficient_samples` ein — laut, nicht still, aber eine Fehlkonfiguration. |
| `PLATFORM_ALERT_SMS_TO` | Bestand (Budget-Achsen), **neues Verhalten seit P5/P7** | leer (`""`) | **BLOCKIEREND für Alarm-Wirksamkeit, siehe Abschnitt 2.** Vor dem Deploy bewusst entscheiden: Betreiber-Nummer eintragen oder leeren Zustand explizit als akzeptiertes Risiko quittieren. | Leer → Tarif-Drift-Alarm (P5) und TTS-Kontingent-Wandalarm (P7) laufen nur ins Audit-Log, **keine SMS an einen Menschen**. Boot-Guard warnt (nicht fatal). |
| `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` | P4b | `10` | Default fahren lassen. **Bleibt bei 10, bis der `ai-voice-assistant`-Pfad zurückgebaut ist** (Owner-Entscheidung 5) — erst danach auf 5 senken (Abschnitt 6). | Falsch gesetzt (zu niedrig) deckt die Vollkosten-Schwelle die teuerste aktivierbare Konfiguration nicht mehr ab; der Guard bleibt dann bei niedriger Abgleich-Deckung fälschlich stumm. |
| `VOICE_CAP_RATE_CENTS_PER_MIN` | P6 | `6` | Default fahren lassen (aufgerundete 5,4 gemessene USD-ct/min). Leitet Tenant-Kostendecken ab (300/900 ct). | Falscher Wert verschiebt die abgeleiteten Tenant-Decken (300/900 ct); zu hoch gesetzt kollidiert ggf. wieder mit `MAX_BUDGET_EUR` (siehe Abschnitt 2). |
| `TTS_CHARACTER_QUOTA` | P7 | `39981` | Default fahren lassen (belegtes ElevenLabs-Starter-Kontingent). | Falscher Wert verfälscht nur die Anzeige/Warnschwelle — kein Gate liest ihn. |
| `TTS_CHARACTER_QUOTA_WARN_PERCENT` | P7 | `75` | Default fahren lassen. `0` = Warnung bewusst aus. | Reine Anzeige-/Alarmschwelle, kein Gate. |
| `TTS_QUOTA_CYCLE_ANCHOR_DAY` | P7 | `3` (Tag im Monat, ElevenLabs-Zyklus-Reset, **nicht** Kalendermonatserster) | Default fahren lassen. `numEnv` mit `min:1`/`max:28` erzwungen. | Falscher Anker verschiebt nur den Reset-Zeitpunkt des Zeichenzählers, kein Gate betroffen. |
| `PLATFORM_FIXED_COST_CENTS_PER_MONTH` | P7 | `600` (EUR-Cent, nominal, keine 0,92-Kursumrechnung — Owner-Entscheidung 6/D7) | Default fahren lassen. | Reine Anzeige (`GET /api/billing/platform-costs`), kein Rechnungsposten, kein Gate. |
| `NUMBER_MONTHLY_COST_CENTS` | P7 | `92` (EUR-Cent, = 1,00 USD × 0,92) | Default fahren lassen. | Reine Anzeige (DID-Listenmiete), kein Rechnungsposten, kein Gate. |

Keine dieser Variablen benötigt zwingend eine Änderung zum reinen Live-Betrieb im
Beobachtungsmodus — **mit Ausnahme der beiden in Abschnitt 2 als blockierend
markierten** (`COST_TRUING_REQUIRED_RECORD_TYPES`, `MAX_BUDGET_EUR`) sowie
`PROVIDER_TO_BUCKET_RATE_MICRO`, das zwar einen unveränderten Default trägt, aber
seit P4 fatal geprüft wird.

---

## 2. BLOCKIERENDE Deploy-Auflagen

Der Dienst startet nicht (`exit(1)`) oder bucht falsch, wenn diese nicht erfüllt sind.

- [ ] **`COST_TRUING_REQUIRED_RECORD_TYPES` ist NICHT leer.**
  Seit P8 ist der Pflicht-Mengen-Riegel (`costTruingBookingFindings` in
  `src/boot-guard.js`) **unkonditional fatal** — der frühere Abschalter
  `COST_TRUING_BOOKING_ENABLED` existiert seit P8 nicht mehr (grep bestätigt 0
  Treffer). Bleibt die Variable leer, verweigert **jeder** Boot den Start, nicht nur
  ein Flip-Zustand.
  Die empirisch belegten `record_type`-Werte aus der Live-Messung vom 2026-07-20
  (PLAN-LIVE-COST-TRACING.md Kap. 2.6, 293 Records, `page[size]=50` je Typ) sind:
  `sip-trunking`, `call-control`, `speech-to-text`, `text-to-speech`, `recording`,
  `inference`, `ai-voice-assistant` (der Typ `"call"` existiert **nicht**, liefert
  HTTP 400).
  **Als Pflicht-Typ wählbar sind davon nur die sechs ZUORDENBAREN** — `sip-trunking`,
  `call-control`, `speech-to-text`, `text-to-speech`, `recording`,
  `ai-voice-assistant`. **`inference` ist ausgeschlossen:** der Beleg trägt
  ausschließlich `conversation_id`, also weder Anker noch Session, und ist damit
  strukturell keinem Call zuordenbar (LCT-FIX-1). Stünde er in der Pflicht-Menge,
  wäre sie dauerhaft unerfüllbar → jeder Call bliebe `'incomplete'` → **jede
  Rückerstattung verfällt, während jede Nachforderung gebucht wird** (einseitige
  Korrektur zulasten des Kunden, Deckungsquote dauerhaft 0 %). Der Boot-Guard
  (`costTruingBookingFindings`) lehnt diesen Fall seit LCT-FIX-1 genauso hart ab wie
  die leere Menge — ein frischer Live-Beleg *enthält* `inference`-Records, deshalb
  darf er nicht ungefiltert in die Variable übernommen werden.
  Geprüft wird gegen die **Allowlist der zuordenbaren Typen**
  (`ASSIGNABLE_COST_RECORD_TYPES`, abgeleitet aus dem Produktions-Enum): jeder Wert
  außerhalb dieser sechs führt zum Boot-Refusal — auch eine abweichende Schreibweise
  (`Inference`), ein Tippfehler oder das nicht existierende `"call"`. Der Vergleich in
  `cost-truing.js` ist exakt und case-sensitiv; ein solcher Wert wäre sonst genauso
  dauerhaft unerfüllbar wie `inference`, nur ohne Warnung.
  **OWNER-ENTSCHEIDUNG vor dem Deploy:** nicht jeder Call trägt jeden Typ (z.B. läuft
  `ai-voice-assistant` nur, wenn der inzwischen zum Rückbau vorgesehene
  Assistant-Pfad aktiv war — Owner-Entscheidung 5). Welche der sechs wählbaren Typen
  als **Pflicht** in die Menge aufgenommen werden (d.h. ihr Fehlen schließt einen Call
  als `'incomplete'`), muss der Owner anhand eines frischen Live-Belegs festlegen,
  nicht die P3-Kandidatenliste blind übernehmen (P4-Report, Abschnitt 9).
  Konsequenz falsch/leer: Boot-Refusal, `/healthz` nie erreichbar.

- [x] **Session-Zuordnung ist gemessen, nicht angenommen** (LCT-FIX-1) — **nicht
  blockierend, erledigt.** Die zweistufige Beleg-Zuordnung (`assignCostRecords`, bis
  KE-P2 `getVoiceCostRecords`) setzt voraus, dass eine Session **call-lokal** ist. Wäre
  sie es nicht, kippte die Zuordnung von fail-closed nach fail-OPEN: fremde Belege
  landeten auf dem eigenen Tenant. Diese Invariante wurde am 2026-07-21 read-only über das **gesamte
  Telnyx-Konto** geprüft — nicht an einer Stichprobe:

  > 297 Belege, 54 Sessions. **0 Sessions tragen mehr als einen Anker**
  > (`call_control_id`). Verteilung Anker/Session: 27×1, 27×0. Mehrere *Legs* je
  > Session (bis 3) sind normal — das sind die Beine desselben Anrufs.

  Gegenprobe an drei echten Anrufen über beide Pfade (Assistant-Outbound und
  TeXML-Inbound), mit dem echten Anrufsfenster: 7 / 7 / 10 Belege, Pflicht-Typen
  jeweils vollständig, Summen deckungsgleich mit der Einzelabfrage.

  **Grenze der Messung, bewusst benannt:** das Konto hatte zum Messzeitpunkt wenig
  Verkehr, und in der Stichprobe liefen **nie zwei Anrufe gleichzeitig**. Genau
  Parallelität ist der Fall, der die Invariante stressen würde. Sie ist damit gestützt,
  nicht bewiesen — bei nennenswertem Parallelverkehr erneut prüfen (dieselbe Abfrage:
  Sessions mit mehr als einem Anker suchen; jeder Treffer ist ein Abbruchgrund).

  **Laufende Beobachtung statt Deploy-Gate:** die PII-freie Log-Zeile
  `[telnyx/voice] getVoiceCostRecords ok records=… via_anchor=… via_telnyx_session_id=…
  via_call_session_id=… rejected=…` zählt je Zuordnungsweg getrennt (Format testgepinnt).
  `via_anchor` = Identitätsgleichheit, kein Annahme-Risiko; die `via_*_session_id`-Spalten
  sind die Belege, die allein über die Invariante hereinkamen — real 4 von 7 bzw. 9 von 10.
  Auffällig ist nicht ihre Existenz, sondern ein **Sprung** gegenüber diesen Größenordnungen.

  *Warum hier kein blockierendes Vor-Deploy-Gate steht:* die `via_`-Zähler entstehen
  ausschließlich in `assignCostRecords`, deren einziger Aufrufer der Sweep ist — und der
  bucht unkonditional (`COST_TRUING_BOOKING_ENABLED` ist seit P8 entfernt). Eine Auflage
  „prüfen, bevor gebucht wird" wäre nicht ausführbar: wer die Zahlen lesen kann, hat bereits
  gebucht. Statt einer Schein-Sicherung steht deshalb oben die Messung, die vor jedem Deploy
  ohne Buchung wiederholbar ist.

- [ ] **`MAX_BUDGET_EUR` ist live ≥ 9 (= 900 ct).**
  P6 führt eine erste, **fatale** Boot-Guard-Linie (`planCapInertFindings`) ein, die
  prüft, ob die aus dem Business-Plan abgeleitete Tenant-Kostendecke (900 ct) unter
  `platformSpendCapCents` liegt. `render.yaml`/`.env.example`/`src/config.js` halten
  weiterhin bewusst `MAX_BUDGET_EUR=8` (800 ct) — das ist **keine vergessene
  Anhebung**, sondern eine explizite Scope-Entscheidung von P6 (Anhebung gehört laut
  Plan zu PLAN-BUDGET-AXES). **Laut Projekt-Stand steht der Live-Env-Wert im
  Render-Dashboard bereits auf 30** (= 3000 ct, ausreichend) — vor dem Deploy dieser
  Kette aktiv im Dashboard verifizieren, dass sich das nicht geändert hat, und nicht
  versehentlich `render.yaml`/`.env.example`/den Code-Fallback als „die Wahrheit"
  behandeln.
  Konsequenz falsch: Boot-Refusal (`exit(1)`, Meldung enthält `plan_cap_inert`,
  `business`, den konfigurierten Cap-Wert) — Fail-Loud-Verhalten, kein Bug; Behebung
  ist „Render-Dashboard-Wert prüfen/anheben", nicht „Guard aufweichen".

- [ ] **`PROVIDER_TO_BUCKET_RATE_MICRO` liegt im Band [460000..1840000] (0,5×–2,0× um Anker 920000).**
  Seit P4 unkonditional fatal geprüft (`assertProviderRateInBand`), unabhängig vom
  Stand jeder anderen Variable. Häufigster Fehler: Zehnerpotenz-Vertipper (`920`
  statt `920000`). Default `920000` unverändert lassen, außer bei bewusster
  Kurs-Aktualisierung durch den Owner (Entscheidung 7: Kurs wird quartalsweise von
  Hand gepflegt).
  Konsequenz falsch: Boot-Refusal, `/Start abgebrochen/` im Log.

- [ ] **`PLATFORM_ALERT_SMS_TO` bewusst entscheiden (nicht blockierend, aber scharf zu quittieren).**
  Leer = der Tarif-Drift-Alarm (P5) **und** der TTS-Kontingent-Wandalarm (P7) haben
  kein SMS-Ziel — beide bleiben reine Audit-Log-Einträge, keine Warnung erreicht
  einen Menschen. Boot-Guard warnt bei jedem Start (WARN, nicht fatal, blockiert
  den Start nicht). Vor dem Deploy aktiv entscheiden: entweder eine
  Betreiber-Zielnummer eintragen oder den leeren Zustand bewusst als akzeptiertes
  Risiko quittieren, statt ihn stillschweigend laufen zu lassen.

---

## 3. DEPLOY-KONSEQUENZ (bewusst, dokumentiert)

Nach P8 ist die Korrekturbuchung im Code **bedingungslos aktiv**. Der frühere
Schalter `COST_TRUING_BOOKING_ENABLED` existiert nicht mehr (grep über `src/`,
`test/`, `.env.example`, `render.yaml` bestätigt 0 Treffer) — es gibt **keinen
Env-Abschalter mehr**, der den AN-Zweig der Korrekturbuchung deaktivieren könnte.
Ein Deploy dieses Standes schaltet die Korrekturbuchung (Differenz zwischen
gemessenen Ist-Kosten und persistierter Schätzung, Überschätzung bedingungslos
geheilt, Rückerstattung nur bei bewiesener Vollständigkeit der Provider-Records)
ohne Möglichkeit zum Zurückrudern per Konfiguration scharf.

Die ursprünglich im Plan vorgesehene **Zeit-Vorbedingung** für diesen Zustand — ein
voller Abrechnungsmonat Live-Betrieb mit Flag AN, ohne Drift-Alarm — wurde **nicht
erfüllt**. Der Owner hat sie am **2026-07-21 bewusst übergangen**, mit folgender
Begründung (aus dem P8-Report):
- kein Nutzerbestand (null zahlende Nutzer),
- der Flip war **nie live**,
- der maximal mögliche Schaden ist durch `MAX_BUDGET_EUR` (aktuell 30 im Dashboard)
  gedeckelt.

Diese Kette selbst hat nicht deployed — P8 macht den AN-Zustand zum **Code-Default**,
nicht zum Live-Zustand. Ein Produktions-Deploy ist ein separater, späterer Schritt
und **erfordert laut P8-Report eine neue Bewertung zum Zeitpunkt, an dem echte
Nutzer existieren.**

---

## 4. Koordination mit PLAN-BUDGET-AXES

Aus PLAN-LIVE-COST-TRACING.md Kap. 7, Abschnitt „Kollision mit PLAN-BUDGET-AXES"
(verbindlich): Beide Ketten schreiben in dieselben Kanten (`bookCents`,
`addVoiceUsageCostCents`, `spendMonthCostCents`).

- [ ] **PLAN-BUDGET-AXES P7 (Monatsachsen-Flip, Env `BUDGET_MONTH_ENABLED`) und diese
      Kette (Ist-Kosten-Flip) dürfen NICHT im selben Deploy live gehen.** Gehen beide
      zusammen live und der Verbrauch verhält sich unerwartet, ist die Ursache nicht
      mehr zuordenbar.
- [ ] **Reihenfolge-Empfehlung: erst die Monatsachse flippen, dann die Ist-Kosten.**
      Der Monatsschlüssel-Flip ist bereits implementiert und getestet; die Ist-Kosten
      sind neu — die unbewährte Änderung geht zuletzt.
- Aktueller Stand laut `render.yaml`: `BUDGET_MONTH_ENABLED=false` (Monatsachse noch
  nicht geflippt) — vor diesem Deploy prüfen, ob sich das inzwischen geändert hat.
- Nicht blockierend, nur zur Einordnung: PLAN-BUDGET-AXES P8a entwidmet `costCents`
  zu einem reinen Forensik-Wert — mit dieser Kette vereinbar, berührt sie nicht.

---

## 5. Deploy-Mechanik

- **Deploy-Remote ist `upstream` (jonas986), nicht `origin`.** `git push origin`
  macht nichts live — zusätzlich `git push upstream master` nötig.
- `autoDeploy: no` — Deploy muss manuell im Render-Dashboard ausgelöst werden.
- Nach dem Deploy: Live-Commit am `[boot]`-Banner im Server-Log prüfen (bestätigt,
  dass der erwartete Commit tatsächlich läuft, nicht nur der Deploy-Trigger
  gefeuert hat).
- Render Free Tier: Migrationen laufen über `migrate()` beim DB-Connect (`init()`),
  es gibt **kein** `preDeploy`-Hook und keine Shell auf dem Free-Tier — das ist bei
  dieser Kette bereits berücksichtigt (P2-Report: alle Schema-Änderungen additiv,
  `ADD COLUMN IF NOT EXISTS`, kein Backfill, kein Index).
- **`hermes-db` muss von Free auf Paid umgestellt sein**, bevor deployed wird — der
  Free-Tier-Ablauf ist laut Projekt-Memory ein bekanntes Fristproblem
  (`hermes-db-forensik`); ohne Paid-Tier droht DB-Ablauf unabhängig vom Code-Stand
  dieser Kette.

---

## 6. Nachtrag Folgearbeit (NICHT Teil dieser Kette)

- **Rückbau des `ai-voice-assistant`-Pfads** (Owner-Entscheidung 5, PLAN-LIVE-COST-TRACING.md
  Kap. 8) ist explizit **nicht** Teil dieser Kette. Betrifft
  `src/telephony/adapters/telnyx/voice.js` (`startAssistant`, `ai_assistant_start`)
  und `src/config.js` (`telnyx.telnyxAssistant`, `TELNYX_AI_ASSISTANT_ENABLED`).
  **Erst nach dem gemergten Rückbau** (ein grep, der `startAssistant`/
  `ai_assistant_start` nicht mehr im `src/`-Baum findet — nicht die bloße Absicht)
  darf `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` synchron in `config.js`, `.env.example`
  **und** `render.yaml` von `10` auf `5` gesenkt werden (Herleitung: 5,4
  USD-Cent/Min × Kurs 0,92 = 4,968 → aufgerundet 5).
- **Die tatsächliche Senkung von `VOICE_TARIFF_DOMESTIC_CENTS`** (aktuell Default
  `20`, P4b-Owner-Aktion, Zielwert ~10) ist ebenfalls **nicht** Teil dieser Kette.
  Vorbedingungen laut P4b-Report:
  1. Live-Betrieb mit echten Outbound-Calls über einen Beobachtungszeitraum.
  2. `costTruingCoveragePercent` erreicht messbar ≥ `COST_TRUING_MIN_COVERAGE_PERCENT`
     (Default 80 %) **und** P5 (Drift-Wächter) liefert für den betroffenen
     Ziel-Präfix einen **echten** Befund (`underestimate`/`overestimate`), **nicht**
     `insufficient_samples` — ein Sweep-Log, das durchgängig nur „zu wenige Proben"
     meldet, beweist keine Deckung.
  3. Erst dann `VOICE_TARIFF_DOMESTIC_CENTS` senken — der P4b-Guard bleibt dabei
     stumm, weil beide Bedingungen (Tarif < Vollkostenschwelle UND Deckung <
     Mindestquote) dann nicht mehr gleichzeitig zutreffen.
