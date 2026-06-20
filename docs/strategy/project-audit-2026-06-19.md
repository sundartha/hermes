# Projekt-Audit 2026-06-19

> Vollstaendige Due-Diligence des `vodafone-agent` (Telefon-KI-Agent: Twilio/Telnyx Voice
> + Claude + MCP, Multi-Tenant SaaS, Express, Postgres+RLS, Stripe-Billing, Render-Deploy).
> Methode: 5 parallele Opus-Subagenten (Security, Architektur, Bugs/Reliability, Betrieb/
> Compliance, Tech-Debt) + eigene Vollverifikation der kritischen Pfade (`server.js`,
> `bridge.js`, `claude.js`, `config.js`, `web-auth.js`, `store/*`, `schema.sql`).
> Codebasis: ~6.700 LOC `src/`, 80 Test-Dateien. READ-ONLY-Analyse, kein Code geaendert.

## Kontext fuer die Severity-Kalibrierung (wichtig)

Der **Live-Betrieb laeuft heute** in einer bewusst engen Konfiguration: `VOICE_ENGINE=budget`
(nicht `realtime`), `PAYMENT_ENABLED=aus`, `MULTI_TENANT=aus`, **eine** Instanz, **ein** Owner.
Viele Findings sind daher **heute latent** und werden erst **scharf**, sobald der naechste
Schritt aktiviert wird (Multi-Tenant, Payment, Realtime, Skalierung). Jedes Finding ist mit
seinem „scharf-ab"-Trigger annotiert. Das ist die zentrale Einsicht des Audits: das System ist
**solide gebaut, aber bewusst fuer eine andere Groessenordnung** als „Millionen Nutzer".

---

## Executive Summary (max 10 Zeilen)

1. **Code-Qualitaet und App-Sicherheit sind ueberdurchschnittlich**: fail-closed Safety-Gates, RLS+FORCE, fest verdrahteter Outbound-Disclosure, timing-sichere Vergleiche, Webhook-Signaturpruefung, **0 npm-Schwachstellen**, sauber azyklischer Import-Graph, Port/Adapter-Trennung. **Keine CRITICAL/HIGH Code-Security-Luecke gefunden.**
2. **Die fundamentale Architektur-Grenze**: der gesamte Laufzeitzustand lebt als **In-Memory-Spiegel in EINEM Prozess** — explizit dokumentiertes Prototyp-Risiko, das Single-Instanz erzwingt und „Millionen Nutzer" blockiert. Die „globalen" Safety-Gates sind real nur **pro Instanz** global.
3. **Die schaerfsten Risiken HEUTE sind betrieblich**: Daten liegen per Default als JSON auf einem **fluechtigen Render-Free-FS ohne Backup** (garantierter Datenverlust bei jedem Redeploy); Migrationen laufen ungated im Laufzeit-Boot; `autoDeploy` ist von der CI **entkoppelt**; keine Observability (kein strukturiertes Logging/Metriken/Readiness/Alerting).
4. **Compliance-Luecken fuer EU/DE/Vodafone**: Inbound-KI-Offenlegung **nicht technisch erzwungen** (AI Act Art. 50); Audit-Trail unvollstaendig **und nicht manipulationssicher**; **keine dokumentierte AVV-/Datenresidenz-Kette** fuer Anthropic/Twilio/Telnyx/Stripe; PII per Klartext-SMS + temporaeres PII-Diagnose-Log noch live.
5. **Latente Multi-Tenant-Risiken**: ein **Cross-Tenant-IDOR** (`/api/action-items/:id/toggle` ohne Tenant-Scope), Haupt-DB-Pool ohne NOBYPASSRLS-Assertion, kein Stripe-Webhook fuer Billing-Reconciliation — alle harmlos owner-only, gefaehrlich ab Multi-Tenant/Payment.
6. **Zustands-Lifecycle-Bugs**: Max-Dauer-Timer ohne `clear`/`unref` (Leak + weiche Kosten-Obergrenze), nicht-persistente `finishCall`-Idempotenz (Doppel-Metering bei Retry/Neustart), `openaiWs.on("open")` ungeschuetzt (dormant hinter Realtime).
7. **Verdikt**: gut gehaerteter Owner-Prototyp/Demo; **nicht produktionsreif** fuer einen oeffentlichen Multi-Tenant-Betrieb unter Vodafone-Marke ohne die unten gelisteten P0/P1-Massnahmen.

---

## 1. Kritische Findings (Must-Fix vor naechstem Deploy)

> „Naechster Deploy" = der naechste produktive Schritt. Die mit **(heute)** markierten Findings
> sind bereits im aktuellen Owner-Betrieb scharf; die uebrigen blockieren den jeweils benannten
> naechsten Aktivierungsschritt.

| # | Finding | Severity | Area | Datei/Zeile | Scharf ab |
|---|---------|----------|------|-------------|-----------|
| F1 | **Datenverlust by-design**: Default `STORE_BACKEND=json` auf fluechtigem Render-Free-FS, keine DB-Backups, kein Persistent Disk, render.yaml hat keine `databases:`/`disk:`-Sektion. Jeder Deploy/Neustart/Spin-down loescht alle Calls, Summaries, Action Items, Budget-Zaehler, Audit-Spuren. | CRITICAL | Betrieb | `render.yaml:13,108-110`; `src/store/json.js:11,133` | **(heute)** |
| F2 | **Deploy-Governance**: Migrationen (`migrate()`) laufen erst beim ersten Request-Pfad im Laufzeit-Prozess (kein Pre-Deploy-Step, kein Schema-Versioning, kein Rollback); `autoDeploy:true` ist von der CI entkoppelt; `DEPLOY.command` macht `git add -A` + push **ohne** Test-Lauf. Roter Test kann live gehen. | CRITICAL | Betrieb/DevOps | `src/store/pg.js:50-57`; `render.yaml:14-17`; `DEPLOY.command:13-32`; `.github/workflows/ci.yml` | **(heute)** |
| F3 | **In-Memory-Spiegel = Single-Instanz-Deckel**: auch im pg-Backend ist die DB **nicht** Laufzeit-Source-of-Truth; `init()` hydriert EINEN globalen Spiegel, jede Mutation laeuft dagegen, `save()` flusht den **gesamten** Bestand (O(alle Daten) pro Write). Zwei Instanzen = divergierende Spiegel, die sich per Full-Flush ueberschreiben (Lost Updates). Selbst als „akzeptiertes Restrisiko P3b" dokumentiert. | CRITICAL | Architektur | `src/store/pg.js:14-17,33-72,434-468`; `src/store.js:53` | Multi-Instanz / Skalierung |
| F4 | **„Globale" Safety-Gates sind pro-Instanz**: Budget-Notaus und Stundenlimit zaehlen gegen den prozesslokalen Spiegel. N Instanzen → bis zu N-faches Budget/Stundenlimit verbrennbar, bevor ein Gate greift. Untergraebt CLAUDE.md „Absolute Regel 1" still bei Skalierung. | CRITICAL | Architektur/Safety | `src/server.js:301,423,696`; `src/store/state-ops.js:516-525` | Multi-Instanz |
| F5 | **Inbound-KI-Offenlegung nicht erzwungen**: der fest verdrahtete Disclosure-Satz greift **nur** Outbound (`server.js:504`, `bridge.js:120`). Inbound rendert das per `/api/settings` frei editierbare `settings.greeting` (Realtime-Inbound-Opener sagt nur „begruesse ihn"). Default-Greeting nennt „KI-Assistent", aber ein Operator kann ihn ohne KI-Hinweis ueberschreiben — kein technischer Riegel. | CRITICAL (Compliance) | Compliance | `src/server.js:441-448,505`; `src/claude.js:58-62,76-79`; `src/store/state-ops.js:680-691` | **(heute, Inbound)** |
| F6 | **Max-Dauer ist „weich" + Timer-Leak**: `armMaxDurationTimer` setzt `setTimeout` ohne `clearTimeout`/`.unref()` (Closure lebt die volle Max-Dauer, akkumuliert bei Last → Leak, blockiert sauberes Shutdown). Enforcement laeuft nur ueber `hangup → Provider-endCall (.catch(()=>{}) verschluckt Fehler) → erhofftes close`; schlaegt der Provider-endCall fehl (Telnyx ohne CallSid, Netz), laeuft der Call **ueber das Limit hinaus mit Kosten ausserhalb des Budget-Guards**. Widerspricht „Absolute Regel Max-Dauer". | CRITICAL (Kosten) | Bugs/Reliability | `src/server.js:389-396`; `src/bridge.js:74-96,245` | **(heute, budget+realtime)** |

---

## 2. Hoch-Prioritaere Findings (sollte zeitnah behoben werden)

| # | Finding | Severity | Area | Datei/Zeile | Scharf ab |
|---|---------|----------|------|-------------|-----------|
| H1 | **`DASHBOARD_PASSWORD` unset → `/api/*` komplett offen**: ist die Variable nicht gesetzt, wird die **gesamte** Basic-Auth-Middleware uebersprungen (`if (!config.dashboardPassword) return next()`); `assertConfig` **warnt nur**, bricht nicht ab. Eine vergessene Env oeffnet Dashboard + API (Calls, Profile, Settings) oeffentlich. | HIGH | Security/Betrieb | `src/server.js:205-222`; `src/config.js:240-258` | **(heute, bei Fehlkonfig)** |
| H2 | **Doppel-Metering**: `finishCall`-Idempotenz haengt allein am **nicht persistierten** `call._finished`; `recordVoiceMinuteMeter → recordUsageEvent` ist append-only **ohne** `callId+kind`-Dedup. Webhook-Retry ueber einen Prozess-Neustart oder konkurrierende `completed`/`cancel`/STOP-Trigger → doppelter Eintrag im Stripe-Ledger = doppelte Abrechnung. | HIGH | Bugs/Billing | `src/server.js:555-560,607-616`; `src/billing/meter.js` | `PAYMENT_ENABLED` |
| H3 | **Kein Stripe-Webhook / keine Signaturpruefung**: kein eingehender Billing-Event-Endpoint; async PaymentIntent-Statuswechsel, 3DS, Disputes, Refunds werden nie zurueckgespielt. Capture verlaesst sich auf synchrone HTTP-Antworten → Geld/Leistung divergiert. | HIGH | Betrieb/Billing | `src/billing/stripe.js` (kein `constructEvent`/`whsec` im `src/`) | `PAYMENT_ENABLED` |
| H4 | **Audit-Trail unvollstaendig + nicht manipulationssicher**: `audit_log` ist als „immutable append-only" kommentiert, technisch aber normale Tabelle ohne `REVOKE UPDATE/DELETE`, ohne RLS. Zentrale Sicherheitsevents (`place_call_denied`, `auth_failed`, `settings_update`, `inbound_unrouted`) gehen via `util.audit` **nur nach stdout** (fluechtig). Keine definierte Aufbewahrungsfrist fuer Audit-Daten. | HIGH | Compliance | `src/db/schema.sql:238-249`; `src/util.js:13-15`; `src/audit-store.js` | **(heute)** |
| H5 | **Keine Observability**: nur unstrukturiertes `console.*` (55 Stellen), kein JSON-Logging/Level/Korrelations-ID, keine Metriken, kein `/readyz` (das `/healthz` prueft **nicht** DB/Store-Init, wird aber als `healthCheckPath` genutzt → „healthy" trotz nicht-initialisiertem Store), **kein Alerting** bei Budget-Breach/Fehlerrate. | HIGH | Betrieb/DevOps | `src/server.js:136`; `src/util.js:13-15`; `render.yaml:16` | **(heute)** |
| H6 | **Keine AVV-/Datenresidenz-Kette**: `region:frankfurt` steuert laut eigenem Kommentar nur den App-Server; DB-Region haengt am externen `DATABASE_URL` (nicht erzwungen). Transkripte/Anruferinhalte gehen an Anthropic + Twilio/Telnyx-STT/TTS (Deepgram, USA-Drittlandtransfer). Kein DPA/AVV, keine SCC/Adequacy-Doku, kein Verzeichnis der Verarbeitungstaetigkeiten, keine TOMs im Repo. | HIGH | Compliance | `render.yaml:6-11`; `.env.example`; `src/claude.js` | Echte Fremd-Tenants |
| H7 | **CI-Luecken**: nur `node --check` + `npm test` + `npm audit`. **Kein** ESLint (trotz Clean-Code-Pflicht), **kein** Coverage-Gate, **kein** Secret-Scanning (gitleaks), **kein** SAST (CodeQL/semgrep), Trigger `on: push` ohne PR-/Branch-Protection-Gate. Der manuelle „Killer-Test" (Tenant-Isolation) ist **nicht** in der Pipeline erzwungen. | HIGH | DevOps | `.github/workflows/ci.yml` | **(heute)** |
| H8 | **`server.js` God-File (1107 LOC)**: vermischt Wiring, Auth/Tenant-Aufloesung, Outbound-Gates, alle `/voice`-Handler, ~10 `/api`-Routen, Onboarding+inline Provisioning-Drain, Metering-Helfer, MCP-Transport, Retention-Loop. Struktureller Rekurrenz-Treiber: OT-1..OT-5 landen immer wieder hier (11 dokumentierte Fix-Touches). | HIGH | Architektur/Tech-Debt | `src/server.js` (gesamt) | **(heute, Wartbarkeit)** |
| H9 | **OpenAI-Realtime-Event-Pfad ohne Unit-Coverage**: der riskanteste Code (1 Prozess bedient alle Calls; ein Throw killt alle) — Barge-in, `response.done`/Tool-Loop, Transkript-Cases — haengt am manuellen Real-Call-Smoke. `handleOpenAiEvent`-Extract (testbar) ist als P4-Follow-up offen. | HIGH | Tech-Debt/Test | `src/bridge.js:126-211` | `VOICE_ENGINE=realtime` |
| H10 | **`uncaughtException` laeuft weiter statt Exit** (TD-7): bewusster Backstop (Exit = alle Calls weg), maskiert aber die ungeschuetzten Throw-Quellen (s. M1). Der „echte" quellseitige Fix ist P3. | HIGH | Reliability | `src/process-guards.js` | **(heute)** |

---

## 3. Architektur & Design-Schulden

**Gesamtbild:** Die *Modul*-Architektur ist fuer einen Prototyp ungewoehnlich reif — Import-Graph
azyklisch (verifiziert), Port/Adapter-Trennung (Telephony/Queue/Billing/Store) konsequent,
Fachlogik **einmal** in `state-ops.js` (keine Backend-Drift), Tenant-Kontext sauber
**request-scoped** (`requestTenant(req)`, kein globaler mutabler Tenant-State → keine
Cross-Contamination auf Request-Ebene). Die Probleme liegen fast alle auf der **Skalierungs-/
State-Achse**, nicht in der Modulstruktur.

| # | Schuld | Sev | Datei/Zeile | Wirkung |
|---|--------|-----|-------------|---------|
| A1 | Call-Laufzeitzustand (OpenAI-WS, Timer, `activeResponse`, `_finished`) lebt nur in Prozess-Closures / In-Memory; kein Sticky-Routing, kein Shared-State | CRITICAL (Scale) | `src/bridge.js:62-71`; `src/server.js:389,556` | Ohne Sticky landet `/voice/turn` ggf. auf falscher Instanz → Abbruch; Crash/Redeploy killt alle Calls + verliert Max-Dauer-Timer |
| A2 | `withStoreLock` ist In-Process-Mutex; schuetzt **keine** Multi-Instanz-Writes; zweite, unkoordinierte `flushChain` in pg.js | CRITICAL (Scale) | `src/store.js:109-131`; `src/store/pg.js:37` | Onboarding-Cap (maxNumbers) nicht mehr atomar → Doppel-Nummernkauf (Toll-Fraud) |
| A3 | Full-Spiegel-Flush bei **jeder** Mutation (Transkript-Append im Hot-Path → Dutzende SQL ueber den Gesamtbestand) | HIGH | `src/store/pg.js:64-72,541-561` | Write-Amplification waechst mit Gesamtgroesse, nicht Delta; PgBouncer/Replicas helfen nicht |
| A4 | `state-ops.js` (731 LOC) + `pg.js` (731 LOC) buendeln je 12 Domaenen | HIGH | `src/store/state-ops.js`, `src/store/pg.js` | Jede neue Entitaet erzwingt parallele Edits in 4-5 Dateien |
| A5 | MCP-Tools rufen die **eigene** REST-API per HTTP-Selbstaufruf (`fetch(localhost)`), Identitaet ueber `X-Internal-Identity`-Header + localhost-Socket-Check | HIGH | `src/mcp-tools.js:6,11-22`; `src/server.js:52-56` | „localhost" ≠ dieselbe Instanz hinter LB; doppelte Serialisierung; Sicherheit haengt am Socket-Check |
| A6 | Telnyx/Twilio-Adapter ziehen Credentials direkt aus dem globalen `config`-Singleton (Twilio: Modul-Singleton `let client`, TD-1) | MEDIUM | `src/telephony/adapters/**`; `twilio/client.js:6` | Per-Tenant-Provider-Subaccounts (echter SaaS-Bedarf) ohne Adapter-Umbau unmoeglich |
| A7 | Rate-Limiter + JWKS/OIDC-Discovery-Cache sind prozesslokale Maps/Singletons | MEDIUM | `src/middleware.js:32-55`; `src/auth.js:42`; `src/web-auth.js:191-208` | Effektives Rate-Limit = N×Limit; mehr IdP-Traffic, inkonsistente Key-Rotation |
| A8 | Zwei `pg.Pool` (Owner + Portal), Default-Poolgroesse, Transaktionen + `SET LOCAL` (RLS-GUC) | MEDIUM | `src/store.js:13-44`; `src/portal-pool.js:51` | N Instanzen × 2 Pools × 10 Conns sprengt Postgres-Limit; PgBouncer (transaction mode) ist Pflicht, aber nur als Betriebs-ToDo dokumentiert (bricht mit statement-pooling wegen `SET LOCAL`) |
| A9 | Profile global keyed-by-email (nur unter Owner-Tenant persistiert) statt tenant-isoliert | MEDIUM | `src/store/pg.js:333-336,625-635` | Global geteilter mutabler Namespace → Kollision bei echten Fremd-Tenants |

**Die 3 wichtigsten Refactoring-Hebel** (Reihenfolge = Hebelwirkung):
1. **Source-of-Truth von In-Memory-Spiegel → echte per-Request-DB-Queries** (loest F3+F4+A3 in einem Zug): globalen `state` eliminieren, Store-Funktionen async, gezielte Delta-Writes, Gates als DB-Aggregat-Queries. Unausweichlich vor Multi-Instanz.
2. **Call-Laufzeitzustand externalisieren + Caps atomar in der DB** (loest A1+A2): Status/Deadlines in DB/Redis, Max-Dauer ueber verteilten Scheduler, Caps per `INSERT ... WHERE (count) < cap` / Advisory-Lock.
3. **`server.js` dekomponieren + MCP-Service-Layer** (loest H8+A5): P4-Decomposition fortsetzen (Gate-Kette, `/voice`, `/api`-Gruppen, Worker raus), MCP-Tools direkt an die Domaene binden statt `fetch(localhost)`.

---

## 4. Fehlende Features fuer Produktionsreife

**Fuer oeffentlichen Multi-Tenant-Betrieb mit echten Fremd-Nutzern fehlt:**
- **Remote-Browser-OAuth fuer Self-Service** — `req.auth` liegt nur auf `/mcp`; Self-Service funktioniert remote noch nicht, nur localhost (I9, bewusst deferred, im Status getrackt).
- **Durable Queue** — `QUEUE_BACKEND=memory` ist prozesslokal; der Geld-Pfad (Nummernkauf, fire-and-forget `void runProvisioningDrain()` nach der HTTP-Response) ist nicht crash-sicher; pg-boss-Adapter ist ein werfender Stub.
- **Stripe-Webhook + Reconciliation** (H3), **idempotentes Metering** (H2), **atomare Caps** (A2).
- **Tenant-isolierte Profile** (A9) und **per-Tenant-Provider-Credentials** (A6).

**Compliance (DSGVO / EU AI Act / TKG) — vorhanden vs. fehlend:**
- ✅ Vorhanden: dokumentiertes Loeschrecht (`scripts/erase-tenant.js`, Art. 17), Export (Art. 15/20, `exportTenantData`), Datenminimierung (Roh-Transkript-Purge nach Summary), `region:frankfurt` als EU-Default, Outbound-Disclosure fest verdrahtet.
- ❌ Fehlt: **erzwungene Inbound-Disclosure** (F5, AI Act Art. 50(1)); **AVV-/Drittland-Kette** (H6, Art. 28 / Kap. V); **manipulationssicherer + vollstaendiger Audit-Trail** mit Aufbewahrungsfrist (H4, Art. 5(2)/30); **Einwilligungs-/Hinweis-Nachweis** fuer die Verarbeitung des Gesprochenen (TKG, beide Richtungen); EU-AI-Act Art. 50(2) maschinenlesbare KI-Markierung (ab 08/2026, bewusst vertagt).
- ⚠️ PII-Hygiene: Summary geht als **unverschluesselte SMS** an `OWNER_NUMBER`; temporaeres `[turn-recv]`-Diagnose-Log (Feldnamen+Laengen) noch live; `/mcp`-Log enthaelt Klartext-E-Mail.

**Monitoring/Observability & DR:** kein strukturiertes Logging/Metriken/Readiness/Alerting (H5); keine Postgres-Backups/PITR, kein Persistent Disk, kein RTO/RPO, keine Restore-Prozedur (F1). Free-Plan-Spin-down → Cold-Start beim ersten Anruf riskiert Webhook-Timeout (stummer Erstanruf).

---

## 5. Betrieb & DevOps

- **Deployment-Risiken** (F2): Runtime-Migrationen ohne Gate/Rollback/Versioning; `autoDeploy` von CI entkoppelt; `DEPLOY.command` pusht blind via `git add -A`. **Empfehlung:** Migrationen in `preDeployCommand` mit Exit-Gate; versioniertes Migrations-Tooling; Branch-Protection (required checks) auf `master`; Deploy nur nach gruener CI; bezahlter Always-on-Plan (Voice-Latenz).
- **Konfigurations-Management:** ~50 Env-Vars, stark flag-gesteuert; `assertConfig` ist bei echten Pflicht-Vars/Zahlen **fail-closed** (gut), warnt aber nur bei sicherheitskritischen Schaltern (`DASHBOARD_PASSWORD` fehlt → H1, `SKIP_TWILIO_SIGNATURE_CHECK`, `MCP_AUTH=off`, http-Issuer). **Empfehlung:** bei gesetztem `RENDER_EXTERNAL_URL` (= Produktion) diese Footguns als **FATAL** (Boot-Refusal), nicht nur Warnung; Konfig-Smoke-Test (`.env.example` ↔ `render.yaml` ↔ `config.js`) in CI.
- **Secrets-Management:** ✅ sauber — keine committeten Secrets (Git-History verifiziert), `.mcp.json` nutzt `${RENDER_API_KEY}`-Expansion, `render.yaml` korrekt `sync:false`/`generateValue`, `.gitignore` deckt `.env`/`data/`/`.twilio-recovery-code`. ⚠️ Offen: keine Rotationsroutine, `RENDER_API_KEY`-Scope/Least-Privilege ungeklaert (Runbook Gate 7).
- **Skalierung:** Single-Instanz nicht erzwungen; Retention-`setInterval` + In-Memory-Queue laufen pro Prozess (bei >1 Instanz inkonsistent). **Empfehlung:** Single-Instanz dokumentieren/erzwingen bis F3/A1/A2/durable-Queue stehen; Retention als externer Cron.

---

## 6. Pre-Mortem: Was kann in 12 Monaten schiefgehen?

1. **„Wir sind live gegangen und haben Kundendaten verloren."** F1 wurde nie geschlossen; ein Render-Redeploy (oder Free-Plan-Spin-down) hat den JSON-Store/das ephemere FS geleert. Keine Backups, kein Restore. **Mitigation:** F1 + DR-Konzept vor jedem produktiven Onboarding.
2. **„Die Telefonkosten sind explodiert."** Drei Wege: (a) F6 — ein Telnyx-Outbound ohne CallSid/mit fehlgeschlagenem `endCall` lief ueber die Max-Dauer hinaus; (b) F4 — bei mehreren Instanzen war der „globale" Budget-Notaus nur pro Instanz wirksam; (c) H1 — `DASHBOARD_PASSWORD` war vergessen, `/api/calls` offen, fremde Outbound-Calls ausgeloest. **Mitigation:** F4/F6/H1.
3. **„Ein Tenant hat Daten eines anderen gesehen/veraendert."** Multi-Tenant wurde aktiviert, aber der IDOR (M2) auf `/api/action-items/:id/toggle` und der fehlende NOBYPASSRLS-Check des Haupt-Pools (M3) blieben — eine geratene ID genuegte. **Mitigation:** M2+M3 vor `MULTI_TENANT=true`.
4. **„Eine Aufsichtsbehoerde hat abgemahnt."** Inbound-Anrufer wurden nie ueber die KI informiert (F5); der Audit-Trail war luckenhaft/manipulierbar (H4); keine AVV-Kette fuer Anthropic/Twilio (H6). **Mitigation:** F5/H4/H6.
5. **„Der ganze Dienst ist beim Redeploy gecrasht."** Eine fehlerhafte Schemaaenderung kippte beim Laufzeit-Boot (F2); kein Rollback. Oder: Realtime wurde scharfgeschaltet und ein Throw aus dem ungeschuetzten `openaiWs.on("open")` (M1) killte den Prozess (= alle Calls). **Mitigation:** F2 + M1/H9 vor Realtime.
6. **„Das System liess sich nicht ueber eine Instanz hinaus skalieren."** Der In-Memory-Spiegel (F3) war nie aufgeloest; jeder Skalierungsversuch fuehrte zu Lost Updates. **Mitigation:** Refactoring-Hebel 1+2 als eigenes Programm vor jedem Wachstumsversprechen.

---

## 7. Aufgabenvorschlaege (fuer parallele Abarbeitung)

> Format je Aufgabe: **ID · Prio · Komplexitaet · Dateien · parallelisierbar**.
> Komplexitaet ∈ {TRIVIAL, NORMAL, KOMPLEX}. Sortiert P0 → P1 → P2.
> P0 = vor naechstem produktivem Schritt / heute scharf. P1 = vor Multi-Tenant/Payment/Realtime.
> P2 = Tech-Debt/Qualitaet, jederzeit.

### P0 — vor naechstem Deploy / heute scharf

- **T-P0-1 · Datenhaltung fail-closed + Backups** · KOMPLEX · `src/config.js`, `src/store.js`, `render.yaml`, neue DR-Doku · **nein** (Infra+Boot)
  Boot-Refusal wenn `RENDER_EXTERNAL_URL` gesetzt + `storeBackend=json`; Managed Postgres (EU/DE) mit automatischen Backups+PITR; RTO/RPO + Restore-Runbook. *(Loest F1.)*
- **T-P0-2 · Deploy-Gate haerten** · NORMAL · `.github/workflows/ci.yml`, `render.yaml`, `DEPLOY.command` · **ja**
  Migrationen in `preDeployCommand` mit Exit-Gate; Branch-Protection + required checks; Deploy an gruene CI koppeln; `DEPLOY.command` nicht blind `git add -A`. *(Loest F2 + Teil H7.)*
- **T-P0-3 · Max-Dauer hart + Timer-Lifecycle** · NORMAL · `src/server.js:389-396`, `src/bridge.js:74-96,245` · **ja**
  Timer-Handle am Call speichern + in `finishCall`/`finalize` clearen + `.unref()`; nach `hangup()` Watchdog, der `finalize()`/Provider-Abbruch hart erzwingt; `endCall`-Fehler loggen statt schlucken; Inbound-Doppel-Arm vermeiden. *(Loest F6.)*
- **T-P0-4 · Inbound-KI-Offenlegung erzwingen** · NORMAL · `src/server.js:441-448`, `src/store/state-ops.js:680-691`, `src/claude.js` · **ja**
  Disclosure als nicht-abschaltbaren ersten Knoten auch fuer Inbound (analog Outbound) **oder** server-seitig erzwingen, dass jedes `greeting` den Pflicht-Hinweis enthaelt (Validierung in `updateSettings`). *(Loest F5.)*
- **T-P0-5 · `DASHBOARD_PASSWORD` fail-closed** · TRIVIAL · `src/config.js:240-258`, `src/server.js:205-222` · **ja**
  Bei gesetztem `RENDER_EXTERNAL_URL` fehlendes `DASHBOARD_PASSWORD` (sowie `MCP_AUTH=off`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, http-Issuer) als FATAL behandeln (Boot-Refusal statt Warnung). *(Loest H1.)*
- **T-P0-6 · Observability-Basis** · NORMAL · `src/util.js`, `src/server.js:136`, `render.yaml:16` · **ja**
  JSON-Logger mit Levels + Korrelations-/Call-ID; `/readyz` das Store/DB prueft (als `healthCheckPath`); Alerting auf Budget-Breach + Fehlerrate; sicherheitsrelevante `audit()`-Events zusaetzlich in `audit_log` persistieren. *(Loest H5 + Teil H4.)*
- **T-P0-7 · PII-Hygiene** · TRIVIAL · `src/server.js:457-459,1092-1095,585-595` · **ja**
  `[turn-recv]`/`[boot]`-Diagnose-Logs hinter Debug-Flag oder entfernen (an Live-Test 1b gekoppelt); `/mcp`-Log-E-Mail hashen/kuerzen; SMS-Summary minimieren oder durch Portal-Abruf ersetzen.

### P1 — vor Multi-Tenant / Payment / Realtime

- **T-P1-1 · Cross-Tenant-IDOR schliessen** · TRIVIAL · `src/server.js:855-859`, `src/store/state-ops.js:246-250` · **ja**
  `/api/action-items/:id/toggle` ueber `callId → call.tenantId` gegen `requestTenant(req)` absichern (404 bei Fremd-Tenant); `toggleActionItem` ein `tenantId`-Argument geben. *(Loest M2.)*
- **T-P1-2 · Haupt-DB-Pool NOBYPASSRLS** · TRIVIAL · `src/store.js:13-44`, `src/portal-pool.js:16-58` · **ja**
  Bestehendes `assertNoBypassRls` auch im Haupt-Store-Init fail-closed laufen lassen. *(Loest M3.)*
- **T-P1-3 · Stripe-Webhook + idempotentes Metering** · KOMPLEX · `src/billing/*`, `src/server.js`, `src/store/state-ops.js` · **ja (2 Teil-Tasks)**
  Signaturverifizierter Stripe-Webhook (`payment_intent.*`, `charge.dispute.*`) + Reconciliation; `recordUsageEvent` per `callId+kind`-Idempotenzschluessel dedupen (oder persistiertes `metered`-Flag). *(Loest H2+H3.)*
- **T-P1-4 · Realtime-`open`-Handler haerten + `handleOpenAiEvent`-Extract** · NORMAL · `src/bridge.js:104-211` · **ja**
  `openaiWs.on("open")` in try/catch + `if (closed || !call) return;`; Event-Handler als reine, injizierbare Funktion extrahieren und offline unit-testen (Barge-in/Tool-Loop/Race). *(Loest M1+H9, senkt Verschachtelung.)*
- **T-P1-5 · Source-of-Truth-Umbau (Spiegel → DB-Queries)** · KOMPLEX · `src/store/pg.js`, `src/store/state-ops.js`, `src/store.js`, alle Caller · **nein (Kern, solo)**
  Globalen `state` eliminieren; Store-Funktionen async; gezielte Delta-Writes; Budget-/Rate-Gates als DB-Aggregat-Queries. *(Loest F3+F4+A3, Fundament fuer Scale.)*
- **T-P1-6 · Call-State externalisieren + atomare Caps** · KOMPLEX · `src/bridge.js`, `src/server.js`, `src/store/*` · **nein (folgt T-P1-5)**
  Call-Status/Deadlines in DB/Redis; Max-Dauer via verteiltem Scheduler; Onboarding-Caps atomar in SQL. *(Loest A1+A2.)*
- **T-P1-7 · Durable Queue + Provisioning-Drain entkoppeln** · KOMPLEX · `src/queue/adapters/pgboss/queue.js`, `src/worker/provisioning.js`, `src/server.js:985` · **ja**
  pg-boss-Adapter real implementieren; Drain aus dem Request-Pfad in einen Worker; Job-Liste begrenzen (Memory-Leak); Drain unter Lock/atomarem In-Progress-Status. *(Loest A2-Teil + Reliability-Race.)*
- **T-P1-8 · Compliance-Paket EU/DE** · NORMAL (Doku) · neue `docs/compliance/*`, `src/db/schema.sql:238-249` · **ja**
  `REVOKE UPDATE,DELETE ON audit_log` + Aufbewahrungsfrist; AVVs (Anthropic/Twilio/Telnyx/Stripe) + SCC/Adequacy + Verzeichnis der Verarbeitungstaetigkeiten + TOMs; DB-Region erzwingen/verifizieren. *(Loest H4+H6.)*
- **T-P1-9 · CI-Tiefe** · NORMAL · `.github/workflows/ci.yml`, neue ESLint-Config · **ja**
  ESLint + Coverage-Threshold + gitleaks + CodeQL; umgebungsunabhaengige Gate-Tests (injizierter Socket-`remoteAddress` statt echter externer IP). *(Loest H7 + L-Test-Skip.)*

### P2 — Tech-Debt / Qualitaet (jederzeit, parallel)

- **T-P2-1 · `server.js` weiter dekomponieren** · KOMPLEX · `src/server.js` → `src/routes/voice.js`, `src/safety/outbound-gates.js`, `src/billing/*` · **ja (byte-Paritaets-Tests wie AC7)** *(Loest H8.)*
- **T-P2-2 · `CALL_STATUS`-Konstante** · TRIVIAL · `src/store/defaults.js` + ~15 Call-Sites · **ja**
  `Object.freeze({ACTIVE,COMPLETED,CANCELLED,FAILED})`; getrennte `PROVIDER_CALL_STATUS` (`busy`/`no-answer`/`canceled`). Behebt das reale `"cancelled"` vs. `"canceled"`-Tippfehler-Risiko (beide im Code).
- **T-P2-3 · Magic Numbers in `claude.js`/`bridge.js` benennen** · TRIVIAL · `src/claude.js:174,193,196,247`, `src/bridge.js:178`, `src/config.js` · **ja**
  `TOOL_LOOP_MAX_ROUNDS=4`, `HISTORY_WINDOW=24`, `TURN_MAX_TOKENS=300`, `SUMMARY_MAX_TOKENS=500`, `HANGUP_GRACE_MS=2500`; kostenrelevante nach `config.js`.
- **T-P2-4 · Telnyx-Adapter-Duplikat extrahieren** · TRIVIAL · neue `src/telephony/adapters/telnyx/http.js` · **ja**
  `telnyxHeaders()`, `assertTelnyxOk()`, `requireTelnyxKey()` aus `voice.js`/`numbers.js`/`messaging.js` zusammenfuehren (~15 LOC 3-fach).
- **T-P2-5 · `summarizeCall` robust** · NORMAL · `src/claude.js:254-260` · **ja**
  Structured Outputs (json_schema) statt Substring-JSON-Parsing; Unit-Test fuer malformten Modell-Output (sonst gehen Action Items still verloren).
- **T-P2-6 · Anthropic-SDK heben** · NORMAL · `package.json:13` · **ja**
  `@anthropic-ai/sdk` `^0.39.0` → aktuelle Major (typed exceptions/parse-Helfer). **Modellname `claude-haiku-4-5` ist korrekt — NICHT aendern.**
- **T-P2-7 · `CLAUDE.md`-Architektur-Doku nachziehen** · TRIVIAL · `CLAUDE.md:7,43-49` · **ja**
  Veraltete Pfade (`src/store.js` als „JSON-Persistenz", nur Twilio) gegen reale `src/`-Struktur (Store-Verzeichnis, Telnyx-Adapter, pg-Backend, web-auth/portal) korrigieren.

### Sammelbox MEDIUM/LOW (Detail-Findings, in P1/P2-Tasks enthalten)

| # | Finding | Sev | Datei/Zeile | Task |
|---|---------|-----|-------------|------|
| M1 | `openaiWs.on("open")` ohne try/catch + ohne `closed`/`call`-Guard (einziger ungeschuetzter Realtime-WS-Handler) | MEDIUM (dormant) | `src/bridge.js:104-124` | T-P1-4 |
| M2 | Cross-Tenant-IDOR `/api/action-items/:id/toggle` (kein Tenant-Scope) | MEDIUM (latent) | `src/server.js:855-859` | T-P1-1 |
| M3 | Haupt-DB-Pool ohne NOBYPASSRLS-Assertion (FORCE-RLS wirkungslos bei Superuser-Rolle) | MEDIUM | `src/store.js:13-44` | T-P1-2 |
| M4 | `/voice/status` ruft `finishCall` un-awaited/un-catch nach `res.sendStatus(200)` → unhandledRejection (nur process-guard faengt, kein Exit) | MEDIUM | `src/server.js:607-616` | T-P0-3/T-P0-6 |
| M5 | `/voice/turn` ohne Idempotenz → Webhook-Retry doppelt Claude-Call/Metering/`book_appointment` | MEDIUM | `src/server.js:452-485` | T-P1-3 |
| M6 | `runProvisioningDrain` fire-and-forget ohne Lock; memory-Queue-Jobliste waechst unbegrenzt | MEDIUM | `src/server.js:985-1019` | T-P1-7 |
| M7 | `resp.usage`/`resp.content` ohne Null-Guard | MEDIUM | `src/claude.js:201-207,251-259` | T-P2-5 |
| M8 | Mutationsrouten (`/api/settings`,`/api/calendar`,`action-items`) ohne try/catch um `save()` → mem/disk-Divergenz bei Disk-voll, 200/500 trotz nicht-persistiert | LOW | `src/store/json.js:155-171` | T-P0-6 |
| M9 | Telnyx-`originateCall`: `sid` kann `undefined` → kein harter Max-Dauer-Cap (s. F6) | LOW | `src/telephony/adapters/telnyx/voice.js:54-56` | T-P0-3 |
| M10 | Prompt-Injection ueber Gegenseite/`callerName` (Daten-Freigaben nur Prompt-Regel, nicht harte Tool-Gates); `callerName` ungeprueft → Impersonation im Disclosure | LOW | `src/claude.js:35-79`; `src/server.js:701` | T-P0-4-nah |
| M11 | `addTranscript` bei gepurgtem Call → stiller Datenverlust (kein Log) | LOW | `src/bridge.js:161-165` | T-P2 |
| M12 | Test-Skips an externe Interface-IP gekoppelt → Auth-/Rate-Limit-Gate-Tests in CI ggf. still uebersprungen | LOW | `test/{audit,rate-limit,security,profiles}.test.js` | T-P1-9 |

---

### Positiv hervorzuheben (Staerken, nicht anfassen)

- **App-Security:** Webhook-Signaturen fail-closed (Twilio-HMAC, Telnyx-Ed25519 + 300s-Replay + timing-safe); JWT/OIDC sauber (`issuer`+`audience`+`clockTolerance`, JWKS, PKCE S256, HMAC-signierte State/Nonce-Cookies, `email_verified`-Gate); SQL durchgehend parametrisiert; XSS-Escaping in beiden Dashboards; `streamToken` = 128-bit `randomBytes` + `timingSafeEqual`, nie ausgegeben; Security-Header (CSP/X-Frame DENY/nosniff/no-store); Error-Handler leakt nie Stack/Message; **kein SSRF/Command-Injection/Path-Traversal**; **npm audit: 0 Schwachstellen.**
- **Korrektheit:** Budget-Engine (Live-Pfad) solide gegen Doppel-Nummernkauf verriegelt; OT-2-WS-Guards um die Frame-Handler; atomic save + `withStoreLock`; fail-closed Gates (Allowlist/Budget/Land/Stundenlimit/KYC) nicht abschaltbar.
- **Qualitaet:** kein toter/auskommentierter Code (ausser getrackten TEMP-Diagnosen), durchgaengig ESM+async/await, Geld als Integer-Cents, zentralisierte Fachlogik (keine Backend-Drift), vorbildliche WARUM-Kommentare, ehrliches und gegen den Code abgeglichenes Tech-Debt-Register (`STATUS-OFFENE-PHASEN.md`).
- **Architektur:** azyklischer Import-Graph, konsequente Port/Adapter-Trennung, request-scoped Tenant-Kontext, RLS+FORCE+NOBYPASSRLS (Portal-Pool), dokumentiertes DSGVO-Loeschrecht + Export.

> **Schlusswort:** Das ist kein schlecht gebautes System — es ist ein **bewusst fuer eine
> kleinere Groessenordnung** (Owner/Demo, eine Instanz) gut gehaertetes System. Der Weg zu
> „Millionen Nutzer unter Vodafone-Marke" fuehrt nicht ueber Bugfixes, sondern ueber die zwei
> Kern-Refactorings (Spiegel→DB, Call-State externalisieren) plus das Schliessen der Betriebs-
> und Compliance-Luecken. Die P0-Liste ist die Schwelle fuer den naechsten ehrlichen Deploy.
