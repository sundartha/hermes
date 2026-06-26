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

## D. Was Claude danach macht (deine Freigabe noetig)

Sobald A+B+C stehen, kann Claude per Render-MCP (kein Secret):

| Env | Wert | Voraussetzung |
|---|---|---|
| `PUBLIC_URL` | `https://app.sundartha.com` | DNS+Domain live (A1/A2); baut `redirect_uri = publicUrl + /auth/callback` |
| `PAYMENT_ENABLED` | `true` | P3 im Stripe-**Testmodus** verifiziert |
| `PROVISIONING_ENABLED` | `true` | **echtes Geld** (P4) — nach gruenem Test + deiner Freigabe |

**Ankreuzen (damit Claude nicht wartet):**
- [ ] Claude darf `PAYMENT_ENABLED=true` setzen, sobald P3 im Stripe-Testmodus gruen.
- [ ] Claude darf `PROVISIONING_ENABLED=true` (echtes Geld) setzen: JA / nur nach Rueckfrage.

## E. Abnahme nach go-live (End-to-End)

1. Registrierung auf `app.sundartha.com` -> Stripe Checkout (Testkarte) -> zurueck.
2. Webhook -> Tenant `active`, `kycLevel=CARD`, Nummer erscheint im Dashboard (bei `PROVISIONING_ENABLED=false`: Nummer `requested`, kein Kauf).
3. MCP-Connector: derselbe Login loest denselben Tenant auf (kein "Kein Tenant" mehr).
4. Outbound-Call-Gate offen (active + KYC>=CARD).

---

**Reihenfolge kompakt:** A1->A2 (DNS+Domain) -> A3 (WorkOS) -> `PUBLIC_URL` -> B (Stripe/Telnyx-Secrets) -> A4 (Stripe-Webhook) -> `PAYMENT_ENABLED=true` (Testmodus) -> E-Abnahme -> `PROVISIONING_ENABLED=true` (echtes Geld).
