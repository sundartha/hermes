# Phasenreport P7 — Boot-Kohaerenz und Startfaehigkeit des Blueprints (GAP-32, GAP-38, GAP-33)

- **Gate:** PASS
- **finalBranch:** `phase/i18n-p7-boot-kohaerenz`
- **headCommit:** `f9f1ee62e9c67794770a88fac3faefa2c2fc8817`
- **Basis:** `master` = `32253f5` (Arbeitsbaum sauber)

---

## 1. Plan (gekuerzt)

Autoritativ: `PLAN-I18N-FIX.md`, Abschnitt „P7 – Boot-Kohaerenz und Startfaehigkeit des Blueprints" + Owner-Entscheidung **O6** + Praemisse **P-B1** + Auflagen A3/A6.

**Ist-Messung vor der Phase:** 6 rote Blaetter (`gap-32`, `gap-38` x2, `GAP-33` Inland/Ausland/Blueprint startfaehig). `npm run test:gates` Baseline: 70 Tests / 25 pass / 45 fail. **Neuer Befund gegenueber Plan-Text**: nicht nur Auslands-Outbound scheitert — unter ausgelieferter Konfiguration geht **gar kein** Outbound (US-Default-DID `+1` ist nirgends „Inland", jedes Leg reserviert 300 ct/min × ceil(180/60) = 900 ct gegen Decke 600 ct).

**Der Hebel:** O6 schliesst zwei der drei Stellschrauben aus (`VOICE_TARIFF_DEFAULT_CENTS` nicht senken, `MAX_CALL_DURATION_CAP_S` bleibt 300 s/Code-Konstante). Damit erzwungen:
```
worstCaseReserve = VOICE_TARIFF_DEFAULT_CENTS(300) × ceil(MAX_CALL_DURATION_CAP_S(300)/60) = 1500 ct
```
- `DEFAULT_TENANT_BUDGET_CENTS`: 600 → **1500** (kleinster Wert, der Klausel B erfuellt)
- `MAX_BUDGET_EUR`: 8 → **30** (der bereits live gemessene Wert, `LIVE_MEASURED`, keine neue Zahl erfunden)

Empirisch am Probe-Skript belegt: mit diesem Hebel kommen Inland+Ausland durch, der Blueprint bootet gruen (nur zwei WARN).

**Drei Commits geplant:**
1. **Zahlen-Kohaerenz** (`render.yaml`, `.env.example`, `src/config.js`, `src/config-fingerprint.js` [P7-E, zwei zusaetzliche Hash-Achsen], `src/boot.js` Banner-Zeile) + Test-Nachzuege (`env-docs-spend-cap-coherence`, `boot-failclosed` T-P3-13, `orig-01-05-cost-origin` ORIG-05).
2. **GAP-38** (`preDeployCommand` aus `render.yaml` entfernen, In-Prozess-Heilung): `src/config.js` (`bootstrapE164`/`bootstrapProvider`), `src/boot-guard.js` (reine Entscheidung `bootstrapHealDecision`, vier disjunkte Ausgaenge, E.164/Provider-Riegel), `src/boot.js` (`healBootstrapStore`, laeuft nach `store.load()` und vor `assertBootGates`), `test/helpers.js` (BASE_ENV-Nachzug, Lehre `test-base-env-drift`), `.env.example`, `docs/RUNBOOK-RESTORE.md`.
3. **Der `fatal`-Flip** (Deploy 7b, eigenstaendig revert-bar): `src/boot-guard.js` Klausel B `WORST_CASE_UNAFFORDABLE` von `fatal:false` auf `fatal:true` mit Zielwert in der Meldung; `AUDITED_BOOT_FINDINGS` als dadurch toter Code entfernt.

**Abweichung vom Plan-Dokument, zugunsten O6 aufgeloest:** Der P7-Fliesstext und die R5-Tabelle empfehlen ein Senken von `MAX_CALL_DURATION_CAP_S` (Richtwert 120 s) — O6 (2026-07-25, bindend) verbietet das ausdruecklich. Umgesetzt wird O6.

**Deterministisches Ergebnis (Plan-Erwartung):** `npm test` 0 fail, `npm run test:gates` 61/22/39 (Baseline 70/25/45).

**Deploy-Zerlegung:** 7a (Commit 1+2) und 7b (Commit 3) getrennt, mit Dashboard-Vorbedingungen (`MAX_BUDGET_EUR=30`, `DEFAULT_TENANT_BUDGET_CENTS=1500` explizit setzen, `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER` pruefen) und der Warnung, dass bestehende `tenant_budget`-Zeilen (600 bzw. 300/900) NICHT automatisch nachgezogen werden.

**Getragene Risiken laut Plan (Abschnitt 7):**
- 7.1 Verifikationsmethode des Plans (configHash/Banner) griff vorher nicht — deshalb P7-E notwendig, nicht optional.
- 7.2 Widerspruch Plan-Text vs. O6 — zugunsten O6 aufgeloest.
- 7.3 Es existiert bereits ein zweiter, json-only Heilpfad (`seedOwnerNumberFromEnv`) — nicht ersetzt, sondern komponiert; Konsolidierung als Follow-up markiert.
- 7.4 Heilung nach Store-Korruption moeglich (Forensik-Kopie + laute Logs + Audit + SMS machen es sichtbar) — getragen.
- 7.5 Plan-Decken (Starter 300 ct, Business 900 ct) bleiben unter der Worst-Case-Reserve 1500 ct — zahlende Abonnenten weiterhin blockiert; **Owner-Entscheidung vor erstem fremden Kunden noetig**.
- 7.6 `render.yaml` bleibt nur *im Test* startfaehig (`COST_TRUING_REQUIRED_RECORD_TYPES` leer, Test kommt nur ueber `PROD_ENV_EXEMPTIONS` durch).
- 7.7 Geld-Konsequenz: Tenant ohne eigene Budget-Zeile darf ab 7a 15,00 EUR statt 6,00 EUR pro Fenster verbrauchen; Plattform-Backstop bleibt 30,00 EUR.

---

## 2. Impl-Zusammenfassung

Vier Commits auf `phase/i18n-p7-boot-kohaerenz`, Arbeitsbaum sauber:

1. **`6c5c2b6`** Zahlen-Kohaerenz: `MAX_BUDGET_EUR` 8→30, `DEFAULT_TENANT_BUDGET_CENTS` 600→1500 in allen drei Quellen (`.env.example`, `render.yaml`, `config.js`-Fallback). Plus P7-E: `configFingerprint` haesht sieben statt fuenf Achsen, Boot-Banner druckt eine „Kosten-Decken"-Zeile.
2. **`9707fd4`** GAP-38: `preDeployCommand` aus `render.yaml` entfernt; Ersatz `healBootstrapStore` (`src/boot.js`) ueber die reine Entscheidung `bootstrapHealDecision` (`src/boot-guard.js`) mit vier Ausgaengen `NOT_NEEDED` / `HEAL` / `BLOCKED_STORE_NOT_FRESH` (Proliferations-Schutz — jede Spur eines gelebten Stores heilt nie) / `BLOCKED_PARAMS` (E.164-/Provider-Riegel). Verweigert nie selbst; `assertBootGates` bleibt einzige Exit-Stelle. Rufnummer wird nie geloggt/auditiert.
3. **`63af102`** Test-Nachzuege (Config-Blatt-Counts, Plan-Cap-Fallback, Katalog-Praefix-Umbenennung).
4. **`f9f1ee6`** GAP-32: Klausel B von WARN auf FATAL, Meldung nennt den Zielwert; `AUDITED_BOOT_FINDINGS` als toter Code entfernt (Deploy 7b, eigenstaendig revert-bar).

**Messungen:** `npm test` 3152/3152/0 (gruen, Master-Baseline 3132/3132/0). `npm run test:gates` 61/22/39 — exakt die im Plan vorhergesagte Zahl (Baseline 70/25/45). Ungefilterter Volllauf 3213 = 3152 + 61, Split-Invariante haelt exakt.

**Smoke:** Server mit `PORT=3999`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, leerem `DATA_DIR`, gesetzten `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER`: Heilungs-Log greift, neue Banner-Zeile „Kosten-Decken: Tenant-Default 1500 ct | Plattform 3000 ct | Worst-Case-Tarif 300 ct/min", Gateway laeuft, `/healthz` 200 mit 64-Hex-`configHash`, kein Rohwert.

### Deviations (vom Plan abweichend, dokumentiert)

1. Zusaetzlich noetig, im Plan nicht vorgesehen: `test/config-namespaces.test.js` (provisioning 11→13 Keys, gesamt 126→128) und `test/plan-cap-derivation.test.js` Fall (c) — beide im ersten Volllauf rot, nachgezogen.
2. `tenantsOf` wird jetzt aus `src/store/state-ops.js` **exportiert** (Plan sah das nicht vor). Grund: `s.tenants` fehlt in Bestands-/Test-Stores; ein Wurf in diesem Boot-Pfad wuerde vom `uncaughtException`-Netz zu einem lautlosen `exit(0)` — bestehender Guard wiederverwendet statt zweitem Gueltigkeitsidiom (G5).
3. Die 4 neuen Wahrheitstabellen-Tests hiessen zunaechst `GAP-38-Wahrheitstabelle: ...` und landeten im Launch-Gate-Lauf (65 statt 61 gemessen). Umbenannt auf „Boot-Heilung (GAP-38): ..." → jetzt exakt 61/22/39.
4. Plan-Test 5 (kein Doppel-Seed) prueft nicht ueber `srv.readStore()`, sondern ueber `GET /api/state`: `seedOwnerNumberFromEnv` mutiert nur In-Memory ohne `save()`, die Platte zeigt die Nummer nie — der geplante Assert waere falsch-negativ gewesen. Zusaetzlich traegt der json-Seed in diesem Test eine andere Nummer als `BOOTSTRAP_E164`, um den Gewinner ablesbar zu machen.
5. Kommentare in `test/prod-env.js` und `test/helpers.js` korrigiert (Plan nannte sie nicht): behaupteten woertlich falsche Zustaende nach P7 (C2).
6. Rot-vor-Fix-Beweis mit Abweichung vom Plan-Text: der Flip allein (ohne Zahlen-Commit) machte T-P3-12 und den env-docs-Code-Fallback-Test rot; T-P3-13 war zu diesem Zeitpunkt bereits aus anderem Grund `exit(1)` (`plan_cap_inert`) und damit gruen — konnte den Flip nicht zusaetzlich belegen.
7. Ungefilterter Volllauf meldet 6 zusaetzliche rote Eintraege in `test/profiles.test.js` (POST /api/profiles → 404) — isoliert gruen und in beiden partitionierten Laeufen gruen; bekannter Voll-Last-Flake, keine Regression dieser Phase.
8. **Nicht umgesetzt, bewusst** (Plan 7.5/7.6/6): Plan-Decken (Starter 300/Business 900 ct) bleiben unter der Reserve; `COST_TRUING_REQUIRED_RECORD_TYPES` bleibt im Blueprint leer; Probe-Anruf auf ein `+1`-Ziel braucht Live-Deploy und konnte hier nicht erfolgen. Alle drei in `STATUS.md`/`PLAN-SECURITY.md` festgehalten.
9. Deploy-Vorbedingungen (nicht Code, dokumentiert): `DEFAULT_TENANT_BUDGET_CENTS=1500` muss im Render-Dashboard explizit gesetzt werden (steht dort heute gar nicht); bestehende `tenant_budget`-Zeilen werden nicht nachgezogen.

---

## 3. Safety-Urteil

**Verdikt: FREIGABE (approved), mit Deploy-Auflagen.**

Alle geprueften Flags positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **Keine Blocker.**

Absolute Regeln (CLAUDE.md) alle gewahrt:
- **Regel 1 (Safety-Gates):** Denylist, Land-Gate, Stundenlimit, Max-Dauer (unveraendert 300 s), Signaturpruefung, Budget-Guard unberuehrt (`outbound-gates.js`, `routes/`, `store/defaults.js`, `plans.js`, `billing/` byte-identisch zu master). Einziger Geld-Effekt: angehobene Schwelle, gedeckt durch O6; die zwei von O6 verbotenen Hebel wurden nachweislich nicht genommen. Neu: `WORST_CASE_UNAFFORDABLE` von WARN auf FATAL — Verschaerfung, keine Aufweichung.
- **Regel 2 (Offenlegung):** `claude.js`/`bridge.js` nicht angefasst.
- **Regel 3 (Auth fail-closed):** `auth.js`/`web-auth.js`/`middleware.js`/`server.js`/`app.js` nicht angefasst; Heilung laeuft vor `assertBootGates`, kann aber nur heilen oder schweigen, nie den Refusal umgehen (in Smoke D/E bewiesen).
- **Regel 4 (Secrets):** kein Secret im Diff, keine Rufnummer in Log/Audit (0 Treffer geprueft); `/healthz` gibt weiterhin nur den Hash aus.
- **Regel 5 (Audio/MCP):** nicht beruehrt.
- **Regel 6 (Scope):** 24 Dateien, alle GAP-32/33/38 zuzuordnen, keine neue Dependency.

**Unabhaengiger Test-Lauf** (eigener Worktree, `review-p7` = Branch, merge-base = master HEAD `32253f5`): `npm test` 3152/3152/0; `npm run test:gates` 61/22/39; Buchhaltung ueber beide Laeufe stimmt exakt (Delta +11 = die 11 neuen Tests). Zusaetzlich 5 eigene Boot-Smoke-Faelle (A: gruener Boot mit korrekten Werten; B: `exit 1` mit Zielwert-Meldung bei inkohaerenten Werten; C: Heilung greift, 0 Nummer-Treffer im Log; D: gelebter Store heilt nicht, Bestands-Refusal bleibt; E: Muell-E.164 heilt nicht) — alle wie erwartet.

**Concerns (dokumentiert, kein Blocker):**
1. Deploy-Risiko: der fatal-Flip toetet den Boot, wenn im Dashboard `DEFAULT_TENANT_BUDGET_CENTS=600` steht — 7a/7b-Trennung korrekt umgesetzt, 7b darf erst nach configHash-Verifikation von 7a raus.
2. Geld-Folge bewusst: genereller Tenant-Deckel 600→1500 ct je Fenster fuer Tenants ohne eigene Budget-Zeile.
3. GAP-33 nur fuer Tenants ohne Plan-Zeile geloest — ein zahlender Starter-Abonnent faellt weiterhin in den 402 (`pay-04` bleibt bewusst gruen und pinnt das).
4. `render.yaml` weiterhin nicht allein deploy-faehig (`COST_TRUING_REQUIRED_RECORD_TYPES` leer, Test kommt nur ueber `PROD_ENV_EXEMPTIONS` durch) — Testname ueberzeichnet leicht, Kommentar im Test benennt es aber korrekt.
5. Boot-Heilung setzt `kycLevel='id_verified'` am Bootstrap-Tenant — byte-gleich zum Bestandsverhalten (`preDeployCommand`/`npm run bootstrap-tenant`), aber neu automatisch bei jedem Boot moeglich statt nur auf Kommando; vier Riegel stehen davor.
6. Restrisiko (in `PLAN-SECURITY.md` getragen): forensisch umbenannter korrupter `store.json` gilt als „frisch" und wuerde geheilt — kein DID-Kauf beteiligt, Audit+SMS machen es sichtbar.
7. Heilung sendet eine echte, kostenpflichtige Plattform-SMS ohne eigenes Budget-/Denylist-Gate — identisch zum Bestandsmuster, fail-soft; in Produktion heute leer (`PLATFORM_ALERT_SMS_TO`), also aktuell keine SMS.
8. Theoretische Mehr-Instanz-Race — idempotent/wertgleich, Render free = 1 Instanz.
9. `npm run lint` in der Review-Umgebung nicht ausfuehrbar (vorbestehend, nicht P7-verursacht); `node --check` auf allen 5 geaenderten `src`-Dateien gruen.
10. Workflow-Setup-Befehl (`ln -s "./node_modules" node_modules`) erzeugte einen defekten Selbstverweis-Symlink im Worktree, musste korrigiert werden — kein Befund am Branch, aber fehlerhafter Workflow-Befehl.

**Deploy-Auflagen (verbindlich, keine Merge-Blocker):**
1. Deploy 7a (`6c5c2b6`+`9707fd4`+`63af102`) und 7b (`f9f1ee6`) getrennt ausrollen; 7b erst nach configHash-Verifikation von 7a.
2. Vor 7b im Render-Dashboard pruefen, ob `DEFAULT_TENANT_BUDGET_CENTS` gesetzt ist — steht dort 600, bootet der Dienst nach 7b nicht mehr.
3. Am Prod-Postgres bestehende `tenant_budget`-Zeilen (600 bzw. 300/900) bewusst anheben oder loeschen.
4. `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER` muessen im Dashboard stehen, sonst ist der neue Wiederherstellungspfad wirkungslos (fail-closed, kein Schaden).
5. `COST_TRUING_REQUIRED_RECORD_TYPES` bleibt zweiter, ungeloester Blueprint-Blocker.

---

## 4. Clean-Code-Audit

**Verdikt: PASS. Kein S1/S2-Befund.**

- **S1:** []
- **S2:** []
- **S3:**
  - `src/boot-guard.js:44-46` — Kommentar referenziert `seedBootstrapNumber`/`seedOwnerNumberFromEnv` aus einem anderen Modul ohne Pfadangabe; verifiziert, dass der Bezug real und korrekt ist (beide existieren, Pflicht-Validierung vor `bootstrapTenant` stimmt) — kein Fix noetig, nur Fussnote.
- **S4:** []
- **blocker:** false

**Begruendung (Kurzfassung):** Saubere Trennung reine Entscheidung (`bootstrapHealDecision`) vs. IO (`healBootstrapStore`), Muster `spendCapCoherence` konsequent weitergefuehrt. Wiederverwendung statt Duplikat: `tenantsOf` exportiert statt kopiert (G5), `sendBootstrapAlertSms`/`alert-sms.js` unveraendert wiederverwendet, `store.bootstrapTenant` genutzt statt eigener Mutation. Tote Konstante `AUDITED_BOOT_FINDINGS` korrekt entfernt (durch den fatal-Flip beweisbar unerreichbar), keine Reste. PII/Secrets: Rufnummer nie geloggt/auditiert (nur `provider=`). E.164-/Provider-Vorpruefung ist load-bearing, kein Kommentar-Bluff (verifiziert: `state-ops.bootstrapTenant` validiert selbst nicht). Testabdeckung fuer jeden neuen Ausgang/jede Klausel vorhanden (`boot-guard.test.js` Wahrheitstabelle aller 4 Ausgaenge, `bootstrap-heal-boot.test.js` 7 Spawn-Tests: Heilung/Idempotenz/Proliferations-Schutz/Store-Ladefehler-Propagation/OWNER_NUMBER_SEED-Vorrang/geschlossene Enum-Menge), plus konsistente Nachzuege in 9 weiteren Testdateien. Doku-Kette vollstaendig (`PLAN-SECURITY.md`, `STATUS.md`, `.env.example`, `render.yaml`, `docs/RUNBOOK-RESTORE.md`) mit Deploy-Vorbedingungen und Restrisiko explizit benannt. Keine Safety-Gate-Aufweichung, keine neue Dependency, kein Scope-Ueberschuss.

**Top-Todos (nicht blockierend):**
1. Vor dem Deploy: `DEFAULT_TENANT_BUDGET_CENTS=1500` explizit im Render-Dashboard setzen — sonst wirkt nur der unsichtbare Code-Fallback.
2. Vor dem Deploy: bestehende `tenant_budget`-Zeilen am Prod-Postgres pruefen/anheben — sonst bleiben Alt-Tenants beim 402.
3. Follow-up: `OWNER_NUMBER_SEED`/`OWNER_NUMBER_PROVIDER` gegen `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER` konsolidieren (zwei Env-Paare fuer dieselbe Sache, bereits in `PLAN-SECURITY.md`/`STATUS.md` vermerkt).

---

## 5. Fix-Runden

Keine — der erste Safety-Review und das erste Clean-Code-Audit liefen beide **PASS/approved** ohne Blocker; es gab keine Fix-Runde.

---

## 6. Geaenderte Dateien (24)

**Produktionscode (6):** `render.yaml`, `.env.example`, `src/config.js`, `src/config-fingerprint.js`, `src/boot.js`, `src/boot-guard.js`, `src/store/state-ops.js`

**Doku (3):** `PLAN-SECURITY.md`, `STATUS.md`, `docs/RUNBOOK-RESTORE.md`

**Tests (1 neu, 13 geaendert):**
- Neu: `test/bootstrap-heal-boot.test.js`
- Geaendert: `test/helpers.js`, `test/prod-env.js`, `test/prod-config-smoke.test.js`, `test/gap-32-worst-case-fatal.test.js`, `test/gap-38-plan-free-predeploy.test.js`, `test/gap-36-healthz-fingerprint.test.js`, `test/env-docs-spend-cap-coherence.test.js`, `test/boot-failclosed.test.js`, `test/boot-guard.test.js`, `test/spend-cap-coherence.test.js`, `test/orig-01-05-cost-origin.test.js`, `test/config-namespaces.test.js`, `test/plan-cap-derivation.test.js`
