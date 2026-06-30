# HANDOVER — Telnyx orderNumber HTTP 402 (Nummernkauf scheitert) + naechste Session

**Stand:** 2026-06-30 ~15:30 · **Fuer:** neue Session, Weiterarbeit ab hier.
**Workflow-Vorgabe (Jonas):** Lean-Template + Implementation-Workflow (`phase-impl-lean`) fuer Code-Fixes; ein **Agent-Team** soll den 402 genauer untersuchen. **Telnyx-MCP-Zugriff muss wiederhergestellt werden** (siehe §6, Jonas-Aktion).

---

## UPDATE 2026-06-30 (Session 2) — Diagnose-Logging GEMERGED (unpushed), 402-Ursache eingegrenzt

**Code-Fix erledigt (Schritt 5.2):** 402-Body-Logging via `phase-impl-lean` umgesetzt + dual-reviewt + manuell verifiziert (Suite **1464 gruen**), gemerged nach `master` (`e6d5491` + Fixes `d1e9b9e`/`2fb4c1b` + Docs `8f0ee5b`). **NICHT gepusht** (Push = Jonas). Details: `tasks/telnyx-402-log-report.md`, Spec: `tasks/telnyx-402-logging.md`.
- Neuer gemeinsamer Telnyx-Envelope `src/telephony/adapters/telnyx/errors.js` (`assertTelnyxOk`), den `numbers.js` UND `voice.js` nutzen (Dedup). 402 ergibt jetzt z.B. `Telnyx orderNumber fehlgeschlagen: HTTP 402 (10015 Payment required: Account balance too low)`. PII/Key-safe (Allowlist code/title[/detail], 200-Trunc, Fallback status-only). Akzeptiertes detail-Restrisiko in `PLAN-SECURITY.md`.
- **Wichtig:** das macht den Grund nur SICHTBAR, fixt den 402 nicht. Nach **Push/Deploy** zeigt der naechste Subscribe/Retry den exakten Grund im Log.

**H3 (Kauf-Land/Regulatory) als 402-Ursache ENTKRAEFTET:** Kauf-Land = DE default (`config.js:321` PROVISIONING_COUNTRY||DE, `config.js:329` FORCE_NUMBER_COUNTRY leer, `server.js:1623` numberCountry=forceNumberCountry||country). `orderNumber` sendet **kein** `regulatory_requirement_id` — ein fehlendes DE-Bundle waere **422/Order-`failure`**, NICHT `402`. → 402 = reines Funding/Billing, **H1/H2 fuehren**. (Live-Render-Override `FORCE_NUMBER_COUNTRY` bleibt ungeprueft → Jonas-Dashboard.)

**ROOT CAUSE BESTAETIGT (direkter Telnyx-Read mit neuem v2-Key):** `balance = $1.92`, `credit_limit = $0`, `available_credit = $1.92`. DE-Nummer kostet erste Monatsrate **$2.00** (`upfront $1 + monthly $1`). `$1.92 < $2.00` → **402 Payment Required**. Order-Historie: 06-27/28/29 gekauft+released (drainte das Guthaben), 06-30 reicht es nicht mehr → H1 bestaetigt, H2/H3 raus.

**Status nach Session 2:** Diagnose-Logging gepusht (master == origin, `1b1bc6b`, Render-Frankfurt deployt). 32 stale Workflow-Worktrees + merged Branches aufgeraeumt (uebrig: 2 uralte diverged Branches `phase/p3-payment-chain`, `review-g4` — bewusst behalten).

**Offen — NUR noch Jonas (kein Code):**
1. **Telnyx-Guthaben aufladen** (≥ Order-Kosten, sinnvoll Auto-Recharge + kleines `credit_limit`). DAS behebt den 402.
2. Danach pro haengendem Tenant `POST /api/onboard/retry` (§5.4) → erwartet `active` statt 402. Das jetzt live deployte Logging zeigt bei erneutem Fehler den exakten Telnyx-Grund.
3. Optional: Telnyx-MCP-Connector-Token erneuern (`10009`) — fuer kuenftige MCP-Reads; fuer Diagnose nicht noetig (curl mit v2-Key reicht).

---

## 1. Wo wir stehen (erledigt, LIVE)

| Track | Status |
|---|---|
| **Phase 1 — Profil-Achse email->tenantId** (Go-live Call-Block) | ✅ LIVE deployt (`7816d17`), Migration `[migrate] profile rekey email->tenant_id: +5 -2` lief. Backend = pg. `stundenlimit_nutzer`-Bug behoben. |
| **Phase 2 — Operator-Re-Trigger `POST /api/onboard/retry`** | ✅ implementiert + getestet (1453/1453) + LIVE deployt (`af7d760`). Owner-gated, Geld-Safety, reuse triggerTenantProvisioning. |
| **DER offene Blocker** | ❌ **Telnyx orderNumber HTTP 402 — es wird KEINE Nummer gekauft.** |

Doku: `PLAN-MCP-PROFILE-IDENTITY.md` (Phase 1/2 Detail). Memory: `bug-c-mcp-profile-identity-divergence.md`.

---

## 2. Der Blocker — praezise

Jeder Abo-Abschluss heute endet so (3x belegt, Live-Logs `srv-d8m0fhflk1mc73bno570`):
```
self_service_subscribe ... plan=business outcome=ok profile=ok:6      <- Tenant + Profil OK
[provision-worker] Telnyx orderNumber fehlgeschlagen: HTTP 402        <- KEIN Kauf bei Telnyx
```
Vorfaelle: 08:05, 08:36, 15:24 (UTC). Betroffene Tenants: `t_user_01KWBRXGE6QAN0EYZV8JHK8GTF`, `t_user_01KWBTP2214JN8VQ2WG9Q50MYF`, `t_user_01KWCJ1MW63A3F4R0M44FVR9WH`.

**Jonas:** "Lief alle Tage bis gestern — es wurde immer erfolgreich eine Nummer gekauft. Seit heute nicht mehr." Kein Budget-/Token-Problem (seine Einschaetzung).

---

## 3. Etablierte Fakten (NICHT neu herleiten)

1. **Es ist NICHT der neue Code.** Der erste 402 war **08:05 heute** — VOR jedem Deploy dieser Session (erster Deploy ~13:44). Phase 1/2 beruehren das Telnyx-Provisioning NICHT. Die gestrigen Go-live-Commits ebenfalls nicht. -> Ursache ist Telnyx-seitig ODER eine Ueber-Nacht-Aenderung (Account/Config/Balance), NICHT der Code. **Nicht im Code suchen.**
2. **402 = "Payment Required", NICHT Auth.** Der Server-`TELNYX_API_KEY` authentifiziert sich erfolgreich (sonst 401, nicht 402). Der Order wird payment-/billing-seitig abgewiesen.
3. **Diagnose-Luecke A (Code):** Der Telnyx-Adapter loggt nur den Status, NICHT den Antwort-Body. `src/telephony/adapters/telnyx/numbers.js`: `assertOk` (~Z.40) wirft `Telnyx ${op} fehlgeschlagen: HTTP ${res.status}` — der 402-Response-**Body** (Telnyx error code/title/detail) wird VERWORFEN. Genau dort steht der echte Grund.
4. **Diagnose-Luecke B (Zugriff):** Der **Telnyx-MCP-Token ist abgelaufen** (`401 code 10009: token expired or revoked`) — direkter Account-Read (Balance/Billing/Orders) aktuell nicht moeglich. Letzter Balance-Read (als Token noch lief, heute frueh): **$1.92** (unbestaetigt als Ursache; Jonas widerspricht Budget-These).
5. Profil-Achse + Re-Trigger sind NICHT der Blocker — die funktionieren. Der Block ist allein der Telnyx-Order.

---

## 4. Hypothesen (VERIFIZIEREN, nicht annehmen)

Konsistenz-Anker: "lief bis gestern, kauft immer erfolgreich, seit heute 402".

1. **H1 — Telnyx-Balance/Funding unter Kauf-Schwelle.** Passt zu "lief bis gestern" (taegliche Kaeufe zehrten das Guthaben auf) + $1.92 + 402. Jonas widerspricht — daher **direkt am Telnyx-Account pruefen**, nicht annehmen.
2. **H2 — Billing/Payment-Method-State.** Hinterlegte Karte abgelaufen/abgelehnt, Auto-Recharge aus, Billing-Hold. 402 trotz Restguthaben moeglich.
3. **H3 — Account-/Regulatory-State.** Verifizierungs-/Regulatory-Anforderung (v.a. DE +49-Nummern brauchen Adress-/Regulatory-Bundle). Pruefen, welches **Kauf-Land** der Order trifft: `FORCE_NUMBER_COUNTRY` (Render-Env) vs. `PROVISIONING_COUNTRY`. Startup-Log zeigte `Land *` (ALLOWED_COUNTRY_CODES), das ist das CALL-Gate, nicht das Kauf-Land.

---

## 5. Entscheidende naechste Schritte (Plan)

**Ziel-Ergebnis (deterministisch):** Telnyx' EXAKTER 402-Grund ist bekannt (Code/Detail), nicht geraten — dann gezielt fixen.

1. **Schnellster Weg — Telnyx direkt lesen (nach Token-Refresh, §6):** Balance, Billing-Status/Payment-Method, letzte `number_orders` + deren Fehler-Detail, Account-Status. Telnyx-MCP: `retrieve_balance`; `list_api_endpoints "number orders"` -> Order-Historie + Error.
2. **Parallel/Alternativ — Diagnose-Logging (Code, `phase-impl-lean`):** In `src/telephony/adapters/telnyx/numbers.js` `assertOk` den Response-Body lesen und den Telnyx-`errors[].code/title/detail` in die Fehlermeldung aufnehmen — **PII-/Secret-frei** (kein API-Key, Regel 4). Deploy -> naechster Subscribe/Retry zeigt den **exakten** Grund im Log. Klein, fail-safe, kein Verhaltens-Risiko.
3. **Kauf-Land klaeren (H3):** `FORCE_NUMBER_COUNTRY`/`PROVISIONING_COUNTRY` in Render pruefen. DE -> Regulatory-Pfad; US -> regulatory-frei.
4. **Nach Root-Cause-Fix verifizieren:** Re-Trigger pro haengendem Tenant:
   ```bash
   curl -u admin:$DASHBOARD_PASSWORD -X POST https://app.sundartha.com/api/onboard/retry \
     -H 'content-type: application/json' -d '{"tenantId":"<tenantId>"}'
   ```
   Erwartung: `{"reason":"queued",...}` -> Log `[provision-worker]` zeigt Nummer `active` (Erfolg) statt 402.

---

## 6. Jonas-Aktionen (Mensch / Account / kein Claude)

1. **Telnyx-MCP-Token erneuern** — der MCP-Connector-Token ist abgelaufen (`code 10009`). Claude kann KEIN OAuth/Token-Refresh. Ohne das ist Schritt 5.1 (direkter Account-Read) blockiert; dann greift 5.2 (Logging).
2. **Telnyx-Account selbst checken** (Dashboard): Balance, hinterlegte Zahlungsmethode, Account-/Regulatory-Status, ob seit gestern etwas umgeschlagen ist (Guthaben aufgebraucht? Karte abgelehnt? Verifizierung faellig?).

---

## 7. Workflow fuer die naechste Session

- **Agent-Team** auf die 402-Diagnose ansetzen: (a) Telnyx-MCP-Reader (Balance/Orders/Billing, sobald Token frisch), (b) Adapter-Logging-Fix-Planer, (c) Kauf-Land/Regulatory-Checker. Read-only Investigation zuerst, dann Fix.
- **Code-Fixes** (z.B. das 402-Body-Logging) ausschliesslich ueber **`phase-impl-lean`** (Lean-Template: Plan -> Worktree-Impl -> dualer Review -> Self-Fix bis PASS). Hinweis: der `phase-impl`-Workflow ist diese Session repariert worden (REPO portabel, args Objekt|String); `phase-impl-lean` war schon portabel.
- **NICHT** den 402 im Applikations-Code suchen (Fakt §3.1) — der Hebel ist Telnyx-Account + Adapter-Logging.

## 8. Schluessel-Dateien

- `src/telephony/adapters/telnyx/numbers.js` — Telnyx-Order-Adapter (`assertOk`, `orderNumber`); hier das 402-Body-Logging.
- `src/server.js` — `triggerTenantProvisioning` (~Z.1771, gibt jetzt {ok,reason,numberId,jobId}), `POST /api/onboard/retry` (Operator-Re-Trigger), `runProvisioningDrain`.
- `src/onboarding.js` — `provisionNumber` (Order-Fehler -> `failNumber` -> Status `failed`; daher ist ein Re-Trigger sauber).
- `src/billing/provision-trigger.js` — `requestNumberForPaidTenant` (Guard `tenantHasLiveNumber`).
