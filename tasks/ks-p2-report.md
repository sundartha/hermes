# KS-P2 — Laufenden Verbrauch messen (Live-Term auf der Carrier-Achse, nur Outbound)

Stand 2026-07-30. Basis `master` = `f098aa3`. Branch `phase/ks-p2-live-verbrauch`.

## Was gebaut wurde

`blockingBudgetAxis` (`src/budget-gate.js`) fragt nicht mehr "was ist gebucht?", sondern
"was ist gebucht PLUS was laeuft gerade?".

| Neu | Ort |
| --- | --- |
| `liveVoiceSpendCents` (+ privat `liveVoiceMinutesOf`) | `src/billing/metering.js` |
| `activeOutboundCallsFor` | `src/store/state-ops.js` |
| `liveBudgetExceeded` (und `budgetExceeded` darueber ausgedrueckt) | `src/store/state-ops.js` |
| Fassaden-Wrapper + Re-Exports | `src/store/json.js`, `src/store/pg.js`, `src/store.js` |
| `callStartAnchorMs` von privat auf `export` | `src/store/state-ops.js` |

Keine neue Datei, keine neue Dependency, kein neuer Env-Schluessel, keine Aenderung an
`.env.example` / `render.yaml` / `src/config.js`.

## Zwei Design-Entscheidungen

### D-A — TOD 6 / TOD 7: Variante (b), der Live-Term ist eine TENANT-Groesse

Der Term summiert die verstrichene Zeit **aller** aktiven Outbound-Legs des Tenants, statt
die Reserve beim Boot zu rekonstruieren. Begruendung:

- deckt TOD 6 **und** TOD 7 mit demselben Code. Die Reserve ist strukturell ephemer (nie
  persistiert, nie hydriert) und nach jedem Deploy 0 — eine Zusage "die Reserve deckt die
  Gleichzeitigkeit" waere nach einem Deploy leer;
- braucht keine Migration, keinen neuen persistierten Zustand, keinen Boot-Hook;
- die Unterzaehlung aus TOD 7 (jeder Turn saehe nur seine eigene Zeit, die der uebrigen
  N-1 Legs fiele unter den Tisch) kann strukturell nicht entstehen.

### D-B — AUSDRUECKLICHE ABWEICHUNG von Abnahmekriterium 1 und 2

`blockingBudgetAxis` behaelt seine Signatur `{ store, billing, tenantId }`. Kein
`call`-Parameter, kein Edit an `src/claude.js`, `src/telnyx-llm-shim.js`,
`src/routes/voice.js`.

Abnahmekriterien 1 und 2 ("`call` als Pflichtfeld durchreichen, beide Aufrufer nachziehen")
sind fuer die call-lokale Variante (a) geschrieben. Unter (b) ist die verstrichene Zeit eine
Eigenschaft des **Tenants**, nicht des rufenden Legs. Ein `call`-Parameter waere dann
(i) redundant, (ii) eine Gelegenheit, das falsche/veraltete Call-Objekt zu uebergeben, und
(iii) eine Einladung, den Term spaeter wieder call-lokal zu machen = genau TOD 7.

Das **Ziel** von Kriterium 2 ("ein Gate, das ein Aufrufer per No-op abschalten darf, ist
keines") wird dabei nicht abgeschwaecht, sondern in seiner staerksten Form erreicht (G27,
Struktur schlaegt Konvention): es gibt **kein** vom Aufrufer geliefertes Datum mehr, das man
vergessen, nullen oder falsch fuellen koennte. Der Term wird vollstaendig innerhalb der
Gate-Kette aus dem Store gezogen. Der Blast-Radius sinkt damit auf die Geld-Kante selbst.

## Tests

Neu: `test/ks-p2-live-carrier-spend.test.js`, 12 Tests, alle gruen. Fixierter Minutensatz
50 ct (`VOICE_TARIFF_DEFAULT_CENTS=50`, `VOICE_TARIFF_DOMESTIC_CENTS=0`, Leg `+1 -> +49`).

Bestandstests angepasst (jede Aenderung folgt aus der neuen Fassaden-Kante, keine
Erwartung wurde abgeschwaecht):

- `test/telnyx-shim-harness.js` — `fakeStore` bekommt `activeOutboundCallsFor` (liefert den
  geseedeten Leg ECHT) + `liveBudgetExceeded`; `makeCall` bekommt Richtung, Zeitanker und
  beide Nummern (ohne die liefe jeder Bestandstest zufaellig ueber NaN-Arithmetik).
- `test/telnyx-llm-shim.test.js` — dieselbe Ergaenzung an seinem eigenen `fakeStore`, an
  seinem `makeCall` UND am zweiten Inline-Store-Literal (`P5-Rate`, im Plan uebersehen:
  ohne die Ergaenzung `TypeError: store.activeOutboundCallsFor is not a function`).
- `test/telnyx-k0-turn-seq.test.js` — Inline-Store-Literal (K0-5).
- `test/al-p6-turn-deadline-budget.test.js` — Tarife auf 0 gepinnt (Lehre
  `test-base-env-drift`; die Achse dieser Datei ist die KI-Token-Achse).

Nicht angefasst und gruen: alle Spawn-Tests (BASE_ENV setzt beide Tarife auf 0 → Live-Term
0 → byte-identisches Verhalten), die Dial-Gate-Tests (stubben `budgetExceeded`, das
unveraendert bleibt) und die Direkt-Aufrufer von `ops.budgetExceeded`
(`budget-nan-fail-closed`, `budget-month-flip`, `gap-01-period-budget-axis`,
`tenant-budget-cap`, `store-pg-tenant-budget`, `tts-quota-counter`) — genau das ist die
Probe, dass die Delegation `budgetExceeded -> liveBudgetExceeded(..., 0, ...)` nichts
verschiebt.

## Mutationsproben (alle gefahren)

| Mutation | erwartet | GEMESSEN |
| --- | --- | --- |
| `store.liveBudgetExceeded` → `store.budgetExceeded` in `budget-gate.js` | 1, 6, 11, 12 rot | **10 rot** (1-6, 8, 9, 11, 12) |
| `Math.max(0, …)` in `liveVoiceMinutesOf` entfernt | 5 rot | 5 rot (nur) |
| `if (!Number.isFinite(elapsedMs)) return NaN;` → `return 0;` | 4 rot | 4 rot (nur) |
| `isBookableCents(liveCents)`-Riegel entfernt | 4 rot | 4 rot (nur) |
| Filter `direction === "outbound"` entfernt | 2 rot | 2 rot (nur) — **erst nach einer Testkorrektur**, s. u. |
| `Math.ceil` → `Math.floor` | 7 rot | 1, 2, 6, 7, 11, 12 rot |

Zwei Abweichungen von der Plan-Erwartung, beide bewusst:

1. **Mutation 1 faerbt 10 statt 4 Tests rot.** Der Fassaden-Fake der Praedikat-Tests
   (`storeOver`) exponiert AUSSCHLIESSLICH die zwei Methoden, die `blockingBudgetAxis`
   aufrufen darf — ein Rueckbau auf `budgetExceeded` wirft dort `TypeError` statt still ein
   anderes Ergebnis zu liefern. Das ist ein staerkeres, nicht ein schwaecheres Signal.
2. **Der `direction`-Filter war im ersten Entwurf NICHT gedeckt.** KS-P2-2 nutzte anfangs
   einen Inbound-Leg mit `to = +49`; `callTariffCentsPerMin` rechnet fuer Inbound
   `tariffCentsPerMin(to, to)` → Inlandssatz 0 → der Test bestand auch OHNE den Filter. Der
   Test baut jetzt die realistische Inbound-Form (eigene DID in `+1`, Anrufer in `+49`) und
   assertiert zusaetzlich, dass derselbe Leg 100 ct WERT waere — nur die Richtung haelt ihn
   aus der Summe. Danach ist die Mutation rot.

## Testlaeufe

- `node --check` auf alle sechs geaenderten `src/`-Dateien: sauber.
- `node --test test/ks-p2-live-carrier-spend.test.js`: 12/12.
- Die 15 beruehrten Bestandsflaechen isoliert: gruen.
- `npm test` (volle Regressionssuite, json + pglite-in-process): **3550 pass / 0 fail**.
- `test/env-docs-spend-cap-coherence.test.js`: gruen (KS-P2 aendert weder Tarif-Fallback
  noch Decken noch Blueprint-Werte).

## Drei bewusst getragene Restrisiken

1. **Die Plattform-Achse bleibt mid-call blind** (E6/TOD 11). `globalBudgetExceeded`
   existiert seit KS-P9/E10 als Sperre nicht mehr; der einzige In-Flight-Schutz der
   Plattform ist `globalReserveExceedsBudget` am Dial-Gate.
2. **Die Vorab-Reservierung ist strukturell ephemer** — nie persistiert, nie hydriert, nach
   jedem Neustart 0. KS-P2 verlaesst sich fuer die Gleichzeitigkeit deshalb nicht auf sie;
   die Reserve bleibt unangetastet, ist aber kein Deploy-fester Schutz.
3. **pg-Spiegel-Grenze.** Ein Leg, das eine andere Instanz nach unserem `hydrate()` angelegt
   hat, fehlt in der Summe — der Live-Term unterzaehlt dann, er ueberzaehlt nie.

## Nachbarbefund (NICHT gefixt, ausserhalb dieser Phase)

Das Dial-Gate (`src/telephony/outbound-gates.js` → `store.budgetExceeded`) und der
Inbound-Reject (`src/routes/voice.js`) sehen den Live-Term weiterhin nicht. Mit Variante (b)
waere das ein Einzeiler je Stelle, aendert aber das 402-Verhalten vor dem Waehlen bzw. die
Annahmeentscheidung fuer eingehende Anrufe — beides eigene Owner-Entscheidungen, nicht
Gegenstand von KS-P2.
