# Phase P2b — Detailbericht: Diagnose-Retention + `allowSummaries`-Leck

**Gate:** PASS
**finalBranch:** `phase/cq-p2b-retention`
**headCommit:** `6044450316d47bd69659eb1a8b79356ff2caf63c`
**Basis:** `master` = `bc4ddc7`

---

## 1. Worum es geht

Phase P2b aus `PLAN-CONVERSATION-QUALITY-V2.md` (Abschnitt `### P2b`, Z. 810–897) hat zwei Ziele:

1. **Diagnose-Retention (neues Feature):** Ruft der Nutzer den eigenen Agenten auf seiner eigenen, hinterlegten Nummer an (`privateNumber`), soll er das Gespräch optional als „Diagnoseanruf" markieren können. Das Roh-Transkript darf dann eine kurze, separate Frist (`DIAGNOSTIC_RETENTION_DAYS`, Default 7) überleben — statt sofort nach der Summary gelöscht zu werden.
2. **`allowSummaries`-Leck (Bugfix, security-review-pflichtig):** Bei abgeschalteten Summaries (`allowSummaries=false`) gab `summarizeCall` `null` zurück, `finishCall` returnte früh und der Roh-Transkript-Purge lief **nie**. Ein Tenant, der Summaries abschaltete, bekam damit still die **längste** Aufbewahrung (Roh-Transkript bis `RETENTION_DAYS`, bis zu 30 Tage) statt der kürzesten — exakt verkehrt herum zur Datenschutz-Absicht. Der Purge steht jetzt **vor** dem Früh-Return.

Drei am Code verifizierte Korrekturen zum ursprünglichen Plantext (im Plan-Abschnitt „0." festgehalten, damit der Umsetzungs-Agent nicht gegen falsche Annahmen baut):

- `pruneOldData` läuft nicht nur beim Boot, sondern zusätzlich alle 6 h (`RETENTION_SWEEP_INTERVAL_MS` in `src/boot.js`). Reale Obergrenze der Diagnose-Frist ist damit `DIAGNOSTIC_RETENTION_DAYS + 6h`, nicht die Frist auf die Minute.
- `RETENTION_DAYS=0` darf die Diagnose-Frist nicht mitabschalten (Bestandsguard `if (!days || days <= 0) return removed;` hätte sonst den neuen Durchgang stillgelegt — betrifft auch `test/helpers.js` `BASE_ENV`, das genau `RETENTION_DAYS: "0"` setzt).
- `place_call` reicht den MCP-Tool-Body nicht automatisch durch (Zod filtert unbekannte Keys) — ohne eigenes Schema-Feld wäre das Diagnose-Flag vom einzigen realen Client (dem MCP-Tool) nie erreichbar gewesen.

---

## 2. Plan (gekürzt)

### Neue Datei: `src/diagnostic-retention.js`
Reines Policy-Modul (kein Store, kein IO, kein `config`-Import) mit drei Funktionen:
- `diagnosticRetentionEnabled(privacy)` — Feature scharf, wenn `diagnosticRetentionDays > 0`.
- `diagnosticRetentionGranted({ requested, to, ownNumber, privacy })` — darf `call.diagnostic` gesetzt werden? Strikt `requested === true` (kein String-Truthiness-Leck), Ziel muss exakt der Tenant-`privateNumber` entsprechen.
- `keepsTranscriptForDiagnosis(call, privacy)` — zweite Prüflinie beim Call-Abschluss (Defense-in-depth).

**Scope-Entscheidung:** „eigene verifizierte Nummer" = ausschließlich `tenant.privateNumber`, bewusst **nicht** die eigene DID aus `s.numbers` (Anruf auf die eigene DID würde Agent-mit-Agent im Inbound-Webhook landen, kein Diagnose-Gespräch, doppelte Kosten).

### Edits (Kernpunkte)
- **`src/config.js`:** neue Env-Var `DIAGNOSTIC_RETENTION_DAYS` (Default 7, `min: 0`) im `privacy`-Namespace.
- **`src/store/state-ops.js`:** `createCall` trägt `diagnostic`; neuer reiner Durchgang `purgeExpiredDiagnosticTranscripts(s, days)`; `pruneOldData` zerlegt in `pruneExpiredRecords` (unverändert) + neuer Durchgang, komponiert über ein Optionsobjekt `{retentionDays, diagnosticRetentionDays}` statt zweier nebeneinanderliegender Zahlen-Positionen (Verwechslungsgefahr, F1/G25); neuer Helfer `hasPrunedSomething(removed)` als **eine** Quelle für die `save()`/Log-Bedingung beider Backends (vorher dreifach dupliziert — vergessener Zähler hätte einen Purge still nicht persistiert).
- **`src/store/json.js` / `src/store/pg.js`:** Fassaden auf das Optionsobjekt umgestellt; pg zusätzlich `rowToCall`-Hydrierung (`diagnostic: r.diagnostic === true`, pg-Boolean-Drift-Lehre beachtet) und `flushCalls`-Spalte — bewusst **nicht** im `ON CONFLICT DO UPDATE SET` (Muster `context`: write-once bei `createCall`).
- **`src/db/schema.sql`:** Spalte `diagnostic BOOLEAN NOT NULL DEFAULT FALSE` + idempotentes Forward-compat-`ALTER`.
- **`src/boot.js`:** Sweep-Log nennt jetzt auch geleerte Diagnose-Transkripte, gated über `hasPrunedSomething`.
- **`src/telephony/call-finish.js` (das Leck):** Purge-Aufruf vor den Früh-Return gezogen, gated durch `keepsTranscriptForDiagnosis(call, config.privacy)`.
- **`src/routes/api-calls.js`:** serverseitige Scope-Auflösung gegen `ctx.to` (normalisiertes Ziel) und `store.tenantPrivateNumber(ctx.tenantId)`; `diagnostic` additiv an `createCall` und in der Erfolgsantwort. Bewusst **kein** neues Gate in der `outboundGates`-Kette (liegt außerhalb, lehnt nie ab).
- **`src/mcp-tools.js`:** `place_call`-Input-Schema um optionales `diagnostic`-Flag ergänzt; `outputSchema`/`structuredContent` bewusst unangetastet.
- **`.env.example` / `render.yaml` / `test/helpers.js` (`BASE_ENV`):** neue Env-Var dokumentiert bzw. neutral gepinnt (Render: `"0"`, Test: `"0"`) — letzteres bedient explizit die bekannte Lehre `test-base-env-drift`.
- **`PLAN-SECURITY.md`:** neuer Abschnitt `P2B-DIAG` mit drei benannten Restrisiken (siehe unten).
- **Bestandstests:** gezielte Zähler-/Schema-Pins in `test/retention.test.js`, `test/store-pg.test.js`, `test/place-call-context-bridge.test.js` — alle über Testnamen aufgelöst, keine Zeilennummern.

### Neue Tests (Plan-Vorgabe, ≈22)
- `test/diagnostic-retention.test.js` (offline): Block A Scope-Prüfung (inkl. `P2b-04`: String `"true"` statt Boolean → `false`), Block B `finishCall`/`makeCallFinish` (**`P2b-10` MUSS vor dem Fix rot sein** — Kern-Regressionsbeweis für das Leck), Block C reiner Sweep-Durchgang, Block D Komposition + json-Persistenz-Durchstich.
- `test/diagnostic-retention-http.test.js` (Spawn): der serverseitige Scope-Beweis — fremdes Ziel trotz `diagnostic: true` im Request → still `false` in Antwort und Store.

### Explizit nicht Teil dieser Phase
Kein neues Gate in `outboundGates`, kein Dashboard-Toggle/zweiter Env-Schalter, kein exakterer Sweep-Timer, keine Änderung an `summarizeCall`s Rückgabevertrag, keine Änderung an `place_call`s `outputSchema`/`structuredContent`/Widget, keine Audit-Events beim stillen Downgrade, keine neuen Dependencies, kein `git push`/`git stash`/`git add -A`.

---

## 3. Implementierung — Zusammenfassung

- **Branch/Commit:** `phase/cq-p2b-retention`, committed als `6044450`.
- **`node --check`:** PASS (alle 9 betroffenen Dateien).
- **Tests:** 2456 / 2456 grün, 0 fail (zwei volle Läufe).
- **Neue Dateien:** `src/diagnostic-retention.js`, `test/diagnostic-retention.test.js`, `test/diagnostic-retention-http.test.js`.
- **Bearbeitete Dateien (17):** `.env.example`, `PLAN-SECURITY.md`, `render.yaml`, `src/boot.js`, `src/config.js`, `src/db/schema.sql`, `src/mcp-tools.js`, `src/routes/api-calls.js`, `src/store/json.js`, `src/store/pg.js`, `src/store/state-ops.js`, `src/telephony/call-finish.js`, `test/config-namespaces.test.js`, `test/helpers.js`, `test/place-call-context-bridge.test.js`, `test/retention.test.js`, `test/store-pg.test.js`.
- **Rot-vor-Fix-Beweis** (kein `git stash`, kein `--force`): Purge-Zeile in `call-finish.js` temporär manuell hinter den Früh-Return zurückversetzt → `P2b-10` und `P2b-12` schlagen fehl; danach exakt auf den committeten Stand zurückgesetzt und per Diff gegen ein Backup byte-identisch verifiziert → alle Tests wieder grün.
- **`outbound-gates-order.test.js`:** unverändert isoliert grün (16 Gates unangetastet — der Diagnose-Wunsch wird bewusst außerhalb der Gate-Kette in `api-calls.js` aufgelöst).
- **Smoke (real durchgeführt):** Server lokal (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `FAKE_ORIGINATE=true`, `DIAGNOSTIC_RETENTION_DAYS=7`, handseed-Store mit Owner-`privateNumber`). `POST /api/calls` an die eigene `privateNumber` mit `diagnostic:true` → 200, `diagnostic:true` (Response + Audit-Log + Store); derselbe Request an eine fremde Nummer → 200, `diagnostic:false` (still verworfen, kein Fehler) — der Scope-Beweis hält auch am echten laufenden Server.
- **Grep-Beweise:** `diagnosticRetentionDays` 10 Treffer in `src/`+`.env.example`+`test/helpers.js`+`render.yaml`; `DIAGNOSTIC_RETENTION_DAYS` je 1× in `.env.example`/`render.yaml`/`test/helpers.js`; `diagnostic` 2 Treffer in `schema.sql` (DDL + ALTER).

### Deviations (Abweichungen vom Plantext)

1. **`test/config-namespaces.test.js`** war im Plan (§2.14) **nicht** in der Bestandstest-Tabelle gelistet, musste aber angepasst werden: `privacy`-Namespace 1→2 Keys, Gesamt-Key-Count 99→100, primitive Blätter 93→94 — reine mechanische Folge der vom Plan selbst geforderten `config.js`-Erweiterung (§2.1); ohne die Anpassung wäre der Struktur-Pin sofort rot gewesen.
2. Ein einzelner voller Suite-Lauf zeigte einen isolierten Socket-Flake in `test/outbound-tenant.test.js` (`UND_ERR_SOCKET`, „other side closed") — eine von dieser Phase nicht berührte Datei; isoliert lief sie sofort wieder grün (6/6), ebenso der nächste volle Lauf → nach dem dokumentierten Flake-Protokoll kein echter Befund, keine Änderung nötig.
3. Für den Smoke-Test wurde der Store per `state-ops.makeDefaultState()` + manueller Tenant-/Nummern-Injektion vorbereitet statt über `scripts/bootstrap-tenant.js` zu laufen — schneller und für den Best-effort-Nachweis ausreichend, keine Verhaltensänderung.

---

## 4. Safety-Urteil (final)

**Verdikt: FREIGABE (approved) — mit einer harten Deploy-Auflage.**

Unabhängig ausgeführte Tests: volle Suite 65/65 (P2b-Fokus) und 2456/2456 (Gesamt) grün; Rot-vor-Fix selbst reproduziert (master-Fassung von `call-finish.js` in den Review-Worktree kopiert → 17/19 statt 19/19, u.a. `P2b-10` fällt genau wie erwartet).

Prüfung der Absoluten Regeln am Diff (`git diff master phase/cq-p2b-retention`):

- **SAFETY-GATES:** intakt — `src/telephony/outbound-gates.js` und `test/outbound-gates-order.test.js` unverändert. Die neue Scope-Berechnung in `api-calls.js` sitzt strikt **nach** der vollständigen Gate-Schleife, mutiert `ctx` nicht, lehnt nie ab, kann nichts umgehen. Kein neuer Endpunkt für Calls/SMS/Geld. `store.tenantPrivateNumber` wirft nie (`tenant?.privateNumber ?? null`).
- **OFFENLEGUNG:** `src/claude.js` und `src/bridge.js` byte-identisch zu master; `disclosureSentence` unangetastet.
- **AUTH FAIL-CLOSED:** `src/auth.js`/`src/web-auth.js`/`src/middleware.js` unverändert, keine neue Route.
- **SECRETS/PII:** neues Log gibt nur Zähler+Fristen aus, keine Nummern/Transkripte; API-Antwort trägt genau ein Boolean.
- **SCOPE:** exakt die 4 Spec-Punkte plus alle drei Pflicht-Deliverables; `package.json`/`package-lock.json` unverändert (keine neue Dependency); `apps/` nicht angefasst.
- **VERHALTEN:** fail-closed in beide Richtungen bestätigt (String-Truthiness-Pin, `Boolean(null)`-Fall, `DIAGNOSTIC_RETENTION_DAYS=0` wirkt an beiden Enden, Diagnose-Durchgang läuft unabhängig von `RETENTION_DAYS`).

### Concerns aus dem Safety-Review

1. **Operative Falle (wichtigste Auflage):** `config.js` hat `fallback: 7` für `DIAGNOSTIC_RETENTION_DAYS`. `render.yaml` pinnt zwar `"0"`, aber Live-Services sind Dashboard-managed — ist die Var im Render-Dashboard **nicht** gesetzt, greift der Fallback 7 und das Feature ist in Prod scharf, obwohl die Datenschutzerklärung noch fehlt. **Vor Deploy im Render-Dashboard explizit `DIAGNOSTIC_RETENTION_DAYS=0` setzen und verifizieren.**
2. `privateNumber` ist E.164- und land-validiert, aber **nicht** OTP-/rückruf-verifiziert. Der Code-Kommentar spricht von „eigener verifizierter Nummer" — überzeichnet die Zusicherung leicht; als Restrisiko 2 in `PLAN-SECURITY.md` bereits benannt und mit Gegengewichten versehen, aber die Wortwahl sollte künftig auf „hinterlegt/validiert" präzisiert werden.
3. Der `allowSummaries`-Fix ist eine echte Verhaltensänderung **unabhängig vom neuen Feature**: ein Tenant mit `allowSummaries=false` verliert das Roh-Transkript jetzt sofort nach Call-Ende statt erst nach `RETENTION_DAYS` — spec-konform und datenschutz-sicher, aber zerstört die Call-Forensik für genau diese Tenants (Bezug zur Memory-Lehre „Roh-Transkript nach Summary gelöscht = keine Call-Forensik"). Kein Blocker, aber nicht als „reines Aufräumen" misszuverstehen.
4. **MCP-Asymmetrie:** `place_call` nimmt `diagnostic` als Input entgegen, aber der MCP-Handler reicht `r.diagnostic` nicht in `data`/`structuredContent` durch — die REST-Antwort meldet den Grant ehrlich, der MCP-Client (der einzige reale Aufrufer) erfährt es nie. Kein Sicherheitsdefekt, aber eine Beobachtbarkeitslücke genau bei der datenschutzrelevanten Entscheidung (identisch mit Clean-Code-Befund `P2B-C1`, siehe unten).
5. Sweep-Takt: reale Obergrenze ist `DIAGNOSTIC_RETENTION_DAYS + 6h`, nicht die Frist auf die Minute — von der Phase selbst als Restrisiko 1 benannt; `PLAN-SECURITY.md` korrigiert den überholten Plantext-Satz „läuft nur beim Boot" korrekt.

---

## 5. Clean-Code-Audit (S1–S4)

- **S1 (Blocker):** keine.
- **S2:** keine.
- **S3 (1 Befund, `P2B-C1`):** `src/routes/api-calls.js` (Response-Feld `diagnostic`) + `src/mcp-tools.js` (`place_call`-Handler, `data`-Objekt) — G2/Least-Astonishment. `api-calls.js` liefert `diagnostic: call.diagnostic` mit dem Kommentar „ehrliche Rückmeldung, ob der Diagnose-Wunsch gewährt wurde" (Präzedenz `context_received`/I10). Der einzige reale Aufrufer von `POST /api/calls` ist aber das MCP-Tool `place_call`, dessen Handler `data` als explizite Whitelist **ohne** dieses Feld baut — es landet nie in `structuredContent`, `CALL_OUTPUT` kennt es nicht. Für die tatsächliche Produkt-Schnittstelle (MCP) ist die im Kommentar versprochene Rückmeldung damit wirkungslos.
  **Fix-Vorschlag:** `diagnostic: r.diagnostic` in den `data`-Aufbau des `place_call`-Handlers aufnehmen + `diagnostic: z.boolean()` in `CALL_OUTPUT` ergänzen (Muster `context_received`), oder den Kommentar in `api-calls.js` auf „nur REST-Ebene sichtbar" präzisieren.
- **S4:** keine.

**Verdikt:** PASS ohne Blocker (0 S1, 0 S2). Ein S3-Befund (unvollständiges Feature-Wiring). Kernstück der Phase (`allowSummaries`-Leck-Fix + Diagnose-Retention) korrekt, fail-closed und regressionsgesichert umgesetzt; volle Suite 2456/2456 lokal grün verifiziert.

**Positiv hervorgehoben:**
- Kern-Fix korrekt: Purge steht vor dem Früh-Return; `P2b-10` explizit als „rot vor Fix" markiert und direkt am Code bewiesen.
- Fail-closed konsequent: strikte `=== true`-Prüfung gegen String-Truthiness, serverseitige Scope-Prüfung, `DIAGNOSTIC_RETENTION_DAYS=0` in Produktion bis die Datenschutzerklärung nachzieht, `numEnv min:0` zusätzlich per `Math.max` geklemmt.
- Beide Store-Backends parallel und konsistent erweitert, inkl. pg-Boolean-Hydrierung und bewusster Exklusion aus `ON CONFLICT DO UPDATE SET`.
- `hasPrunedSomething` als eine Quelle statt der vorher dreifach duplizierten OR-Kette — sauberes G5-Präventionsbeispiel gegen eine benannte Datenverlust-Klasse.
- `PLAN-SECURITY.md`-Eintrag vollständig und ehrlich (3 Restrisiken, Deploy-Kopplung dokumentiert).

---

## 6. Fix-Runden

Keine Fix-Runde nötig — das Review-Ergebnis war direkt PASS (0 S1, 0 S2; Safety `approved` mit dokumentierten Concerns statt Blockern). Der einzige S3-Befund (`P2B-C1`, MCP-Passthrough) bleibt als offener Folge-Punkt stehen, siehe Owner-/Deploy-Auflagen unten.

---

## 7. Offene Owner-/Deploy-Auflagen

*(Nicht-Agenten-Arbeit, Restrisiken, Bestandsdaten-/Deploy-Auflagen — kein Teil des Abnahmekriteriums dieser Phase.)*

1. **⛔ Datenschutzerklärung (`apps/web/src/pages/datenschutz.astro`) — im P2b-Commit bewusst nicht angefasst.** Läuft zwingend über `staging` + `hermes-web-staging`, live nur per Merge auf `master` + manuellem Deploy von `hermes-web` (`docs/RUNBOOK-LAB-LIVE.md`). Fertig formulierter Textvorschlag:

   > **Diagnosemodus.** Wenn Sie den Assistenten testweise auf Ihrer eigenen, bei uns hinterlegten Rufnummer anrufen lassen, können Sie den Anruf als Diagnoseanruf kennzeichnen. In diesem Fall bewahren wir das wörtliche Gesprächsprotokoll ausnahmsweise bis zu 7 Tage auf, damit Sie das Gespräch anschließend auswerten können; danach wird es automatisch gelöscht. Der Diagnosemodus greift ausschließlich bei Anrufen an Ihre eigene hinterlegte Rufnummer — bei jedem anderen Ziel wird das wörtliche Protokoll wie sonst unmittelbar nach der Zusammenfassung gelöscht.

2. **Harte Deploy-Auflage (Reihenfolge, kein Code-Gate):** `DIAGNOSTIC_RETENTION_DAYS` bleibt in Produktion auf `0`, bis der Text aus (1) live ist. **Wichtig:** `config.js` hat `fallback: 7` — ist die Var im Render-Dashboard nicht explizit gesetzt, ist das Feature sofort scharf. Vor jedem Deploy im Render-Dashboard `DIAGNOSTIC_RETENTION_DAYS=0` **explizit setzen und verifizieren** (Live-Services sind Dashboard-managed, `render.yaml` allein wirkt nicht). Danach im Dashboard auf `7` heraufsetzen.
3. **Probeanruf** (Diagnose-Call auf die eigene Nummer, danach Rohtranskript sichten) — echter Anruf, echte Kosten, kein Agenten-Schritt.
4. **Restrisiko 2 (akzeptiert, benannt):** `privateNumber` ist E.164-/land-validiert, aber nicht OTP-/rückruf-verifiziert. Ein Tenant könnte die Nummer eines Dritten eintragen und für Anrufe an diesen Dritten die verlängerte Aufbewahrung auslösen. Gegengewichte: dieselbe Nummer ist Ziel der Summary-SMS (selbst-begrenzend), Outbound ist KYC-/abo-gegated, Frist bleibt kurz. OTP-Nachweis der `privateNumber` ist die saubere Lösung und bleibt offen (nicht Teil von P2b).
5. **Restrisiko 1 (akzeptiert, bounded):** Sweep-Takt Boot + alle 6 h → reale Obergrenze `DIAGNOSTIC_RETENTION_DAYS + 6h`, nicht die Frist auf die Minute. Render Free hat keine Cron-Jobs; ein exakterer Takt bräuchte einen eigenen Timer (nicht Teil von P2b).
6. **Restrisiko 3 (akzeptiert):** Wird `DIAGNOSTIC_RETENTION_DAYS` nachträglich von 7 auf 0 gedreht, fällt ein bereits markiertes Transkript nicht sofort, sondern beim nächsten Sweep (≤ 6 h). `RETENTION_DAYS` bleibt der harte Backstop.
7. **Clean-Code-Folge-Punkt (`P2B-C1`, S3, kein Blocker):** `diagnostic`-Feld im `place_call`-MCP-Response nachziehen (`structuredContent` + `CALL_OUTPUT`) — sonst ist die im Code versprochene „ehrliche Rückmeldung" für den einzigen echten Aufrufer (das MCP-Tool) wirkungslos.
8. **Kommentar-Präzisierung (klein, kein Blocker):** in `src/diagnostic-retention.js` „eigene verifizierte Nummer" auf „eigene hinterlegte/validierte Nummer" korrigieren, damit spätere Phasen sich nicht auf eine OTP-Garantie verlassen, die es nicht gibt.
