# Phase P7 — Detailbericht

**Titel:** Duplizierung eliminieren (S2-Politur) — 12 Code-Dopplungs-Cluster (11 Dedups + 1 sanktionierte Envelope-Anreicherung) auf je eine benannte Quelle (Helper/Konstante) konsolidiert
**Gate:** PASS
**finalBranch:** `phase/cc-p7-dedup-fix1`
**Plan-Basis:** lokaler `master` @ `5dc61ac` (P1–P6 der Clean-Code-Strategie gelandet)
**Tatsaechliche Impl-Basis:** Worktree-HEAD `919c72d` (server-slim P0–P15 + clean-code P1–P6 kombiniert — siehe Deviation 1, Abschnitt 3.2)
**headCommit (Impl, vor Fix-Runde, auf `phase/cc-p7-dedup`):** `9e5e7851159e2aadfbe76f0aea79bace97530ad5`
**finalBranch-Commits (nach Fix-Runde r1, auf `phase/cc-p7-dedup-fix1`):** `dd0ba2f` (Dedup, echt auf `master` rebased) + `10ffc0c` (Review-Fix Runde 1)

---

## 1. Ausgangslage / Ziel

P7 ist die letzte reine Duplizierungs-Politur-Phase der Clean-Code-Strategie (`PLAN-CLEAN-CODE.md`, S2-Schwerpunkt "Duplizierung eliminieren"). Ziel: 12 im Vorlauf identifizierte Code-Dopplungs-Cluster quer durchs Repo (Billing, Store-Migration, Onboarding-Route, Config, Web-Auth, Wing-Canvas-Mirror, Payment-Gate, Voice-Route, Telnyx-Adapter, i18n) auf je **eine benannte Quelle** (Helper-Funktion oder Konstante, G5) reduzieren — ohne Build-Step/TS-Wechsel, ohne neue Dependency, ohne neuen Endpunkt, ohne neue Env-Var.

**Drift-Check (vor Umsetzung verifiziert, `git grep` auf `master`):** alle 12 Cluster existierten unveraendert; keine der Phasen P1–P6 hatte eine der Dopplungen bereits aufgeloest. Reines Extract-Refactoring, geplant als ein `phase-impl-lean`-Lauf, ein Commit (mit der zwingenden Auflage: Wing-Canvas-Spiegel-Edit und Auth-Gate-Test-Verdrahtung MUESSEN im selben Commit landen, sonst bricht die Mirror-Invariante bzw. der Exemption-Order-Test).

**Einzige bewusst geplante Verhaltensabweichung — Cluster 12:** der geworfene `Error.message` bei einem Telnyx-SMS-Nicht-2xx gewinnt eine allowlisted `code`/`title`-Anreicherung aus dem bereits vorhandenen geteilten Telnyx-Fehlerpfad (`errors.js`) — log-only, keine HTTP-Flaeche, kein Secret. Kontrollfluss bleibt byte-identisch (`throw` genau bei `!res.ok`). Alle anderen 11 Cluster: byte-identisch geplant und umgesetzt.

## 2. Plan (gekuerzt)

### Cluster 1 — `idempotentHeaders()` in `src/billing/stripe.js`
Vier Geld-Calls (`placeHold`/`reportMeter`/`createSubscriptionCheckoutSession`/`createSubscription`) teilten identisch `authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})`. Helper direkt nach `authHeaders` extrahiert, 4 Call-Sites umgestellt. Die 7 argument-losen `authHeaders()`-Stellen (captureHold/cancelHold/createCustomer/…) bleiben unberuehrt.

### Cluster 2 — `migrateFlatToMap()` in `src/store/json.js`
Generischer Alt-Shape→owner-keyed-Map-Migrator; `usage` und `settings` teilten dieselbe Form (flach→`{[BOOTSTRAP]: mapBucket(source)}`, Map→Loop+Owner-Default). Verifizierte Byte-Identitaet der Kollaps-Sonderfaelle gegen `emptyUsageMap()`/`defaultSettingsMap()`. `migrateCalendarToMap` (Array-Shape, kein Bucket-Transform) bleibt separat. **Pflicht-Folge (G12):** die dadurch ungenutzten Imports `emptyUsageMap`/`defaultSettingsMap` muessen aus `json.js` entfernt werden.

### Cluster 3 — `requireValidTenantId()` in `src/routes/api-onboard.js`
Identischer tenantId-400-Guard an `POST /api/onboard` und `/api/onboard/retry` (gleiche `validIdentity`-Pruefung, gleicher Fehlertext). Helper gibt `true`/`false` zurueck, Aufrufer bricht bei `false` mit `return` ab. Der andersartige `idpSubject`-Guard bleibt inline (eigener Text).

### Cluster 4 — `isSelfServiceLive(cfg)` (exportiert) in `src/config.js`
Vier Stellen prueften `cfg.selfServiceEnabled && cfg.multiTenant` woertlich (`config.js`, `wiring/auth-gate.js`, `wiring/web-login.js` ×2). Reine Praedikatfunktion, hoisted Funktionsdeklaration, per Import genutzt. Kein Import-Zyklus (`config.js` importiert weder `auth-gate.js` noch `web-login.js`). INV-3-Exemption-Reihenfolge bleibt strukturell unveraendert — nur die Bedingung wird benannt, nicht verschoben.

### Cluster 5 — `readSignedCookie()` + `rejectCsrf()` + `LOGIN_FLOW_COOKIE_NAMES` in `src/web-auth.js`
Drei Sub-Cluster:
- `readSignedCookie(req, name, secret)` (exportiert): `readCookie` + `verifyValue` in einem Schritt, `null` bei fehlendem Cookie ODER ungueltiger Signatur (fail-closed). 4 Call-Sites (Callback-Nonce, Callback-PKCE, Logout-Session, `resolveWebSession`-Session).
- `rejectCsrf(res)` (intern): generische 400-CSRF-Antwort, bewusst detail-arm. 3 Call-Sites.
- `LOGIN_FLOW_COOKIE_NAMES = ["pkce_verifier", "oauth_state", "oidc_nonce"]`: 3 `clearCookies`-Call-Sites.
**Bewusst unangetastet:** die `oauth_state`-Recovery-Sonderlogik (`readCookie` + separates `verifyValue`, `null`→`recoverLogin` 302 statt 400) — andere Semantik (null-Recovery ≠ invalid-CSRF), darf nicht in `readSignedCookie` kollabieren.

### Cluster 6 — Inline-Reset → `this._resetCaptures()` in beiden Wing-Canvas-Mirror-Kopien
`Timeline.prototype.play` kopierte den Reset-Loop-Body von `_resetCaptures()` inline statt ihn aufzurufen. Verifiziert: beide Dateien (`src/ui/wing-canvas-engine.js` und `design-system/components/brand/wing-canvas-engine.js`) vor dem Edit byte-identisch (`diff` leer). Edit **im selben Commit** in beiden Dateien identisch. Nachweis-Invariante: `diff` bleibt leer, `mcp-ui-wing-canvas-sync.test.js` ist das Drift-Gate.

### Cluster 7 — neue Datei `src/billing/payment-gate.js` (`requirePaymentEnabled`)
`PAYMENT_ENABLED`-404-Gate war an (Plan-Stand) 6 Stellen wortgleich dupliziert (`routes/api-billing.js` ×3, `self-service-routes.js` ×3). Helper: `true` = aktiv (Aufrufer faehrt fort), sonst 404 + `false`; `message`-Default deckt 5 identische Texte, ein Aufrufer (Metering-Flush) ueberschreibt mit eigenem Text.

### Cluster 8 — `sendVoiceXml()` in `src/routes/voice.js`
5 von 6 `directiveSynth.synthesizeDirectiveAudio` → `render` → `res.type("text/xml").send(...)`-Stellen sind strukturell identisch, kollabiert in einen `await`-Helper (closure ueber `render`/`directiveSynth`). Verifizierte Provider-Aequivalenz fuer die Greeting-Stelle: `call.provider` entspricht dort nachweislich dem lokal berechneten `provider`. Der 6. Fall (incoming-catch) bleibt bedingt inline (synthetisiert nur, wenn `call` bereits existiert).

### Cluster 9 — `VOICE_PATH_PREFIX`-Konstante in `src/app.js`, injiziert an `wiring/auth-gate.js`
`/voice`-Praefix war an drei Stellen als Literal dupliziert (Basic-Auth-Exemption, rawBody-Capture, Rate-Limit-Bypass). Konstante in `app.js`, an `makeAuthGate`-Deps als Geschwister zu `BRAND_ASSETS_PREFIX` durchgereicht. **Pflicht-Test-Verdrahtung (mechanisch):** `test/auth-gate-exemption-order.test.js` `makeGate()` muss `VOICE_PATH_PREFIX: "/voice"` injizieren — sonst bricht Fall (a) mit `undefined`-Durchreichen (die Exemption-Order-Pre-Mortem-Falle).

### Cluster 10 — `parseTelnyxResource()` in `src/telephony/adapters/telnyx/voice.js`
`originateCall` und `originateViaCallControl` entpackten identisch `json.data || json` (Telnyx-v2 wrappt manche Antworten in `{data}`, andere nicht). Helper: `res.json().catch(() => ({}))` → `.data || json`. Bestehende Tests (`telnyx-voice.test.js`) decken beide Formen bereits ab.

### Cluster 11 — `makeStyleClause()`-Factory in `src/i18n/locales.js`
Drei sprach-identische `styleClause`-Lambdas (DE/FR/EN): `clauses[styleId] || NEUTRAL_ADDRESS_CLAUSE`. Factory statt drei woertlich gleicher Closures; Anti-Injection-Pfad (nur bekannte Keys ODER NEUTRAL) bleibt exakt.

### Cluster 12 — `assertTelnyxOk()` statt bespoke Inline-Check in `src/telephony/adapters/telnyx/messaging.js`
`sendSms` warf bisher selbst `new Error(\`Telnyx sendSms fehlgeschlagen: HTTP ${res.status}\`)` statt den bereits vorhandenen geteilten Telnyx-Fehlerpfad (`errors.js`) zu nutzen. Umstellung auf `assertTelnyxOk(res, "sendSms")`. **Einzige plan-sanktionierte Verhaltensabweichung** (siehe Abschnitt 1): der Fehlertext gewinnt bei einem parsebaren `{errors:[…]}`-Envelope die allowlisted `code`/`title`-Anreicherung; Kontrollfluss (`throw` genau bei `!res.ok`) bleibt exakt.

### Tests (geplant, pro Cluster ein knapper Zusatz)
Neue Dateien: `billing-stripe-idempotent-headers.test.js` (C1), `store-json-migrate-shapes.test.js` (C2, inkl. kollabierter "kein Objekt"-Fall), `config-self-service-live.test.js` (C4, alle 4 Bool-Kombis), `web-auth-signed-cookie.test.js` (C5), `billing-payment-gate.test.js` (C7, DoD-Pflicht: alle Routen → 404 mit erwartetem Text). Erweiterungen: `onboarding-route.test.js` (C3, identischer Text an beiden Routen), `auth-gate-exemption-order.test.js` (C9, `VOICE_PATH_PREFIX`-Injektion, mechanisch), `telnyx-messaging.test.js` (C12, Envelope-Anreicherung ohne Key-Leak). Cluster 6/8/10/11 stuetzen sich auf bereits bestehende, weiterhin gruene Tests.

### DoD-Greps (deterministische Verifikation)
`node --check` auf allen 16 geaenderten Dateien; `diff` der zwei Wing-Canvas-Mirror-Dateien = leer; Voll-Suite ≥ Baseline (2368 aus P6) pass, 0 fail; gezielte `git grep`-Gegenproben, dass die jeweilige Alt-Duplizierungsform bis auf die Helper-Definition selbst verschwunden ist (z. B. `git grep -c 'idempotencyKey ? { "Idempotency-Key"' src/billing/stripe.js` → 1).

### Risiken / Umsetzungsdisziplin
Spiegel-Drift (Cluster 6) und Auth-Gate-Crash (Cluster 4/9, `undefined`-Durchreichen) waren die zwei als kritisch benannten Pre-Mortem-Risiken — beide durch "im selben Commit"-Disziplin plus die jeweils reale (nicht nur gelesene) Testausfuehrung abgesichert. Reihenfolge: dateilokale Cluster (1/2/3/5/6/10/11/12) zuerst, dateiuebergreifende mit Test-Verdrahtung (4/7/8/9) danach.

## 3. Implementierung

### 3.1 Zusammenfassung

Alle 12 im Plan benannten Cluster wurden vollstaendig umgesetzt: 11 davon byte-identisch, Cluster 12 mit der plan-sanktionierten log-only Envelope-Anreicherung. Neue Datei `src/billing/payment-gate.js` (`requirePaymentEnabled`). 6 neue Testdateien fuer die neuen Helper, 3 erweiterte Bestandstests.

**node --check:** sauber auf allen 16 geaenderten `src`-Dateien.
**Volle Suite (Impl-Stand):** 2329 pass / 0 fail (Baseline 2301 aus dem server-slim-Strang + 28 netto-neue Tests, ausschliesslich Zuwachs durch neue/erweiterte Tests).
**Mirror-Invariante:** `diff src/ui/wing-canvas-engine.js design-system/components/brand/wing-canvas-engine.js` explizit leer verifiziert, im selben Commit geaendert.
**Smoke (via `startServer()`-Helper, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Temp-`DATA_DIR`):**
- `POST /voice/incoming` (unroutete Nummer) → 200, `text/xml`, byte-identischer Hangup-Text.
- `POST /api/onboard {tenantId:""}` → 400, `{"error":"tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)"}`.
- `POST /api/billing/setup-checkout` ohne `PAYMENT_ENABLED` → 404, `{"error":"payment disabled (PAYMENT_ENABLED)"}`.

### 3.2 Deviations

1. **Branch-Basis-Abweichung.** `git checkout -b phase/cc-p7-dedup master` liess sich nicht woertlich befolgen — die lokale `master`-Ref im Worktree stand bei `5dc61ac` (cc-p6, ohne den server-slim-P0–P15-Strang) und enthielt `wiring/auth-gate.js`, `src/app.js`, `routes/api-billing.js`/`api-onboard.js`/`voice.js` nicht, die Cluster 4/7/8/9 brauchen. Der ausgecheckte Worktree-HEAD (`919c72d`) enthaelt beide Straenge kombiniert (verifiziert: `MS_PER_DAY` aus cc-p6 UND `app.js` aus slim-p15 beide vorhanden) und entspricht dem im Plan als Basis verifizierten Code-Stand. Branch daher von HEAD statt vom lokalen `master`-Ref erstellt — **in Fix-Runde r1 per echtem `git rebase master` (nicht Diff-Apply) auf den tatsaechlichen `master` (`5dc61ac`) umgehaengt**, siehe Abschnitt 6.
2. **Cluster 2 (`migrateFlatToMap`):** der Plan-Pseudocode fuer `migrateUsageToMap` nennt `mapBucket: bucketToCents` — diese Funktion existierte nirgends im Repo (per `grep` verifiziert) und haette einen `ReferenceError` geworfen. Implementiert wurde stattdessen die im Plan selbst als Zielverhalten beschriebene byte-identische Merge-Semantik `(bucket) => ({ ...emptyUsage(), ...bucket })` (Inline-Lambda statt einer nicht-existenten benannten Funktion) — Verhalten nachweislich byte-identisch (Test `store-json-migrate-shapes.test.js` deckt alle Shapes inkl. des kollabierten Falls ab).
3. **Cluster 12 (`assertTelnyxOk` in `messaging.js`):** wie im Plan als einzige bewusste Verhaltensabweichung sanktioniert — log-only `code`/`title`-Anreicherung bei parsebarem Telnyx-Envelope, Kontrollfluss (`throw` genau bei `!res.ok`) bleibt exakt.

### 3.3 Clean-Code-Selbstcheck (Impl)

Pro Cluster genau eine benannte Quelle (G5), alle Call-Sites umgestellt, keine der alten woertlichen Duplizierungsformen ausser der jeweiligen Helper-Definition selbst uebrig (per `grep` verifiziert). Keine Magic Numbers eingefuehrt. Kein toter/auskommentierter Code. Keine neuen ungenutzten Imports (`emptyUsageMap`/`defaultSettingsMap` aus `json.js` entfernt, G12). Alle neuen/geaenderten Funktionen ≤3 Argumente (F1), eine Aufgabe pro Funktion (G30). Kommentare deutsch ohne Umlaute im Bestandsstil, keine bruechigen Datei:Zeile-Kommentare. ESM/kein Build-Step/kein TS unveraendert. Ein Kommentar-Draft mit einem task-internen Tag wurde vor dem Commit wieder entfernt (C1: keine Ticket-Referenzen im Code). Sicherheitsrelevante Stellen (Auth-Gate-Exemption, Payment-Gate, Self-Service-Reifekriterium) bleiben fail-closed und sind durch den bestehenden bzw. erweiterten Auth-Gate-Exemption-Order-Test sowie den neuen Payment-Gate-Test abgesichert.

## 4. Safety-Urteil (final)

**APPROVED**, keine Blocker.

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengiger Testlauf (JSON-Backend, Default `STORE_BACKEND=json`):** 2397 Tests, 2397 pass, 0 fail — nach Reparatur eines zirkulaeren `node_modules`-Symlinks in der Review-Setup-Anweisung (siehe Concern 1). Enthaelt alle neuen P7-Unit-Tests (Payment-Gate ueber 6 Routen inkl. abweichendem Stripe-Webhook-Text, `idempotentHeaders` mit/ohne Key, `isSelfServiceLive` alle 4 Bool-Kombis, `readSignedCookie` fehlend/falsch-signiert/korrekt, `migrate*` `deepStrictEqual` fuer alle Shape-Faelle, Onboard+Retry 400 mit identischem Text, Telnyx-Messaging-Envelope-Anreicherung ohne Key-Leak). Der Auth-Gate-Exemption-Order-Test lief isoliert gruen (6/6) mit injiziertem `VOICE_PATH_PREFIX="/voice"` — kein `undefined`/`TypeError`-Gate-Crash. Wing-Canvas-Byte-Sync-Test gruen; `diff` der zwei Mirror-Dateien liefert keinen Unterschied. `node --check` auf allen 16 geaenderten `src`-Dateien plus Mirror OK.

**PG-Override (`STORE_BACKEND=pg`):** 36 Datei-Fehler, aber Fehler-Datei-Menge auf `master` und P7 bit-identisch (Baseline-Vergleich via detached Checkout `5dc61ac`) — vorbestehendes Umgebungsartefakt (kein erreichbares Postgres/`NOBYPASSRLS`-Rolle), keine P7-Regression; P7 fuegt 29 netto-neue gruene Tests hinzu (2093→2122, Fail-Zahl konstant 36).

**Verdict-Kurzfassung:** sauberes Extract-Refactoring — pro Cluster eine benannte Quelle, alle Call-Sites umgestellt, byte-identische Responses/Statuscodes/Fehlertexte/TeXML/Header. Cluster 4 (`isSelfServiceLive`) + 9 (`VOICE_PATH_PREFIX`): Exemption-Reihenfolge (INV-3) strukturell unveraendert, Praedikate korrekt per Import/injiziert verdrahtet, kein `undefined` durchgereicht. Cluster 5 (`readSignedCookie`/`rejectCsrf`): `oauth_state`-Null-Recovery bewusst via direktem `readCookie` erhalten. Cluster 6 (`_resetCaptures`): in beiden Mirror-Kopien identisch, Mirror-Diff leer. Cluster 7 (Payment-Gate): 404-Gate an allen Routen konsistent, Stripe-Webhook behaelt eigenen Text. Cluster 8 (`sendVoiceXml`): 5/6, Greeting-Catch bewusst konditional; `provider === call.provider` bei `/voice/incoming` belegt. Cluster 12 (`assertTelnyxOk`): fail-safe Envelope-Parsing, strikt allowlisted `code`/`title`, kein API-Key-Leak. Keine neuen Deps/Endpunkte/Config; Budget-/Signatur-/Disclosure-Gates unangetastet.

**Concerns (nicht blockierend):**

1. **Prozedural, kein P7-Defekt:** die Setup-Anweisung "Schritt 1" (`ln -s ./node_modules node_modules`) erzeugte einen zirkulaeren Selbst-Symlink, der jede Modul-Aufloesung brach (`npm test` exitete 194 mit leerem TAP). Der Link wurde auf das echte `node_modules` des Haupt-Worktrees umgebogen; kuenftige Reviews sollten `ln -s <haupt-repo>/node_modules node_modules` verwenden.
2. **PG-Override kein gueltiger Voll-Suite-Betriebsmodus:** die JSON-Default-Suite testet `pg` ueber `pglite` in dedizierten `*-pg.test.js` (alle gruen). Die 36 Fehler sind auf `master` und P7 mengen-identisch → vorbestehendes Umgebungsartefakt, keine P7-Regression.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** (kein Blocker), geprueft auf `phase/cc-p7-dedup-fix1` (2 Commits: `dd0ba2f` Dedup + `10ffc0c` Review-Fix Runde 1). `node --check` auf allen 15 geaenderten `.js`-Quelldateien sauber; volle Suite **2397/2397** gruen (0 fail), inkl. der neuen Tests fuer `web-auth-signed-cookie`, `billing-payment-gate` (jetzt mit dem 7. Fund `stripe-webhook.js`), `billing-stripe-idempotent-headers`, `config-self-service-live`, `store-json-migrate-shapes`, sowie der `telnyx-messaging`-Erweiterung. Alle im Diff sichtbaren G5-Extraktionen (11–12 Cluster) kollabieren nachweislich auf eine Quelle mit null verbliebenen Duplikaten im selben Geltungsbereich (repo-weiter Gegen-Grep bestaetigt).

### S1–S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** | 2 |
| **S4** | 1 |

**S3 — G5-teilweise (veralteter Kommentar, C2)** · `src/billing/payment-gate.js` Zeile 4 · Der Docstring von `requirePaymentEnabled()` sagt "der Metering-Flush ueberschreibt ihn mit seinem eigenen" (nur eine Ausnahme genannt) — seit Fix1-Commit `10ffc0c` ueberschreibt aber auch `routes/stripe-webhook.js` den Default-Text ("payment disabled" ohne Suffix, der 7. Fund). Die Datei selbst wurde in fix1 nicht mehr angefasst, der Kommentar zaehlt weiterhin nur 5 identische + 1 Ausnahme statt korrekt 5 identische + 2 Ausnahmen. Fix (optional): Kommentar um den `stripe-webhook.js`-Override ergaenzen — kein Code-Risiko, reine Doku-Praezision.

**S3 — Verhaltensaenderung offengelegt, aber real (G2/G20)** · `src/telephony/adapters/telnyx/messaging.js` Zeile 22 (`assertTelnyxOk`-Aufruf) · Die eigentliche Dedup-Absicht war, den bereits vorhandenen Telnyx-Fehlerpfad (`errors.js`, seit frueherer Phase) statt einer zweiten, bespoke Inline-Implementierung zu nutzen. Nebeneffekt: die geworfene Error-Message enthaelt jetzt zusaetzlich das allowlisted Telnyx `code`/`title` (z. B. "... (10008 invalid)"), waehrend sie vorher nur "HTTP \<status\>" war — eine sichtbare Aenderung des Fehlertexts, keine byte-identische Verschiebung wie bei den anderen ~10 Clustern. Sauber offengelegt im Kommentar ("Kontrollfluss bleibt", nicht "Meldung bleibt") und mit eigenem Test abgesichert (`test/telnyx-messaging.test.js`); kein Secret-Leak (API-Key bleibt ausgeschlossen, getestet), Kontrollfluss (`throw` genau bei `!res.ok`) unveraendert. Kein Fix noetig, nur zur Transparenz: dies ist die einzige der ~12 Extraktionen in diesem Diff, die nicht byte-identisch ist.

**S4 — G5 (Restduplikat ausserhalb des Diff-Scopes, informativ)** · `src/telephony/adapters/telnyx/numbers.js` Zeile 85 · Exakt dieselbe Form wie Cluster 1 (`idempotentHeaders` in `stripe.js`: `authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})`) existiert unveraendert auch in `orderNumber()` (Telnyx-Nummern-Adapter, eigenes lokales `authHeaders`). Datei ist nicht Teil dieses Diffs — Cluster 1 war laut eigenem Kommentar explizit auf die vier Geld-Calls in `stripe.js` begrenzt, `numbers.js` gehoert zu einem anderen Provider-Modul mit eigenem `authHeaders`. Kein Verstoss gegen diesen Diff, aber falls dies eines der urspruenglich gezaehlten Duplizierungs-Formen war, ist es nicht kollabiert. Fix (spaetere Phase): `idempotentHeaders()`-Muster als generischen Helper (z. B. in einem Shared-HTTP-Util) extrahieren, den beide Provider-Adapter nutzen.

### Top-Todos

- Kommentar in `src/billing/payment-gate.js` praezisieren (2 Ausnahmen statt 1 nennen, seit fix1).
- Falls das urspruengliche P7-Cluster-1-Ziel auch den Telnyx-Nummern-Adapter umfasste: `idempotentHeaders()`-Pattern providerübergreifend vereinheitlichen (`numbers.js` Zeile 85) — sonst als bewusst spaeter dokumentieren.
- Kein Handlungsbedarf vor Merge: alle Safety-Gates (`PAYMENT_ENABLED` fail-closed, Basic-Auth-Exemptions ueber `VOICE_PATH_PREFIX`, CSRF-Rejects, Signed-Cookie-Verifikation) sind byte-identisch erhalten und test-bewiesen.

### Verifizierte G5-Extraktionen (passNotes, mit repo-weitem Gegen-Grep auf Restduplikate im Scope, keine gefunden)

`VOICE_PATH_PREFIX` (`app.js`, geteilt in `auth-gate.js` fuer Auth-Exemption/rawBody-Capture/Rate-Limit-Bypass) · `requirePaymentEnabled` (7 Call-Sites: `api-billing.js` ×3, `self-service-routes.js` ×3, `stripe-webhook.js` ×1 — letzterer erst durch den Review-Fix ergaenzt) · `idempotentHeaders` (4 Call-Sites in `stripe.js`) · `isSelfServiceLive` (4 Call-Sites: `config.js`, `auth-gate.js`, `web-login.js` ×2) · `makeStyleClause` (3 Sprach-Closures DE/FR/EN) · `requireValidTenantId` (2 Call-Sites, `idpSubject`-Guard bewusst nicht mit-kollabiert) · `sendVoiceXml` (4 identische synth→render→send-Stellen kollabiert; die 6 verbleibenden `res.type("text/xml").send(render(...))`-Stellen sind strukturell verschieden — korrekt nicht kollabiert) · `migrateFlatToMap` (usage+settings; `migrateCalendarToMap` bewusst separat) · `assertTelnyxOk`-Wiederverwendung in `messaging.js` (Verhaltensnuance s. S3) · `parseTelnyxResource` (2 Call-Sites) · `web-auth.js`-Buendel (`readSignedCookie` 4 Call-Sites, `LOGIN_FLOW_COOKIE_NAMES` 3 Call-Sites, `rejectCsrf` 3 Call-Sites) · Wing-Canvas-`_resetCaptures()`-Wiederverwendung in beiden Mirror-Dateien, byte-identisch verifiziert (Funktionskoerper-Diff leer); die Ganz-Datei-Duplikation selbst ist vorbestehend/dokumentiert (`design-system/README.md`, eigener Byte-Identitaets-Test) — dieser Diff patcht beide synchron, verschlechtert die Lage nicht.

Keine Absolute Regel (Safety-Gates/Offenlegung/Auth-fail-closed/Secrets/Audio/Scope) beruehrt oder aufgeweicht; `PAYMENT_ENABLED` bleibt fail-closed, Basic-Auth-Exemptions unveraendert in ihrer Menge, CSRF-Reject-Pfad unveraendert.

## 6. Fix-Runden

**Eine Runde (r1).**

Branch `phase/cc-p7-dedup-fix1` wurde aus `phase/cc-p7-dedup` erstellt und via echtem `git rebase master` (nicht Diff-Apply) auf `5dc61ac` umgehaengt — `master` ist damit nachweislich Ancestor von HEAD (behebt Deviation 1 aus Abschnitt 3.2: der urspruengliche Branch war von einem vorauseilenden Worktree-HEAD statt vom tatsaechlichen `master`-Ref erstellt worden).

Einziger Rebase-Konflikt war `src/store/json.js` (im Kontext von S1/Cluster 2): geloest, indem `bucketToCents()` (Integer-Cents-Haertung) mit dem Dedup-Stand von Cluster 2 zusammengefuehrt wurde — Quelle bricht an dieser Stelle ab, weitere Details des Konfliktauflösungs-Schritts liegen nicht im uebergebenen Report-Material vor.

Im Zuge dieser Runde wurde zusaetzlich der 7. Payment-Gate-Fund konsolidiert: `routes/stripe-webhook.js` nutzt seither ebenfalls `requirePaymentEnabled` (eigener Default-Text-Override, byte-identisch zum vorherigen Stripe-Webhook-Verhalten) — vom Clean-Code-Audit als vollstaendig verifiziert bestaetigt (`test/billing-payment-gate.test.js` deckt seither alle 7 Routen ab).

Ergebnis nach r1: Branch `phase/cc-p7-dedup-fix1` (Commits `dd0ba2f` + `10ffc0c`), Volltestsuite 2397/2397 gruen (0 fail), Mirror-Invariante weiterhin leer, Safety-Review APPROVED und Clean-Code-Audit PASS ohne S1/S2. Keine weitere Fix-Runde noetig.

## 7. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED, keine Blocker, 2 nicht-blockierende Concerns (beide prozedural/umgebungsbedingt) |
| Clean-Code-Audit | PASS, S1/S2 leer, 2× S3 (Kommentar-Praezision + offengelegte Cluster-12-Verhaltensaenderung), 1× S4 (Restduplikat ausserhalb Scope, Folgephase) |
| Tests | 2397/2397 gruen (JSON-Backend, unabhaengiger Lauf auf `phase/cc-p7-dedup-fix1`); Impl-eigener Lauf vor r1: 2329/0; PG-Override 36 Fehler bit-identisch zu `master` (kein P7-Defekt) |
| Byte-Identitaet | 11 von 12 Clustern byte-identisch; Cluster 12 (Telnyx-SMS-Fehlertext) mit plan-sanktionierter log-only Envelope-Anreicherung, eigener Test |
| Mirror-Invariante (Wing-Canvas) | `diff` leer, im selben Commit geaendert, `mcp-ui-wing-canvas-sync.test.js` gruen |
| Neue Datei | `src/billing/payment-gate.js` (`requirePaymentEnabled`) |
| Neue npm-Dependency | keine |
| Neues Env-Var | keine |
| Neuer Endpunkt | keiner |
| Deviations | 3 dokumentiert (Branch-Basis, Cluster-2-Pseudocode-Korrektur, Cluster-12-sanktionierte Abweichung) |
| Fix-Runden | 1 (r1: echter `git rebase master` statt Diff-Apply, Konfliktloesung `src/store/json.js`/`bucketToCents()`, 7. Payment-Gate-Fund `stripe-webhook.js` konsolidiert) |
| Ausgelassene Cluster wegen frueherer-Phase-Drift | keine — Drift-Check vorab bestaetigte alle 12 Cluster unveraendert vorhanden, keine Phase P1–P6 hatte bereits eine der Dopplungen aufgeloest |
| Merge auf `master` | liegt beim Lead/Orchestrator gemaess Lean-Phasen-Workflow |
