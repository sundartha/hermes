# Phasenbericht KS-P2 — Live-Verbrauch der Carrier-Achse (nur Outbound)

**Status:** Gate = **PASS**
**finalBranch:** `phase/ks-p2-live-verbrauch`
**headCommit:** `7c720c36913bf9fcbd608950fa2914921dd5f32f`
**Basis:** `master` = `f098aa3`

---

## 1. Ausgangslage

`blockingBudgetAxis` (die Mid-Call-Budgetpruefung) sah bis KS-P2 nur den bereits **gebuchten**
Verbrauch der Carrier-Achse (`store.budgetExceeded`). Die Carrier-Minuten werden aber erst bei
Call-Ende gebucht (`reconcileOutboundVoiceBudget`), waehrend die KI-Token-Achse in jeder
Schleifenrunde bucht — die teurere Achse war mid-call blind. KS-P2 schliesst diese Luecke, indem
`blockingBudgetAxis` zusaetzlich den noch nicht gebuchten, aber bereits verstrichenen Verbrauch
("Live-Term") einrechnet.

---

## 2. Plan (gekuerzt)

### 2.1 Zwei vorab getroffene Design-Entscheidungen

**D-A — TOD 6/TOD 7: Variante (b), nicht (a).** `PLAN-KOSTEN-STEUERUNG.md` verlangte eine
begruendete Wahl zwischen (a) die Reserve beim Boot rekonstruieren und (b) der Live-Term summiert
die verstrichene Zeit **aller** aktiven Outbound-Calls des Tenants. Gewaehlt: **(b)** — deckt TOD 6
und TOD 7 mit demselben Code, braucht keine Migration/keinen Boot-Hook/keinen neuen persistierten
Zustand, und die Unterzaehlung aus TOD 7 kann strukturell nicht entstehen (die Reserve ist nach
jedem Deploy 0 und waere als "Gleichzeitigkeitsschutz" eine leere Zusage).

**D-B — Folge aus D-A: `blockingBudgetAxis` behaelt seine Signatur `{ store, billing, tenantId }`.**
Bewusste Abweichung von Abnahmekriterium 1/2 der Spec (die fuer die call-lokale Variante (a)
geschrieben sind): unter (b) ist die verstrichene Zeit eine Tenant-Groesse (Summe ueber alle
laufenden Outbound-Legs), kein `call`-Parameter waere redundant, eine Fehlerquelle (veraltetes
Call-Objekt) und eine Einladung, den Term spaeter wieder call-lokal zu machen (= TOD 7). Das Ziel
von Kriterium 2 ("ein Gate, das ein Aufrufer per No-op abschalten darf, ist keines") wird dabei in
seiner staerksten Form erreicht: es gibt kein vom Aufrufer geliefertes Datum mehr, das man
vergessen/nullen/falsch fuellen koennte (G27). Praktische Folge: `src/claude.js`,
`src/telnyx-llm-shim.js`, `src/routes/voice.js` werden nicht angefasst.

### 2.2 Neue Funktionen (keine neue Datei)

| Funktion | Ort | Begruendung |
|---|---|---|
| `liveVoiceSpendCents` (+ privat `liveVoiceMinutesOf`) | `src/billing/metering.js` | neben `voiceMinutesOf` (gleiche ceil-Rundung) und `callTariffCentsPerMin` — Vorhersage genau der Buchung von `reconcileOutboundVoiceBudget` |
| `activeOutboundCallsFor` | `src/store/state-ops.js` | Leseprojektion neben `countOutboundCallsSince` |
| `liveBudgetExceeded` | `src/store/state-ops.js` | Schwester von `budgetExceeded`/`reserveExceedsBudget`; `budgetExceeded` wird darueber ausgedrueckt (G5) |

Kein neuer Env-Schluessel, keine neue Dependency, keine Aenderung an `.env.example`/`render.yaml`/
`src/config.js`.

### 2.3 Kompositionspunkt

`src/budget-gate.js`: `blockingBudgetAxis` berechnet `nowMs = Date.now()`, zieht
`liveVoiceSpendCents(store.activeOutboundCallsFor(tenantId), nowMs)` und fragt
`store.liveBudgetExceeded(tenantId, liveCents, billing)` statt `store.budgetExceeded`.

### 2.4 Fassaden-Durchreichung

`src/store/json.js`, `src/store/pg.js` bekommen Wrapper fuer `liveBudgetExceeded` +
`activeOutboundCallsFor`; `src/store.js` re-exportiert beide. `callStartAnchorMs` wird von privat
auf `export` gehoben (zweiter Konsument in `metering.js`).

### 2.5 Fail-closed-Kante

`liveBudgetExceeded(s, tenantId, liveCents, cfg, nowIso)` laeuft ueber denselben D7-Riegel
(`isBookableCents`/`denyCorruptUsage`) wie der Bestand — unlesbarer Zeitanker liefert NaN statt
stillem 0, geloggt mit eigenem Feldnamen `feld=liveCents`. Uhr-Ruecksprung clampt auf 0. Die
Vorab-Reserve zaehlt bewusst NICHT mit (TOD 2 — sonst liefe der Call gegen sich selbst).

### 2.6 Tests (Plan)

Neue Datei `test/ks-p2-live-carrier-spend.test.js`, 12 Faelle (Cap-Riss durch reinen Live-Term,
Inbound zaehlt nicht, Reserve zaehlt nicht mit, NaN-Anker fail-closed mit Log-Wortlaut,
Uhr-Ruecksprung clampt auf 0, zwei gleichzeitige Legs summieren, Rundungsgrenzen 0/1/60000/60001ms,
fremder Tenant, beendeter Leg, `budgetExceeded` unveraendert, End-zu-Ende Engine-Spawn,
End-zu-Ende Shim). Sechs Mutationsproben definiert. Bestandstests mit Store-Fakes/-Literalen
(`telnyx-shim-harness.js`, `telnyx-llm-shim.test.js`, `telnyx-k0-turn-seq.test.js`) muessen die
zwei neuen Methoden nachziehen; `al-p6-turn-deadline-budget.test.js` pinnt die Tarif-Env auf 0
(Lehre `test-base-env-drift`).

### 2.7 Explizit NICHT Teil dieser Phase

Kein `call`-Parameter an `blockingBudgetAxis`; kein Live-Term am Dial-Gate
(`outbound-gates.js`/`budgetExceeded`) oder im Inbound-Reject (`routes/voice.js`); keine Aenderung
an `MAX_CALL_DURATION_S`/`_CAP_S`, Tarifen, Plan-Decken, Boot-Guards.

---

## 3. Impl-Zusammenfassung

`blockingBudgetAxis` (src/budget-gate.js) fragt jetzt "was ist gebucht PLUS was laeuft gerade?"
statt nur "was ist gebucht?". Umgesetzt wie geplant: 6 src-Dateien editiert
(`budget-gate.js`, `billing/metering.js`, `store/state-ops.js`, `store/json.js`, `store/pg.js`,
`store.js`), keine neue Datei in `src/`. `PLAN-SECURITY.md` um Abschnitt "KS-P2" ergaenzt
(Wirkungsrichtung strenger-nie-lockerer, Fail-closed-Kante, unberuehrte Flaechen, drei bewusst
getragene Restrisiken: Plattform-Achse bleibt mid-call blind, Reserve ist strukturell ephemer,
pg-Spiegel-Grenze unterzaehlt statt ueberzaehlt).

Tests: `test/ks-p2-live-carrier-spend.test.js` (12 neu) + 4 Bestandsdateien nachgezogen
(`telnyx-shim-harness.js`, `telnyx-llm-shim.test.js`, `telnyx-k0-turn-seq.test.js`,
`al-p6-turn-deadline-budget.test.js`). `node --check` auf allen 6 geaenderten src-Dateien gruen.
Voller `npm test`: 3550/3550, 0 fail (ein einzelner Lauf zeigte 1 Flake, zweimal davor/danach
voll gruen — Gate-Protokoll gemaess Memory `suite-flake-p5-gate-proof-spawn-race`: rot zaehlt nur
isoliert rot). Smoke-Test gruen in beide Richtungen (positiv: Live-Term reisst den Cap, Ansage +
Hangup, `runden=0` beweist kein Token verbrannt; negativ: frischer Leg mit 0 verstrichenen Minuten
laeuft durchs Gate).

### Deviations (gegenueber Plan)

1. **D-B bestaetigt** — ausdrueckliche Abweichung von Abnahmekriterium 1/2, wie im Plan
   begruendet. Kein `call`-Parameter, `claude.js`/`telnyx-llm-shim.js`/`routes/voice.js`
   unangetastet.
2. Plan uebersah ein **zweites** Inline-Store-Literal in `test/telnyx-llm-shim.test.js`
   (Test "P5-Rate"), das ohne Nachzug `TypeError: store.activeOutboundCallsFor is not a function`
   warf — nachgezogen.
3. Plan uebersah, dass `test/telnyx-shim-harness.js` `src/config.js` **statisch** importiert; ein
   statischer Import in der neuen Testdatei haette die lokale `.env`-Tarif-Drift eingefroren
   (gemessen 30 statt gepinnter 50) — Harness wird jetzt dynamisch nach dem Setzen der Tarif-Env
   geladen.
4. **Echte Testluecke gefunden und geschlossen:** KS-P2-2 (Inbound zaehlt nicht) baute den
   Inbound-Leg zunaechst mit `to = +49`, wo der Inlandssatz 0 den Test auch OHNE den
   `direction`-Filter gruen liess. Test korrigiert auf realistische Form (eigene DID in +1,
   Anrufer +49) — jetzt faerbt die Mutation korrekt rot.
5. Mutationsprobe 1 (`liveBudgetExceeded` → `budgetExceeded` zurueckgebaut) faerbt **10** statt
   der geplanten 4 Tests rot — der Fassaden-Fake exponiert nur die zwei erlaubten Methoden, ein
   Rueckbau wirft `TypeError` statt eines leiseren Verhaltensunterschieds. Staerkeres Signal.
6. Mutationsprobe 6 (`Math.ceil` → `Math.floor`) faerbt **6** statt 1 Test rot (Rundung traegt
   mehr Assertions als angenommen). Ebenfalls staerkeres Signal.
7. Smoke-Test brauchte zusaetzliche Boot-Guard-Werte (TWILIO_ACCOUNT_SID/_AUTH_TOKEN/PUBLIC_URL,
   `COST_TRUING_REQUIRED_RECORD_TYPES` nicht-leer) — Bestandsblocker, nicht KS-P2-bezogen.
8. Ein selbstreferenzieller `node_modules`-Symlink im Worktree wurde lokal repariert (nicht
   committet, gitignored).

---

## 4. Mutationsproben-Tabelle (gefahren)

| Mutation | Erwartet (Plan) | Tatsaechlich | Bewertung |
|---|---|---|---|
| `store.liveBudgetExceeded` → `store.budgetExceeded` in budget-gate.js | 4 rot (1,6,11,12) | **10 rot** | staerkeres Signal (Fassade wirft TypeError statt stillem Fallback) |
| `Math.max(0, …)` in `liveVoiceMinutesOf` entfernen | 5 rot | 5 rot | wie erwartet |
| `if (!Number.isFinite(elapsedMs)) return NaN` → `return 0` | 4 rot | 4 rot | wie erwartet |
| `isBookableCents(liveCents)`-Riegel entfernen | 4 rot | 4 rot | wie erwartet |
| Filter `direction === "outbound"` entfernen | 2 rot | 2 rot (nach Testkorrektur, s. Deviation 4) | wie erwartet, Test vorher zu schwach |
| `Math.ceil` → `Math.floor` | 7 rot | **6 rot** (1,2,6,7,11,12) | staerkeres Signal |

---

## 5. Safety-Urteil

**Verdict: FREIGABE (approved).** Alle sieben absoluten Regeln eingehalten, unabhaengige Laeufe
gruen (Branch 3570/3570 im Wiederholungslauf, Master-Basis 3558/0, Delta exakt +12 = die neuen
Tests; Gates 534 Tests, 3 fail = deckungsgleich mit dem dokumentierten Bestand, kein neues Rot).

Formaler Beweis der Richtung (Regel 1, SAFETY-GATES): `liveVoiceMinutesOf` clampt mit
`Math.max(0, …)`, also `liveCents >= 0` oder `NaN`; `NaN` faellt in `denyCorruptUsage` → `true`.
Das Ergebnis ist damit immer eine Obermenge des bisherigen Verhaltens — strenger, nie lockerer.
`budgetExceeded(s, tenantId, 0, cfg, nowIso)` kollabiert wegen `isBookableCents(0) === true`
byte-identisch auf `spent >= cap`; Dial-Gate, Inbound-Reject, `reserveExceedsBudget`,
`tryReserveOutboundBudget`, `tenantBudgetSnapshot` unveraendert (von KS-P2-10 gepinnt).
Offenlegung, Auth, Secrets, Audio: kein Diff in den betroffenen Dateien.

### Concerns (keiner blockiert)

1. **D-B verdient Owner-Sichtbarkeit** — Abweichung von Abnahmekriterium 1/2, durch Plan-TOD 6/7
   gedeckt, aber ausdruecklich zu bestaetigen.
2. **Heisser Pfad O(n):** `activeOutboundCallsFor` scannt linear ueber alle hydrierten Calls pro
   Turn/Schleifenrunde — korrektheitsfrei, aber Kandidat fuer Index/Cache bei Skala.
3. **Fassaden-Leck (schmal):** `activeOutboundCallsFor` liefert Live-Referenzen auf interne
   Call-Records (inkl. Transcript/PII), keine Projektion — konsistent zum Bestandsmuster
   (`getCall`), einziger Konsument mutiert nichts.
4. **Neue Ausfallart, nicht in den drei dokumentierten Restrisiken:** ein faelschlich auf
   `status="active"` haengender Leg (verlorener Hangup-Webhook) vergiftet die Mid-Call-Achse des
   ganzen Tenants — auch fuer Inbound-Gespraeche. Zeitlich gedeckelt durch
   `armMaxDurationTimer`/`rearmActiveCallTimers`, aber sollte im Report neben den drei genannten
   Risiken stehen (hiermit nachgetragen).
5. Modul-Kopplung `budget-gate.js → billing/metering.js → {state-ops.js, outbound-gates.js}`
   spec-konform, kein Import-Zyklus.
6. pg-Kante nur strukturell (Methodenmengen-Parity) getestet, nicht verhaltensmaessig gegen den
   Spiegel — im Code als Restrisiko 3 (PLAN-SECURITY.md) korrekt gefuehrt.
7. Suite-Blindfleck: `BASE_ENV` pinnt Tarife auf 0 in allen Spawn-Tests ausser KS-P2-11 — gewollt
   (Determinismus), heisst aber der neue Term wird ausschliesslich von der dedizierten Datei
   geprueft.

---

## 6. Clean-Code-Audit

**Verdict: PASS.** s1/s2/s3/s4 = **leer** (keine Befunde in irgendeiner Schwere-Klasse).

Begruendung: alle Aenderungen folgen Bestandsmustern (Fassaden-Re-Export wie
`reserveExceedsBudget`, D7-Riegel wie im Bestand). `budgetExceeded` byte-identisch ueber
`liveBudgetExceeded(...,0,...)` ausgedrueckt statt dupliziert (G5 sauber). Fail-closed korrekt.
Reserve bewusst ausgeschlossen, Inbound/fremde Tenants/beendete Legs strukturell ausgefiltert.
`blockingBudgetAxis`-Signatur unveraendert, beide Aufrufer brauchten keine Anpassung; D-B im
Report explizit begruendet, nicht stillschweigend. Bestandstests korrekt nachgezogen, neue Suite
deckt Grenzbedingungen ab. `PLAN-SECURITY.md` dokumentiert Restrisiken statt sie zu verschweigen.

Verifiziert: `node --check` auf allen 6 geaenderten src-Dateien gruen; gezielter Testlauf der
direkt betroffenen Dateien 86/86 gruen; `isBookableCents(0) === true` bestaetigt. Voller
`npm test` wurde vom Auditor selbst wegen paralleler Last **nicht** bis zum Ende gefahren (Lehre
`al-parallelism-load-limit`) — dafuer aber unabhaengig vom Safety-Reviewer vollstaendig
nachgeholt (s. Abschnitt 5, 3550/3550 bzw. 3570/3570).

Offene To-Dos (nicht blockierend): vor Merge einen isolierten vollen `npm test` fahren (vom
Safety-Review bereits nachgeholt); Restrisiko "Plattform-Achse bleibt mid-call blind" als
Folgearbeit im Backlog halten.

Selbst-Check des Implementierers (clean-code.md durchgegangen): F1 (>3 Argumente,
`liveBudgetExceeded` mit 5) bewusste Ausnahme, spiegelt exakt die Schwesterfunktion
`reserveExceedsBudget` (G11/G24 Vorrang vor F1). Keine Magic Numbers, kein toter/auskommentierter
Code, G27 (Struktur statt Konvention) bei den drei Filterbedingungen in `activeOutboundCallsFor`,
G30/G34 (eine Aufgabe pro Funktion), N7 (reine Queries ohne Nebeneffekt ausser dem bestehenden
Log-Pfad), G3/T5 (Grenzfaelle 0/1/60000/60001ms, NaN, negative Zeit, fremder Tenant, beendeter
Leg, Inbound alle einzeln getestet).

---

## 7. Fix-Runden

**Keine.** Die Phase erreichte PASS ohne Fix-Runde — Safety- und Clean-Code-Review liefen beide
sofort auf FREIGABE bzw. PASS mit leeren Blocker-Listen.

---

## 8. Nachbarbefund (bewusst nicht gefixt)

Das Dial-Gate (`src/telephony/outbound-gates.js`, `store.budgetExceeded`) und der Inbound-Reject
(`src/routes/voice.js`) sehen den Live-Term weiterhin nicht. Unter Variante (b) waere das ein
Einzeiler, aendert aber 402-Verhalten und ist nicht Gegenstand dieser Phase.
