# PA-15 — Migration Cluster B (Signatur/Gates)

**Gate:** PASS
**finalBranch:** `phase/polish-a-p15`
**headCommit:** `2fdac45a8ec34bccd7c4f0d08cbf65f68e610b0f`
**Basis:** master `5cc3317` (PA-12/13/14 bereits gemergt — `CONFIG_NAMESPACES`-Karte + `guardedConfig`-Proxy live)

## 1. Scope

Migration der Config-Zugriffspfade in 5 Dateien von flachen Keys (`config.<key>`) auf Namespace-Blaetter (`config.<namespace>.<key>`) — Cluster B (Signatur/Gates):

- `src/telephony/adapters/twilio/signature.js`
- `src/telephony/adapters/telnyx/signature.js`
- `src/telephony/outbound-gates.js`
- `src/routes/voice.js`
- `src/routes/stripe-webhook.js`

Reiner Zugriffspfad-Refactor, verhaltens-erhaltend. Keine Env-Var-Umbenennung, `test/helpers.js` `BASE_ENV` unangetastet.

## 2. Plan (gekuerzt)

### Ausgangslage
`CONFIG_NAMESPACES` (src/config.js Z785–799) ist autoritativ; Namespaces sind als nicht-enumerable Getter-Blaetter an `rawConfig` gehaengt, jedes Blatt delegiert auf denselben flachen Slot. Der `guardedConfig`-Proxy wirft TypeError bei unbekanntem Schluessel — faengt falsche Blattpfade sofort. Verbleibende Gefahr (PM-10): ein **existierender, aber falscher** Blattname (z.B. `maxCallDurationS` statt `maxCallsPerHour`) — dagegen wurden gezielt Wert-Tests ergaenzt.

### Migrations-Karte (19 Blattpfade)

| # | Datei | Vorher | Nachher | Namespace |
|---|---|---|---|---|
| 1 | twilio/signature.js | `config.publicUrl` | `config.server.publicUrl` | server |
| 2 | twilio/signature.js | `config.twilioToken` | `config.telephony.twilioToken` | telephony |
| 3 | telnyx/signature.js | `config.telnyxPublicKey` | `config.telephony.telnyxPublicKey` | telephony |
| 4 | outbound-gates.js | `defaultConfig.voiceTariffDomesticPrefixes` | `defaultConfig.billing.voiceTariffDomesticPrefixes` | billing |
| 5 | outbound-gates.js | `defaultConfig.voiceTariffDomesticCents` | `defaultConfig.billing.voiceTariffDomesticCents` | billing |
| 6 | outbound-gates.js | `defaultConfig.voiceTariffDefaultCents` | `defaultConfig.billing.voiceTariffDefaultCents` | billing |
| 7 | outbound-gates.js | `cfg.maxCallDurationS` | `cfg.safety.maxCallDurationS` | safety |
| 8 | outbound-gates.js | `config.allowedCountryCodes` | `config.safety.allowedCountryCodes` | safety |
| 9 | outbound-gates.js | `config.perTargetWindowMs` | `config.safety.perTargetWindowMs` | safety |
| 10 | outbound-gates.js | `config.maxCallsPerHour` (4x) | `config.safety.maxCallsPerHour` | safety |
| 11 | outbound-gates.js | `config.perTargetCallCap` | `config.safety.perTargetCallCap` | safety |
| 12 | outbound-gates.js | `config.outboundFrozen` | `config.safety.outboundFrozen` | safety |
| 13 | outbound-gates.js | `config.assistantContextEnabled` | `config.tenancy.assistantContextEnabled` | tenancy |
| 14 | outbound-gates.js | `config.paymentEnabled` | `config.billing.paymentEnabled` | billing |
| 15 | voice.js | `config.telnyxAssistant.enabled` | `config.telnyx.telnyxAssistant.enabled` | telnyx |
| 16 | voice.js | `config.skipTwilioSignatureCheck` | `config.safety.skipTwilioSignatureCheck` | safety |
| 17 | voice.js | `config.publicUrl` | `config.server.publicUrl` | server |
| 18 | voice.js | `config.voiceEngine` (2x) | `config.voice.voiceEngine` | voice |
| 19 | stripe-webhook.js | `config.stripeWebhookSecret` | `config.billing.stripeWebhookSecret` | billing |

Asymmetrie in outbound-gates.js beachtet: `voiceTariff*`/`paymentEnabled` -> billing, `assistantContextEnabled` -> tenancy, Gate-Zahlen/-Flags -> safety.

### DO-NOT-TOUCH (Ganz-config-Uebergaben, bleiben unangetastet)
- outbound-gates.js: `store.budgetExceeded(...)`, `store.globalBudgetExceeded(config)`, `globalCapEur(config)`, `store.tryReserveOutboundBudget(..., config)`, `resolveMaxDurationS(..., config)`-Aufruf.
- voice.js: `store.budgetExceeded(...)`, `startInboundAiAssistant({ ..., config, ... })`, `makeCallControlIngest({ ..., config })`.
- stripe-webhook.js: `requirePaymentEnabled(res, config, ...)`.

### Test-Strategie
- **Unveraendert bleibend** (schreiben Flach-Keys auf echten Proxy, kein `set`-Trap -> landet im rawConfig-Slot, Getter sehen denselben Wert): `telnyx-signature.test.js`, `voice-signature.test.js`, weitere Spawn-/Struktur-Tests.
- **Pflicht-Reshape** (injizieren flache Fake-config-Objekte -> muessen `withConfigNamespaces()` nutzen): `outbound-gates.test.js`, `outbound-gates-order.test.js`.
- **Neu — PM-10-Guard-Wert-Tests**: LAND-Gate, STUNDENLIMIT (Blattwert im Fehlertext), PER-ZIEL-CAP — fangen den "falscher-aber-existierender-Blattname"-Fall, den grep+Proxy nicht fangen.
- **Neu — `stripe-webhook-route-secret.test.js`**: beweist per echter HMAC-Signatur, dass die Route `config.billing.stripeWebhookSecret` liest (positiv: korrektes Secret -> Signatur besteht; negativ: falsches Secret -> 400 + Audit-Reject).

### Feedback-Loop
1. `node --check` aller 5 Dateien
2. Struktur-Gate: grep auf 0 Flach-Zugriff (`config|defaultConfig|cfg`.`<nicht-namespace>`) in den 5 Dateien
3. Ziel-/Wiring-/Wert-Tests gruen
4. Volle Suite gruen
5. Optionaler "Zaehne-Beweis": ein Blattpfad testweise vertauschen -> zugehoeriger Wert-Test muss rot werden, danach zuruecksetzen

## 3. Implementierung — Zusammenfassung

Alle 19 Blattpfade exakt gemaess Migrations-Karte umgesetzt. Alle DO-NOT-TOUCH-Ganz-config-Uebergaben explizit gegengeprueft und unberuehrt gelassen.

Zeile-fuer-Zeile-Diff-Review aller 5 Dateien durchgefuehrt: nur Zugriffspfad geaendert, keine Logik-/Struktur-Aenderung. Struktur-Grep-Gate (0 Flach-Zugriff inkl. Bracket-Notation) auf allen 5 Dateien bestaetigt gruen (gegen master lieferte derselbe Grep vorher 25 Treffer — der Gate hat nachweislich Zaehne).

**Tests:**
- `outbound-gates.test.js` + `outbound-gates-order.test.js` auf `withConfigNamespaces`-Fixtures umgestellt.
- Neue Wert-Tests (PM-10-Guard) in `outbound-gates-order.test.js`: LAND-Gate, STUNDENLIMIT (mit Blattwert im Fehlertext), PER-ZIEL-CAP.
- Neue Datei `test/stripe-webhook-route-secret.test.js` (2 Tests: korrektes Secret -> Signatur besteht + faellt am JSON.parse; falsches Secret -> Signaturpruefung schlaegt fehl + Audit-Reject).

**Zaehne-Beweis** durchgefuehrt: `config.safety.maxCallsPerHour` testweise durch `config.safety.perTargetCallCap` ersetzt (beide Blaetter existieren, Proxy wirft nicht, Grep-Gate bleibt 0) -> STUNDENLIMIT-Wert-Test schlug wie erwartet fehl (Regex `/MAX_CALLS_PER_HOUR=5/` matched nicht mehr). Danach zurueckgesetzt, `node --check` + Test erneut gruen bestaetigt.

**Volle Suite:** 2414/0 gruen (STORE_BACKEND=json-Default; pglite-Tests laufen in-process innerhalb derselben Suite).

**Smoke-Test:** Server lokal gestartet (PORT=3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, bootstrap-tenant fuer aktive Nummer). `/healthz`=200. `POST /voice/incoming` lieferte korrektes TeXML (Signatur-Skip-Gate + Voice-Engine-Pfad ueber neue Namespaces gelesen, keine Regression). `POST /api/calls` durchlief die Gate-Kette bis owner_name-Gate ohne Crash, Audit-Log korrekt (`place_call_denied`). Kein TypeError, kein Server-Fehler. Server sauber gestoppt.

**Commit:** `2fdac45` auf Branch `phase/polish-a-p15` (von master `5cc3317` abgezweigt), nur die 8 betroffenen src/test-Dateien gestaged. Kein Deploy, kein Push.

### Geaenderte Dateien
- `src/telephony/adapters/twilio/signature.js`
- `src/telephony/adapters/telnyx/signature.js`
- `src/telephony/outbound-gates.js`
- `src/routes/voice.js`
- `src/routes/stripe-webhook.js`
- `test/outbound-gates.test.js`
- `test/outbound-gates-order.test.js`

### Neue Dateien
- `test/stripe-webhook-route-secret.test.js`

### Deviations vom Plan
Keine.

## 4. Safety-Urteil (final)

**approved: true**

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**Concern (kein Blocker):** Kein "run everything under STORE_BACKEND=pg"-Modus existiert (Spawn-Tests brauchen echte `DATABASE_URL`); pg-Abdeckung erfolgt via pglite-Tests in der Suite + explizitem pg-Subset. Fuer eine reine config-Zugriffspfad-Migration (null Store-Code beruehrt) ausreichend, aber kein voller Second-Backend-Durchlauf des kompletten Spawn-Integrationssets.

**Unabhaengige Test-Zusammenfassung:**
- JSON-Backend Voll-Suite: 2414 pass / 0 fail.
- pg/pglite-Subset (rls-with-check, web-auth-pg, store-pg-rls): 39 pass / 0 fail.
- Benannte Wiring/Signatur-Tests (outbound-gates, outbound-gates-order, telnyx-signature, voice-signature, stripe-webhook-route-secret, stripe-webhook-signature): 48 pass / 0 fail.
- `node --check` aller 5 migrierten Dateien + config.js OK.

**Verdict:** APPROVED. Saubere, rein zugriffspfad-basierte Namespace-Migration (Cluster B: Signatur/Gates/Stripe), exakt auf die 5 in der Spec genannten Dateien beschraenkt. Alle 18 migrierten Blattpfade gegen `CONFIG_NAMESPACES` verifiziert — jeder Namespace-Getter liest denselben rawConfig-Slot, kein `undefined`, kein fail-open. TODESGEFAHR-Kandidaten (`skipTwilioSignatureCheck`, `stripeWebhookSecret`, `allowedCountryCodes`, `maxCallsPerHour`, `outboundFrozen`, `perTargetCallCap`, `telnyxPublicKey`, `twilioToken`, `publicUrl`) liefern nachweislich identische Werte. Deep-Nesting `config.telnyx.telnyxAssistant.enabled` loest korrekt durch den rekursiven `guardedConfig`-Proxy auf. Grep-Gate: 0 Flach-/Bracket-Zugriff auf migrierte Keys in den 5 Dateien. Twilio-HMAC / Telnyx-Ed25519 / Stripe-HMAC fail-closed unveraendert; Land-Gate/Stundenlimit/Kill-Switch/per-Target-Cap/Budget/Max-Dauer byte-identisch. `claude.js` + `bridge.js` unberuehrt, `disclosureSentence` intakt. Keine neue Dependency, kein neues Logging, keine Secret-Leaks. Scope exakt eingehalten. Alle Tests gruen. Kein Deploy/Push durchgefuehrt.

## 5. Clean-Code-Audit (final)

**verdict: PASS** (blocker: false)

- **s1 (Blocker):** keine
- **s2:** keine
- **s3 (nicht-blockierend):**
  1. `G24 · test/outbound-gates.test.js:35` — `const result = resolveMaxDurationS(undefined, withConfigNamespaces({ maxCallDurationS: undefined }));` ist 103 Zeichen, ueberschreitet printWidth=100 (`.prettierrc.json`); durch dieses Diff selbst verlaengert. Fix: `npx prettier --write test/outbound-gates.test.js`.
  2. `G24 · src/routes/voice.js:101` — bereits auf master 110 Zeichen (Pre-existing-Verstoss), das Diff verlaengert auf 117 durch zusaetzliche `.telnyx.`-Verschachtelung. Kein neuer Verstoss, aber Gelegenheit zum Mit-Beheben.
- **s4:** keine

**Begruendung:** Sauberer, rein mechanischer Migrationsschritt im Rahmen der laufenden Config-Namespace-Migration (PA-12..PA-15). Alle 15 migrierten Zugriffspfade korrekt gegen `CONFIG_NAMESPACES` verifiziert. Volle Testsuite lief gruen (2413/2414; der 1 Fail in `test/telnyx-event-ingest-route.test.js` reproduzierte isoliert NICHT und ist der dokumentierte vorbestehende Suite-Flake — kein Verstoss dieses Diffs). Kommentare konsistent mit Code aktualisiert (kein C2). Keine Duplizierung, keine Sicherheitsluecke, keine abgeschalteten Gates. Bemerkenswert positiv: die 3 neuen PM-10-Guard-Tests und die neue `stripe-webhook-route-secret.test.js` pruefen gezielt den Risikofall dieser Art Refactor (falscher-aber-existierender-Blattname) mit echten Werttests statt nur Struktur-Checks.

**Pass-Notes:**
- Alle 5 migrierten Produktionsdateien syntaktisch geprueft und vollstaendig im Scope migriert — kein flacher Config-Zugriff mehr uebrig (grep-verifiziert).
- Namespace-Mapping stimmt 1:1 mit `CONFIG_NAMESPACES` ueberein (keine Tippfehler/Vertauschungen).
- Risikoreichste Pfade (Twilio-HMAC, Telnyx-Ed25519, Stripe-Webhook-Secret) werden End-zu-Ende mit echter Kryptografie gegen den echten config-Singleton bewiesen.
- Kommentare an allen migrierten Stellen inhaltlich mitgezogen.
- Keine Magic Numbers, kein toter/auskommentierter Code, keine console.log/TODO/FIXME im Diff.

**Top-TODOs (nicht dringend):**
1. Optional: `npx prettier --write test/outbound-gates.test.js src/routes/voice.js` fuer die 2 (mit-)verlaengerten Zeilen ueber printWidth=100 (S3, kein Blocker).
2. Fortsetzung wie geplant: naechste Cluster der Config-Namespace-Migration (weitere Flach-Zugriffe ausserhalb dieses Scopes, z.B. `boot.js`, `claude.js`, `api-calls.js`, `self-service-routes.js`, `telnyx-*.js`) bleiben fuer Folge-Phasen offen.

## 6. Fix-Runden

Keine — Gate wurde im ersten Review-Durchlauf mit PASS erreicht, es gab keine S1/S2-Blocker und damit keine Fix-Runde.
