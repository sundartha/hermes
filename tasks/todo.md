# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Abo-ohne-Nummer Wurzelfix (Webhook-Race) — 2026-07-06

## Befund (Live-Logs 2026-07-06 07:05-07:06 UTC, verifiziert)

Tenant `t_user_01KWSDW4JZ12WF02NGPYW0BA4V`, Plan business:

1. 07:05:51 `self_service_subscribe_rejected reason=no_card` -> `setup_checkout mode=subscription` (korrekt)
2. 07:06:23 `stripe_webhook_activate profile=ok:6` — der Webhook GEWINNT das Rennen
   gegen den Browser-Return, speichert Abo, stoesst Provisioning an
3. 07:06:23 `[provision-worker] ... hat kein hinterlegtes Zahlungsmittel` — Nummer
   -> failed. Der Webhook-Pfad speichert NIE customerId/paymentMethodId
4. 07:06:25 `self_service_subscribe outcome=already_subscribed profile=none` — der
   Return-Pfad bricht in `activateSubscriptionFromCheckoutSession` (subscribe.js:145-148)
   VOR `setTenantStripe` (Z.154) ab -> Karte wird NIE gebunden -> Provisioning dauerhaft tot

Warum "hat schon mal funktioniert": vor dem Stripe-Live-Cutover war der Webhook-Secret
tot (alle Webhooks signature-rejected) -> der Return gewann immer und band die Karte.
MAX_NUMBERS war ein Fehlschluss der letzten Session (failed-Nummern zaehlen NICHT gegen
die Caps, state-ops.js liveNumbers schliesst FAILED aus; Worker-Log nennt die Wurzel klar).

## Fix (2 Schichten, beide fail-closed)

- [x] 1. `src/billing/webhook.js`: ACTIVATE-Event traegt `customer` + `default_payment_method`
      (signatur-verifiziert). Fehlt die Karte am Tenant UND matcht der Customer
      (customerMatches, R4), Karte VOR activatePaidTenant binden -> Webhook-Pfad
      provisioniert selbststaendig (Browser-Return wird optional, wie es sein muss).
      NIE eine vorhandene Karte ueberschreiben (nur Luecke fuellen).
  - Erwartet: neuer Test p3-payment-webhook: Event mit customer+default_payment_method
    + Tenant ohne Karte -> setTenantStripe({paymentMethodId}) genau 1x vor provision;
    mit Karte -> kein Bind; Customer-Mismatch -> kein Bind
  - Verifikation: `node --test test/p3-payment-webhook.test.js` gruen
- [x] 2. `src/billing/subscribe.js` (`activateSubscriptionFromCheckoutSession`):
      already_subscribed mit IDENTISCHER subscriptionId + Tenant OHNE Karte =
      Webhook-gewonnenes Rennen -> heilen (setTenantStripe + activatePaidTenant,
      beides idempotent). MIT Karte = echter Doppel-Redirect -> No-op wie bisher.
  - Erwartet: bk2-Test (7) mit Karte-Seed unveraendert gruen; neuer Test (16):
    subscribed ohne Karte -> 302 sub=ok, pm gebunden, provision genau 1x
  - Verifikation: `node --test test/bk2-checkout-return-plan.test.js` gruen
- [x] 3. `paymentMethodIdOf` von stripe.js nach webhook.js verschoben (G5)
  - Ergebnis: node --check ok, Stripe-Tests gruen
- [x] 4. Volle Suite + Syntax
  - Ergebnis: `npm test` 1752/1752 gruen (2026-07-06)
- [x] 5. Commit 0d3d110 gepusht (origin + upstream, Owner-Freigabe); Render-Deploy
      dep-d95msqs2m8qs73c5puo0 live 09:00:46 UTC
  - Ergebnis: `[boot] deployed commit=0d3d110...` im Log, /healthz 200
- [x] 6. Live-Reparatur Tenant `t_user_01KWSDW4JZ12WF02NGPYW0BA4V`: Event
      `evt_1Tq6bi3d0y9L6EpqDuxTbvab` per Stripe-Workbench-Resend erneut zugestellt
      (09:08:39 UTC)
  - Ergebnis: `stripe_webhook_activate profile=ok:6` OHNE Zahlungsmittel-Fehler,
    KEINE [provision-worker]-Fehlerzeile; Nummer +15597576128 ACTIVE, end-to-end
    per MCP get_my_number/get_agent_status bestaetigt

## Offene Nebenbefunde (nicht Teil dieses Fixes)

- `stripe_webhook_rejected signature` weiterhin sporadisch (04:58, 07:06:22, 07:06:39)
  NEBEN erfolgreichen Zustellungen -> vermutlich zweiter/alter Webhook-Endpoint im
  Stripe-Dashboard mit totem Secret. Ops: alten Endpoint loeschen.
- MAX_NUMBERS-Erhoehung der letzten Session war wirkungslos (kein Schaden, kann bleiben).

---

## Fix: place_call HTTP 422 (10015) — Call-Control-App-ID entkoppeln (2026-07-10)

Wurzel (RCA: `tasks/rca-place-call-422.md`): `TELNYX_AI_ASSISTANT_ENABLED=true` ist live
gesetzt, daher laeuft Outbound ueber `originateViaCallControl` (POST /v2/calls). Der Adapter
sendete dort `config.telnyxConnectionId` — das ist aber eine **TeXML**-Application-ID.
Telnyx verlangt an dieser Stelle eine **Call-Control**-Application-ID und lehnt deterministisch
ab: `HTTP 422 (10015 Invalid value for connection_id (Call Control App ID))`.
Auf dem Account existierte GAR KEINE Call-Control-App (`GET /v2/call_control_applications` leer).

- [x] 1. Neue Env-Var `TELNYX_CALL_CONTROL_APP_ID` in `src/config.js` (+ Boot-Pflicht bei aktivem Flag)
  - Erwartet: `assertConfig()===false`, wenn Flag an und Var leer; Boot-Refusal nennt die Var
  - Verifikation: `node --test test/telnyx-p10-config.test.js` -> gruen (30/30)
- [x] 2. `originateViaCallControl` nutzt `telnyxCallControlAppId` statt `telnyxConnectionId`
      (`src/telephony/adapters/telnyx/voice.js`); TeXML-Pfad + Nummern-Routing unveraendert
  - Erwartet: `body.connection_id === CALL_CONTROL_APP_ID` und `!== CONNECTION_ID`
  - Verifikation: `node --test test/telnyx-call-control.test.js` -> gruen (17/17)
- [x] 3. Regressionstest, der den Live-Bug faengt (beide IDs bewusst verschieden)
  - Erwartet: Test ist ROT gegen den alten Code
  - Verifikation: Zeile temporaer zurueckgerollt -> 2 Tests rot (inkl. Regression),
    TeXML-Gegentest blieb gruen; Fix zurueckgespielt
- [x] 4. 4-Orte-Doku: `.env.example`, `render.yaml`, `test/helpers.js` (BASE_ENV +
      TELNYX_ASSISTANT_BOOT_ENV) nachgezogen
  - Verifikation: `npm test` -> 1949/1949 gruen
- [ ] 5. Telnyx: Call-Control-Application anlegen, Outbound-Voice-Profil **"MCP"**
      (`2982782444253480209`, whitelisted US/CA/**DE**) zuweisen — NICHT "Default" (nur US/CA)
  - Verifikation: `GET /v2/call_control_applications` liefert die App mit korrektem Profil
- [ ] 6. Render-Env `TELNYX_CALL_CONTROL_APP_ID` setzen — **VOR** dem Deploy
  - KRITISCH: `server.js:2470` macht `process.exit(1)`, wenn die Var bei aktivem Flag fehlt.
    Deploy ohne gesetzte Var = Live-Dienst startet nicht (Inbound/Dashboard/MCP tot).
- [ ] 7. Deploy + Live-Testanruf (Owner). Nicht blind vertrauen.
  - Verifikation: `[boot] deployed commit=...` im Log, dann `place_call` -> `status=completed`

## Offene Nebenbefunde aus dieser Session

- `+49173XXXXXXX` in nationaler Schreibweise (`0173...`) wird korrekt fail-closed abgelehnt:
  Tenant hat keine `privateNumber`, einzige DID ist US -> `homeCountryCode()` = null.
  `src/mcp-tools.js:355` verspricht die Aufloesung aber bedingungslos -> Doku-Bug.
  NIEMALS `homeCountry` auf `+49` defaulten (Falschanruf-Risiko fuer Nicht-DE-Tenants).
- Tenant-/Nummern-Vermehrung: 4 aktive Telnyx-DIDs, mehrere Tenants desselben Menschen
  (`t_user_01KWKXZ3...`, `t_user_01KX5TCC...`, `t_user_01KX600834...`, `user_01KWSDW4...`).
  Eigener RCA-Durchgang laeuft.
- `src/ui/widgets/call.html`: 8s-Poll ohne Terminal-Guard beim Re-Mount (Client-Hygiene,
  kein Serverload — kein `get_call_status` in den Logs).
