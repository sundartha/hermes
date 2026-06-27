# Phase BK4 — Detailbericht

**Phase:** BK4 — Dashboard: Rufnummer + Plan + Kontingent
**Gate:** **PASS**
**finalBranch:** `phase/bk4-dashboard-quota`
**Commit:** `21c4a99` (`21c4a999139be0d92603bf3b978ea7346407bc48`)
**Tests:** 1082 pass / 0 fail (beide Backends: json + pglite)

---

## 1. Ziel & Scope

Im Tenant-Dashboard sollen **Rufnummer**, **Plan** und das **Minuten-Kontingent des laufenden Abrechnungszeitraums** sichtbar sein.

Ist-Befund (code-gegroundet): Rufnummer (`#agentNum` <- `agent.number`) und Planname (`renderSubscription`) waren bereits vorhanden. **Net-new End-to-End = die Kontingent-Ableitung (Backend) + eine Anzeige-Zeile (Frontend).** Reiner Read, gegated über das bestehende `paymentEnabled`. Kein Geld-Flow, kein neuer Calls/SMS-Endpunkt.

---

## 2. Plan (gekürzt)

Ableitungskette aus bestehenden Quellen, additive Edits in den Heimat-Modulen (G17 — „wo würde jemand das suchen"), keine neuen Quelldateien:

| Edit | Datei | Inhalt |
|---|---|---|
| **E1** | `src/plans.js` | `findPlan(slug)` — Katalog-Lookup (`PLAN_CATALOG.find ?? null`), kapselt das Array. Liefert `includedMinutes`. |
| **E2** | `src/store/state-ops.js` | `voiceMinutesUsedSince(s, tenantId, sinceIso)` — Sibling zu `dailySmsCount`, summiert `quantity` aller `kind=VOICE_MINUTE`-Events des Tenants im Fenster (`reduce`-Sum statt `length`). |
| **E3** | `src/billing/meter.js` | `periodStartIso(currentPeriodEndSec)` (s->ms-Brücke, `setUTCMonth(-1)`) + `quotaView(s, {tenantId, planSlug, currentPeriodEnd})` -> `{includedMinutes, usedMinutes, remainingMinutes}` (`Math.max(0,...)`-Klemme). |
| **E4** | `src/self-service-routes.js` | `paymentView` um `quota: quotaView(store.load(), {...})` erweitert. Kein Abo -> `null`; `PAYMENT_ENABLED` aus -> Key fehlt komplett (byte-identisch). |
| **E5** | `public/tenant.html` | `#quotaLine` + `renderQuota(quota)` — Zeile „X von Y Minuten verbleibend"; versteckt bei fehlendem `quota` (auch im Aktivierungs-Pfad). |

**Bewusste Vereinfachung (im Code + Commit dokumentiert):** `current_period_start` wird nicht persistiert -> Perioden-Start = `currentPeriodEnd` minus 1 Monat (einzige Katalog-Kadenz). Monatsletzten-Überlauf um wenige Tage akzeptiert, weil **Anzeige, kein Gate** (harter Cap bleibt `budgetExceeded`). Folge-Ticket benannt: `current_period_start` persistieren (PLAN §10).

**Bewusst NICHT gemacht:** `dailySmsCount` nicht zu geteiltem Helfer umgebaut (toll-fraud-kritischer SMS-Cap-Pfad H1 nicht in einer Anzeige-Phase anfassen); `apps/web/src/lib/plans.js`-Mirror unberührt (deepEqual-Test prüft nur `PLAN_CATALOG`, `findPlan` ist Backend-only Zusatz-Export).

**Tests (Plan):** T1 `bk4-quota-view.test.js` (pure unit, fixe `occurredAt`, kein `Date.now`) + T2 `bk4-self-service-quota.test.js` (Route-Level, pglite, Muster `w4-self-service-subscribe`).

---

## 3. Implementierung — Zusammenfassung

Exakt plan-konform umgesetzt:

- **5 additive Quelldatei-Edits** (E1–E5) + **2 neue Testdateien** (T1/T2).
- Keine neuen npm-Dependencies, keine DB-Migration, Store-Fassade `store.js` unberührt (`meter.js` importiert `voiceMinutesUsedSince` direkt aus `state-ops.js`, wie schon `pendingMeterEvents`).
- `node --check` exit 0 auf alle 6 `.js`-Dateien.
- Neue Tests **15/15 grün** (11 Unit + 4 Route-Level). Gesamtsuite **1082 pass / 0 fail**.
- HTML-Marker `id="quotaLine"` per grep verifiziert (count=1) + `renderQuota`-Funktion vorhanden.

**Verifikations-Substanz:** T2 startet den echten `makeSelfServiceRoutes`-Handler in-process (pglite) und asserted das `quota`-Objekt in der `GET /state`-JSON-Response inkl. `PAYMENT_ENABLED`-aus-Pfad und Cross-Tenant-Isolation.

### Deviations

1. **Live-Server-curl-Smoke nicht ausgeführt** (`smokePass=false`): boot-guard ist fail-closed — `src/server.js` verweigert den Start ohne persistierte aktive Nummer im Store plus echte Provider-/Stripe-Secrets; der Bootstrap-Seed persistierte nicht in einem Schuss ins Temp-`DATA_DIR`. Plan-konform best-effort, **kein Blocker** — Backend-Route stattdessen in-process via pglite-Integrationstest (T2) verifiziert, HTML-Marker per grep.
2. Sonst exakt gemäß Plan, keine weiteren Abweichungen.

---

## 4. Safety-Urteil

**APPROVED** (Tests unabhängig reproduziert: 1082/1082 gesamt, 15/15 BK4, beide Backends).

| Kriterium | Status |
|---|---|
| Safety-Gates intakt | ja — kein neuer Calls/SMS/Geld-Endpunkt; `numberGateError`/Budget/Disclosure/Auth nicht angefasst |
| Disclosure intakt | ja — `claude.js` + `bridge.js` byte-identisch |
| Auth fail-closed | ja — kein neuer Endpunkt; `quota` an bestehender `webAuthMw`-Route, session-tenant-gefiltert |
| Keine Secrets/IDs geleakt | ja — `subscriptionId` bewusst draußen; Response trägt nur aggregierte Minuten (kein `cus_`/`sub_`/`pm_`, keine PII) |
| Scope respektiert | ja (mit dokumentierter, minimaler Erweiterung, s.u.) |
| Verhalten wie beabsichtigt | ja — flag-off byte-identisch (`paymentView` -> `{}`), kein Client-Rechnen |

**Concerns (alle Non-Blocker):**
1. **Scope-Erweiterung:** Spec nannte nur `self-service-routes.js`, `billing/meter.js`, `tenant.html` — impl berührt zusätzlich `src/plans.js` (`findPlan`) und `src/store/state-ops.js` (`voiceMinutesUsedSince`). Minimal, sauber gekapselt, kein Feature-Creep.
2. **Monats-Fenster-Näherung:** dokumentiert/akzeptiert, Anzeige statt Gate, Folge-Ticket benannt.
3. **Minor:** `paymentView` macht zwei Store-Reads (`tenantSubscription` + `load`) — reine Lese-Sicht, keine Korrektheits-/Konsistenz-Folge.

**Pre-Mortem:** Anzeige-Fehler-Risiko = Monatsfenster-Approximation -> Verbrauch um wenige Tage falsch gefenstert. Akzeptiert (Anzeige, kein Gate). Zweites Risiko: `usedMinutes` versehentlich nur `pendingMeterEvents` zählen (Unterzählung nach Flush) -> durch Testfall T1.7 + Code-Kommentar fixiert (Flush-Marker ist Abrechnungs-Flag, KEINE Perioden-Grenze).

---

## 5. Clean-Code-Audit (S1–S4)

**Verdict: PASS — kein Blocker.** S1 leer, S2 leer, S4 leer.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (niedrig, optional):**
  - **BK4-S3-1** · `src/billing/meter.js` (`quotaView`): Reine Lese-/Ableit-View liegt im Flush-Modul, dessen Header nur „Stripe-Metering-Flush" deklariert (mild P2/G17, zweite verwandte Verantwortung). Fix-Option: `quotaView`+`periodStartIso` nach `views.js`/neben `voiceMinutesUsedSince` in `state-ops.js` verschieben ODER Modul-Header um die Read-View-Verantwortung erweitern.
  - **BK4-S3-2** · `quotaView` return: `usedMinutes` ist Teil des View-Objekts, wird von der aktuellen UI (`renderQuota` zeigt nur `remaining`/`included`) nicht angezeigt. Fix-Option: belassen (getesteter View-Vertrag, kein toter Code) oder als API-Reserve kommentieren — niedrigste Prio.
- **S4 (Fragmentierung):** keine.

**Geprüft & sauber:** Magic Numbers benannt (`MS_PER_SECOND` in meter.js, `SECONDS_PER_DAY` im Test statt 1000/86400, G25); Monatsfenster via `setUTCMonth(-1)` (Ausnahme -1) + Kommentar; Geld/Minuten als Ganzzahl, kein Float (G26); `remainingMinutes` `Math.max(0,...)`-geklemmt; alle Funktionen ≤2 Argumente bzw. Sibling-Signatur (F1); reine Reads ohne verschwiegene Nebeneffekte (N7); keine stalen/auskommentierten/toten Zeilen, keine ungenutzten Imports (C2/C5/G9/G12); `?? null` statt undefined; ESM/kein Build/kein TS, alle Zeilen ASCII-clean (umlaut-frei). `findPlan` kapselt das Array-`.find` (G17/G36).

**Watch (kein Flag):** `voiceMinutesUsedSince` und `dailySmsCount` teilen das Filter-Prädikat (`kind && tenantId && occurredAt>=since`) bei unterschiedlicher Aggregation (`length` vs. `reduce`-Sum) — heute idiomatisch/lesbar; bei einer 3. usage_event-Query Prädikat extrahieren, sonst belassen (Vorrang Lesbarkeit).

---

## 6. Fix-Runden

**Keine.** Beide Reviews (Safety + Clean-Code) liefen direkt grün — Safety `APPROVED` ohne Blocker, Clean-Code `PASS` mit ausschließlich optionalen S3-Hinweisen. Es waren keine Self-Fix-Iterationen nötig.

---

## 7. Betroffene Dateien

**Editiert (additiv):**
- `src/plans.js`
- `src/store/state-ops.js`
- `src/billing/meter.js`
- `src/self-service-routes.js`
- `public/tenant.html`

**Neu (Tests):**
- `test/bk4-quota-view.test.js` (11 Fälle, pure unit)
- `test/bk4-self-service-quota.test.js` (4 Fälle, pglite-Route)

**Unberührt:** `webhook.js`, `subscribe.js`, `schema.sql`, `pg.js`/`json.js`-Setter, `config.js`, `render.yaml`, `store.js`, `apps/web/src/lib/plans.js`.
