# TODO — Fragilitaets-Remediation

Strategie: `PLAN-FRAGILITY-REMEDIATION.md`. Roh-Designs: `tasks/fragility-cluster-designs.json`.
Ausfuehrung: eine `phase-impl-lean`-Session pro Phase, in FRISCHEM Kontext (siehe PLAN Abschnitt 6).
Jede Phase ist "done" erst, wenn ihre Verifikation IN DIESER Session lief und das beobachtete
Ergebnis unten protokolliert ist.

Legende: [ ] offen · [~] in Arbeit · [x] fertig+verifiziert

---

## P1 — C1 Stripe-Webhook-Race (S1-1, preserves, M)
- [ ] `makeKeyedChainMutex()` in `src/chain-mutex.js` (additiv, self-cleaning Map)
- [ ] `applyStripeWebhookSerialized()` in `src/billing/webhook.js` (Keyed-Mutex + Event-ID-Dedup + `created`-Monotonie)
- [ ] `src/server.js` Stripe-Route ruft die serialisierte Variante
- **Erwartetes Ergebnis:** zwei konkurrierende Events (`payment_failed` vs. `active`) enden IMMER im nach `event.created` korrekten Zustand; nie `active`+`kycLevel=CARD` nach Zahlungsfehler; identisches Event zweimal = No-op; verschiedene Tenants serialisieren nicht gegeneinander.
- **Verifikation:** `npm test` (neu `test/stripe-webhook-race.test.js` + bestehend `test/p3-payment-webhook.test.js` gruen) · `node --check` auf beruehrte Dateien.
- **Ergebnis:** _(hier Kommando + Output nach Abschluss)_

## P2 — C2 Geld/Typ + pg/json-Paritaet (S1-2/3, preserves, L)
- [ ] `maxBudgetEur` -> `maxBudgetCents` (Cents-Integer); Env `MAX_BUDGET_EUR` bleibt; ~4 Caller in `state-ops.js` + Display-Sites + ~10 Test-Dateien (grep-gefuehrt)
- [ ] `deserializeObjective()` in `pg.js` `rowToCall` (Symmetrie zu `serializeObjective`)
- [ ] neuer `test/store-pg-json-parity.test.js` (pglite Re-Open + json Temp-DATA_DIR, `deepStrictEqual`)
- **Erwartetes Ergebnis:** Budget-Gate rechnet in Cents (`maxBudgetCents:800` vs `costEur=8.00` -> exceeded true, 7.99 -> false); `objectiveAchieved` bleibt ueber pg-Rundlauf Boolean; pg- und json-Rundlauf `deepStrictEqual`; externer API/MCP-Kontrakt bleibt EUR.
- **Verifikation:** `npm test` gruen inkl. neuem Paritaets-Test + `test/config-money-manifest.test.js` (Manifest fuehrt jetzt `maxBudgetCents`).
- **Ergebnis:** _()_
- **Zurueckgestellt:** `usage.costEur` -> Cents (S1-4) = eigener spaeterer Cluster.

## P3 — C5 finishCall-Settlement erzwingen (Struct-4, preserves, M)
- [ ] Fail-Fast-Guard in `terminateAndBillCall` (`throw` wenn `bill` kein Function)
- [ ] `/voice/status` (~1510) + Telnyx `onHangup` ueber `terminateAndBillCall({...,hangUp:null,bill:()=>finishCall(...)})`
- [ ] **Echter Bug:** `server.js:1827` place_call-catch ueber den Gateway; manuelles `releaseReserve` entfernen
- **Erwartetes Ergebnis:** `terminateAndBillCall` wirft ohne `bill`; doppelte Terminierung idempotent (Billing genau 1x, Reserve genau 1x frei); Dial-Fehlschlag laeuft erstmals durch die volle Settlement-Kette.
- **Verifikation:** `npm test` gruen (erweitert `test/call-termination-order.test.js` + Source-Regex-Checks; bestehende `/voice/status`- und `telnyx-event-ingest`-Tests gruen).
- **Ergebnis:** _()_
- **Restrisiko notieren:** `bridge.js` = 6. Pfad, bewusst nicht hier.

## P4 — C4 Webhook-Parsing-Port (Struct-2, none, S) — Warm-up
- [ ] Port `WebhookEvents` in `ports.js`; Adapter `twilio/webhook-events.js` + `telnyx/webhook-events.js` (Code 1:1)
- [ ] Registry-Zeile `webhookEvents(provider)`; 3 Call-Sites in `server.js` umgestellt
- **Erwartetes Ergebnis:** identisches Parse-Verhalten je Provider (Telnyx-Sonderfelder + `SAFE_CAUSE_TOKEN`-Regex + Transcript-Vorrang gepinnt); dritter Provider braucht nur Adapter + Registry-Zeile; `server.js` hat keinen `if(provider===)`-Parse-Zweig mehr.
- **Verifikation:** `npm test` gruen (neu `test/webhook-events.test.js`; bestehende `voice-status-lifecycle`/`voice-speak-status`/`telnyx-speak-events` unveraendert gruen).
- **Ergebnis:** _()_

## P5 — C6a Config-Proxy-Guard + Grouping (Struct-3, preserves, M)
- [ ] Proxy-Guard `guardedConfig()` (wirft bei unbekanntem Key) — ZUERST, mit eigenem Test
- [ ] Grouping feature-fuer-feature, je 1 Commit: `telnyxAssistant` -> `billing` -> `webLogin` -> `mcp` (grep VORHER/NACHHER)
- [ ] Safety-Gate-Keys bleiben flach (nicht in dieser Phase)
- **Erwartetes Ergebnis:** Zugriff auf nicht-existenten Config-Key wirft TypeError (nicht `undefined`); alter flacher Pfad nach Migration nachweislich weg; legitimer Zugriff liefert Default.
- **Verifikation:** `npm test` gruen (neu `test/config-shape.test.js`; Proxy faengt jeden uebersehenen Caller als Crash).
- **Ergebnis:** _()_
- **Skizze (nicht jetzt):** C6b state-ops-Split (Barrel-Reexport, S4, getriggert).

## P6 — C3 Outbound-Gate-Kette extrahieren (Struct-1, RISKY, L)
- [ ] `src/telephony/outbound-gates.js` `makeOutboundGates({...})` -> geordnetes `{name,run(ctx)}`-Array (16 Gates, EXAKTE Reihenfolge)
- [ ] private Helfer wandern MIT; `tariffCentsPerMin`/`E164_FORMAT_ERROR`/`isTrunkZeroFormatError` exportiert + zurueckimportiert; Magic 180/300 -> Konstanten
- [ ] `POST /api/calls` schrumpft auf 2 Pre-Gate-Checks + EINE `for`-Schleife + createCall/Originate aus `ctx`
- **Erwartetes Ergebnis:** Gate-Reihenfolge byte-identisch zum Bestand; Gate hinzufuegen/umsortieren = Ein-Zeilen-Array-Diff; `reserve_budget` bleibt letztes Gate.
- **Verifikation:** `npm test` gruen (neu `test/outbound-gates-order.test.js` Order-Snapshot + per-Gate-Ablehnung; ALLE bestehenden Outbound-Integrationstests gruen) · **Opus-Safety-Review** (risky).
- **Ergebnis:** _()_

## P7 — C7 bridge.js-Guard-Paritaet + Dedup + tote Seeds (S2, RISKY, M)
- [ ] P1: `shouldSuppressEndCall()` + `END_CALL_WAIT_INSTRUCTION` aus `claude.js` exportieren; `bridge.js` gatet `end_call` + `shapeForSpeech` aufs Transkript (HEIKLE STELLE, additiv)
- [ ] P2: `tenantOwnsCall`-Kopie (`server.js:987`) loeschen+importieren; `safeEqual` in `web-auth.js` aus `util.js`
- [ ] P3: tote Seeds `seedBootstrapPrivateNumber`/`seedBootstrapIdentity` + 2 Testdateien loeschen — **VORHER offene Branches pruefen**
- [ ] NICHT anfassen: `requireTenant`-Fusion (Audit-Vertrag), dead-air-Log/voiceAttrs/fmtDate (False Positive / bewusst)
- **Erwartetes Ergebnis:** Realtime beendet Outbound-Call NICHT mehr vor der ersten Antwort des Angerufenen (Paritaet zur Budget-Engine); Realtime-Transkript ohne Markdown-Reste; keine tenantOwnsCall/safeEqual-Duplikate; `npm test` ohne Referenzfehler nach Seed-Loeschung.
- **Verifikation:** `npm test` gruen (unit `shouldSuppressEndCall` + `bridge-event-unit`) · **Opus-Safety-Review** · **echter Realtime-Probe-Anruf VOR Merge** (Fake-ctx-Unit reicht nicht).
- **Ergebnis:** _()_

---

## Zurueckgestellt (bewusst, spaeter)
- [ ] S1-4 `usage.costEur` -> Cents (eigener Cluster)
- [ ] C6b `state-ops.js`-Split (S4, getriggert)
- [ ] `bridge.js` als vollwertiger 6. Terminierungspfad (aus C5-Pre-Mortem)

## Review-Sektion (nach Abschluss aller Phasen fuellen)
_(High-level-Zusammenfassung der Aenderungen, offene Punkte, Lehren -> `tasks/lessons.md`)_
