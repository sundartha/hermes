# HANDOVER — Go-live: deine manuellen Aufgaben (Jonas)

**Stand:** 2026-06-26 · Code P0+P1+P3 ist auf `origin/master` (`0efb9d2`), Render deployt automatisch. **P0 aktiv** (Tenant-Identitaet, "Kein Tenant"-Fix), **P3 dormant** hinter `PAYMENT_ENABLED`/`PROVISIONING_ENABLED` (Default off). Quelle: `PLAN-ONBOARDING.md §9`.

Claude kann **kein** DNS/OAuth/Dashboard/Secrets. Die folgenden Schritte muss ein Mensch im Browser/Render machen. Reihenfolge ist bindend (jeder Schritt setzt den vorigen voraus).

---

## A. Browser-/Konsolen-Aktionen

| # | Aktion | Detail | Wann |
|---|---|---|---|
| 1 | **DNS CNAME** | `app.sundartha.com` -> Gateway-Service `vodafone-agent` (Render Frankfurt) | jetzt |
| 2 | **Render Custom-Domain** | `app.sundartha.com` an Service `vodafone-agent` (`srv-d8m0fhflk1mc73bno570`) haengen | jetzt (nach 1) |
| 3 | **WorkOS redirect_uri** | `https://app.sundartha.com/auth/callback` registrieren (zusaetzlich zur onrender-URL — sonst Login-Bruch beim Cutover) | jetzt |
| 4 | **Stripe Webhook** | Endpoint `https://app.sundartha.com/webhooks/stripe`, Events `customer.subscription.*` | erst wenn 1+2 live (Domain muss erreichbar sein; gibt 404 solange `PAYMENT_ENABLED=false`) |

`app.sundartha.com` braucht **kein** WorkOS-Plan-Upgrade. WorkOS Custom-Domain `auth.sundartha.com` ist deferred (Upgrade noetig), nicht jetzt.

## B. Secrets in Render eintragen (`sync:false`, NIE in den Chat — Sicherheitsregel #4)

Direkt im Render-Dashboard am Service `vodafone-agent`:

| Env | Zweck | Format |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API | `sk_…` |
| `STRIPE_WEBHOOK_SECRET` | Webhook-Signaturpruefung | `whsec_…` |
| `STRIPE_STARTER_PRICE_ID` | Plan Starter 4,99 € | `price_…` |
| `STRIPE_BUSINESS_PRICE_ID` | Plan Business 9,99 € | `price_…` |
| `TELNYX_API_KEY` | Telnyx API (Nummernkauf) | — |
| `TELNYX_PUBLIC_KEY` | Ed25519 Webhook-Verify | — |
| `TELNYX_CONNECTION_ID` | TeXML Connection (Outbound) | — |
| `TELNYX_ACCOUNT_SID` | Telnyx Account (Hangup) | — |

`STRIPE_PUBLISHABLE_KEY` wird im Code nicht genutzt -> weglassen. `STRIPE_API_BASE`/`TELNYX_API_BASE` haben Defaults. (Mehrere TELNYX-Werte liegen evtl. schon in Render — nur fehlende ergaenzen.)

## C. Hermes-Web (sundartha.com Landing/Login-Funnel)

- Env `PUBLIC_GATEWAY_URL=https://app.sundartha.com` setzen.
- **Rebuild manuell ausloesen** — `autoDeploy:false` auf der Static-Site, Push allein deployt sie NICHT (Memory `hermes-web-deploy-gotchas`).

---

## D. Env-Flags (Stand 2026-06-26)

| Env | Wert | Stand |
|---|---|---|
| `PUBLIC_GATEWAY_URL` | `https://app.sundartha.com` | ✅ live (Custom-Domain) |
| `PAYMENT_ENABLED` | `true` | ✅ gesetzt + deployed (Testmodus), Webhook-Endpoint aktiv (400 statt 404) |
| `PROVISIONING_ENABLED` | `false` | ✅ bewusst false = Dry-Run, KEIN echter Telnyx-Kauf beim Testen |
| `PROVISIONING_ENABLED` | `true` | offen (P4, echtes Geld) — erst nach gruenem E2E + deiner Freigabe |

## D2. Restliste vor echtem Go-live (Jonas — Browser/Secrets)

1. **Stripe-Webhook-Event `customer.subscription.created` ergaenzen** — aktuell nur `.updated`/`.deleted` + `invoice.payment_failed`. Sofort-aktive Abos (Stripe `error_if_incomplete` -> Subscription wird direkt `active`) feuern `.created`; ohne dieses Event laeuft die Aktivierung NUR ueber den synchronen P5-Subscribe-Fix, der Webhook ist dann nur Backup. Endpoint: `https://app.sundartha.com/webhooks/stripe`.
2. **WorkOS Staging -> Production** — live laeuft noch gegen `…-staging.authkit.app` (Staging-Client `client_01KVWCMPXRT0K2CWEJ9B2255XX`). Prod-AuthKit-Environment + `WORKOS_*`-Secrets in Render verdrahten.
3. **Stripe Live-Keys (`sk_live_…`)** fuer echten Umsatz — aktuell `sk_test`. Erst zusammen mit `PROVISIONING_ENABLED=true` (P4).
4. **E2E-Abnahme:** Register -> Stripe Checkout (Testkarte) -> Tenant `active` + `kycLevel=CARD` + Nummer im Dashboard (bei `PROVISIONING_ENABLED=false`: Nummer `requested`, kein Kauf). Siehe E.

## E. Abnahme nach go-live (End-to-End)

1. Registrierung auf `app.sundartha.com` -> Stripe Checkout (Testkarte) -> zurueck.
2. Webhook -> Tenant `active`, `kycLevel=CARD`, Nummer erscheint im Dashboard (bei `PROVISIONING_ENABLED=false`: Nummer `requested`, kein Kauf).
3. MCP-Connector: derselbe Login loest denselben Tenant auf (kein "Kein Tenant" mehr).
4. Outbound-Call-Gate offen (active + KYC>=CARD).

---

**Reihenfolge kompakt:** A1->A2 (DNS+Domain) -> A3 (WorkOS) -> `PUBLIC_URL` -> B (Stripe/Telnyx-Secrets) -> A4 (Stripe-Webhook) -> `PAYMENT_ENABLED=true` (Testmodus) -> E-Abnahme -> `PROVISIONING_ENABLED=true` (echtes Geld).
