# KS-P8 — Detailbericht: Nutzer sieht Prozent statt Euro (E4)

- **Gate**: PASS
- **finalBranch**: `phase/ks-p8-prozent-statt-euro`
- **Basis**: `master` = `f789a36`
- **HEAD**: `99131fa`
- **Scope (E4)**: keine Kostenbetraege mehr in der Tenant-Projektion (`GET /api/state`, `get_agent_status`) — statt Euro sieht der Nutzer den Prozentanteil der verbrauchten Plan-Minuten.

---

## Plan (gekuerzt)

**Befund am echten Code (zwei Abweichungen von der Spec-Formulierung):**
1. `public/tenant.html` und `public/index.html` existieren nicht mehr (geloescht in `6b57725`, altes Dashboard) — der HTML-Teil des Spec-Umfangs ist gegenstandslos.
2. `/api/self-service/state` (`/app`-Sicht) traegt schon heute keinen Kostenbetrag — `paymentView` liefert `hasCard`, `subscription`, `quota` (Minuten), `numberSetupFeeCents`/`currency` (Preis, keine Kostenstruktur). Kein Edit noetig.

Die einzige heute EUR-tragende Nutzer-Projektion ist die Kette `usageView` (`src/routes/api-read.js`) → `GET /api/state .usage` (`costEur`, `tenantCapEur`, `spendMonthCostEur`, `spendMonthKey`, `reservedEur`) → `pickAgentStatus` (`src/mcp-tools.js`) → `get_agent_status` (structuredContent + Textblock + Widget `src/ui/widgets/agent-status.html`). Die Betreiber-Kostensicht (`GET /api/billing/platform-costs`, DB/Logs) wird nicht angefasst.

**Entscheidungen (D1–D6):**
- **D1** Kein Plan/Kontingent → `planUsagePercent: null`, Text „kein Kontingent hinterlegt", Widget-Slot `—`. **Nie 0 %** (0 % waere eine Aussage ueber ein Kontingent, das es nicht gibt).
- **D2** Bezugsgroesse ist die Minuten-Achse (`quotaView`/`includedMinutes`/`usedMinutes`/`exhausted`) — dieselbe Achse wie das Outbound-Gate (`planMinutesExceeded`); Anzeige == Gate bleibt Invariante.
- **D3** Rundung `Math.floor`. Invariante: 100 % genau dann, wenn `exhausted`. `Math.round` haette bei 29,9/30 min faelschlich „100 %" gezeigt, waehrend das Gate noch durchlaesst.
- **D4** `exhausted` (auch ohne Perioden-Anker, auch bei widerrufenem Periodenguthaben) → 100 %, kein zweit-kodiertes Praedikat.
- **D5** Betreiber verliert die EUR-Zahlen in `/api/state` mit (`/api/state` hat keine Rollen-Weiche; eine neue Auth-Weiche waere Scope-Verstoss). Ersatz: `/api/billing/platform-costs`, `tenantBudgetSnapshot` in den 402-Ablehnungstexten (KS-P4), DB.
- **D6** `spendMonthKey` faellt mit weg (war nur Label des EUR-Betrags, ohne Betrag ein bezugsloser String).

**Neue Datei**: `test/ks-p8-percent-projection.test.js` (K1–K8, Harness-Muster aus `test/api-state-usage-axis.test.js`, isolierte Route-Montage, kein Server-Spawn). K1 Whitelist der `usage`-Keys, K2 rekursiver Geldfeld-Grep ueber die gesamte `/api/state`-Antwort, K3 Prozent-Berechnung, K4 kein Plan → `null` (nicht `0`), K5 erschoepft → 100, K6 floor statt round (96 statt 100), K7 fehlender Perioden-Anker → 100 (fail-closed), K8 reine Leseprojektion (kein `save()`).

**Kern-Edits:**
- `src/billing/meter.js`: neu `tenantQuotaView(store, tenantId)` (Argument-Zusammenstellung, EINE Quelle fuer `api-read.js` UND `self-service-routes.js`, G5) und `planUsagePercent(quota)` (fail-closed, `FULL_PERCENT`-Konstante statt Magic Number). `quotaView` selbst bleibt unveraendert (Bestandstests `bk4-quota-view`/`bk4-self-service-quota` bleiben gruen).
- `src/self-service-routes.js`: `paymentView` nutzt `tenantQuotaView` statt eigener Destrukturierung (Antwort-Shape byte-identisch).
- `src/routes/api-read.js`: `usageView` verliert `costEur`/`tenantCapEur`/`spendMonthCostEur`/`spendMonthKey`/`reservedEur`, bekommt `planUsagePercent`. Tote Imports (`CENTS_PER_EUR`, `spendMonthUsageCents`, `spendMonthWindowKey`) entfernt.
- `src/mcp-tools.js`: tote Helfer `costDigits`/`AGENT_STATUS_COST_DIGITS`/`chargeCurrencyLabel` geloescht; `pickAgentStatus`, `AGENT_STATUS_OUTPUT`-Schema, Textblock und `description` auf `planUsagePercent` umgestellt; neuer Zeilen-Helfer `planUsageLine`.
- `src/i18n/mcp-texts.js` (de/en/fr): `costLifetime`/`costSpendMonth`/`reserved`/`unknownMonth` → `planUsage`/`planUsageUnknown`.
- `src/ui/widgets/agent-status.html`: 5 Geldzeilen → 1 Prozentzeile (`data-mcp="planUsagePercent"`), `bind()` ueberspringt `null` (Platzhalter `—`).
- `src/ui/widget-i18n.js`: 5 Geldeintraege entfernt, 1 neuer Eintrag (de/fr).
- `PLAN-SECURITY.md`: Ueberholt-Notiz an `## P5A-ACHSENTRENNUNG` + neuer Abschnitt `## KS-P8`.
- `PLAN-KOSTEN-STEUERUNG.md`: Statuszeile auf ERLEDIGT.

**Nicht angefasst**: `.env.example`, `render.yaml`, `src/config.js`, `src/store/*`, `src/telephony/outbound-gates.js`.

---

## Impl-Zusammenfassung

- **headCommit**: `99131fa8d9b64d13078e6101524a1358539478ac`
- `node --check` auf allen 6 geaenderten Quelldateien: sauber.
- `npm test`: 3631/3631 gruen (bereinigt um i18n-Katalog: 3611/3611).
- `npm run test:gates`: 3 rot (GAP-05, GAP-15 x2) — vorbestehend auf `master`, ohne Bezug zu dieser Phase.
- Struktursonde (`grep` nach entfallenen Geldfeldnamen in `src/routes/api-read.js`, `src/mcp-tools.js`, `src/ui`, `src/i18n`): keine Treffer.
- Smoke: lokaler Serverstart (Dummy-Env, Bootstrap-Tenant-Seed), `curl /api/state` liefert exakt `calls,inputTokens,outputTokens,planUsagePercent null` (D1 fail-closed, kein Abo im frischen Store).
- Vier Mutationsproben (kein-Plan→0, round statt floor, `costEur` reaktiviert, `exhausted`-Zweig entfernt) einzeln gesetzt: alle Tests wie erwartet rot geworden, danach exakt zurueckgebaut (Diff-bestaetigt).
- Sechs Tests ohne Edit gruen geblieben (Regressionsbeweis der `tenantQuotaView`-Extraktion): `bk4-quota-view`, `bk4-self-service-quota`, `bk5-smoke-e2e`, `mcp-ui-widget-i18n`, `p15-mcp-tool-descriptions-en`, `outbound-gates`, `ks-p4-snapshot-gate-axis`, `deny-diagnosability`.
- Angepasste Bestandstests: `api-read-parity`, `api-state-usage-axis`, `mcp-ui`, `mcp-tools-language`, `mcp-tools` (nur Kommentar). Der bisherige Waehrungslabel-Test in `mcp-tools-language.test.js` wurde nicht geloescht, sondern zum Waechter umgedreht: prueft jetzt, dass der `get_agent_status`-Text ueberhaupt keine Waehrung (`EUR`/`USD`/`€`/`$`) mehr nennt.
- Doku aktualisiert: `PLAN-SECURITY.md` (neuer Abschnitt KS-P8 + Ueberholt-Notiz an P5A-Sektion), `PLAN-KOSTEN-STEUERUNG.md` (Status ERLEDIGT).

### Deviations vom Plan

- Der Kommentar in `src/routes/api-read.js` musste anders formuliert werden (keine woertlichen Feldnamen wie `costEur` mehr im Kommentartext), damit der im Plan geforderte Struktur-Grep (Schritt 5.2) tatsaechlich leer bleibt. Inhaltlich identische Begruendung, nur ohne die literalen Identifier.

---

## Safety-Urteil

**FREIGABE (approved: true).** Alle Einzelpruefungen positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `scopeRespected`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`. Keine Blocker.

Belege: `git diff --stat master..phase -- src/telephony src/routes/voice.js src/store src/config.js src/server.js` leer — kein Gate-Praedikat beruehrt. `store.tenantBudgetSnapshot`/`store.reservationOf` bleiben reine Lese-Snapshots an den echten Gate-Kanten (`outbound-gates.js`, `routes/voice.js`) unveraendert bestehen; nur `/api/state` liest sie nicht mehr. Offenlegungssatz (`claude.js`/`bridge.js`) nicht im Diff. Keine neue Route, `/api/state` bleibt hinter bestehender `/api/*`-Auth. Aenderung entfernt Information (Geldfelder), fuegt keine hinzu. `planUsagePercent` mathematisch geschlossen geprueft: kein Divide-by-zero/NaN moeglich, da `planMinutesExceeded` im nicht-exhausted-Zweig zwingend `0 <= used < included` liefert.

**Independent test run**: eigener Worktree, `npm test` 3631/3630/1 (ein Flake: `telnyx-p5-gate-proof.test.js`, dokumentierter Voll-Last-Race, isoliert 14/14 gruen — nach Gate-Protokoll nicht echt rot). 163/163 gezielt nachgefahrene Tests gruen (inkl. pg/pglite-Backend). `npm run test:gates`: 544/541, 3 rot, thematisch fremd.

**Concerns (keine Blocker, Owner-Information):**
1. **D5-Abweichung von der Spec**: Spec erlaubte der Betreiber-Sicht ausdruecklich, Zahlen zu behalten — Umsetzung entfernt EUR-Felder aus `/api/state` fuer ALLE (keine Rollen-Weiche vorhanden). Danach keine per-Tenant-EUR-Sicht mehr ueber die API; Ersatz nur `GET /api/billing/platform-costs`, 402-Texte, DB/Logs. Bewusst getragen, in `PLAN-SECURITY.md` dokumentiert, sollte dem Owner aber explizit vorliegen.
2. **Harte API-Kontrakt-Migration ohne Flag**: die fuenf Geldfelder verschwinden sofort aus `/api/state` und `structuredContent`. Repo-intern kein verbliebener Consumer gefunden; ein externer MCP-/Widget-Host, der die alten Felder bindet, bekommt kommentarlos nichts mehr.
3. **Uneinheitlicher Leerzustand**: MCP-Textblock nennt bei `null` den fail-closed-Wortlaut, das Widget zeigt nur `—` (weil `bind()` `null` ueberspringt). Kein Sicherheitsproblem, aber die beiden Oberflaechen sagen Unterschiedliches.
4. **Formatierung**: `prettier --check` meldet 6 geaenderte Dateien — Baseline-Gegenprobe zeigt 5 davon als vorbestehende Drift; neu nur die Testdatei und eine 104-Zeichen-Zeile (`mcp-tools.js:963`). Kein Blocker.
5. **Lint nicht unabhaengig verifizierbar** (eslint bricht im Worktree ab, Package-Resolution-Problem, nicht Repo-Fehler). Nur `node --check` belegt Syntax.
6. **Clean-Code-Nit**: `planUsageLine` ist innerhalb von `registerTools` deklariert, ohne Closure zu brauchen; ein Bestandskommentar behauptet weiterhin „Text byte-identisch", was nach der Phase nicht mehr stimmt.

---

## Clean-Code-Audit (S1–S4)

- **S1**: keine.
- **S2**: keine.
- **S3**: `src/mcp-tools.js:960` (`registerTools`) — `planUsageLine()` ist ein weiterer Closure-Helfer mitten in `registerTools`; rein stilistisch, keine Wiederholung, kein Fix noetig.
- **S4**: `store.reservationOf` hat nach diesem Diff keinen `src/`-Aufrufer mehr (nur noch Tests) — im Bericht selbst als Restbefund notiert, bewusst nicht angefasst (Entfernung waere Eingriff in beide Store-Backends ohne Nutzen). Vorbestehend, kein Blocker.

**blocker: false. Verdict: PASS.**

Begruendung: Geldfelder werden an genau der einen API-Kante (`/api/state` → `usageView`) ersatzlos durch `planUsagePercent` ersetzt, konsistent durch `mcp-tools.js`/i18n/Widget/HTML gezogen. Fail-closed korrekt (kein Kontingent → `null`, nie `0 %`; erschoepft → immer `100 %`, dieselbe Praedikat-Quelle wie das Outbound-Gate). `floor()` garantiert „100 % == erschoepft" strukturell; Division im nicht-exhausted-Zweig beweisbar `> 0`. `tenantQuotaView()` ist die eine Argument-Zusammenstellung fuer `api-read.js` und `self-service-routes.js` (G5, kein Duplikat). Tote Helfer mit ihrem einzigen Aufrufer entfernt. Neue Testdatei deckt Whitelist, Geldfeld-Freiheit, Prozent-Berechnung, floor-vs-round, fail-closed-Faelle und Nebeneffekt-Freiheit ab; Bestandstests korrekt nachgezogen, keine Assertion-Luecke. Geld-Achse bleibt bewusst in 402-Texten und Betreiber-Route erhalten. Doku-Pflicht erfuellt.

**Top-TODOs**: Vor dem Merge den `Merge <sha>`-Platzhalter in `PLAN-KOSTEN-STEUERUNG.md` mit dem echten Merge-Commit fuellen. Sonst kein Handlungsbedarf am Code — Phase ist mergefaehig.

---

## Fix-Runden

Keine. Safety- und Clean-Code-Review liefen jeweils direkt auf PASS/FREIGABE ohne Blocker; entsprechend keine Fix-Runde noetig (`=== FIXES ===` im Quellmaterial ist leer).
