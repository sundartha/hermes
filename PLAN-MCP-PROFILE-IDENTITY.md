# PLAN — MCP-Profil-Identitaet (Outbound-Call-Block am Go-live)

**Stand:** 2026-06-30 · **Status:** Phase 1 (Strategie S) LIVE deployt (`7816d17`, Migration `+5 -2` lief). Phase 2 (Number-Re-Trigger `/api/onboard/retry`) IMPLEMENTIERT + getestet + lokal gemergt (`eb86fff`, unpushed). Offen: Push(deploy) + Owner triggert + Telnyx-Kauf-Verifikation.
**Methodik:** Adversariale Verifikation (7 Agents, Run `wf_3cef2801-5ad`) + 5-Why + Pre-Mortem; Umsetzung Plan->Worktree-Impl->Review (Run `wf_0069ad90-ba7`), Review/Verifikation im Main-Thread nachgeholt (Review-Agents am Spend-Limit gestorben).

## STATUS-UPDATE (2026-06-30, nach Umsetzung)

Strategie S umgesetzt (Commit `8e30feb`, gemergt `71e252f`): Profil-Achse keyt jetzt auf `tenantId` (AM6-autoritativ) statt email/sub. `resolveProfile(tenantId)` in place_call (nach TENANT_REJECT, vor numberGateError), /mcp-Gateway (scopedTenant), Booking-Gate (tenant). `resolveProfileFrom`: `tenantId===BOOTSTRAP_TENANT_ID -> OWNER_PROFILE` (R2 hart gepinnt), sonst stored-or-DEFAULT (Sec1, kein Falsy-Kollaps). pg: `email`-PK -> `tenant_id`-PK + idempotente non-destruktive `rekeyProfilesToTenant`-Migration (account-Join) — heilt Bestands-Profile beim Deploy. Resolver synchron (kein Account-/email-Lookup mehr). **Verifiziert:** npm test 1449/1449 grün (beide Backends, eigener Lauf), Smoke bestaetigt sub-only -> Profil-Gate passiert (NICHT stundenlimit_nutzer), kein Safety-Gate aufgeweicht, Diff selbst safety-reviewed.

**Phase 2 (implementiert, `eb86fff`):** Operator-Endpoint `POST /api/onboard/retry` {tenantId} — re-provisioniert eine Nummer fuer einen aktiven+CARD-Subscriber, dessen Kauf scheiterte (`provisionNumber` faellt bei Order-Fehler/402 auf `failed` -> `tenantHasLiveNumber` wieder offen -> frische `requested` -> Worker kauft). Owner-gated (Basic-Auth/trusted-localhost, Regel 3), Geld-Safety nur fuer Subscriber (Regel 1), reuse `triggerTenantProvisioning` (alle Gates). 4 Tests gruen, Suite 1453/1453. `triggerTenantProvisioning` gibt jetzt ein Ergebnis zurueck (Webhook ignoriert es).

**Naechste Schritte:** (1) **Push** -> Render deployt Phase 2. (2) Owner triggert pro haengendem Tenant: `curl -u admin:$DASHBOARD_PASSWORD -X POST https://app.sundartha.com/api/onboard/retry -H 'content-type: application/json' -d '{"tenantId":"t_user_01KWBRXGE6QAN0EYZV8JHK8GTF"}'`. (3) Server-Logs verifizieren: Nummer `active` (Erfolg) ODER exakter Grund (402=Funds / regulatory). Telnyx-MCP-Token ist abgelaufen (mein Direkt-Read tot) — Verifikation nur ueber Server-Logs.

> **TL;DR:** Der Abo-Kauf funktioniert. Das Paid-Profil wird korrekt geschrieben. Der MCP-`place_call` findet es nur nicht, weil das WorkOS-Access-Token keine `email`-Claim traegt und der Lese-Pfad dann auf die `sub` (user-id) zurueckfaellt, waehrend das Profil unter `account.email` liegt. Read-Key != Write-Key → `DEFAULT_PROFILE` (`maxCallsPerHour=0`) → harter Block. Die A4-Haertung (`2→0`) hat den latenten Mismatch sichtbar gemacht. **Separat:** der Telnyx-402 (kein Guthaben) hinterliess keine aktive Nummer — das ist das *naechste* Gate nach dem Profil-Fix.

---

## 1. Symptom + Beweis (Live-Logs, Render `srv-d8m0fhflk1mc73bno570`)

```
self_service_subscribe ... tenant=t_user_01KWBRXGE6QAN0EYZV8JHK8GTF plan=business outcome=ok profile=ok:6
[provision-worker] Telnyx orderNumber fehlgeschlagen: HTTP 402
place_call_denied ip=::1 to=+491737252163 grund=stundenlimit_nutzer requestedBy=user_01KWBRXGE6QAN0EYZV8JHK8GTF
```
`requestedBy` ist eine WorkOS-**user-id** (`user_01KWB…`), KEINE Email. `profile=ok:6` beweist: das Profil WURDE geschrieben (6 Keys = PAID_PLAN_PROFILE). Zweiter Test-Tenant identisch.

---

## 2. Root Cause (einstimmig bestaetigt, 3/3 Verifier, alle 5 Alternativen widerlegt)

```
WorkOS-JWT (MCP-Connector) ohne email-Claim
→ server.js:1844  identity = req.auth.email || req.auth.sub || ANON_IDENTITY  →  sub "user_01KWB…"
→ mcp-tools.js:35  X-Internal-Identity: "user_01KWB…"
→ server.js:1197  store.resolveProfile("user_01KWB…")
→ state-ops.js:1330  s.profiles["user_01KWB…"] = undefined   (Profil liegt unter account.email!)
→ defaults.js:372  resolveProfileFrom(sub, undefined) → {...DEFAULT_PROFILE}
→ defaults.js:338  DEFAULT_PROFILE.maxCallsPerHour = 0
→ server.js:617-620  limit = min(config.maxCallsPerHour, 0) = 0
→ server.js:737  userHourReached() = (0 >= 0) = true  →  deny grund=stundenlimit_nutzer
```

**Write-Pfad** (`billing/activation.js:26`): `store.setProfile(account.email, tier)` — Profil unter **Email**.
**Read-Pfad** (`server.js:1844`): identity = **sub** (wenn email-Claim fehlt) — Lookup verfehlt.

**Ausgeschlossen (mit Beleg):** globaler Cap=0 (sonst `grund=stundenlimit`, nicht `_nutzer`) · Profil-unter-sub (Write keyt email) · Normalisierung sub→email (keine) · `account.email`==user-id (Format `user_…` vs. `@`) · falsch gelabeltes Gate (`stundenlimit_nutzer` nur in server.js:740).

---

## 3. 5-Why

1. **Warum** wird der Call abgewiesen? → `userHourReached` liefert true (limit=0).
2. **Warum** limit=0? → Das aufgeloeste Profil ist `DEFAULT_PROFILE` (`maxCallsPerHour=0`), nicht das Paid-Profil (`null`).
3. **Warum** DEFAULT statt Paid? → `resolveProfile(identity)` findet keinen Eintrag unter dem Read-Key.
4. **Warum** kein Eintrag? → Read-Key ist die `sub`, das Profil wurde unter `account.email` geschrieben.
5. **Warum** `sub` statt email? → Das WorkOS-Access-Token traegt keine `email`-Claim; `server.js:1844` faellt fail-closed auf `sub` zurueck.

**Wurzel (deepest why):** Die Profil-Achse der A-Serie ruht auf einer **ungesicherten Annahme** — "das MCP-Access-Token traegt immer eine `email`-Claim". Diese Annahme ist in 5 Doku-Stellen kodiert, aber nirgends gegen WorkOS AuthKit verifiziert. Die **A4-Haertung** (`DEFAULT_PROFILE.maxCallsPerHour 2→0`) entfernte das versehentliche Polster (vorher: 2 Calls/h trotz Miss), das den Invarianten-Bruch maskierte → latenter Bug wurde harter Prod-Block.

---

## 4. War gestern Arbeit umsonst? — Nein.

Die ~20 Commits vom 29.06. sind die **Profile-Provisioning/Quota-Serie** (`PLAN-PROFILE-PROVISIONING.md`):

| Block | Was | Status |
|---|---|---|
| A1 | Plan→Rechteprofil-Mapping (`PLAN_PROFILE`) | korrekt |
| A2 | Aktivierung schreibt Profil auf `account.email` (Achsen-Bruecke tenantId→email) | **Write korrekt** |
| A3 | idempotenter Backfill Bestands-Subscriber (keyt email) | korrekt |
| B1–B3 | Minuten-Kontingent-Gate | korrekt, nicht ursaechlich |
| A4 | `DEFAULT_PROFILE.maxCallsPerHour 2→0` (Haertung) | korrekt — **legte den Read-Bug frei** |

Die Write-Seite ist sauber. Der einzige Defekt ist die **Read-Annahme**. Der Fix *vervollstaendigt* das Design (Verdict Archaeology-Agent), er widerspricht ihm nicht. Ein Profil-auf-`sub`-Keyen waere ein Widerspruch (PLAN §4 explizit verworfen).

---

## 5. Forward-Chain — was der Profil-Fix entsperrt (und was NICHT)

Volle Gate-Kette fuer einen aktiven, `kyc=card`, `plan=business` Tenant nach +49-Mobil, **Profil-Fix angenommen**:

| Gate | Ergebnis |
|---|---|
| OUTBOUND_FROZEN, Trunk-0, Tenant-Reject, KYC, ownerName | PASS |
| Denylist / E164 / Land (+49 erlaubt) | PASS |
| globalHourReached (cap=6) / **userHourReached** | **PASS nach Fix** |
| perTarget-Cap / allowlist (active+CARD subscriber) | PASS |
| Budget / B2-Minuten (business=120, frischer Anker) / Reserve | PASS |
| **Gate 5: aktive Absender-Nummer (`outboundFrom`)** | **BLOCK (real)** |

**Kritisch:** Der Profil-Fix passt die gesamte Gate-Kette — **bis auf** Gate 5. Im Live-Zustand hat der Tenant **keine aktive Nummer** (Telnyx-402), also `outboundFrozen`→null→`403 grund=keine_tenant_nummer`. **Profil-Fix + Telnyx-Nummer sind BEIDE noetig**, damit ein Call durchgeht. Der Profil-Fix allein entsperrt das Profil-Gate, nicht den Call.

---

## 6. Fix-Strategien

### Strategie T (taktisch) — email-first vervollstaendigen
Bei fehlender `req.auth.email` die kanonische `account.email` aus der bereits JWT-aufgeloesten Identitaet nachschlagen und als `X-Internal-Identity` reichen. Werkzeug existiert (`accounts.resolve(sub)` / `accountByTenant`).
- **+** kleiner Diff, deckt sich mit dokumentiertem Design, schnell live.
- **−** laesst die Fragilitaet der Email-Achse bestehen (Recycling, Casing); harte Implementierungs-Fallen (s. §7).

### Strategie S (strategisch, empfohlen) — Profil-Achse auf `tenantId` vereinen
Profil read+write auf die **`tenantId`-Achse** umkeyen — dieselbe Achse, die AM6 bereits autoritativ aus dem verifizierten JWT aufloest (`X-Internal-Tenant`).
- **+** eliminiert die Root-Cause-Klasse ganz (kein email/sub-Divergenz mehr), **eliminiert die Email-Recycling-Vuln (Sec #2)** und Casing (#4), **kein neuer Hot-Path-DB-Read** (tenantId ist am Gateway schon aufgeloest).
- **−** schreibt die A-Serie-Invariante um (activation, A3-Backfill, 5 Doku-Stellen, `s.profiles`-Migration); groesserer Blast-Radius; **braucht eigenen Pre-Mortem/Review** vor Impl.

| | Strategie T | Strategie S |
|---|---|---|
| Behebt Root-Cause | ja | ja |
| Email-Recycling-Vuln (#2) | bleibt | **weg** |
| Casing-Risiko (#4) | bleibt | **weg** |
| Neuer Hot-Path-DB-Read | ja (mitigierbar) | nein |
| Blast-Radius | klein | mittel-gross |
| Migrations-Kosten | 0 | **0 heute (pre-launch, nur Test-Tenants)** |

**Empfehlung:** **Strategie S, jetzt** — pre-launch (Telnyx ungefundet, nur 2 Test-Tenants) ist die Migrations-Kost null und der Bug-Klasse wird *vor* den ersten echten Nutzern der Boden entzogen ("Millionen-Skala, kein Wegwerf-Code", CLAUDE.md). Strategie T nur, falls ein Demo-Unblock VOR dem S-Umbau zwingend ist — dann mit allen §7-Mitigationen, und S bleibt als Folge-Haertung gesetzt.

---

## 7. Implementierungs-MUSS (harte Constraints aus dem Pre-Mortem)

Egal welche Strategie — diese Punkte sind Blocker, kein Nice-to-have:

| # | Schwere | Constraint |
|---|---|---|
| R1 | KRITISCH | `accounts` liegt im `guardedBoot`-Scope; `/mcp`-Handler ist ausserhalb → `accounts is not defined`. **json-Backend hat kein `accountByTenant`** → TypeError in Prod UND allen 170 Tests. Jede Achsen-Aufloesung muss in BEIDEN Stores existieren + Scope korrekt. (Strategie S umgeht das, da `tenantId` schon im Scope.) |
| Sec1 | KRITISCH | ANON_IDENTITY-Terminal nie im `\|\|`-Ausdruck verlieren. Async-Refactor: `if (!identity) identity = ANON_IDENTITY` als eigene Zeile NACH dem await. Sonst falsy-Kette → `resolveProfile(undefined)` → OWNER_PROFILE → **Owner-Eskalation**. |
| R2 | HOCH | Owner-Pfad: `scopedTenant===BOOTSTRAP_TENANT_ID` muss weiter auf `OWNER_PROFILE` fallen (heute `resolveProfileFrom(!email)`). Sonst Owner-Email → kein `s.profiles`-Eintrag → DEFAULT → **Owner selbst gesperrt**. Heute unsichtbar (am6-Test prueft nur `get_my_number`, nicht `place_call`). |
| Sec3 | HOCH | DB-Lookup (falls Strategie T) in eigenem try/catch mit Fallback `sub\|\|ANON`; DB-Exception darf nie identity leer lassen. |
| #4 | HOCH | Email-Casing: `toLowerCase().trim()` an genau EINER Write- und EINER Read-Stelle (falls Email-Achse bleibt). |
| #6/R3 | MITTEL | Strategie T: Lookup NUR wenn `req.auth && !req.auth.email` (nicht jeder MCP-Request) — Hot-Path-Schutz. |
| #5 | MITTEL | `accountByTenant`→null (0 oder >1 Accounts, §5.6) muss geloggt werden, nicht still auf DEFAULT fallen. |

### Pflicht-Tests + Smoke (Verifikations-Feedback-Loop)
1. **Neuer Test:** sub-only OAuth-Token + Subscriber-Profil unter email + `place_call` → passiert Profil-Gate (erwartet 500/Provider-Fehler, NICHT 429). *Einziger direkter Korrektheits-Beweis.*
2. **Neuer Test:** Owner-Token (`sub=OWNER_IDP_SUBJECT`) + `place_call` → NICHT 429 (R2-Regression-Riegel).
3. **Bestehender Invarianten-Test:** sub-only ohne Profil + `place_call` → bleibt 429 (kein Leck).
4. `npm test` (alle 170 Suites, json-Backend darf nicht crashen) + `node --check src/server.js`.
5. **Smoke:** `PORT=3999 MCP_AUTH=oauth MULTI_TENANT=true npm start` + `curl /mcp` mit sub-only Bearer.

---

## 8. Problem 2 — Telnyx HTTP 402 (paralleler Infra-Track, NICHT Code)

`PROVISIONING_ENABLED` ist live **`true`** (entgegen Handover-Doku) → Worker lief → Telnyx-Order `402 Payment Required` = **Telnyx-Account ohne Guthaben/Zahlungsmittel**. Folge: Nummer bleibt `requested/failed`, nicht `active` → Gate 5 blockt. **Jonas-Aktion:** Telnyx-Account aufladen/Billing setzen. Danach: bestehende `requested`-Nummern brauchen einen Re-Trigger (kein Auto-Backfill — `tenantHasLiveNumber`-Guard blockt sonst neuen `requestNumber`).

---

## 9. Offene Entscheidungen fuer Jonas

1. **Strategie S (Empfehlung) oder T?** S = Achse auf `tenantId`, jetzt pre-launch. T = email-first vervollstaendigen (Interim).
2. **Telnyx 402:** selbst klaeren oder via Telnyx-MCP pruefen lassen?
3. **Vor Impl:** `/council` auf die Achsen-Entscheidung (S aendert frische A-Serie) — oder direkt `phase-impl-lean` mit diesem Plan als Vorgabe?
