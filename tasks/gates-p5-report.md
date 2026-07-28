# Phase GATES-P5 — DID-Monatsmiete im Ledger (GAP-06)

**Spec:** `tasks/gates-fix-chain.md`, Abschnitt "P5", **inklusive Nachtrag 2026-07-28** (entstanden nach dem ersten, blockierten Anlauf). Der Nachtrag aendert die Vorgaben gegenueber dem ersten Anlauf in vier Punkten:

1. GAP-06 wird neu gefasst: **Wiederkehr UND Idempotenz** muessen beide gepinnt sein (nicht nur ein einmaliger Beleg).
2. Die Idempotenz laeuft an der **NUMMER**, nicht am Tenant — eine Zaehlung je Tenant ist ausdruecklich verboten, weil sie Doppelbuchungen erzeugt (zwei Nummern, eine ohne gelernten Preis).
3. Der GAP-11-Test darf nur **ERWEITERND** angepasst werden: beide Faelle bleiben/werden gepinnt (ohne gelernten Preis kein Beleg; mit gelerntem Preis genau ein Beleg mit diesem Betrag).
4. `src/app.js` bleibt verboten als Ort fuer den Ausloeser.

**Gate:** PASS
**finalBranch:** `phase/gates-p5-monatsmiete-neu`
**headCommit:** `17c5e34cadf76118fa0da8fd6da54918f0ba385e`
**Basis:** `master @ 2f99e4b`

---

## Abnahmekriterien (Status)

| Kriterium | Ergebnis |
|---|---|
| Neu gefasstes GAP-06 gruen via `npm run test:gates` | ✅ 3x gruen (Wiederkehr ueber drei Kalendermonate, Idempotenz im selben Monat, beide Ausloeser -> ein Beleg) |
| `npm test` mit fail=0, kein neu roter Bestandstest | ✅ 3333/3333 auf dem Branch; Baseline (master, detached 2f99e4b) 3319/3318 (1 vorbestehender Flake, unabhaengig vom Diff) |
| Diff beruehrt `src/` nur wie vorgesehen | ✅ 7 src-Dateien, `src/app.js` kommt nicht vor |
| Server-Start-Timeout-Flake isoliert bewerten | ✅ als bekannter Voll-Last-Flake (`p5-gate-proof`-Familie) eingeordnet, nicht dem Diff angelastet |

---

## Plan (gekuerzt)

### Vier Design-Weichen (E1–E4)

- **E1 — Ausloeser ohne `src/app.js`/Webhook-Dateien.** `applyStripeWebhook` ruft im ACTIVATE-Zweig `activatePaidTenant({ provision })`, und `provision` **ist** bereits `provisioning.triggerTenantProvisioning`. Der neue Ausloeser wird dort als erster Schritt eingehaengt — 0 Dateien ausserhalb der erlaubten Liste. `src/billing/webhook.js`, `src/routes/stripe-webhook.js`, `src/wiring/web-login.js` bleiben unberuehrt.
- **E2 — Idempotenz an der NUMMER.** `usage_event` bekommt additiv/nullable `number_id` (Muster wie `call_id`, bewusst **ohne FK** auf `number(id)`, damit ein DID-Release/Erase den Abrechnungsnachweis nicht mitloescht). Der Riegel ist ein `Set` von `numberId` — die Tenant-Zaehlung des ersten (blockierten) Anlaufs entfaellt vollstaendig.
- **E3 — Die Uhr wird durchgereicht (`occurredAt`), nicht zweimal gelesen.** `recordUsageEvent` bekommt ein optionales `occurredAt` (Default = Bestandsverhalten `new Date().toISOString()`); Faelligkeits-Pruefung und Beleg-Stempel nutzen denselben `nowIso`, sonst faellt ein Monat an der Grenze zwischen zwei Uhren durch.
- **E4 — Kein Fallback auf einen geratenen Betrag.** Der Betrag ist ausschliesslich `number.monthlyCostCents` (aus P4). Kein `holdAmountForCountry`, kein `NUMBER_MONTHLY_COST_CENTS`, keine Schaetzung. Ohne gelernten Preis wird **nicht** gebucht (fail-closed), sichtbar als `ohne_preis=` in der Sweep-Bilanz. Konsequenz: `config` wird aus `makeMetering` entfernt (G12, ungenutzt).

Nicht im Scope: `NUMBER_MONTHLY_COST_CENTS` bleibt Anzeige-Groesse in `api-billing.js`; keine neue Env-Variable, kein Cron, kein Endpunkt, keine neue Ressource.

### Neue Funktionen (keine neuen Dateien)

| Funktion | Datei | Aufgabe |
|---|---|---|
| `numbersDueForMonthMeter` | `src/store/state-ops.js` | Die eine Idempotenz-/Faelligkeitsregel: aktive Nummern ohne `number_month`-Beleg im UTC-Kalendermonat von `nowIso`. Reine Query. |
| `recordDueNumberMonthMeters` | `src/billing/metering.js` | Bucht alle faelligen Mieten, tolerant je Nummer (ein Fehler an einer Nummer beendet den Lauf nicht). |
| `settleDueNumberMonthMeters` | `src/worker/provisioning-orchestrator.js` | Payment-Gate + Store-Lock + Log; wirft nie. Von beiden Ausloesern gemeinsam genutzt. |

### Betroffene Bestandsdateien

`src/db/schema.sql` (additive nullable Spalte `number_id`, kein FK), `src/store/state-ops.js` (`recordUsageEvent` + neue Query), `src/store/pg.js` (Round-Trip der neuen Spalte in SELECT/Mapping/Flush), `src/billing/metering.js` (Betrag aus Nummern-Datensatz, wiederkehrende Buchung, `config`-Parameter entfernt), `src/worker/provisioning-orchestrator.js` (beide Ausloeser: Aktivierungs-Beleg im Drain + neuer Abo-Ausloeser + neue Funktion), `src/boot.js` (zweiter Schritt im bestehenden Stunden-Sweep, kein neuer Timer), `src/server.js` (Ein-Zeilen-Edit: `makeMetering({ store })` ohne `config`).

### Tests (Plan)

- `test/metering-unit.test.js`: GAP-06 ersetzt durch 3 neu gefasste Tests (Wiederkehr, Idempotenz im Monat, beide Ausloeser -> ein Beleg) + Regressionstests (Doppelbuchungs-Beweis, Fehler-an-einer-Nummer, freigegebene Nummer).
- `test/f1-provisioning-geo.test.js`: GAP-11 nur erweitert — Bestandstest (Hold==Capture) bekommt zusaetzlich den Nullfall (kein Preis -> kein Beleg); neuer Test fuer den Preisfall (genau ein Beleg mit `number.monthlyCostCents`).
- `test/usage-event-meter.test.js`: 7 neue Tests zu `recordUsageEvent`-Feldern und `numbersDueForMonthMeter`.
- `test/store-pg.test.js`: pg-Round-Trip von `number_id` additiv erweitert.
- `test/provisioning-enqueue-order.test.js`: `settleDueNumberMonthMeters` wirft nie, No-op ohne `PAYMENT_ENABLED`.

Pre-Mortem im Plan deckt: Doppelbelastung durch falschen Idempotenz-Anker, fehlender Monat durch zwei Uhren, Fallback-Betrag auf Einrichtungsgebuehr, Absturz des stuendlichen Sweeps, weiterlaufende Berechnung gekuendigter Nummern, verschwindender Abrechnungsnachweis bei DID-Release (jeweils mit konkreter Entschaerfung im Plan).

---

## Implementierungs-Zusammenfassung

Umgesetzt wie geplant, committed auf `phase/gates-p5-monatsmiete-neu` (`17c5e34`), sauber auf `master@2f99e4b` aufgesetzt.

- `usage_event.number_id`: additiv, nullable, **ohne FK** (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, idempotent, Muster `call_id`).
- `numbersDueForMonthMeter` (state-ops.js): die eine Faelligkeitsregel, Anker = Nummer, nicht Tenant; ignoriert Belege ohne `numberId` (Bestandsverhalten vor P5); filtert auf `NUMBER_STATUS.ACTIVE`; `tenantId=null` = alle (Sweep), gesetzt = ein Tenant (Abo-Ereignis); unlesbare Uhr -> leer (fail-closed).
- `recordUsageEvent`: `numberId` und `occurredAt` optional, Default-Verhalten fuer Bestandsaufrufer byte-identisch.
- `metering.js`: `monthlyRentCents` (rein, Ganzzahl-Cents-Guard) + `recordNumberMonthMeter(number, nowIso)` (kein Beleg ohne gelernten Preis) + `recordDueNumberMonthMeters` (Schleife, tolerant je Nummer, Bilanz `{faellig, gebucht, ohnePreis, fehler}`); `holdAmountForCountry`-Import entfernt, `config`-Parameter aus `makeMetering` entfernt.
- `provisioning-orchestrator.js`: Aktivierungs-Beleg im Drain reicht jetzt `new Date().toISOString()` durch; neuer Abo-Ausloeser `await settleDueNumberMonthMeters({ tenantId })` sequentiell **vor** dem bestehenden `withStoreLock`-Block in `triggerTenantProvisioning` (kein verschachteltes Lock); neue Funktion `settleDueNumberMonthMeters` mit `paymentEnabled`-Gate, `withStoreLock`, internem try/catch (wirft nie), einer Log-Zeile nur wenn etwas faellig war.
- `boot.js`: zweiter Schritt im bestehenden Stunden-`setInterval` (kein zweiter Timer, kein Cron, kein Endpunkt), eigener `.catch()`.
- `server.js`: `makeMetering({ store })` (config entfernt).
- pg.js: SELECT/Mapping/Flush um `number_id` erweitert, `?? null` gegen `undefined`-Drift.

### Deviations vom Plan

1. Plan sah vor, dass der Bestandstest "Modul bucht ungated" sein `config`-Argument behaelt. Tatsaechlich: Argument entfernt (E4-Konsequenz konsequent zu Ende gefuehrt — ein weiterhin uebergebenes, im Modul nicht mehr existierendes Feld waere eine Luege am Aufrufer). Daraus folgend in derselben Datei auch uebrige `config: {}`-Argumente sowie dadurch ungenutzte Importe entfernt (`withConfigNamespaces`, `NUMBER_SETUP_FEE_CENTS` in `metering-unit.test.js`; `withConfigNamespaces` in `f1-provisioning-geo.test.js`). Andere, nicht in der Dateiliste stehende Testdateien blieben unangetastet.
2. Ein dritter Orchestrator-Test zusaetzlich zu den zwei geplanten: `settleDueNumberMonthMeters reicht die tenantId des Abo-Ereignisses durch (null = alle)` — sonst waere die Zwei-Ausloeser-Verdrahtung nirgends gepinnt.
3. `test/store-pg.test.js`: der Flush-Flip am Ende des Bestandstests musste beide Events flippen (`n=2`), sonst haette das zusaetzliche `voice_minute`-Event die Assertion "kein pending Event mehr" gebrochen. Plan nannte nur das Hinzufuegen des Events.
4. ESLint liess sich nicht fahren (`@eslint/js` im Checkout nicht installiert) — kein Abnahmekriterium der Phase; `node --check` auf allen geaenderten Dateien und beide Testlaeufe sind gruen.

### Verifikation (Impl-Agent)

- `node --check` auf allen 6 geaenderten Kern-Quelldateien: pass.
- `npm test`: 3333/3333, 0 fail.
- Smoke: Server als Kindprozess (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `PAYMENT_ENABLED=true`, Stripe-Dummy-Keys, `NUMBER_SETUP_FEE_CENTS=500`), Boot sauber, `GET /healthz` -> 200.
- `git diff --stat master`: exakt 12 Dateien (7 src, 5 test), `src/app.js` kommt nicht vor.

---

## Safety-Urteil (final)

**approved: true**, alle Einzelurteile positiv (Tests unabhaengig gruen, Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secrets geleakt, Verhalten wie beabsichtigt, Scope respektiert). **Keine Blocker.**

**Verdict:** PASS. Diff eng auf GATES-P5 beschnitten, keine neue Dependency/Env-Variable/Cron/Ressource/Endpunkt, `.env.example`/`render.yaml` unveraendert. Alle vier Absolutregeln (CLAUDE.md) halten mechanisch: keine Gate-/Signatur-/Auth-/Routen-Datei beruehrt, `claude.js`/`bridge.js` nicht im Diff, Offenlegungssatz unangetastet, keine PII/Secrets in neuen Logzeilen (grep: 0 Treffer). Flag-off ist praktisch byte-identisch (`settleDueNumberMonthMeters` kehrt vor jedem Store-Zugriff zurueck, wenn `PAYMENT_ENABLED=false`). Beide Nachtrags-Kernpunkte unabhaengig nachgewiesen: GAP-06 pinnt Wiederkehr UND Idempotenz, Anker liegt an der Nummer (Doppelbuchungs-Szenario des Vor-Reviews reproduziert nicht mehr), GAP-11 wurde nur erweitert (Hold==Capture bleibt, plus Nullfall plus Preisfall). Betrag ausschliesslich aus `number.monthlyCostCents`, kein Fallback, fail-closed sichtbar als `ohne_preis=`. Ganzzahl-Cents durchgehend. Sweep wirft nie, ein Fehler an einer Nummer blockiert den Lauf nicht. pg-Persistenz sauber tenant-gescopet und round-trip-gepinnt. Re-Entrancy unkritisch (sequentiell vor bestehendem Lock).

**Unabhaengige Testsummary:** eigener Lauf im frischen Worktree. Branch (`17c5e34`): `npm test` 3333/3333/0; `npm run test:gates` 132 Tests, 121 pass, 11 fail. Master-Basis (detached `2f99e4b`, exakter merge-base): `npm test` 3319/3318/1 (vorbestehender Flake `telnyx-p8-inbound.test.js`, auf dem Branch gruen); `npm run test:gates` 129/117/12 fail. Delta der roten Gates ist exakt GAP-06 (rot -> gruen), die uebrigen 11 (FMT-15 x2, GAP-05, GAP-15 x2, GAP-24, GAP-26, GAP-31, GAP-37, VOICE-12, WEB-08) identisch. Ein zweiter Gates-Lauf zeigte zusaetzlich PROMPT-07 rot — LLM-Timing-Flake, kein P5-Bezug. Geaenderte Testdateien isoliert: 91/91 gruen. Zusaetzliche eigene Sonden (12 Monate x 24 Sweeps -> 12 Belege; Tenant-Scoping; RELEASED-Nummer keine Folgemiete; Aktivierung+Sweep im selben Monat -> 1 Beleg; Zeitzonen-Offset korrekt auf UTC-Monat normalisiert; Doppelbuchungs-Szenario reproduziert NICHT).

### Concerns (dokumentiert, keine Blocker)

1. **Bestands-Belege ohne `numberId` sperren nichts** — eine im Deploy-Monat bereits aktivierte Nummer koennte im selben Monat einen zweiten Beleg bekommen. Reproduziert vom Reviewer (Sonde 7). Bewusst so entschieden, im Code kommentiert, per Test gepinnt. Heute unerreichbar, weil `render.yaml` `PAYMENT_ENABLED=false` fuehrt — **muss vor einem Flip auf `true` erneut geprueft werden** (Backfill von `number_id` oder Stichtags-Riegel noetig).
2. `monthlyCostCents === 0` bucht einen 0-Cent-Beleg mit `quantity=1`; Stripe-Meter zaehlt die Einheit trotzdem. Bestehende Meter-Semantik, nicht durch P5 eingefuehrt.
3. Skalierung: der stuendliche Schritt scannt den gesamten `usageEvents`-Spiegel ueber alle Tenants unter `withStoreLock`, jeder Beleg loest einen Voll-State-Flush aus. Am Monatsersten werden alle Nummern gleichzeitig faellig. Im Code als bewusste Abwaegung dokumentiert, bei heutiger Groesse unkritisch, waechst linear mit dem Ledger.
4. Fixture-Schwaeche im neuen GAP-11-Test: `providerPrice()` setzt `upfrontMicroCents == monthlyMicroCents`, dieser eine Test kann Einrichtungsgebuehr und Miete daher nicht unterscheiden — die Unterscheidung ist aber separat in `metering-unit.test.js` mit verschiedenen Werten (92 vs. 137) gepinnt, die Zusage haelt.
5. Drei Dateien liegen ausserhalb der urspruenglichen Spec-Dateiliste (`schema.sql`, `pg.js`, `server.js`) — sachlich zwingend (Idempotenz-Anker braucht die Spalte + Round-Trip im pg-Backend; `server.js` ist die eine Aufrufstelle der geaenderten Signatur). Commit-Nachricht benennt sie nicht ausdruecklich als Listen-Ausnahme, wie vom Nachtrag Punkt 4 fuer listenfremde Dateien verlangt. Verbotene Dateien (`app.js`, `stripe-webhook.js`, `web-login.js`) bleiben unberuehrt.

---

## Clean-Code-Audit (final)

**Verdict:** PASS, kein Blocker.

**S1 (Blocker):** keine.
**S2 (Blocker):** keine.

**S3:**
- `src/worker/provisioning-orchestrator.js:272-292` — `settleDueNumberMonthMeters` ruft `store.load()` innerhalb des `withStoreLock`-Callbacks statt den State vorher zu ziehen und als Closure zu nutzen (kein struktureller Fehler, `load()` liefert in beiden Backends dieselbe In-Memory-Referenz). Optional: `store.load()` vor `withStoreLock` ziehen, analog zu `queueProvisioning`/`triggerTenantProvisioning`.

**S4:**
- `src/billing/metering.js` `recordDueNumberMonthMeters` — pro faelliger Nummer ein eigener `store.recordUsageEvent()`-Aufruf, der bei jeder Nummer synchron load()+save() ausloest (json: Datei-Rewrite je Nummer; pg: eigener Flush je Nummer), statt Batch+ein Flush. Im Code als "BEWUSSTE ABWAEGUNG" begruendet, bei realistischer Groessenordnung unkritisch.

Weitere Beobachtungen aus dem Audit: Kernlogik sauber (`numbersDueForMonthMeter` als einzige Faelligkeits-/Idempotenzregel, Anker=Nummer, fail-closed ohne Preis, durchgereichte Uhr, kein Wurf im Sweep, sequentielle statt verschachtelte Locks), durch gezielte Tests belegt. `monthlyCostCents` korrekt aus vorgelagerter Phase (P4/GAP-11) befuellt — initial faelschlich als totes Feld vermutet, per `git show`/master widerlegt. Alle 91 direkt betroffenen Tests sowie volle Suite (3354/3354 im Auditlauf) gruen; `node --check` auf allen 4 geaenderten Kern-Dateien ok. `schema.sql`-Aenderung additiv/nullable ohne FK, idempotent per `applySchema()` bei jedem Boot, auch fuer Bestands-DBs. Keine Duplizierung (G5/S2): Faelligkeitsregel existiert genau einmal, beide Ausloeser und alle Tests fragen darueber. Keine Magic Numbers im Produktcode (G25); alle Testbetraege sind benannte Konstanten. Keine ungenutzten Importe (G12/C5/G9), kein toter/auskommentierter Code, keine abgeschaltete Sicherung. Nebeneffekte im Namen (N7): `record*`/`settle*` tragen die Schreibung, `monthlyRentCents`/`numbersDueForMonthMeter` sind rein. Eine Aufgabe pro Funktion (G30/G34): laengste neue Funktion 16 Zeilen, max. Verschachtelungstiefe 3. Max. 2 Argumente je neuer Funktion (F1). Kein Lazy-Init (P15): Uhr wird an den Raendern (boot/orchestrator) gestellt und durchgereicht.

topTodos: kein Handlungsbedarf fuer den Merge; S3/S4 sind optionale Politur.

---

## Fix-Runden

Keine — der Impl-Agent lieferte einen Stand, der im dualen Review (Safety + Clean-Code) direkt mit PASS/PASS abgenommen wurde. `=== FIXES ===` im Quellmaterial ist leer.

---

## Zusammenfassung

GATES-P5 (GAP-06, Nachtrag-Fassung) ist umgesetzt, gruen und committed. Die DID-Monatsmiete wird jetzt wiederkehrend gebucht und ist je Nummer und Kalendermonat idempotent (Anker=Nummer, nicht Tenant — die Nachtrag-Vorgabe 2 ist strukturell erzwungen, nicht nur behauptet, und durch einen Rot-vor-Fix-Test bewiesen). Betrag ausschliesslich aus `number.monthlyCostCents` (P4), fail-closed ohne gelernten Preis. Beide Ausloeser (Stripe-Abo-Verlaengerung ueber `triggerTenantProvisioning`, stuendlicher Sweep in `boot.js`) teilen sich `settleDueNumberMonthMeters`, ohne `src/app.js` oder Webhook-Dateien anzufassen. `npm run test:gates` zeigt exakt GAP-06 gekippt (rot->gruen) gegenueber der unabhaengig gemessenen Master-Baseline, `npm test` bleibt bei 0 fail auf dem Branch. Diff beschraenkt auf 12 Dateien (7 src, 5 test), `src/app.js` nicht beruehrt. Ein dokumentiertes Restrisiko (Bestands-Belege ohne `numberId` vor einem `PAYMENT_ENABLED`-Flip) ist heute unerreichbar und als Vorbedingung fuer einen kuenftigen Flip festgehalten.
