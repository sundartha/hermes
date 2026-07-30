# KS-P3 — Detailbericht: Reserve entkoppeln + guthaben-abgeleitete Notbremse

- **finalBranch:** `phase/ks-p3-zeitgrenze-notbremse` (headCommit `4f3e9e3f677ac1b82858bf0e00369fb8fb4ce39a`, Basis `master` @ `5bc9f93`)
- **Gate:** **PASS**
- **Scope:** (a) Vorab-Reserve von der Maximaldauer entkoppeln, (b) die Zeitgrenze wird eine guthaben-abgeleitete Notbremse (Owner-Entscheidungen E2/E3/E8)

---

## 1. Ausgangslage

Bindend war NICHT `tasks/ks-chain-spec.md` (dort fehlt ein KS-P3-Abschnitt), sondern `### KS-P3` in `PLAN-KOSTEN-STEUERUNG.md` plus E2/E3/E8. Vorbedingungen (KS-P6, KS-P2, KS-P4, KS-P5, KS-P1b, KS-P3a, KS-P7) waren zum Planzeitpunkt bereits auf `master` gemergt.

---

## 2. Plan (gekürzt)

### Entwurfsentscheidungen
- **D1 — Reserve wird reine Vorlauf-Größe:** `tariff * RESERVE_LEAD_MINUTES` mit `RESERVE_LEAD_MINUTES = 2`. Deckt nur noch das Fenster bis der Live-Zähler (KS-P2) greift + Gleichzeitigkeit; nicht mehr die ganze Gesprächsdauer.
- **D2 — Reserve-Formel EINE Quelle:** `outboundReserveCents(tariffCentsPerMin)` wandert nach `src/store/defaults.js` (Blatt-Modul, von Gate UND Boot-Guard bereits importiert). `maxCallDurationS` fällt aus beiden Boot-Guard-Signaturen — die Zeitgrenze kann den Boot nicht mehr töten.
- **D3 — Notbremse als reine Funktion:**
  `Restminuten = max(0, floor(remainingCents / tariffCentsPerMin))`
  `Notbremse_s = min((Restminuten + BRAKE_BUFFER_MINUTES) * 60, MAX_CALL_DURATION_CAP_S)`, `BRAKE_BUFFER_MINUTES = 1` (E8). Fail-Richtung: nicht auflösbares Guthaben (D7-Riegel) oder Tarif ≤ 0/nicht endlich → absolute Obergrenze, nie „unbegrenzt". Untergrenze 60 s (Puffer allein), nie 0.
- **D4 — Frist wird beim Anlegen abgeleitet, NICHT beim Re-Attach neu geschrieben.** E8 ist bereits über die Geld-Prüfung beim Re-Attach (KS-P1b) erfüllt. Verworfene Alternative: `maxDurationS` beim Re-Attach neu ableiten — würde `cappedEndedAtMs` an eine schrumpfende Frist koppeln → Unterbuchung realer Carrier-Minuten.
- **D5 — `MAX_CALL_DURATION_S` entfällt** als Env-/Config-Größe (E2/E3: keine neue feste Maximaldauer, der Operator-Knopf wäre wirkungslos-gefährlich, da Dashboard-managed). Ersatz: hartkodierte `MAX_CALL_DURATION_CAP_S`.
- **D6 — `MAX_CALL_DURATION_CAP_S` 300 → 1800** (30 min, Größenordnung des größten Kontingents). Gegen die Guards nach D2 nachgerechnet: `spendCapCoherence` Klausel B (60 ct ≤ 1500 ct) und `planCapReserveFindings` (60 ct ≤ 1500 ct Starter) bleiben grün und sind jetzt dauerhaft dauer-unabhängig.
- **D7 — `TELNYX_DEAD_AIR_TIMEOUT_S` behält `max: 300`**, verliert nur seine Cap-Ableitungs-Begründung (eigenständiger Watchdog-Wert).
- **D8 — `POOL_SINCE_MARGIN_MS`** wird `POOL_SINCE_MARGIN_FACTOR (12) × MAX_CALL_DURATION_CAP_S` statt fest gepflegter Zahl (TOD 12, überlebt künftige Cap-Wechsel).

### Neue Symbole
- `src/store/defaults.js`: `RESERVE_LEAD_MINUTES = 2`, `outboundReserveCents(tariffCentsPerMin)`, `MAX_CALL_DURATION_CAP_S` 300→1800, `DEFAULT_CALL_DURATION_S` gelöscht.
- `src/call-duration.js`: `BRAKE_BUFFER_MINUTES = 1`, `emergencyBrakeSeconds({remainingCents, tariffCentsPerMin})`, privater Helfer `affordableMinutes`.

### Edits (Auswahl der Kernstellen)
- `boot-guard.js`: `worstCaseReserveCents` gelöscht, beide Aufrufer (`spendCapCoherence`, `planCapReserveFindings`) verlieren `maxCallDurationS` aus der Signatur, nutzen `outboundReserveCents`.
- `boot.js`: `assertSpendCapCoherence` ohne `maxCallDurationS`.
- `telephony/outbound-gates.js`: `resolveMaxDurationS(raw, brakeSeconds)` — Body-Override kann nur noch verkürzen; neuer `brakeSecondsFor(tenantId, tariffCents)`-Helfer über dem Gate-Array; `compute_reserve`-Gate liest jetzt den Store (lehnt aber weiterhin nie ab).
- `config.js`: `maxCallDurationS` (numEnv, Namespace `safety`) gelöscht; Folgekommentare bei `deadAirTimeoutS`, `capFarewellLeadMs`, `defaultTenantBudgetCents` nachgezogen.
- `telephony/call-lifecycle.js`, `routes/voice.js`, `bridge.js` (HEIKLE STELLE, nur Argument-Tausch): `config.safety.maxCallDurationS` → `MAX_CALL_DURATION_CAP_S` als Fallback; Inbound-Call bekommt beim Anlegen ein guthaben-abgeleitetes `maxDurationS` über einen analogen `brakeSecondsFor(leg)`-Helfer (nutzt `callTariffCentsPerMin`, keine Richtungsregel-Duplizierung).
- `billing/cost-truing.js`: `POOL_SINCE_MARGIN_MS` abgeleitet statt Literal.
- `mcp-tools.js`: Tool-Beschreibung `max_duration_s` neu formuliert (Server leitet effektive Grenze ab, verkürzt nur).
- `billing/plan-caps.js`: Kommentar-Nachzug (Kopffreiheits-Herleitung ohne `MAX_CALL_DURATION_CAP_S`-Term).
- Doku/Deploy: `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `tasks/ks-deploy-checkliste.md` nachgezogen.

### Tests (4 neue/angepasste Dateien laut Plan)
- `test/ks-p3-reserve-decoupled.test.js`, `test/ks-p3-emergency-brake.test.js`, `test/ks-p3-brake-wiring.test.js` (neu) + eine Reihe angepasster Bestandstests (siehe §4 unten).
- Vier geforderte Mutationsproben: Dauer-Unabhängigkeit der Reserve, „Live-Zähler bindet immer zuerst" (Puffer-Zusage, `BRAKE_BUFFER_MINUTES=0` → rot), Boot-Guards dauer-blind, Outbound-Frist-Wiring.

### Pre-Mortem (6 Punkte, Kern)
1. Kuba-30-Minuten-Fall: Notbremse deckelt bei 1800 s zu unserem Satz — getragenes Restrisiko, KS-P7 (Sperrliste) davor.
2. Reserve schützt Gleichzeitigkeit nicht mehr über die volle Dauer — Lücke deckt der KS-P2-Live-Term.
3. Bestands-Calls ohne `maxDurationS` fallen nach Deploy auf 1800 s statt 180 s — bounded auf aktive Legs zum Deploy-Zeitpunkt.
4. Boot-Re-Arm hat kein Geld-Gate (anders als Re-Attach seit KS-P1b) — notiert, nicht gefixt (Nachbarphase).
5. `MAX_CALL_DURATION_S` wird gelöscht statt umgedeutet, damit ein stehengebliebener Dashboard-Wert nichts mehr tut.
6. Notbremse wird keine neue verdeckte Produktgrenze, solange 1800 s über jedem realistischen Terminanruf liegt.

### Ausdrücklich nicht in dieser Phase
`MAX_BUDGET_EUR`/Plattform-Achse, Denylist, Prozentanzeige (KS-P8), Inbound-Budget-Sperre (KS-P10, zurückgezogen), Reserve-Rekonstruktion beim Boot, Plattform-Achse mid-call, Inbound-Kostenbuchung, AL-P2-Spike-Reste, jede Änderung an `disclosureSentence`/Auth/Signaturprüfung/`OUTBOUND_FROZEN`/Abo-KYC/Stundenlimit/Land-Gate. Keine neue npm-Dependency.

---

## 3. Implementierungs-Zusammenfassung

Umgesetzt wie geplant: `outboundReserveCents` als EINE Quelle für das `compute_reserve`-Gate und beide Boot-Guards (die private Doppel-Formel in `boot-guard.js` gelöscht); `emergencyBrakeSeconds` als reine Funktion in `call-duration.js` mit zwei Aufrufern (Outbound-Gate, `/voice/incoming`), die nur ihre Eingaben beschaffen. Bei 30 ct/min: Reserve 150 ct → 60 ct je Anruf. `MAX_CALL_DURATION_S` ersatzlos entfallen, `MAX_CALL_DURATION_CAP_S` 300 → 1800 s hartkodiert, `POOL_SINCE_MARGIN_MS` abgeleitet statt gepflegt.

- `GATE_CHAIN_LENGTH` bleibt 17, `EXPECTED_ORDER` unverändert.
- Body-Override kann die Frist nur verkürzen, nie verlängern.
- Fail-Richtung geprüft: `remainingCents === null` (D7) oder Satz ≤ 0 → absolute Obergrenze, nie unbegrenzt; Untergrenze 60 s.
- `nodeCheckPass`: true (alle 10 logik-tragenden Module).
- Regressionslauf: 3626 Tests, 0 fail (nach Auflösung eines isolierten Spawn-Race-Flakes, s. Deviations).
- 15 neue Tests in 3 Dateien; alle 4 Mutationsproben durchgeführt.

### Deviations
1. Worktree lag auf einem stalen Commit (`57adf4a`, kein Nachfahre von `master`) — Regel 0 angewandt: Branch explizit von `master`@`5bc9f93` neu angelegt, `git merge-base --is-ancestor` verifiziert.
2. Umgebungs-Befund (kein Phasen-Defekt): `npm test`/`npm start` lieferten im Worktree keine Ausgabe, Exit 194. Ursache laut Safety-Review: ein selbstreferenzieller `node_modules`-Symlink aus der Workflow-Vorgabe. Läufe stattdessen mit ausgeschriebener `node --test`-Invocation gefahren.
3. MCP-Beschreibungstext für `max_duration_s` enthielt geplant das Wort „SHORTER", was den gepinnten Emphase-Test O14 (vorher `[]`) brach. Pin bewusst auf `["SHORTER"]` nachgezogen und im Test begründet — die Verhaltensgarantie „Client-Wunsch kann nur verkürzen" ist die eigentliche Aussage des Feldes.
4. Zusätzlich zum Plan angepasste Bestandstests (Folge der Formel-/Signaturänderung, keine Aufweichung): `test/config-namespaces.test.js`, `test/boot-failclosed.test.js` (T-P3-12: 600/300 → 500/300, unter neuer Formel kohärent), `test/cost-origin-axis.test.js`, `test/cost-truing-retrievable.test.js`, `test/outbound-reserve-{backstop,concurrency-http,release-success}.test.js` (Tarife neu gewählt), `test/p15-mcp-tool-descriptions-en.test.js`.
5. Boot-Guard-Meldungstext über Plan hinaus präzisiert: nannte `max_duration_s=<n>` als Grenze der Bezahlbarkeit (C2, ein Parameter, der die Bezahlbarkeit nicht mehr steuert) — neu formuliert, Zahl unverändert.
6. Regressionslauf: erster Volllauf 3626/0; ein Zwischenlauf zeigte 1 rot (`HC6 Flag AUS`, `fetch failed` nach 8 s), isoliert 10/10 grün — als dokumentierter Spawn-Race-Flake gewertet, nicht als Befund.
7. Nicht behoben, nur notiert (Spec-Regel „nur die eigene Phase"): `rearmActiveCallTimers` (Boot-Re-Arm) hat kein Geld-Gate, anders als der Re-Attach seit KS-P1b — als Restrisiko in `PLAN-SECURITY.md` und hier vermerkt.

---

## 4. Safety-Urteil (final)

**approved: true** — alle Einzelchecks true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`), **keine Blocker**.

Unabhängiger Testlauf im frischen Worktree: Basis verifiziert (`master` == Merge-Base == `5bc9f93`). Regression: Lauf 1 = 3606/3601, 5 fail in `test/api-routes.test.js` (T-P4-08 + 4 Subtests, 401 statt 200/400) — isoliert 5/5 grün, vom Diff nicht berührt → dokumentierter Spawn-Race-Flake unter Volllast. Lauf 2 = 3606/3606, 0 fail. Gates: 129 korrigiert / 3 fail = GAP-05, GAP-15×2 — exakt master-Baseline, keine neue Rot-Zeile. Boot-Smoke mit live-naher Env UND absichtlich stehengebliebenem `MAX_CALL_DURATION_S=180`: `/healthz` 200, kein „Start abgebrochen", toter Key wirkt nicht mehr.

Regel-für-Regel geprüft:
- **Regel 1 (Safety-Gates):** Gate-Kette/Reihenfolge unverändert; `compute_reserve` lehnt weiterhin nie ab, Geld-Entscheidung bleibt bei `reserve_budget`. Denylist, Land-Gate, Stundenlimit, Per-Target-Cap, KYC/Abo-Permit, `OUTBOUND_FROZEN`, Tenant-Kostendecke unberührt. Max-Gesprächsdauer nicht entfernt, sondern umgehängt und HARTKODIERT (schwerer zu entwaffnen als vorher, da nicht mehr per Env abschaltbar). `resolveMaxDurationS` verifiziert: Client kann Frist nur verkürzen (strenger als Bestand, wo ein Body-Wert bis 300 s anheben konnte).
- **Regel 2 (Offenlegung):** `disclosureSentence` und Aufrufstellen byte-identisch; `bridge.js` (HEIKLE STELLE) nur Import + Argument-Tausch am `endTimer`, Barge-in/Call-Ende unberührt.
- **Regel 3 (Auth fail-closed):** null Zeilen in `auth.js`/`web-auth.js`/`middleware.js`/`server.js`/Signatur-Adaptern geändert; kein neuer Endpunkt.
- **Regel 4 (Secrets):** kein Secret im Diff, Testfixture-Nummern bereits in `master`, Report PII-frei.
- **Regel 5 (Audio/MCP):** nur `place_call.max_duration_s`-Beschreibung geändert, kein Audio-Pfad berührt.
- **Regel 6 (Scope):** keine neue Dependency, kein neuer Env-Schlüssel (einer entfallen), keine DB-Migration.

**Verdict: FREIGABE**, mit fünf Vorbehalten (keiner ein Regelverstoß):
1. **Härtester Befund:** Restrisiko-4-Formulierung im Bericht ist zu optimistisch. `blockingBudgetAxis` wird ausschließlich PRO TURN ausgewertet — im Hänger-Fall (für den die Notbremse existiert) läuft der Live-Term nie. Rechnung bei Live-Kalibrierung: sechs gleichzeitig hängende Outbound-Legs könnten bis zu 6 × 1800 s × 30 ct/min = 5400 ct gegen eine 1500-ct-Decke kosten, davon nur 360 ct vorab reserviert (Bestand: 540 ct vollständig durch 900 ct Reserve gedeckt). Owner-entschieden (E2/E3/E8), daher kein Regelverstoß, aber die Restrisiko-Formulierung sollte präzisiert werden.
2. `CAP_FAREWELL_LEAD_MS` Default 20000 ms gegen die kürzestmögliche Notbremse (60 s): Abschiedssatz bei knappem Guthaben nach 40 s eines 60-s-Fensters (33 % Marge), kein `numEnv`-Riegel erzwingt das Verhältnis.
3. `rearmActiveCallTimers` weiterhin ohne Geld-Gate, Frist jetzt bis 1800 s statt 180 s — korrekt nicht nebenbei gefixt.
4. Deploy-Übergangscalls fallen auf 1800 s Fallback statt vorher 180 s — akzeptiertes, bounded Restrisiko.
5. Umgebungsbefund: Der im Report genannte „npm-/worktree-spezifisch"-Grund für das `npm test`-Versagen ist eine Fehldiagnose — Ursache war der selbstreferenzielle Symlink aus der Workflow-Vorgabe, nicht die Umgebung selbst.

---

## 5. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2:** keine
- **s3 (Info, kein Flag):**
  - `src/telephony/reattach.js`: Parametername `maxCallDurationS` ist Altlast, `call-lifecycle.js` reicht jetzt `MAX_CALL_DURATION_CAP_S` herein — Datei nicht Teil des Diffs, nur Hinweis.
  - `src/call-duration.js:42` vs `src/boot-guard.js:86`: `SECONDS_PER_MINUTE = 60` steht modul-lokal an zwei Stellen — explizit begründet (Zeit-Einheit, kein Betriebsparameter, G35 n.z.), deckt sich mit etabliertem Muster (`MS_PER_MINUTE`).
- **s4:** keine
- **blocker: false**
- **Verdict: PASS** — keine S1/S2-Befunde. EINE Quelle je Regel (`outboundReserveCents`, `emergencyBrakeSeconds`), keine Duplizierung, Body-Override kann nur verkürzen (getestet), alle Fail-Fälle (D7/NaN/negativ/Satz≤0) fallen auf die Obergrenze, Tests prüfen Literale UND Eigenschaften (Monotonie, Puffer-Zusage), Kommentare durchgehend nachgezogen (kein C2), Env-Dokumentation (`.env.example`, `render.yaml`, `BASE_ENV`, `CONFIG_NAMESPACES`) lückenlos.
- **Top-Todos (beide optional, kein Blocker):**
  1. `reattach.js`-Parametername bei nächster Berührung präzisieren (kosmetisch, S3, nicht Teil dieser Phase).
  2. Restrisiko 2 aus `PLAN-SECURITY.md` (Deploy-Übergangscalls auf 1800 s) im Blick behalten, falls Deploy-Fenster mit vielen aktiven Legs zusammenfällt.

---

## 6. Fix-Runden

Keine — der Impl-Durchlauf erreichte direkt PASS in Safety- und Clean-Code-Review; die einzigen Nacharbeiten waren die im Plan bereits vorgesehenen bzw. als Deviation gemeldeten Test-/Kommentar-Anpassungen im selben Durchlauf, keine separate Fix-Runde nach einem Review-Reject.
