# KS-P3 — Phasenbericht (Reserve entkoppelt + guthaben-abgeleitete Notbremse)

Branch: `phase/ks-p3-zeitgrenze-notbremse` (Basis: `master` 5bc9f93)
Umgesetzt: 2026-07-30. Owner-Entscheidungen E2/E3 (keine feste Maximaldauer) und E8 (Puffer 1 Minute).

## 1. Die neue Zeit-/Kosten-Kante in Zahlen

| Groesse | Vorher | Nachher |
|---|---|---|
| Vorab-Reserve je Outbound | `Satz * ceil(maxDur/60)` — bei 30 ct/min und 300 s: **150 ct** | `Satz * RESERVE_LEAD_MINUTES` = `Satz * 2` — bei 30 ct/min: **60 ct** |
| Zeitgrenze je Leg | fest `MAX_CALL_DURATION_S` (Env, live 180 s), geklemmt auf 300 s | `min((Restminuten + 1) * 60, 1800 s)` aus dem Restguthaben |
| Absolute Obergrenze | `MAX_CALL_DURATION_CAP_S` = 300 s | `MAX_CALL_DURATION_CAP_S` = **1800 s**, hartkodiert |
| Beleg-Abrufmarge (`POOL_SINCE_MARGIN_MS`) | fest 1 h | `12 * MAX_CALL_DURATION_CAP_S` = 6 h (**abgeleitet**, veraltet nicht mehr) |

Rechenbeispiel der Notbremse bei 30 ct/min: 300 ct Rest -> 10 bezahlbare Minuten + 1 Puffer-Minute = **660 s**;
1 000 000 ct Rest -> geklemmt auf **1800 s**; 0 ct Rest -> **60 s** (der Puffer allein, nie 0).

## 2. Was gebaut wurde

**Neue Symbole** (keine neue Datei, keine neue Dependency, kein neuer Env-Schluessel — einer ist entfallen):

- `src/store/defaults.js`: `RESERVE_LEAD_MINUTES = 2`, `outboundReserveCents(tariffCentsPerMin)`,
  `MAX_CALL_DURATION_CAP_S` 300 -> 1800, `DEFAULT_CALL_DURATION_S` **geloescht** (ohne Aufrufer, F4/G9).
- `src/call-duration.js`: `BRAKE_BUFFER_MINUTES = 1`, `emergencyBrakeSeconds({remainingCents, tariffCentsPerMin})`
  plus der private Helfer `affordableMinutes`.

**Entfallen:** `config.safety.maxCallDurationS` (Env `MAX_CALL_DURATION_S`) und die private
`worstCaseReserveCents` in `boot-guard.js` (G5: die Formel stand doppelt).

**Zwei Aufrufer der Notbremse**, beide nur Eingaben-Beschaffung um dieselbe reine Regel:
`brakeSecondsFor` im `compute_reserve`-Gate (`outbound-gates.js`) und `brakeSecondsFor(leg)` in
`routes/voice.js` (Inbound, `callTariffCentsPerMin` traegt die Richtungsregel).

**`compute_reserve` hat jetzt zwei UNABHAENGIGE Ableitungen**: Reserve = Satz x Vorlauffenster,
Frist = Notbremse (vom Body hoechstens verkuerzt). Das Gate liest seit dieser Phase den Store,
lehnt aber weiterhin **nie** ab; `GATE_CHAIN_LENGTH` bleibt 17.

## 3. Mutationsproben (alle vier durchgefuehrt)

| Mutation | Erwartung | Ergebnis |
|---|---|---|
| `BRAKE_BUFFER_MINUTES = 0` | Puffer-Zusage + Untergrenze faerben rot | **3 von 5** Tests in `ks-p3-emergency-brake` rot |
| `compute_reserve` zurueck auf `tariff * ceil(maxDur/60)` | Dauer-Unabhaengigkeit faerbt rot | genau **1** Test rot (die Kernaussage), Rest gruen |
| `/voice/incoming` ohne `maxDurationS: brakeSecondsFor(...)` | Inbound-Persistenz faerbt rot | Spawn-Test rot (`maxDurationS` bleibt `null`) |
| Boot mit `VOICE_TARIFF_DEFAULT_CENTS=800` | Klausel B feuert weiterhin fatal | `exit 1`, Meldung `Worst-Case-Reserve 1600 Cent (... * 2 Vorlauf-Minuten) ... mindestens 1600` |

## 4. Verifikation

- `node --check` auf alle geaenderten Module: sauber.
- **Regressionslauf** (`npm test`-Partition): 3626 Tests. Zwei Vollaeufe: der erste **0 fail**;
  der zweite (nur Kommentar-/Doku-Edits dazwischen) 1 rot mit `fetch failed` nach 8 s in
  `HC6 Flag AUS` — **isoliert gruen** (10/10 in `assistant-context-http.test.js`), die
  Nachbarn HC7/HC8/HC9 im selben Lauf gruen. Das ist der dokumentierte Spawn-Race-Flake
  unter Voll-Last, kein Befund dieser Phase (Protokoll: rot nur echt, wenn isoliert rot).
- **Gates-Lauf** (`test:gates`-Partition): 543 Tests, **3 rot** — exakt die Baseline von `master`
  (GAP-05, GAP-15 x2). Baseline vor dem ersten Edit ueber `git archive master` erhoben
  (540 Tests, 537 pass, dieselben 3 IDs) und gegenuebergestellt: **keine neue Rot-Zeile
  durch diese Phase**. Die 3 zusaetzlichen Tests sind die Katalog-tragenden Faelle dieser Phase.
- **Boot-Smoke**: `/healthz` = 200, keine Zeile `Start abgebrochen`,
  `Kosten-Decken: Tenant-Default 1500 ct | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min`.
  Der 1800er-Cap toetet den Boot nicht (das war der Zweck von D2: die Dauer faellt aus beiden
  Guard-Signaturen heraus).

### Umgebungs-Befund (kein Phasen-Defekt)

`npm test` / `npm start` liefern in **diesem Worktree** keinerlei Ausgabe und brechen mit Exit 194 ab;
die identische Invocation direkt ueber `node --test` bzw. `node src/server.js` laeuft vollstaendig
durch, und `npm run test:gates` im per `git archive` ausgepackten `master`-Baum funktioniert normal.
Der Befund ist also npm-/worktree-spezifisch und **nicht** durch diese Phase verursacht.
Alle oben genannten Laeufe wurden deshalb mit der ausgeschriebenen `node --test`-Invocation
(identisches Skip-/Name-Pattern aus `package.json` `config.i18nCatalogPattern`) gefahren.

## 5. Neue Tests

- `test/ks-p3-emergency-brake.test.js` (5) — Tabelle + zwei Eigenschafts-Tests
  (Puffer-Zusage, Monotonie), offline und ohne gepinnte Kalibrierungszahlen.
- `test/ks-p3-reserve-decoupled.test.js` (6) — Dauer-Unabhaengigkeit der Reserve, feindliche
  `max_duration_s`-Werte, Dauer-Blindheit beider Boot-Guards + Gegenprobe der Schaerfe.
- `test/ks-p3-brake-wiring.test.js` (4) — Outbound-Frist aus dem Guthaben, "Override kann nur
  kuerzen", D7 am Gate (Frist lang, Geld-Gate sperrt trotzdem ziffernfrei), Inbound-Spawn.

## 6. Angepasste Bestandstests (jeweils mit Begruendung im Kommentar)

Signatur-/Formel-Folgen: `outbound-gates`, `outbound-gates-order`, `spend-cap-coherence`,
`gap-32-worst-case-fatal`, `env-docs-spend-cap-coherence` (Pre-Merge-Gate), `ks-p3a-plan-cap-reserve-guard`,
`ks-p5a-plan-cap-carries-sold-minutes`, `pay-04-starter-reserve-charakterisierung`,
`orig-01-05-cost-origin`, `cost-origin-axis`, `boot-failclosed` (T-P3-12: 600/300 ist jetzt
kohaerent -> 500/300), `telnyx-p5-gate-proof`, `outbound-reserve-{backstop,concurrency-http,release-success}`
(Tarif 200/600 -> 300, damit "eine Reserve passt, zwei nicht" wieder gilt).

Marge-Folgen: `cost-truing-since` (+ neuer Eigenschafts-Assert, der den naechsten Cap-Wechsel
ueberlebt), `cost-truing-retrievable`.

Tote Schluessel entfernt (G12): `helpers.js` `BASE_ENV.MAX_CALL_DURATION_S`,
`config-namespaces` (safety 11 -> 10, gesamt 133 -> 132), `config-failclosed` T-P2-04 auf
`TELNYX_DEAD_AIR_TIMEOUT_S` umgehaengt, dazu vier Fixture-Keys in
`cap-failure-reason`/`budget-failure-reason`/`gap-35-metrics-country`/`p4-billing-hold-gate`.

`p15-mcp-tool-descriptions-en`: die gepinnte Emphase-Inventur fuer `place_call.max_duration_s`
geht von `[]` auf `["SHORTER"]` — die alte Beschreibung nannte zwei Zahlen ("default 180, max 300"),
die es nicht mehr gibt. Bewusst nachgezogen statt die Emphase wegzuschreiben: dass ein
Client-Wunsch die Frist nur VERKUERZEN kann, ist die eigentliche Verhaltensgarantie des Feldes.

## 7. Getragene Restrisiken (benannt, nicht behoben)

1. **Teure Ziele.** Bis zu `Decke / 30 ct` Minuten je Periode — die Kosten-Achse rechnet mit
   UNSEREM Satz, nicht dem Zielpreis (TOD 1, Kuba). Gegenmittel ist die Sperrliste aus KS-P7,
   die bewusst VOR dieser Phase steht.
2. **Bestands-Calls ueber den Deploy.** Zeilen ohne `maxDurationS` fallen auf 1800 s statt
   vorher 180 s. Bounded auf die zum Deploy-Zeitpunkt aktiven Legs; der Live-Zaehler greift
   beim naechsten Turn. Eine Migration fuer < 10 Minuten Uebergang waere unverhaeltnismaessig.
3. **Boot-Re-Arm ohne Geld-Gate.** `rearmActiveCallTimers` prueft — anders als der Re-Attach
   seit KS-P1b — die Geld-Achse nicht; ein re-armter Call behaelt seine alte Frist. Befund einer
   Nachbarphase, hier nur notiert (Spec-Regel: nicht nebenbei fixen).
4. **Reserve deckt die Gleichzeitigkeit nur noch 2 Minuten.** Alles darueber deckt der
   KS-P2-Live-Term, der ueber alle aktiven Outbound-Legs des Tenants summiert. Bleibende Kante
   ist genau das Fenster zwischen Dial und erstem Turn — dafuer ist die Reserve da.

## 8. Ausdruecklich NICHT angefasst

`disclosureSentence`, Auth/Signaturpruefung, `OUTBOUND_FROZEN`, Abo+KYC, Denylist, Land-Gate,
Stundenlimit, Per-Target-Cap, die pro-Tenant-Kostendecke, `MAX_BUDGET_EUR` (KS-P9),
Prozentanzeige (KS-P8), Inbound-Budget-Sperre (KS-P10 zurueckgezogen), die AL-P2-Spike-Reste.
`bridge.js` (HEIKLE STELLE): genau EIN Argument-Tausch, Barge-in und Call-Ende unberuehrt.
`TELNYX_DEAD_AIR_TIMEOUT_S` behaelt `max: 300` — ein Watchdog jenseits von 5 Minuten waere inert;
geaendert wurde nur seine Begruendung (sie leitete sich frueher aus dem Cap ab).

## 9. Deploy-Hinweis

`MAX_CALL_DURATION_S` wird nicht mehr gelesen. Ein im Render-Dashboard stehengebliebener Wert ist
ab diesem Deploy **wirkungslos** — er kann kein Gespraech mehr kuerzen. Aufraeumen darf der Owner,
muss er aber nicht (`tasks/ks-deploy-checkliste.md` traegt den Hinweis).
