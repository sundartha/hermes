# Phase P8 — Detailbericht

**Titel:** Gebündelte Politur-Phase (S3/S4) — benannte Konstanten, Kommentar-/Dead-Code-Bereinigung, F1-Param-Objekte, 2 neue Testluecken-Fixes — verhaltens-erhaltend
**Gate:** PASS
**finalBranch:** `phase/cc-p8-polish-fix1`
**Plan-Basis:** lokaler `master` @ `027c9b6` (P1–P7 der Clean-Code-Strategie gelandet, Baseline-Testzahl 2397/0)
**headCommit (Impl, vor Fix-Runde, auf `phase/cc-p8-polish`):** `b0cc76210fb46f587521510981d1104e89c9b656`
**finalBranch-Commit (nach Fix-Runde r1, auf `phase/cc-p8-polish-fix1`):** `d022e6c`

---

## 1. Ausgangslage / Ziel

P8 ist eine gebündelte Politur-Phase der Clean-Code-Strategie (`PLAN-CLEAN-CODE.md`, Schwerpunkte S3/S4: benannte Konstanten statt Magic Numbers/Strings, toter Code, F1-Parameterbündelung bei isolierten Helfern, C1-Provenienz-Marker, C2-veraltete Kommentare, plus zwei offene Testlücken). Alle Funde wurden **am aktuellen master neu verifiziert** (nicht aus alten Plan-Zeilennummern übernommen) — mehrere Invarianten-Prämissen hielten dabei nicht mehr (siehe Abschnitt 2, Re-Verifikationsteil A). Ziel: verhaltens-erhaltend, kleiner Blast-Radius, kein neuer Endpunkt/Env-Var/Dependency.

## 2. Plan (gekürzt)

### A — Re-Verifikations-Befunde, die von den Invarianten abwichen (kein blindes Patchen)

1. `MAX_IDENTIFIER_LENGTH=254` existierte bereits als `IDENTITY_MAX_LEN` (`api-profiles.js:17`, exportiert; P7 hatte die tenantId-400-Guards schon zu `requireValidTenantId()` konsolidiert) → kein neuer Konstantenname, nur 2 Fehlertext-Literale umstellen.
2. `ACCOUNT_STATUS_SUSPENDED`/`STATUS_ACTIVE` nicht neu anlegen — `TENANT_STATUS` (`store/defaults.js:157`) existierte bereits und wurde teils schon importiert; vorhandenes Enum wiederverwenden statt Dopplung (das separate `NUMBER_STATUS.SUSPENDED` ist ein anderes Enum, unangetastet).
3. `deleteMissingByText`: „1 unbenutzter Parameter" galt nicht mehr — alle 5 Parameter waren live genutzt → reine Bündelung, kein Parameter-Entfernen.
4. `this.duration` existierte nicht in `wing-canvas-engine.js`, nur `this.target` war tot (write-only) — Invarianten-Paar auf `this.target` reduziert.
5. `[F5]`-Marker in `portal-pool.js` ist ein Runbook-Anker (referenziert in `docs/RUNBOOK-RESTORE.md`, `docs/RUNBOOK-OPERATOR.md`), kein Change-Log-Marker → bleibt.
6. `GLOBAL_CAP_REASON="global_cap"` war bereits eine Konstante (`defaults.js:85`) — die neue Reason-Enum-Extraktion baut darauf auf statt zu duplizieren.

### B — Konkrete Änderungen

- **B1 Magic Numbers/Strings → Konstanten (G25/G11):** `IDENTITY_MAX_LEN` in 2 Fehlertexten (`api-onboard.js`); neue Modul-Konstante `SMS_BODY_MAX_CHARS=1500` (`call-finish.js`); neue Konstanten `END_CALL_TOOL_NAME="end_call"` + `DEFAULT_EVENT_DURATION_MINUTES=60` in `claude.js` (nur Schema/Dispatch/Guard-Literale, **nicht** die an das Modell gerichtete Prompt-Prosa); vorhandenes `TENANT_STATUS.SUSPENDED`/`.ACTIVE` statt Roh-Strings in `web-auth.js` (4 Stellen) und `db/migrate.js` (SQL); neues `VOICE_ENGINE`-Enum (`{BUDGET:"budget", REALTIME:"realtime"}`) in `config.js`, verdrahtet in 5 Konsumenten (`voice.js` ×2, `call-lifecycle.js`, `api-calls.js`, `boot.js`); neues `REQUEST_NUMBER_REASON`-Enum (`state-ops.js`/`defaults.js`, baut auf `GLOBAL_CAP_REASON` auf) für `tenant_inactive`/`tenant_cap`. Alle Werte grep-/node-verifiziert byte-identisch zu den ersetzten Literalen.
- **B2 Tote Symbole löschen (G9/G12):** `src/utils/format-duration.js` + `test/format-duration.test.js` (39 Tests) komplett gelöscht — repo-weit kein Prod-Importer (call.html hat eine eigene, andere Inline-Implementierung); `Timeline.prototype.pause` + write-only `this.target` in **beiden** Wing-Canvas-Mirror-Kopien (`src/ui/` + `design-system/components/brand/`) synchron entfernt; tote Regex-Alternative `^i'` in `i18n/locales.js` (mathematisch als Teilmenge von `^i\b` bewiesen, Node-verifiziert); tote ctx-Felder `log`/`finalize` in `bridge.js` (HEIKLE STELLE — `handleOpenAiEvent` destrukturiert beide nicht, kein `ctx.log`/`ctx.finalize`-Zugriff); `_pool` in `portal-pool.js` (**siehe Fix-Runde r1** — dieser Punkt musste nach dem ersten Review zurückgenommen werden, Details Abschnitt 6).
- **B3 F1-Parameterbündelung (nur isolierte Helfer ohne Test-Caller):** `pg.js:deleteMissingByText` (5 Positionsargumente → Options-Objekt), `llm.js:backoffDelay` (4→Objekt), `wing-canvas-engine.js:drawTriangle` (15→3 Argumente über `blit={ctx,img,dpr}`/`dst`/`src`-Arrays, 1:1-Mapping-Tabelle im Plan, beide Mirror-Kopien byte-identisch).
- **B4 C1 vergängliche Marker entfernen:** Provenienz-/Ticket-Kürzel (`CP[0-9]`, `AC[0-9]`, `afix-p[0-9]`, `stab-p[0-9]`, `P3b-R`, „Server-Slim P[0-9]") aus `portal-pool.js`, `llm.js`, `telnyx-llm-shim.js`, `telephony/adapters/telnyx/voice.js`, `routes/api-calls.js`, `app.js`, `ui/registry.js`, `claude.js` entfernt; Substanztext bleibt. **`[F5]`-Runbook-Anker bewusst behalten.**
- **B5 C2 veraltete Kommentare:** `util.js` — zwei falsche Beispiel-Hashes durch node-`crypto`-neu-berechnete korrigiert (`#9f2c1a`→`#b4267a`, `0d6f3a1c`→`363a175f`); veraltete Datei-Referenzen in `billing/webhook.js`/`plans.js`/`worker/provisioning-orchestrator.js` nach dem Server-Slim-Umzug korrigiert (Kommentar-only).
- **B6 Judgment-Items (durchgeführt):** `reqRes`→`numberResult`-Umbenennung (`api-onboard.js`, `provisioning-orchestrator.js`); `nextWeekday`-Zwischenvariablen benannt (`defaults.js`); G31-Kommentar zur Reihenfolge-Invariante an der `rekeyProfilesToTenant`-Call-Site verankert (`migrate.js`).
- **E — 2 neue S3-Abdeckungstests:** `streamDirectives` wss-URL + Provider-Media-Pfad (twilio/telnyx) in `voice-render-action-url.test.js`; `findPlan`-Null-Zweig (unbekannt/leer/undefined) in neuer Datei `plans-find-plan.test.js`.

### C — Bewusst ausgelassen (mit Begründung, aus dem Plan)

1. **`[F5]`-Marker** (`portal-pool.js`) — Runbook-Anker, Operator-Log-Grep-Ziel; Entfernen bräche Doku-Korrelation. Bleibt.
2. **F1 `addCalendarEvent`/`trackUsage`** — Store-Fassaden mit Paritäts-Kontrakt (json.js == pg.js == state-ops.js) und direkten Testaufrufern (6+7 Testdateien) — Signaturänderung hätte Bestandssuite gebrochen. Folgepunkt.
3. **G30-Zerlegungen** (`registerTools`, `handleChatCompletion`, api-onboard-Handler, api-calls-POST-Handler, `wireWebLogin`) — sensible Fläche (MCP-Handshake, Telnyx-Rate-Limit/Budget-Kill, Outbound-Safety-Gate-Kette, Auth-Verdrahtung, Provisioning/Money-Gates); Funktionsextraktion ist die regressionsanfälligste Kategorie, gehört in fokussierte Einzel-Reviews wie die Server-Slim-Phasen, nicht in eine Kosmetik-Phase. Deferred.
4. **`claude.js:agentTurn`-Zerlegung** und **`bridge.js`-Connection-Callback-Zerlegung** — HEIKLE STELLE (End-Call-Suppression-Reihenfolge / Barge-in / Call-Ende laut CLAUDE.md). Nur der Literal-Swap (`END_CALL_TOOL_NAME`) und die tote-ctx-Feld-Löschung wurden angefasst, **keine Struktur/kein Kontrollfluss**.
5. **G11 `provisioningCountry`-Trim** — Angleichen an `forceNumberCountry` wäre Input-**Normalisierung** (`" de "`→`"DE"`), also Verhaltensänderung. Verletzt „verhaltens-erhaltend". Folgepunkt.
6. **N7 `llm.js:isOpen()`** — bewusster, bereits dokumentierter FSM-Nebeneffekt (Circuit-Breaker open→half-open). Bleibt (Clean-Code-Regel 3, dokumentierte Ausnahme).
7. **G26-Fallbacks** (z. B. `img.onerror` in wing-canvas) — Ergänzen wäre neues Verhalten. Ausgelistet.
8. **P2 (mehrere Änderungsgründe)** — nur dokumentiert, keine Entflechtung (Invariante).
9. **Alle ~6 G27-Funde außerhalb P8-Scope**: `telephony/registry.js` (= P5, bereits erledigt), `state-ops:markProvisioningJob` + `billing/webhook` SUSPEND-Default (Kern-Phasen), `api-calls to-vs-ctx.to` (safety-adjacent zur Denylist), `defaults:sanitizeProfile` + `billing/ports` (Grenzfälle) — Diff durfte keine G27-Datei außer reiner Kommentar-/Namenspolitur ändern.
10. **release-reconcile-Reasons** (`state-ops.js` ~1203–1244, statisch+dynamisch gemischte Diagnose-Reasons) und **`60000`/`MS_PER_MINUTE`** in `claude.js` — Judgment-Leaves, als Folgepunkt vermerkt.

## 3. Implementierung

### 3.1 Zusammenfassung

Alle B1–B6-Punkte aus dem Plan umgesetzt. **31 Dateien** insgesamt geändert (27 Quelldateien + Testdateien), 1 neue Testdatei (`test/plans-find-plan.test.js`), 1 Datei-Paar gelöscht (`src/utils/format-duration.js` + `test/format-duration.test.js`).

Neue Konstanten: `IDENTITY_MAX_LEN` (wiederverwendet), `SMS_BODY_MAX_CHARS`, `END_CALL_TOOL_NAME`, `DEFAULT_EVENT_DURATION_MINUTES`, `VOICE_ENGINE`-Enum (+ 4 Konsumenten-Dateien), `REQUEST_NUMBER_REASON`-Enum. Toter Code entfernt: `format-duration.js`+Test, `Timeline.prototype.pause` + `this.target` in beiden Wing-Canvas-Mirror-Kopien, tote Regex-Alternative in `i18n/locales.js`, tote ctx-Felder `log`/`finalize` in `bridge.js`, `_pool` in `portal-pool.js` (**in der Impl-Version entfernt — siehe r1**). F1-Bündelung: `pg.js:deleteMissingByText`, `llm.js:backoffDelay`, `wing-canvas:drawTriangle` (15→3 Argumente). C1-Marker entfernt aus 7 Dateien, `[F5]` bewusst erhalten. C2-Kommentare korrigiert in `util.js` (Hash-Beispiele node-verifiziert), `billing/webhook.js`, `plans.js`. N1-Umbenennung `reqRes`→`numberResult` in 2 Dateien. G19/G31-Lesbarkeitsverbesserungen ohne Logikänderung.

**node --check:** sauber auf allen 27 geänderten `.js`-Dateien.
**Testsuite (Impl-Stand, Baseline 2397/0):** 2362 pass / 0 fail — Mathematik: `2397 − 39 (gelöschte format-duration-Tests) + 4 (E1: 2 neue in voice-render-action-url.test.js, E2: 2 neue in plans-find-plan.test.js) = 2362`. **Abweichung von der Plan-Vorhersage** (Plan sagte `2397−39+2=2360` voraus, da E1 im Plantext nur „2 neue Tests" nannte; tatsächlich fügte E1 selbst bereits 2 neue Tests hinzu und E2 weitere 2, macht netto 4 statt 2 neue Tests) — 0 Fails, 0 Skips, über 4 Läufe stabil reproduziert (ein bekannter, vorbestehender Spawn-Race-Flake in `onboarding-identity.test.js` trat einmal unter Volllast auf, isoliert lief er grün).
**Mirror-Invariante:** `diff src/ui/wing-canvas-engine.js design-system/components/brand/wing-canvas-engine.js` leer.
**Smoke:** `/healthz` → 200 `{ok:true}`; `POST /api/onboard` mit leerem `tenantId` → byte-identischer `IDENTITY_MAX_LEN`-Fehlertext (`<=254 Zeichen`); Boot-Banner zeigt „Voice-Engine: budget" (`VOICE_ENGINE.BUDGET` korrekt verdrahtet).

### 3.2 Deviations

1. **DoD-Grep-Scope** bewusst auf die im Plan-Abschnitt F4 konkret spezifizierte Regel-Menge (`CP[0-9]`/`AC[0-9]`/`afix-p[0-9]`/`stab-p[0-9]`/`P3b-R`/„Server-Slim P[0-9]") begrenzt, **nicht** auf jedes bare `P5`/`P6`/`P2`/`K0`/`K3`/`K8`/`MAJOR-1-Fix`/`MINOR-1-Fix`-Vorkommen in `llm.js`/`telnyx-llm-shim.js`/`telephony/adapters/telnyx/voice.js`/`app.js`/`claude.js`: diese sind tief in substanzielle technische Erklärungen eingewoben, ihre Entfernung hätte Bedeutung/Kohärenz gefährdet, ohne dass die Plan-eigene F4-Prüfformel sie verlangt (Regel 3, Vorrang Lesbarkeit).
2. **`src/ui/registry.js`:** `T-P3-AC5`/`T-P3-AC7` (matcht `\bAC[0-9]\b`) **bewusst nicht entfernt** — Grep bestätigt, das sind exakte, existierende Testnamen in `test/mcp-ui.test.js` (echte Cross-Referenzen), keine Provenienz-/Ticket-Marker.
3. **`json.js:addCalendarEvent`/`trackUsage`** nicht gebündelt (Plan-Ausschluss C.2: Paritäts-Kontrakt + direkte Testaufrufer) — offener Punkt.
4. **G30-Zerlegungen** (5 Kandidaten) gemäß Plan-Abschnitt C.3 deferred — keine Funktionsextraktion vorgenommen.
5. **`claude.js:agentTurn`-Struktur** und **`bridge.js`-Connection-Callback** nicht zerlegt (HEIKLE STELLE, nur die exakt spezifizierten Literal-Swaps/Feld-Löschungen).
6. **G11 `provisioningCountry`-Trim** nicht angeglichen (Verhaltensänderung, Plan-Ausschluss C.5).
7. **N7 `isOpen()`** in `llm.js` nicht angefasst (dokumentierter Nebeneffekt, Plan-Ausschluss C.6).
8. **`store/portal.js`** (G19/G20) geprüft, kein klarer Verstoß gefunden — keine Änderung.
9. **release-reconcile-Reasons** und **`MS_PER_MINUTE`/`60000`** bewusst als Judgment-Leaves belassen (wie im Plan vermerkt).
10. Ein bekannter, vorbestehender Suite-Flake (`test/onboarding-identity.test.js`, Spawn-Race unter Volllast) trat einmal auf, isoliert lief der Test grün — kein durch P8 verursachter Defekt.

### 3.3 Clean-Code-Selbstcheck (Impl)

G25 (Magic Numbers/Strings → Konstanten, Werte grep-verifiziert identisch), G9/G12 (toter Code nur mit Grep-Nachweis entfernt), F1 (>3 Argumente bei isolierten Helfern ohne Test-Caller bzw. mit 1:1-Mapping gebündelt), C1 (Ticket-Marker entfernt, Substanztext + echte Doku-/Test-Referenzen bewusst erhalten und einzeln begründet), C2 (echte veraltete Referenzen per Grep gefunden, nicht geraten), N1 (lokale Umbenennung ohne Strukturänderung), G19/G31 (Lesbarkeit ohne Logikänderung). Keine neuen Magic Numbers außer 0/1/-1, kein toter/auskommentierter Code hinterlassen, kein `eslint-disable`-artiger Marker, keine neue Dependency. HEIKLE STELLEN (`bridge.js`, `claude.js:agentTurn`) nur mit den exakt spezifizierten minimalen Edits angefasst — keine Kontrollfluss-Änderung. G27-Ausschlussliste eingehalten (einzige G27-Datei-Änderung war eine reine Kommentarkorrektur in `billing/webhook.js`).

## 4. Safety-Urteil (final)

**APPROVED**, keine Blocker.

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhängiger Testlauf** (frisches Worktree, `npm test` auf beiden Branches — pg-Backend läuft in-process via pglite, ein `npm test` deckt json+pg ab): `baseline-master` (`027c9b6`) → 2397/2397, 0 fail, 0 skip; `review-p8-r1` (`d022e6c`, entspricht `phase/cc-p8-polish-fix1`) → 2362/2362, 0 fail, 0 skip. Beide Läufe Exit 0. Delta `-35` löst sich exakt auf: `2397 − 39 (format-duration.test.js, kein Prod-Importer verifiziert) + 4 (neue S3-Tests) = 2362`. Keine versteckte Regression, kein maskierter Skip. `node --check` sauber auf jeder geänderten Quelldatei.

**Verifikation im Detail:**
1. Alle extrahierten Konstanten wertidentisch zu den ersetzten Literalen (`VOICE_ENGINE.BUDGET="budget"`/`REALTIME="realtime"`, `TENANT_STATUS.ACTIVE="active"`/`SUSPENDED="suspended"`, `END_CALL_TOOL_NAME="end_call"`, `DEFAULT_EVENT_DURATION_MINUTES=60`, `SMS_BODY_MAX_CHARS=1500`, `IDENTITY_MAX_LEN=254`, `REQUEST_NUMBER_REASON.{TENANT_INACTIVE,TENANT_CAP,GLOBAL_CAP}`); konsumierende Maps (`ONBOARD_REASON_STATUS`) weiterhin über dieselben String-Werte geschlüsselt.
2. `claude.js:agentTurn` End-Call-Suppression byte-identisch in der Reihenfolge — `suppressEndCall` weiterhin einmal vor der Tool-Loop berechnet, nur `"end_call"`→`END_CALL_TOOL_NAME`, kein Kontrollfluss-Reorder.
3. `bridge.js` HEIKLE STELLE: nur tote ctx-Felder `log`/`finalize` entfernt — bestätigt nie von `handleOpenAiEvent` destrukturiert, nie als `ctx.log`/`ctx.finalize` referenziert; auf `master` waren sie ebenso ungenutzt.
4. `i18n/locales.js` Regex `/^i\b|^i'/i` → `/^i\b/i` empirisch äquivalent (16 Fälle inkl. „island"/„ID"/„Interested"/„I'm"/„I'd") — `^i'` ist eine strikte Teilmenge von `^i\b`, da Apostroph nach „i" bereits eine Wortgrenze ist.
5. `nextWeekday`, `backoffDelay`, `deleteMissingByText`, `drawTriangle` (14→3 Argumente) — reine Extraktion/Parameter-Objekt mit 1:1-Argument-Mapping, Call-Sites korrekt aktualisiert.
6. `wing-canvas-engine.js`: beide Mirror-Kopien diff-identisch; `Timeline.prototype.pause` und `this.target` nachweislich tot (Visibility-Pause läuft über die raf-`syncRun`-Schleife, nicht `Timeline.pause`; kein externer Aufrufer ruft `pause`).

**SAFETY:** keine Gate-Logik berührt; Offenlegungszeilen in `claude.js`/`bridge.js` unangetastet (grep-bestätigt); `web-auth.js` fail-closed „suspended"-Default für neue OIDC-Tenants erhalten (via `TENANT_STATUS.SUSPENDED`); `migrate.js`/`web-auth.js` SQL nutzt eingefrorene Konstanten (kein Injection-Risiko). **SCOPE:** kein neuer Endpunkt, kein neues Config-Feld/Env-Var (`VOICE_ENGINE` ist eine Modul-Konstante, kein Config-Key), keine neue Dependency; G27-ausgeschlossene Körper unangetastet; kein `eslint-disable`/Skip-Marker eingeführt.

**Concerns (nicht blockierend):**
1. Rohe Pass-Zahl 2362 niedriger als master 2397, aber zu 100 % auf die task-autorisierte Löschung von `format-duration` (netto `−39+4`) zurückführbar; 0 Skips, 0 Fails, keine maskierte Regression.
2. `provisioning-orchestrator.js` Zeile 1 trägt weiterhin einen „Server-Slim P6"-Provenienz-Marker — Datei war C2/Rename-Ziel (`reqRes`→`numberResult`), nicht Teil der Invariante-3-C1-Entfernungsliste — außerhalb P8-Scope.
3. `[F5]`-Fehlermeldungspräfixe in `portal-pool.js` korrekt **erhalten** — dokumentierter Operator-Grep-Anker (`RUNBOOK-RESTORE.md`, `RUNBOOK-OPERATOR.md`), exakt die „Runbook-Anker → Klartext behalten"-Ausnahme.
4. `_pool: pool` in `portal-pool.js` bleibt tot (kein Leser in `src/`/`test/`), ist aber vorbestehend und von P8 unangetastet — konservativ belassen (siehe Fix-Runde r1, Abschnitt 6).
5. Nicht-blockierende Abweichung vom Invarianten-Text (Ergebnis korrekt/besser): `MAX_IDENTIFIER_LENGTH` wurde als bereits vorhandenes `IDENTITY_MAX_LEN` realisiert statt neu angelegt; `ACCOUNT_STATUS_SUSPENDED` wiederverwendete das vorhandene `TENANT_STATUS.SUSPENDED`-Enum statt einer neuen Konstante; `pg.js:deleteMissingByText` — Invariante behauptete 1 unbenutzten Parameter, tatsächlich sind alle 5 Felder live, korrekt alle 5 gebündelt statt einen zu entfernen.
6. Mehrere optionale G30-Zerlegungen bewusst nicht durchgeführt — explizit optional laut Invariante („nur wo Lesbarkeit klar steigt / im Zweifel auslassen"); `claude.js:agentTurn` und `bridge.js` korrekt NICHT funktions-gesplittet.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** (keine S1/S2-Blocker), geprüft auf vollständigem Diff `master..phase/cc-p8-polish-fix1` (31 Dateien, +212/−347). Kategorie für Kategorie gegen `.claude/refs/clean-code.md` geprüft; alle Refactorings statisch + dynamisch als verhaltenserhaltend verifiziert (Volltest 2361/2362 grün in einem Lauf, die eine rote Zeile ein isoliert reproduzierbar grüner Flake in einer von P8 nicht berührten Datei). Konstanten durchgängig wertgleich.

### S1–S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine (siehe Fix-Runde r1 — der ursprüngliche S1-Fund `_pool` wurde vor diesem finalen Audit bereits behoben) |
| **S2** (Blocker) | keine |
| **S3** | 2 |
| **S4** | 0 |

**S3 — C1-Rest** · `src/telnyx-llm-shim.js:238-239, 288` · Zwei Ticket-/Review-Runden-Marker („MINOR-1-Fix, 2. Review-Runde", „P5 (Scope 4, Carryover aus P4)") bleiben stehen, obwohl P8 im selben File gleichartige Marker (`afix-p3`, `stab-p9`) gezielt entfernt hat. Nicht Teil dieses Diffs (Zeilen unverändert) und kein Verhaltensrisiko, aber inkonsistent mit dem erklärten Politurziel dieser Phase. Fix (optional): in einer Folge-Politur mitziehen.

**S3 — C1-Rest** · `src/web-auth.js:462, 487, 495, 520, 583` · Fünf „Review-Blocker Runde 1/2/3"-Kommentare derselben Kategorie, ebenfalls nicht von diesem Diff berührt, im selben editierten File aber stehengeblieben (`TENANT_STATUS`-Änderungen liegen wenige Zeilen daneben). Fix: gleiche Behandlung wie die in `claude.js`/`telnyx-llm-shim.js` entfernten Marker.

### Top-Todos

- Kein Blocker — Phase kann wie vorgelegt gemergt werden.
- Optional/Folge-Politur: die zwei verbliebenen C1-Reste in `telnyx-llm-shim.js` und `web-auth.js` bei nächster Gelegenheit mitziehen (Dateien ohnehin schon in P8 angefasst).
- Kein Handlungsbedarf bei den G25/G5-Konstantenextraktionen (`VOICE_ENGINE`, `TENANT_STATUS`, `REQUEST_NUMBER_REASON`, `END_CALL_TOOL_NAME`, `DEFAULT_EVENT_DURATION_MINUTES`, `SMS_BODY_MAX_CHARS`, `IDENTITY_MAX_LEN`) — alle wertgleich verifiziert.

### Gezielt verifizierte Punkte (passNotes)

`drawTriangle`-Refactor (beide Kopien byte-identisch): Parameterreihenfolge in beiden `drawMesh`-Aufrufstellen exakt erhalten, `blit={ctx,img,dpr}` deckt sich mit den vorherigen Positionsargumenten. `this.target`/`Timeline.prototype.pause` repo-weit gegengeprüft — kein Aufrufer (die `.pause()`-Aufrufe anderswo laufen auf echten GSAP-Timelines, nicht dieser Custom-Klasse). `bridge.js` `log`/`finalize`: `handleOpenAiEvent()` destrukturiert beide nicht, keine sonstige `ctx.log`/`ctx.finalize`-Nutzung. `i18n/locales.js`-Regex empirisch (14 Testfälle) äquivalent bestätigt. `format-duration.js` + Test komplett gelöscht: repo-weite Grep-Suche zeigt keinen Importer außerhalb der eigenen Testdatei. `util.js`-Hash-Beispiele node-neu-berechnet: neue Werte exakt korrekt, alte erfunden/falsch — legitimer C2-Fix. `TENANT_STATUS`-Werte per String-Interpolation in SQL entsprechen bestehender Modul-Konvention (`pg.js` interpoliert bereits interne, nie nutzergesteuerte Konstanten) — kein neues Injection-Risiko, Werte per `Object.freeze` fixiert und identisch zu den alten Literalen. `backoffDelay`/`deleteMissingByText`: Objekt-Parameter-Refactor korrekt auf benannte Properties umgestellt. `reqRes`→`numberResult`: vollständig durchgezogen, keine Altreferenzen (grep bestätigt). Neue Tests (`plans-find-plan.test.js`, Ergänzungen in `voice-render-action-url.test.js`) sowie die angepasste Assertion in `telnyx-p9-flag-matrix.test.js` laufen grün und decken echte, vorher unbedeckte Zweige ab. C2-Kommentarkorrekturen (`plans.js`→`telephony/outbound-gates.js`, `llm.js`→`degradedSpeechFor`, `migrate.js` Reihenfolge-Hinweis) stichprobenartig gegen den tatsächlichen Code verifiziert — alle akkurat.

## 6. Fix-Runden

**Eine Runde (r1).**

Der einzige gemeldete Blocker aus dem ersten Review war **S1-1: `_pool`-Feld in `src/portal-pool.js` fälschlich als tot entfernt.** Der Impl-Stand (`phase/cc-p8-polish`, Commit `b0cc762`) hatte `_pool: pool` gemäß Plan-Punkt B2.3 gelöscht (Grep-Beleg im Plan: „kein Leser repo-weit"); der Review deckte auf, dass diese Löschung nicht sicher war (siehe die entsprechende Concern-Note im finalen Safety-Urteil: `_pool` bleibt konservativ als vorbestehendes, unangetastetes totes Feld erhalten statt entfernt).

Vorgehen: `node_modules`-Symlink im Review-Worktree auf die echte Ordner-`node_modules` des Haupt-Repos gesetzt (aufgelöst, funktionsfähig), Branch `phase/cc-p8-polish-fix1` aus `phase/cc-p8-polish` erstellt, `_pool: pool` in `portal-pool.js` wiederhergestellt (Rest der B2.3/B4-Änderungen an derselben Datei — C1-Marker-Entfernung, `[F5]`-Erhalt — blieb unverändert).

Ergebnis nach r1: Branch `phase/cc-p8-polish-fix1` (Commit `d022e6c`), Volltestsuite 2362/2362 grün (0 fail, 0 skip) auf beiden Backends unabhängig reproduziert, Mirror-Invariante weiterhin leer, Safety-Review APPROVED (keine Blocker) und Clean-Code-Audit PASS (S1/S2 leer, nur noch 2× S3 informativ). Keine weitere Fix-Runde nötig.

## 7. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED, keine Blocker, 6 nicht-blockierende Concerns (alle prozedural/dokumentierte Abweichungen mit besserem Ergebnis) |
| Clean-Code-Audit | PASS, S1/S2 leer, 2× S3 (verbliebene C1-Ticket-Marker in `telnyx-llm-shim.js`/`web-auth.js`, außerhalb Diff-Scope), S4 leer |
| Tests | 2362/2362 grün (unabhängiger Lauf auf `phase/cc-p8-polish-fix1`, beide Backends); Baseline `master` 2397/2397; Delta exakt `−39` (format-duration-Löschung) `+4` (neue S3-Tests) |
| Byte-Identität | Alle B1-Konstantenextraktionen wertidentisch verifiziert (grep/node); B2-Löschungen mit Grep-Totheitsnachweis; B3-Bündelungen mit 1:1-Argument-Mapping |
| Mirror-Invariante (Wing-Canvas) | `diff` leer, in beiden Kopien synchron geändert |
| Neue Dateien | `test/plans-find-plan.test.js` |
| Gelöschte Dateien | `src/utils/format-duration.js`, `test/format-duration.test.js` (39 Tests, kein Prod-Importer) |
| Neue npm-Dependency | keine |
| Neues Env-Var | keine |
| Neuer Endpunkt | keiner |
| Bewusst ausgelassene Funde | `[F5]`-Runbook-Anker (behalten), F1 `addCalendarEvent`/`trackUsage` (Paritäts-Kontrakt), 5 G30-Zerlegungen (sensible Fläche), `claude.js:agentTurn` + `bridge.js`-Connection-Callback-Struktur (HEIKLE STELLE), G11 `provisioningCountry`-Trim (Verhaltensänderung), N7 `isOpen()` (dokumentierter Nebeneffekt), G26-Fallbacks, alle ~6 G27-Funde, release-reconcile-Reasons + `MS_PER_MINUTE` (Judgment-Leaves) |
| „Bereits erledigt"-Funde (Invarianten-Drift) | `IDENTITY_MAX_LEN` (statt neuem `MAX_IDENTIFIER_LENGTH`), `TENANT_STATUS`-Enum (statt neuem `ACCOUNT_STATUS_SUSPENDED`), `deleteMissingByText`-5-Parameter alle live (kein „unused" zu entfernen), `GLOBAL_CAP_REASON` bereits Konstante — alle in Plan-Abschnitt A dokumentiert, keine Doppel-Definitionen eingeführt |
| Fix-Runden | 1 (r1: S1-1-Blocker `_pool` fälschlich entfernt → in `portal-pool.js` wiederhergestellt, `phase/cc-p8-polish-fix1` aus `phase/cc-p8-polish`) |
| Merge auf `master` | liegt beim Lead/Orchestrator gemäß Lean-Phasen-Workflow |
