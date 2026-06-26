# Phase BK3 — Auto-Provisioning nach Abo-Aktivierung

| Feld | Wert |
|---|---|
| Phase | BK3 — Auto-Provisioning nach bestaetigter Abo-Aktivierung |
| Gate | **PASS** |
| finalBranch | `phase/bk3-auto-provision` |
| headCommit | `c59d1ea986b4010efb6e1dbb3bdb2b16d64051e7` |
| Tests | 1067 pass / 0 fail (+5 ggue Baseline) |
| node --check | gruen (4 Dateien) |
| Smoke | `GET /healthz` -> HTTP 200 |
| Spec | `PLAN-BUCHUNG-PRICING.md §BK3` |

---

## 1. Kern-Befund (Plan-Phase zuerst)

Die Verkettung **existierte bereits vollstaendig auf master** (gebaut in P3, 26.06.). BK3 ist **kein Neubau**. Verifizierter Pfad:

```
POST /webhooks/stripe (server.js:276)
  -> verifyStripeSignature (fail-closed)
  -> applyStripeWebhook (webhook.js:153)   [ACTIVATE nur bei status active/trialing]
     -> activatePaidTenant (activation.js:13)   [KYC=CARD -> setStatus(active) -> provision()]
        -> triggerTenantProvisioning (server.js:1474, als Seam injiziert)
           -> tenantHasLiveNumber-Guard (Idempotenz) -> requestNumber (Caps)
           -> if !PROVISIONING_ENABLED: return   [Dry-Run-Stop, KEIN Kauf]
           -> else queueProvisioning -> runProvisioningDrain -> handleProvisionJob
              -> provisionNumber (Money-Safety)
```

Es blieben genau **drei nachweisbare Luecken** (Scope strikt darauf begrenzt):

1. **Verhaltens-Luecke (S1-relevant, Kosten-Notbremse):** Cap-Block (`tenant_cap`/`global_cap`) erzeugte nur `console.warn` (server.js:1497) — **kein Audit-Eintrag**. Spec verlangt: *"Limit ueberschritten -> kein Kauf, Audit-Eintrag."*
2. **Test-Luecke:** Spec-Dreiklang (Dry-Run-Nummer · Idempotenz · Limit) fehlte. P3-Test umging den Cap bewusst (`HIGH_CAP`) und testete eine **Replik** statt der echten Logik.
3. **Clean-Code-Luecke (S2):** `triggerCore` (p3-payment-webhook.test.js:134) duplizierte den Produktions-Decision-Core.

**Designprinzip:** reinen Decision-Core extrahieren (eine Quelle, G5/S2); IO (Audit/Queue/Drain) bleibt in `server.js`. Die `provision(tenant)`-Seam-Signatur bleibt **unveraendert** (`activation.js`/`webhook.js` nicht angefasst). Keine neuen Dependencies.

---

## 2. Plan (gekuerzt)

### 2.1 Neue Datei `src/billing/provision-trigger.js`
Reiner, config-freier Decision-Core (`requestNumberForPaidTenant`): State rein -> Ergebnis raus, keine IO. Co-loziert mit `activation.js`.
- Idempotenz-Guard ueber `tenantHasLiveNumber` (kein Doppelkauf bei Webhook-Retry).
- `provider: PROVIDER.TELNYX` **explizit** (load-bearing, da `DEFAULT_PROVIDER = TWILIO`).
- Land aus Tenant-Geo mit Fallback, Sprache via `languageForCountry`.
- F1: ein Options-Objekt (`tenantId` + Caps + `fallbackCountry`).
- Rueckgabe: `{ ok:true, number }` | `{ ok:false, reason: "already_provisioned" | "tenant_inactive" | "global_cap" | "tenant_cap" }`.

### 2.2 Edit `src/server.js`
- Import-Block: ungenutzte `tenantHasLiveNumber`/`tenantGeo` entfernen (G12); `requestNumberForPaidTenant` importieren. `requestNumber`/`PROVIDER`/`languageForCountry` bleiben (andere Caller).
- `triggerTenantProvisioning`: Inline-Core durch Helper ersetzen; `store.save()` bleibt (IO, P15).
- `console.warn` -> `audit("webhook_provision_skipped", null, ...)` bei jedem Grund **ausser** `already_provisioned` (erwarteter stiller No-op). `req=null` -> audit-util markiert Quelle als `system`; nur `tenantId` + Grund-Code, kein Secret/PII.

### 2.3 Tests
- `test/p3-payment-webhook.test.js`: S2-Replik `triggerCore` retiren, B(h) auf echte `requestNumberForPaidTenant` umstellen (Assertions identisch).
- Neu `test/bk3-auto-provision.test.js`: Spec-Dreiklang + signierter E2E-Pfad (T1 Dry-Run-Nummer, T2 Idempotenz, T3 `tenant_cap`, T3b `global_cap`, T4 signierter `active`-Webhook idempotent).

### 2.4 Deterministisches Ergebnis
`node --check` (beide Dateien) Exit 0; `npm test` -> `fail 0`, Test-Cases **+5**; Luecken-Beweis-greps: `webhook_provision_skipped` = 1 Treffer, `console.warn` = 0, `triggerCore` in `test/` = 0, `tenantHasLiveNumber|tenantGeo` in `server.js` = 0.

---

## 3. Implementierung — Zusammenfassung

BK3 schliesst die 3 Luecken, kein Neubau:

1. **Audit bei geblocktem Kauf** — `tenant_cap`/`global_cap`/`persist_error` werden jetzt im Audit-Trail protokolliert (`audit('webhook_provision_skipped', ...)` statt `console.warn`). `already_provisioned` bleibt stiller idempotenter No-op.
2. **Neue Test-Datei** `test/bk3-auto-provision.test.js` — 5 Tests (Spec-Dreiklang + signierter E2E-Webhook).
3. **S2-Replik retired** — Decision-Core nach `src/billing/provision-trigger.js` extrahiert (reine Fn, EINE Quelle fuer Produktion + Test).

**Ergebnis:** `node --check` gruen (4 Dateien); `npm test` 1067 pass / 0 fail (+5 ggue Baseline); Smoke `/healthz` HTTP 200; commit `c59d1ea`.

| Datei | Art | Umfang |
|---|---|---|
| `src/billing/provision-trigger.js` | neu | ~20 Zeilen, reine Funktion |
| `src/server.js` | edit | 2 Import-Zeilen entfernt, 1 hinzugefuegt; `triggerTenantProvisioning`-Body (Core->Helper, `console.warn`->`audit`) |
| `test/p3-payment-webhook.test.js` | edit | Replik `triggerCore` entfernt, Import + B(h) auf echte Fn umgestellt |
| `test/bk3-auto-provision.test.js` | neu | 5 Tests (T1/T2/T3/T3b/T4) |

### Deviations
1. **node_modules-Symlink (Worktree-Falle):** `ln -s ./node_modules node_modules` erzeugte einen self-referentiellen (ELOOP) Symlink -> `node --test` brach mit Exit 194 ohne Output ab. Symlink auf das `node_modules` des Haupt-Repos umgebogen (absolut, gitignored, **nicht committed**). Bekannte Falle (siehe Projekt-MEMORY).
2. **B(h)-Refactor:** Plan zeigte Inline-Ersetzung; stattdessen lokale `const opts` genutzt, um das Options-Objekt nicht zu duplizieren (kleinere G5-Sauberkeit, Verhalten identisch).
3. **Stale Header-Kommentar (C2):** Letzter Satz des `triggerTenantProvisioning`-Doc-Kommentars ("Diagnose ... ueber console") war nach `console.warn`->`audit` stale -> auf den Audit-Trail aktualisiert (gleiche Funktion, kein Scope-Creep).

---

## 4. Safety-Urteil — APPROVED

Selbst ausgefuehrt im frischen Worktree (node v25.9.0): `npm test` EXIT 0, 1067/1067 pass, ~54s. **Beide Backends in EINEM Lauf:** JSON-Store (`makeDefaultState`) UND Postgres-Store via pglite (Postgres-in-WASM, kein Netz) — RLS/WITH-CHECK/Multitenant/Tenant-Budget-Suites alle gruen. BK3-Tests T1–T4 gruen.

| Pruefung | Befund |
|---|---|
| Scope | Genau 4 Dateien, alle BK3; **keine neue npm-Dependency** (package.json/lock 0-Zeilen-Diff) |
| Safety-Gates intakt | Cap-tragende `requestNumber`, `config.js`, `webhook.js`, `locales.js`, `defaults.js` **byte-fuer-byte unveraendert**. Cap-Block -> `r.ok=false` -> kein `store.save`, return VOR `queueProvisioning` => kein Kauf bei Cap-Ueberschreitung. `PROVISIONING_ENABLED=false` bleibt Dry-Run |
| Disclosure intakt | `claude.js` + `bridge.js` 0-Zeilen-Diff; `disclosureSentence` unveraendert fest verdrahtet |
| Auth fail-closed | `triggerTenantProvisioning` laeuft erst NACH `verifyStripeSignature` (HMAC, fail-closed) + JSON-Parse; `PAYMENT_ENABLED` aus -> 404 byte-identisch; **kein neuer Endpunkt** |
| Secrets | `audit(..., null, tenant=<id> grund=<reason>)` loggt nur interne `tenantId` + Grund-Code; `req=null` -> ip=`system` (null-sicher). Kein Secret/Audio/PII |
| Behavior/Flag-Off | `requestNumberForPaidTenant` verhaltens-identisch zur Inline-Komposition; einzige Delta: `console.warn`->`audit` = exakt die Spec-Forderung |

**Nicht-blockende Concerns:**
- Die Audit-**Emission** selbst (`console.log` via `util.audit`) wird in keinem Unit-Test asserted — T3/T3b pruefen nur den Decision-Contract (`reason=tenant_cap/global_cap`). Emissions-Pruefung auf BK5/Smoke geschoben (console-Output-Asserts sind bruechig). Bis BK5 ruht "Audit wird wirklich geschrieben" auf Code-Inspektion.
- T4 ruft den echten Core ueber ein `provision`-Double auf gemeinsamem State; voller Server-Trigger (`withStoreLock` + `store.save` + `queueProvisioning`) ist P3-Integration/Smoke-abgedeckt, nicht im Unit-Test (Repo-Konvention: kein Server-Spawn).
- Diff ist **kleiner** als die in der Spec gelistete Datei-Liste (`webhook.js`/`provisioning.js`/`store.js`) — korrekt, kein Scope-Mangel: die Webhook->provision-Verkettung existierte bereits in P3; BK3 schliesst die eine offene Luecke.

---

## 5. Clean-Code-Audit — PASS (kein Blocker)

| Stufe | Findings |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** (Minor) | 3 (s.u.) |
| **S4** (Nit) | keine |

**S3-Findings (alle nicht-blockend):**
1. `C4-1` · `provision-trigger.js` Header Z.5 · Bezeichnung "Pure" leicht ungenau — Fn mutiert `s` (push via `requestNumber`). Qualifier praezisiert IO-Freiheit, aber "Pure" suggeriert Seiteneffekt-Freiheit. Vorschlag: "IO-frei (mutiert nur s)". Bagatelle (Konvention wie bestehendes `requestNumber`).
2. `T3/P14-1` · BK3-T2 vs p3 B(h) · Idempotenz in zwei Files nahezu identisch geprueft. **Reine Test-Redundanz, kein S2** (keine Produktions-Duplizierung). Dokumentarischer Wert rechtfertigt Beibehaltung.
3. `C3-info` · `provision-trigger.js` + `server.js` · hohe Kommentar-Dichte vor `audit`-Call — begruendet nicht-offensichtliches "Warum" (`req=null`, `audit` statt `warn`, einzige Quelle), traegt Wert -> nicht geflaggt, nur Hinweis.

**Verdict-Notiz:** Saubere G5/S2-Verbesserung — Komposition (Guard + `requestNumber`) jetzt EINE Quelle, die Produktion + beide Tests nutzen. F1 per Options-Objekt geloest. Caps durchgereicht und in `requestNumber` durchgesetzt, Idempotenz-Guard bewahrt. `PROVIDER.TELNYX` explizit korrekt. Sicherheits-Netto-Plus: `console.warn` -> `audit` (PII-frei, forensischer Trail). Ungenutzte Imports korrekt entfernt. 14/14 node-Tests, node --check sauber. Diff-Basis == master HEAD (merge-base 45cd103).

**Top-Todos (optional, kein Merge-Blocker):**
- "Pure" im Header von `provision-trigger.js` praeziser fassen.
- Redundante Idempotenz-Assertion BK3-T2 vs p3-B(h) konsolidieren (niedrige Prio).

---

## 6. Fix-Runden

**Keine.** Beide Reviews (Safety + Clean-Code) gaben in **Runde 1** PASS/APPROVED ohne Blocker (S1/S2 leer). Self-Fix-Schleife nicht ausgeloest. Die drei S3-Findings sind optional und wurden bewusst nicht nachgezogen (Bagatellen / dokumentarischer Wert).

---

## 7. Cleancode-Self-Check (Auszug Impl)

G5/S2 Decision-Core extrahiert, Replik retired · G12 ungenutzte Imports entfernt (0 Rest-Refs verifiziert) · P5/P6 Core ist reine Query (kein save/config/Audit/Log) · P15 `store.save()` bleibt in server.js · F1 2 Args (state + Options) · G25 Test-Konstanten `HIGH`/`SECRET`/`NOW` benannt · C2 stale Header korrigiert · C5/G9 kein toter/auskommentierter Code · N7 nebeneffekt-freier Name · ESM, kein Build-Step, deutsche Kommentare ohne Umlaute. Safety-Gates (Caps, Dry-Run-Gate, Money-Safety, Disclosure, Signaturpruefung) unveraendert; `provision(tenant)`-Seam-Signatur stabil.
