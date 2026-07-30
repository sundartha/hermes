# Phase KS-P5a — Starter-Kunde bekommt die verkauften Minuten (E5/E5a)

**Gate: PASS**
**finalBranch:** `phase/ks-p5a-starter-minuten`
**headCommit:** `573a0bc4d739271870ea473025298408f9f75919`
**Basis:** `master` @ `6ad5e5d`

E5/E5a in einem Satz: `planCapCents` rechnet jetzt mit demselben Satz, mit dem der Verbrauch gebucht wird (`voiceTariffDefaultCents`), statt mit einem zweiten, unabhaengigen Deckel-Basissatz — der Starter-Kunde telefoniert seine verkauften Minuten (inkl. Reserve fuer den letzten Anruf), ohne dass die EUR-Decke vorher greift.

---

## Plan (gekuerzt)

### Befundlage vor der Phase

- Decke = `includedMinutes * cfg.voiceCapRateCentsPerMin * num/den` (`src/billing/plan-caps.js`), `voiceCapRateCentsPerMin` mit genau einem Leser (repo-weit gegrept).
- Gebuchter Satz = `voiceTariffDefaultCents` (Worst-Case-Zweig) via `tariffCentsPerMin` (`src/telephony/outbound-gates.js`) — zwei getrennte Zahlen fuer dieselbe Sache.
- Die Klemme der Plan-Decke auf `platformSpendCapCents` in `deriveTenantBudgetFromPlan` war **bereits seit KS-P9 entfallen** — im Code stand nur noch der Begruendungskommentar. `PLAN_CAP_INERT`/`planCapInertFindings`/`tenantCapRowInertFindings` existieren nicht mehr; kein Boot-Guard haelt eine Plan-Decke gegen irgendeine Zahl. Damit war D-1 des ersten Laufs (Boot-Guard FATAL->WARN) gegenstandslos — kein Boot-Guard wurde in dieser Phase abgesenkt.

### Design-Entscheidungen

- **D-1 (E5a woertlich):** `voiceCapRateCentsPerMin` entfaellt ersatzlos — Env-Key, config-Eintrag, Namespace-Eintrag, `.env.example`, `render.yaml`. Kein Synchron-Halten zweier Zahlen, keine Alias-Bruecke.
- **D-2 (Satz 0 darf keine 0-Decke schreiben):** `voiceTariffDefaultCents` ist per `min: 0` abschaltbar (die gesamte Spawn-Suite faehrt `VOICE_TARIFF_DEFAULT_CENTS: "0"`). Eine 0-Decke waere kein strengeres Gate, sondern Telefonie-Totalausfall (`effectiveCapCents` liefert die Zeile, `budgetExceeded` ist ab dem ersten Cent true). Behandlung an der Schreibkante (`deriveTenantBudgetFromPlan`): No-op + laute WARN `grund=tarif_null`, bestehende Decke bindet weiter.
- **D-3:** kein neues Gate, kein neuer Schalter, keine neue Env, keine neue Dependency, keine neue Quelldatei im `src/`-Baum — genau eine neue Testdatei.
- **D-4:** Boot-Guards unangetastet, verifiziert dass keiner feuert (weder bei T=300 noch bei T=30).

### Zahlen (Herleitung)

Formel: `includedMinutes * voiceTariffDefaultCents * num/den`, Kopffreiheit Starter 5/3, Business 5/4. Ganzzahlig fuer jeden ganzzahligen Satz T: Starter `30*T*5/3 = 50T`, Business `120*T*5/4 = 150T`.

| Plan | verkauft | Decke bei T=30 (live) | Decke bei T=300 (Code-Fallback) |
|---|---|---|---|
| Starter | 30 min | **1500 ct (15 €)** | 15000 ct (150 €) |
| Business | 120 min | **4500 ct (45 €)** | 45000 ct (450 €) |

Invariante (der letzte Anruf inkl. Worst-Case-Reserve `T*ceil(300/60) = 5T` muss hineinpassen): `M*T + 5*T <= M*T*num/den`, aequivalent `M >= 7,5` (Starter) bzw. `M >= 20` (Business). Mit 30 bzw. 120 verkauften Minuten haelt das satzunabhaengig — genau das pinnt der neue Test ueber alle Katalog-Slugs und beide Saetze (300/30).

Plattform-Cap-Aufstellung (Grundlage fuer Owner-Entscheidung E9), Decken-Lesart bei T=30 ct/min:

| N | nur Starter (15 €/Kunde) | nur Business (45 €/Kunde) |
|---|---|---|
| 1 | 15 € | 45 € |
| 3 | 45 € | 135 € |
| 5 | 75 € | 225 € |
| 10 | 150 € | 450 € |

Realistische Lesart (nur verkaufte Minuten telefoniert, Starter 9 €, Business 36 €):

| N | nur Starter | nur Business |
|---|---|---|
| 1 | 9 € | 36 € |
| 3 | 27 € | 108 € |
| 5 | 45 € | 180 € |
| 10 | 90 € | 360 € |

`MAX_BUDGET_EUR` = 30 € (heute nur Warnschwelle, keine Sperre seit KS-P9) liegt ab 2 Startern bzw. 1 Business-Kunden unter der Summe der verkauften Decken — die 80-%-Warnung wird ab dann Dauerzustand. Die Zahl selbst ist Owner-Entscheidung **E9** und wurde in dieser Phase **nicht** angefasst (weder Code-Default noch `.env.example` noch `render.yaml`).

### Neue Dateien / Edits (Plan-Umfang)

- **Neu:** `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` — 4 Tests, katalogfrei (kein Katalog-Praefix), landet im Regressionslauf `npm test`. Mutationsprobe verlangt: alle 4 Tests VOR den Code-Edits rot (NaN-Decke, weil `planCapCents` `cfg.voiceCapRateCentsPerMin` liest, das im neuen Fixtur nicht existiert).
- **`src/billing/plan-caps.js`:** Kommentare aktualisiert, der eine Ausdruck `cfg.voiceCapRateCentsPerMin` -> `cfg.voiceTariffDefaultCents`.
- **`src/config.js`:** `voiceCapRateCentsPerMin`-Block ersatzlos geloescht, Konsumenten-Kommentar bei `voiceTariffDefaultCents` um den vierten Konsumenten (Plan-Kostendecke) ergaenzt, `CONFIG_NAMESPACES.billing` von 36 auf 35 Keys.
- **`src/store/state-ops.js`:** `deriveTenantBudgetFromPlan` bekommt Fall (4): `capCents <= 0` -> No-op + `console.warn(... grund=tarif_null ...)`, bestehende Decke bleibt.
- **`.env.example`, `render.yaml`:** `VOICE_CAP_RATE_CENTS_PER_MIN`-Bloecke ersatzlos geloescht, Hinweis bei `VOICE_TARIFF_DEFAULT_CENTS` ergaenzt.
- **`PLAN-SECURITY.md`:** neuer Abschnitt `## KS-P5a — Plan-Decke und Buchung teilen sich einen Satz`.
- **`STATUS.md`:** Punkt 10 (veraltete Aussage "Plan-Decken liegen unter der Worst-Case-Reserve, offen") ersetzt durch den erledigten Stand; verbleibend offen bleibt nur E9.
- **8 Testdateien angepasst** (Env-Umbenennung, Fixtur-Feldname, PAY-04 inhaltlich von Defekt-Charakterisierung zu Sollzustand gedreht, Namespace-/Manifest-Zaehlwerte nachgezogen).

Nicht angefasst (bewusst): `MAX_BUDGET_EUR`, `DEFAULT_TENANT_BUDGET_CENTS`, `PLAN_CAP_HEADROOM`, `src/boot-guard.js`, `src/boot.js`, `src/plans.js`, `apps/web/src/lib/plans.js`, `PLAN-KOSTEN-STEUERUNG.md`, `PLAN-ASSISTANT-LEAP.md`.

---

## Implementierung — Zusammenfassung

Vollstaendig gemaess Plan umgesetzt und committet (`573a0bc` auf `phase/ks-p5a-starter-minuten`).

**Kern:** `planCapCents` (`src/billing/plan-caps.js`) rechnet mit `cfg.voiceTariffDefaultCents` — demselben Satz wie `tariffCentsPerMin`. `voiceCapRateCentsPerMin`/`VOICE_CAP_RATE_CENTS_PER_MIN` ist ersatzlos entfallen (config-Eintrag, Namespace 36->35, `.env.example`, `render.yaml`). Kein lebender Code liest den Key mehr; Reste nur in historischen Plandokumenten und in den Tally-Kommentarketten von `config-namespaces.test.js`.

**Neuer fail-closed Pfad (D-2):** Satz 0 -> `deriveTenantBudgetFromPlan` No-op mit lauter WARN `grund=tarif_null` (eigenes Label, getrennt von `grund=slug_unbekannt`), bestehende Decke bindet weiter.

**Mutationsprobe (Pflichtnachweis):** neue Testdatei allein gegen den Bestand -> 4/4 ROT vor den Edits, 4/4 gruen danach.

**Tests laut Impl-Report:** `npm test` 3537/3537 gruen (0 rot), `npm run test:gates` 126/129 mit 3 vorbestehenden roten (GAP-05, GAP-15 x2 — phasenfremd), PAY-04 gruen.

**Smoke:** Boot lokal bei T=300 und T=30 gruen (`Kosten-Decken: ... Worst-Case-Tarif 300|30 ct/min`, `/healthz` -> 200), keine verwaisten Prozesse.

### Deviations

1. Keine inhaltliche Abweichung vom Plan. Zwei Praezisierungen:
   - Die Boot-Smoke-Tests brauchten mehr Env als im Plan notiert (`PUBLIC_URL`, `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER`, `COST_TRUING_REQUIRED_RECORD_TYPES`) — sonst verweigert der Boot fail-closed den Start (bekannter, phasenfremder Befund: `render.yaml` startet wegen leerem `COST_TRUING_REQUIRED_RECORD_TYPES` nicht). Mit vollstaendigem Env sind beide Saetze gruen.
   - `test/pay-04-starter-reserve-charakterisierung.test.js` behaelt ihren Dateinamen (der Plan aendert nur den Testnamen, nicht den Pfad).
2. `npm run test:gates` ist mit 3 roten Tests rot (GAP-05 `allow_promotion_codes`, GAP-15 zweimal: Rechtstext-Platzhalter + EN-Fassung) — vorbestehende Produktbefunde, keiner beruehrt diese Phase; der Gates-Lauf darf laut CLAUDE.md rot sein. PAY-04 ist gruen, das plan-geforderte Kriterium ist erfuellt.

---

## Safety-Urteil (unabhaengiges Review, final)

**approved: true**, alle Einzelpruefungen (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) **true**. Keine Blocker.

**Verdict:** PASS mit sechs nicht-blockierenden Auflagen. Gegen die absoluten Regeln geprueft:

1. **SAFETY-GATES intakt** — `src/telephony/` nicht angefasst; Denylist, Land-Gate, Stundenlimit, Per-Target-Cap, Max-Dauer, `tryReserveOutboundBudget`, Abo+KYC-Permit, `OUTBOUND_FROZEN` byte-identisch. Kein Boot-Guard abgesenkt. Die Tenant-Kostendecke wird angehoben, nicht abgeschafft; `budgetExceeded`/`reserveExceedsBudget`/`effectiveCapCents`/`isBookableCents` unveraendert scharf. Der neue `capCents <= 0`-Zweig ist die fail-closed Richtung (bestehende Decke bindet weiter, kein 0-Cap-Tenant moeglich).
2. **OFFENLEGUNG unberuehrt** — `src/claude.js`/`src/bridge.js` nicht im Diff.
3. **AUTH FAIL-CLOSED unberuehrt** — keine Treffer in Auth-/Middleware-/Server-Dateien.
4. **SECRETS sauber** — neue `console.warn` loggt nur `slug`+`tenantId` (Muster wie bestehende Zeile), keine Secrets/PII in Diff, Report oder Doku.
5. **AUDIO/MCP nicht beruehrt.**
6. **SCOPE eingehalten** — `package.json`/`package-lock.json` unveraendert (keine neue Dependency), keine neue Quelldatei im `src/`-Baum, genau eine neue Testdatei. Repo-weiter grep bestaetigt: kein lebender Code-Verweis auf den entfernten Key mehr.
7. **Verhalten selbst nachgerechnet** (nicht dem Bericht geglaubt): frischer Worktree-Review, `git merge-base` bestaetigt keine Stale Base. `npm test`: 3557/3557 gruen (Zahl weicht vom Impl-Report ab, Ergebnis nicht). `npm run test:gates`: 530/533, dieselben 3 vorbestehenden roten, PAY-04 gruen. Mutationsprobe unabhaengig via `git archive` gegen master-src wiederholt: 4/4 rot, UND der reale Bestandsdefekt mit der produktiven master-Konfiguration (`voiceCapRateCentsPerMin=6`) nachgerechnet — in allen vier Kombinationen (Satz 30/300 x Starter/Business) traegt die alte Decke die verkauften Minuten NICHT (z.B. Starter@30: cap=300 ct, benoetigt=1050 ct). Boot-Smoke unabhaengig wiederholt, beide Saetze gruen, keine verwaisten Prozesse.

### Concerns (nicht blockierend)

1. **Deploy-Reihenfolge (wichtigster Punkt):** Der Branch aendert den ausgelieferten Default-Wert nicht — Code-Fallback (`src/config.js`) UND `render.yaml` stehen weiter auf `VOICE_TARIFF_DEFAULT_CENTS=300`. Die pro-Tenant-Decke sprAengt unter den Repo-Werten von 300/900 ct auf 15000/45000 ct (Faktor 50). Die beabsichtigten 1500/4500 ct gelten nur, weil die Live-Env (Render-Dashboard) bereits 30 gesetzt hat. Spec-konform (Fallback ist ausdruecklich KS-P6), aber **KS-P5a darf nicht vor KS-P6 deployt werden**, sonst haengt die reale Deckenhoehe an einer Dashboard-Variable statt am Repo. `STATUS.md` markiert korrekt "nicht deployt".
2. **Doku-Widerspruch E9:** `STATUS.md`/Report nennen E9 "offen", `PLAN-KOSTEN-STEUERUNG.md` erklaert E9 dagegen bereits fuer "entfaellt, durch E10 gegenstandslos". Eine der beiden Stellen sollte nachgezogen werden.
3. **Kommentar widerspricht Code** in `test/pay-04-starter-reserve-charakterisierung.test.js`: Kopfkommentar sagt "bei Satz 0 vakuum-gruen", Code hat stattdessen `assert.ok(capCents > 0, ...)`, der bei Satz 0 rot faellt. Heute folgenlos (kein `.env` im Repo -> Fallback 300), aber irrefuehrend nach KS-P6 bzw. mit abgeschalteter Kosten-Achse.
4. **NaN-Luecke im neuen Zweig** (kein erreichbarer Pfad heute): `if (capCents <= 0)` laesst `NaN` durchrutschen (`NaN <= 0` ist false) — exakt die Fehlerklasse der Mutationsprobe. Heute unerreichbar (Config-Validierung + `planCapCents`-Wurf bei unbekanntem Slug verhindern es strukturell), aber `Number.isInteger(capCents) && capCents > 0` waere robuster als die Konfigurations-Konvention.
5. **Getragenes Restrisiko:** Seit KS-P9 haelt kein Boot-Guard mehr die absolute Euro-Hoehe der Plan-Decke gegen irgendeine Zahl — nur das Verhaeltnis (Decke >= verkaufte Minuten + Reserve) ist gepinnt. Ein Tarif-Vertipper verschiebt jede Tenant-Decke still mit.
6. **Bestandsdaten nicht nachgezogen:** existierende `tenant_budget`-Zeilen (300/900 ct) bleiben bis zum naechsten Stripe-Patch — dasselbe Muster wie die Lehre "additiv-nullable Pflichtfeld braucht immer Backfill". Am Prod-Postgres zu pruefen.

---

## Clean-Code-Audit (final)

**Blocker: false. Verdict: PASS.** s1 = [], s2 = [], s3 = [], s4 = [] — keine Befunde in irgendeiner Schwere-Stufe.

**passNotes:** Einheitliche Kosten-Quelle statt zwei auseinanderlaufender Zahlen (G5-Dedup); fail-closed statt stiller 0-Decke, mit eigenem WARN-Label und direktem Test; Doku (`PLAN-SECURITY.md`/`STATUS.md`/Env-Kommentare) und Test-Suite (Namespace-Counts, Fixtur-Kommentare) durchgaengig synchron gehalten; neuer Test pinnt die fachliche Invariante satz- und plan-unabhaengig statt nur Einzelwerte; Ganzzahligkeits-Beweis im Kommentar nachvollziehbar (50T/150T fuer jedes ganzzahlige T); Money-Pfad bleibt integer (G26); vollstaendige Test-Suite gruen (eigener `npm test`-Lauf im isolierten Worktree, exit 0, plus gezielte Nachlaeufe fuer plan-caps/config-namespaces/boot-failclosed/pay-04/gap-01).

**topTodos:** Keine Blocker offen. Owner-Entscheidung E9 (`MAX_BUDGET_EUR` anheben) bleibt bewusst ausserhalb des Scopes von KS-P5a und ist in `STATUS.md`/`PLAN-SECURITY.md` korrekt als offen markiert (siehe Concern 2 oben zum Widerspruch mit `PLAN-KOSTEN-STEUERUNG.md`).

**Selbst-Check (Impl-Agent, `cleanCodeSelfCheck`):** G5 (keine zweite Zahl fuer dieselbe Sache mehr), G25 (alle neuen Konstanten benannt, `Object.freeze`), G35 (kein neuer konfigurierbarer Wert, ein bestehender entfaellt), C5/G9/G12 (toter Kommentar-Verweis + tote BASE_ENV-Zeile entfernt, keine ungenutzten Imports), C2 (brittler `render.yaml:287-291`-Zeilenverweis entfaellt), F1/G30/G34 (neue Helfer je 1 Argument/1 Aufgabe, Verschachtelungstiefe unveraendert 1), P11 (neues Verhalten hat Test mit belegter Rot-Faerbung auf dem Bestand), N7 (`grund=tarif_null` eigenes Log-Label).

---

## Fix-Runden

Keine. Das Review lief in einer Runde durch: Safety-Review = approved/PASS (Concerns dokumentiert, keine Blocker), Clean-Code-Audit = PASS mit leeren s1–s4-Listen. Kein Fix-Zyklus noetig.
