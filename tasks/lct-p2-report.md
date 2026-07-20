# Phase-Report: P2 — Ist-Kosten am Call persistieren (additiv, inert)

**Plan-Quelle:** PLAN P2 — Ist-Kosten am Call persistieren (additiv, inert)
**Umfang:** Fünf Kosten-Felder additiv+inert am Call persistieren (beide Store-Backends), Buchungsstelle `estimatedCostCents` im selben Schritt wie die Ist-Buchung, Kurs-Umrechnungsfaktor + nicht-fataler Toleranzband-Guard — **P1 (`getVoiceCostRecords`) wird NICHT aufgerufen, kein Gate/Meter liest die neuen Felder**
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p2-persist-actual-cost`
**headCommit:** `361b5548ec05da12750bc971403f5a0f4c80c59a` (Kurzform `361b554`)
**Basis:** `master @ e8fa4ef` ("merge: LCT P1 - CDR-Seam am Telnyx-Voice-Port")
**Datum:** 2026-07-20

---

## 1. Plan (gekürzt)

Autoritative Quelle: PLAN P2. Vorbedingung außerhalb dieses Plans: der `hermes-db`-Ablauf 2026-07-24 muss vor Ausrollen gelöst sein; der Code selbst ist Free-Tier-tauglich (`migrate()` läuft in `init()` bei Connect, kein preDeploy, keine Shell).

### 1.1 Verbindliche Entscheidungen (Auszug)

| # | Entscheidung | Grund |
|---|---|---|
| E1 | Fünf Felder ausschließlich in `createCall` definiert | Einzige Shape-Quelle beider Backends |
| E2 | `estimatedCostCents` wird von `reconcileOutboundVoiceBudget` aus **einer** lokalen Konstante geschrieben, die auch gebucht wird | Rekonstruktion aus `tariffCentsPerMin` öffnet nach P4b den Lebenszeit-Topf lautlos wieder |
| E3 | Set-once (`estimatedCostCents !== null` → No-op) | Wert ist Bezugspunkt der P4-Korrektur; Überschreiben wäre stille Phantom-Buchung |
| E4 | Estimate-Schreiber gated auf derselben `isBookableCents`-Quelle wie `addVoiceUsageCostCents` | Wird die Buchung als korrupt verworfen, darf kein Estimate stehen |
| E5 | `actual_cost_micro_cents` BIGINT, Hydrierung über `Number(...)`, `NULL → null` | node-postgres liefert int8 als String (Präzedenz `rowToUsage`) |
| E6 | Kein Index, kein Backfill | `migrate()` läuft bei jedem Boot auf einer Connection mit `app.current_tenant = BOOTSTRAP_TENANT_ID`; ein Backfill auf der FORCE-RLS-Tabelle `call` sähe nur Bootstrap-Zeilen |
| E7 | Alle fünf Felder ins `ON CONFLICT DO UPDATE SET` | Alle fünf mutieren nach Create (anders als `context`/`mandate`/`diagnostic`) |
| E8 | `publicCall` strippt die fünf Felder | Muster `summarySmsSentAt`; hält `/api/state` byte-identisch |
| E9 | `json.js` bekommt eine Alt-Shape-Ergänzung für `state.calls` | Bestands-`store.json` trägt `costTruingAttempts: undefined`; P3 rechnet `+1` darauf → `NaN` |
| E10 | Kurs-Guard: reine Funktion in `boot-guard.js`, Verdrahtung als **WARN** in `boot.js`, unkonditional (kein Flag) | Kein Verbraucher in P2/P3; P8 entfernt `COST_TRUING_BOOKING_ENABLED` — eine daran gekoppelte Bedingung wäre danach lautlos tot |

### 1.2 Geplante Blast-Radius-Dateien

**Neu:** `test/call-actual-cost-roundtrip.test.js` (pglite+json in-process, kein Server-Spawn), `test/provider-rate-guard.test.js` (Unit + Spawn-Boot-Beweis). Keine neuen Produktions-Dateien, keine neuen Dependencies.

**Bearbeitet:** `src/store/state-ops.js` (fünf Felder in `createCall` + Schreiber `recordCallEstimatedCostCents`), `src/store/json.js` (Wrapper + Alt-Shape-Migration `migrateCallCostFields`), `src/store/pg.js` (Wrapper, `rowToCall`-Hydrierung inkl. `hydratedMicroCents`, `flushCalls` Spaltenliste/Platzhalter/UPDATE-SET/Werte-Array), `src/store.js` (Re-Export), `src/store/views.js` (`publicCall` strippt fünf Felder), `src/billing/metering.js` (`reconcileOutboundVoiceBudget` bucht und persistiert im selben Schritt), `src/db/schema.sql` (additiv, CREATE + ALTER, BIGINT, kein Index), `src/config.js` (`providerToBucketRateMicro`, Default 920000, `min:1`), `src/boot-guard.js` (reine Funktion `providerRateOutOfBand`, Toleranzband 0,5×–2× um Anker 920000), `src/boot.js` (unkonditionales WARN, kein `exit(1)`), `.env.example`/`render.yaml`/`test/helpers.js` (Env-Doku, Lehre `test-base-env-drift`), `test/config-namespaces.test.js` (Zähler-Nachzug).

**Nicht angefasst (bewusst):** `src/db/migrate.js`, `src/telephony/call-finish.js`, `src/telephony/outbound-gates.js`, `src/telephony/adapters/**`, alle Gates, `src/routes/*`, Dashboards.

### 1.3 Rot-vor-Fix-Nachweis (vom Plan vorgeschriebene Reihenfolge)

Branch abzweigen, **nur** die beiden Testdateien schreiben (kein Produktions-Edit, kein `BASE_ENV`-Edit), beide Testdateien gegen unveränderten Bestand laufen lassen, wörtliche Fehlermeldungen in den Report kopieren, für Fall (c) zusätzlich ein gezielter Negativ-Beleg (Zeilen aus `ON CONFLICT DO UPDATE SET` testweise entfernen → muss rot werden → zurücksetzen). Erst danach implementieren in der Reihenfolge `state-ops.js` → Wrapper `json.js`/`pg.js` → `store.js` → `schema.sql` → `views.js` → `metering.js` → `config.js`/`boot-guard.js`/`boot.js` → Env-Doku → `config-namespaces.test.js`-Zähler.

---

## 2. Implementierungs-Zusammenfassung

PLAN P2 auf Branch `phase/lct-p2-persist-actual-cost` umgesetzt, committed (`headCommit` s.o.).

Fünf Kosten-Felder (`estimatedCostCents`, `actualCostMicroCents`, `costTruedAt`, `costTruedSource`, `costTruingAttempts`) additiv+inert in `createCall` definiert, in beiden Backends persistiert (`json.js` Alt-Shape-Migration `migrateCallCostFields`, `pg.js` Spalten + Hydrierung + `ON CONFLICT DO UPDATE SET`), über `views.publicCall` gestrippt (API/Dashboard byte-identisch). `metering.reconcileOutboundVoiceBudget` bucht und persistiert denselben Estimate-Betrag im selben Schritt (set-once, keine spätere Tarif-Rekonstruktion). Kurs-Guard `providerRateOutOfBand` (Toleranzband 0,5×–2× um Anker `920000`) als reine Funktion in `boot-guard.js`, in `boot.js` als unkonditionales WARN verdrahtet (kein `exit(1)`, kein Flag-Gate), per echtem Server-Spawn bewiesen.

**Testergebnis:** volle Suite 2690/0 (Baseline 2677 aus P1 + 13 neue Tests: `call-actual-cost-roundtrip.test.js` a–e, `provider-rate-guard.test.js` f1+f2). Ein einmaliger Flake (`test/telnyx-event-ingest-route.test.js`) beim Voll-Last-Lauf — isoliert 3× grün, deckt sich mit dem dokumentierten ~12-%-Voll-Last-Race (Seed-vor-Boot), kein LCT-P2-Bezug.

**Clean-Code-Selbstprüfung des Implementierers:** G5/S2 (`setOnceTimestamp`/`isBookableCents` wiederverwendet statt dupliziert, `hydratedMicroCents` folgt exakt dem Präzedenz-Muster `rowToUsage`), G25 (Magic Numbers benannt, `PROVIDER_RATE_ANCHOR_MICRO`/Bandfaktoren bewusst nicht an den Config-Default gekoppelt), keine neuen Imports außer bereits vorhandenen, F1 (≤3 Argumente), G30/G34 (eine Aufgabe je Funktion), Nesting/Funktionslänge weit unter Richtwert, kein toter/auskommentierter Code.

### 2.1 Deviations (Abweichungen vom Plantext)

1. **`test/metering-unit.test.js` war im Plan-Dateiindex nicht gelistet, musste aber angefasst werden:** der dortige `fakeStore` implementierte die neue Methode `store.recordCallEstimatedCostCents` nicht, wodurch `reconcileOutboundVoiceBudget` (Plan 2.6) einen `TypeError` warf. Minimal-Fix: `fakeStore` um die Methode ergänzt (Muster `addVoiceUsageCostCents`) + eine Assertion zum Pinnen von E2. Notwendige Konsequenz der spezifizierten `metering.js`-Änderung, keine Scope-Erweiterung.
2. **Plan-Ergebnis-Punkt "`grep actual_cost_micro_cents` → genau zwei Treffer" schlägt wörtlich fehl:** tatsächlich 4 Treffer (2 SQL-Spaltendefinitionen + 2 Kommentar-Vorkommen). Die Kommentar-Vorlage aus dem Plan selbst (Abschnitt 2.7) enthält den Spaltennamen bereits im Kommentartext. Beide SQL-Spaltendefinitionen (CREATE + ALTER) sind wie gefordert BIGINT — nur die wörtliche Grep-Zählung (inkl. Kommentare) trifft nicht exakt 2.
3. **Plan-Ergebnis-Punkt "920000/0.5/2.0 erscheinen ausschließlich in den Konstanten-Deklarationen" trifft für `920000` nicht ganz zu:** die Diagnose-Meldung in `providerRateOutOfBand` enthält zusätzlich die Zeichenkette "920000" im menschenlesbaren Fehlertext ("Zehnerpotenz-Vertipper (920 statt 920000)") — exakt der im Plan selbst vorgegebene Wortlaut (Abschnitt 2.9). Kein Magic-Number-Verstoß im G25-Sinn, sondern eine literale Wortlaut-Übernahme aus dem Plan, die die eigene Grep-Formulierung des Plans nicht exakt erfüllt.
4. **Ein Voll-Last-Lauf zeigte einmalig `test/telnyx-event-ingest-route.test.js` rot** (vorbestehender, dokumentierter ~12-%-Voll-Last-Flake, Seed-vor-Boot-Race, nicht LCT-P2-bezogen). Isoliert lief die Datei sofort grün (2/2); ein weiterer Voll-Lauf direkt danach war 2690/2690 grün.

---

## 3. Rot-vor-Fix-Nachweis (wörtliche Fehlermeldungen)

Beide neuen Testdateien wurden geschrieben und gegen den unveränderten Bestand (`master @ e8fa4ef`) gefahren, **vor jedem Produktions-Edit**.

**`test/call-actual-cost-roundtrip.test.js`:** 6 von 7 Fällen rot (Fall A2 grün, da json ad-hoc Properties trägt — erwartungsgemäß, kein Rot-vor-Fix-Verstoß). Wörtliche Fehler:

- **A1:** `Expected values to be strictly equal: + undefined - 51300`
- **B1:** `Expected values to be strictly equal: + undefined - null`
- **C1:** `Mutation nach Create muss den 2. Flush überleben ... + undefined - incomplete`
- **D1:** `Zeile bleibt nach doppeltem migrate() unverändert ... undefined !== 777`
- **E1:** `derselbe Betrag wird am Call persistiert ... undefined !== 18`

**`test/provider-rate-guard.test.js`:** Datei scheiterte komplett beim Laden mit

```
SyntaxError: The requested module '../src/boot-guard.js' does not provide an export named 'PROVIDER_RATE_FINDING'
```

— deckt sich mit der im Plan vorhergesagten Fehlerklasse für f1 (fehlender Export).

**Zusätzlicher Negativ-Beleg für Fall (c), nach der Implementierung:** die fünf Zeilen aus dem `ON CONFLICT DO UPDATE SET` testweise entfernt → genau Test C1 wird rot (`actual: null - expected: incomplete`), alle anderen 6 Fälle bleiben grün → beweist, dass (c) echten UPDATE-SET-Drift pinnt statt nur Spalten-Existenz. Zeilen danach zurückgesetzt, `pg.js` wieder identisch zum implementierten Stand (`node --check` + volle Testdatei erneut grün).

**Flake-Protokoll (Plan-Vorgabe):** ein roter Test zählt nur, wenn er isoliert ebenfalls rot ist — der vorbestehende ~12-%-Voll-Last-Flake wird nie als Befund dieser Phase gewertet.

---

## 4. Die fünf harten Zusagen der Phase (mit Beleg)

| # | Zusage | Status | Beleg |
|---|---|---|---|
| 1 | **ON-CONFLICT-Abdeckung:** alle fünf neuen Spalten im `ON CONFLICT DO UPDATE SET` | ✅ erfüllt | `pg.js:1170-1175` am SQL verifiziert (Safety-Review); Test (c) pinnt den Drift per Rundlauf, Negativ-Beleg (fünf Zeilen entfernt → Test C1 wird rot, sonst nichts) zeigt, dass der Test echten UPDATE-SET-Drift prüft, nicht nur Spalten-Existenz |
| 2 | **`estimatedCostCents` wird an der Buchungsstelle geschrieben** (derselbe Wert, derselbe synchrone Schritt, keine spätere Rekonstruktion aus `tariffCentsPerMin`) | ✅ erfüllt | `metering.js:64-66`: EIN `const estimatedCostCents = minutes * tariffCentsPerMin(call.to)`, danach `store.addVoiceUsageCostCents(...)` und `store.recordCallEstimatedCostCents(...)` mit demselben Wert; Test (e) pinnt Stabilität gegen Tarifwechsel 6→25 (`estimatedCostCents` bleibt 18) und Set-once bei zweitem Aufruf |
| 3 | **Guard = WARN, nicht fatal** | ✅ erfüllt | `boot.js` (`warnProviderRateOutOfBand`) ruft nur `console.warn`, kein `exit(1)`; per echtem Server-Spawn bewiesen: Server startet trotz `PROVIDER_TO_BUCKET_RATE_MICRO=920`, `/healthz` liefert 200, genau eine WARN-Zeile (Test f2, Safety- und Clean-Code-Review unabhängig nachvollzogen) |
| 4 | **Guard flag-unabhängig** (kein Flag-Gate, insbesondere nicht an `COST_TRUING_BOOKING_ENABLED` gekoppelt) | ✅ erfüllt | `grep -rn "costTruingBookingEnabled\|COST_TRUING_BOOKING_ENABLED" src/ test/` → 0 Treffer (Flag existiert in P2 noch nicht); Test f2 setzt in keinem der beiden Läufe dieses Flag und beweist trotzdem WARN-Verhalten |
| 5 | **Kein Index, kein Backfill** | ✅ erfüllt | `schema.sql`: nur `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (additiv, idempotent), kein `CREATE INDEX`; `src/db/migrate.js` unverändert (kein neuer Backfill-Aufruf); Test (d) fährt `migrate()` zweimal auf derselben pglite-DB, Zeile bleibt unverändert |

Ein sechster, im Safety-Review separat geprüfter Punkt bestätigt Zusage 2 zusätzlich strukturell: `grep -rn "tariffCentsPerMin" src/` zeigt unverändert nur zwei Verbraucher (`outbound-gates.js` Reserve, `metering.js`) — keine dritte Stelle rekonstruiert `estimatedCostCents` aus dem Tarif.

---

## 5. Safety-Urteil (final)

**Verdikt: FREIGEGEBEN (approved).**

Alle geprüften Achsen positiv: Tests unabhängig reproduziert, Rot-vor-Fix glaubwürdig, Safety-Gates unangetastet, Offenlegungssatz unangetastet, additiv+inert wie behauptet (kein Gate/Meter/keine Projektion liest die neuen Felder), Estimate nicht rekonstruiert, Rundlauf verlustfrei, keine Währungsumrechnung an der Persistenzkante, Guard WARN+flag-unabhängig, Migration idempotent ohne Backfill, kein Fail-open-Pfad, Verhalten wie beabsichtigt, Auth fail-closed unangetastet, keine Secrets geleakt, Scope eingehalten.

**Unabhängiger Testlauf des Reviewers:** zwei eigene Voll-Läufe von `npm test` im frischen Worktree. Lauf 1: 2690 Tests, 2689 pass, 1 fail (`test/telnyx-event-ingest-route.test.js:49`, "call.hangup: Settlement idempotent", `reserveReleased` `false !== true`); isoliert 3× wiederholt: je 2/0 grün. Lauf 2 der Vollsuite: 2690 pass, 0 fail (125,8 s). Bekannter ~12-%-Voll-Last-Flake, kein echtes Rot. Zusätzlich verifiziert: `git diff master..phase/lct-p2-persist-actual-cost` = ein Commit, `package.json`/`package-lock.json` unverändert (keine neuen Dependencies), keine Änderung in `src/telephony/`, `src/routes/`, `src/auth.js`, `src/web-auth.js`, `src/claude.js`.

### 5.1 Concerns (keine Blocker)

1. **`warnProviderRateOutOfBand` wertet `finding.fatal` nicht aus** — anders als `assertSpendCapCoherence`, das `findings.find(f => f.fatal) → exit(1)` macht. In P2 korrekt (WARN gefordert), aber ein P4-Autor, der in `boot-guard.js` nur `fatal:true` setzt, bekäme lautlos weiterhin nur eine WARN. **P4 muss beide Dateien ändern** — Übergabepunkt für die nächste Phase.
2. **pg-Rundlauf mit einem Nicht-`null`-`estimatedCostCents` ist nicht direkt assertiert:** A1 pinnt `actualCostMicroCents`, C1 pinnt `costTruedSource`+`costTruingAttempts` gegen den ON-CONFLICT-Drift, E1 läuft auf json. `estimated_cost_cents` steht korrekt in INSERT-Spalten, `$30` und UPDATE-SET (am SQL geprüft), ist aber nur indirekt getestet.
3. **`recordCallEstimatedCostCents` ist set-once.** Liefe `reconcileOutboundVoiceBudget` je zweimal für denselben Call, würde `usage.costCents` doppelt gebucht, `estimatedCostCents` bliebe einfach — P4 korrigierte dann zu wenig, also in Überbuchungs-Richtung (fail-closed). Test E1 dokumentiert dieses Verhalten explizit; die Doppelbuchung selbst verhindert der bestehende `billedAt`-Marker.
4. **`json.js`-`load()` schreibt die fünf Felder in bestehende `data/store.json`-Calls zurück** (`migrateCallCostFields` + späteres `save`). Nur Datei-Shape, kein Verhalten — erwartetes Ergebnis der Alt-Shape-Normalisierung, ohne die `undefined+1 = NaN` in P3 entstünde.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS.** Keine S1/S2-Befunde, kein Blocker.

**s1 (Blocker):** keine.
**s2 (schwerwiegend):** keine.

**s3 (Politur):**
1. `src/config.js:364-380` vs. `src/boot-guard.js:143-148` — der Zahlenwert `920000` steht literal an vier Stellen (config.js-Default, boot-guard.js-Anker, `.env.example`-Kommentar, `render.yaml`-Value) statt an einer Quelle — bewusst begründet (Anker darf nicht von einer späteren Default-Änderung mitgezogen werden, sonst prüft das Band gegen sich selbst und stirbt strukturell lautlos). Kein Flag im engeren Sinn, aber ein Punkt, den ein Leser ohne die Kommentare für eine vergessene Konstante hält. Fix (optional): Kommentar-Verweis am Default in `config.js` zurück auf `PROVIDER_RATE_ANCHOR_MICRO` (und umgekehrt).

**s4 (Kosmetik):**
1. `src/store/state-ops.js:146-230` (`createCall`) — die Funktion war mit 110 Zeilen bereits vor dieser Phase über dem Repo-Richtwert (100 Zeilen) und wächst durch die fünf neuen Kosten-Felder auf 132 Zeilen. Rein additiv, flacher Objekt-Literal-Aufbau (eine Abstraktionsebene, kein Verzweigungs-/Schleifen-Wachstum) — kein G30-Mehrfach-Aufgaben-Verstoß, daher niedrigste Priorität. Fix (optional, spätere Phase): Kosten-Felder-Initialisierung in einen Helfer wie `initialCallCostFields()` auslagern.

**Top-Todos:** kein Handlungsbedarf vor Merge — beide s3/s4-Punkte sind bewusste, dokumentierte Trade-offs. Optional für die nächste Iteration: gegenseitige Kommentar-Referenz `PROVIDER_RATE_ANCHOR_MICRO` ↔ config.js-Default; `createCall()` bei nächster Berührung in einen Feld-Helfer zerlegen.

**Geprüfte Kategorien laut Audit:** volle Suite (`npm test`) in isoliertem `--detach`-Worktree auf `361b554` grün (2690/2690, inkl. 13 neue Tests). G26 (Geld nie Float): `estimatedCostCents` INTEGER, `actualCostMicroCents` BIGINT (nicht NUMERIC/Float) mit expliziter `hydratedMicroCents()`-Konvertierung gegen die bekannte pg-BIGINT-als-String-Falle. NULL-vs-0-Unterscheidung ("nie abgeglichen" vs. "gemessen: kostenlos") konsequent durchgehalten in `state-ops`/`json`/`pg`. Set-once-Semantik nutzt bewusst `!== null` statt Falsy-Check (0 Cent ist ein gültiger gebuchter Wert). `isBookableCents` als einzige Gültigkeitsquelle wiederverwendet (G5), kein zweites Validierungsidiom. `providerRateOutOfBand` ist eine reine, config-freie Entscheidung im etablierten Boot-Guard-Muster, `fatal:false` explizit und mit Testbeweis untermauert. `ON CONFLICT DO UPDATE SET` enthält alle fünf neuen Spalten, per pglite-Rundlauf-Test bewiesen. `publicCall()` strippt alle fünf Felder (kein API-Leak). Keine Umlaute in neuen Kommentaren, kein auskommentierter Code, keine toten Schalter, Nesting ≤2 überall, alle neuen Funktionssignaturen ≤3 Argumente. Migration idempotent (`ADD COLUMN IF NOT EXISTS`, per Test D doppelt gefahren), json-Seite defensiv gegen Alt-Bestand (`migrateCallCostFields`, per Test B bewiesen).

---

## 7. Fix-Runden

**Keine Fix-Runde erforderlich.** Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf auf PASS/FREIGEGEBEN (`=== FIXES ===` in der Quelle ist leer). Die vier Safety-Concerns und der eine Clean-Code-s3-Punkt sind als "vor P4 zu klären" bzw. "Politur" eingestuft, nicht als Blocker dieser Phase — kein Self-Fix-Zyklus ausgelöst.

---

## 8. Übergabepunkte an P3/P4

- **P4 muss `boot.js` mitändern**, sobald der Kurs-Guard fatal wird: `warnProviderRateOutOfBand` wertet heute `finding.fatal` nicht aus (Safety-Concern 1).
- Direkter pg-Rundlauf-Test mit Nicht-`null`-`estimatedCostCents` ist optional nachzuziehen (Safety-Concern 2, derzeit nur indirekt über SQL-Grep + json-Test abgedeckt).
- s3-Politur aus dem Clean-Code-Audit (Kommentar-Querverweis `PROVIDER_RATE_ANCHOR_MICRO` ↔ `config.js`-Default) — optional vor P4.
- s4-Kosmetik (`createCall()`-Länge) — optional bei nächster Berührung der Datei.

---

## Anhang: Quellenhinweis zu personenbezogenen Daten

Die Quelltexte (Plan, Impl-Report, Safety-Urteil, Clean-Code-Audit) wurden vor dem Schreiben dieses Reports auf personenbezogene Daten geprüft (Telefonnummern, Namen, E-Mail-Adressen, Kunden-IDs). Es wurden keine gefunden. Lokale Dateisystempfade in der Quelle (Worktree-Pfade unter `.claude/worktrees/wf_946e6802-f7d-2/`) enthalten keine Drittdaten und wurden in diesem Report auf die repo-relative Pfadangabe reduziert, da sie für die Nachvollziehbarkeit des Reports nicht erforderlich sind.
