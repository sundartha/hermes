# Status: Offene Phasen, Tech-Debt & ToDo (Stand 2026-06-18)

> Synthese aus allen Plan-/Status-Dokumenten dieses Repos: `PLAN-SECURITY.md`,
> `PLAN-MULTI-TENANT-TELNYX.md`, `PLAN-MULTI-TENANT-IDENTITY.md`, `PLAN-INBOUND-AUDIO-STT.md`,
> `BERICHT-INBOUND-STT-2026-06-16.md`, `tasks/todo.md`, `tasks/crash-hotspots/*`,
> `tasks/auth-fixes/*` und dem realen Git-Stand (origin/local/upstream).
> Konvention: Deutsch ohne Umlaute (wie der Bestand der Plan-Docs).

---

## 0. Git-/Deploy-Divergenz — BEHOBEN (2026-06-18)

Alle drei Staende sind jetzt **synchron auf `ae9eba0`** (lokal = origin = upstream/Live).

| Stand | vorher | jetzt |
|---|---|---|
| **lokales Arbeitsverzeichnis** | `fb59001` (9 hinter) | `ae9eba0` |
| **origin/master** (Antonio) | `236aaf2` | `ae9eba0` |
| **upstream/master = Render/LIVE** (jonas986) | `83ccef9` | `ae9eba0` |

Beim Fetch zeigte sich, dass origin und upstream ab `54ca2f0` **disjunkt divergiert**
waren: Live hatte den `form-data`-Security-Fix (`83ccef9`, CVE GHSA-hmw2-7cc7-3qxx),
den origin nicht hatte; origin hatte den Telnyx-Inbound-STT-Fix (`04549c4`) +
`.env.example`-Doc, die Live nicht hatte. Konfliktfrei zusammengefuehrt (Merge `ae9eba0`),
`npm test` 490/490 gruen als Pre-Push-Gate, dann origin + upstream gepusht. Render
(`autoDeploy: true`, Region Frankfurt) deployt automatisch; `/healthz` -> 200.

**Damit jetzt LIVE (war es vorher nicht):**
- Crash-Haertung **P0/P1/P2** (Backstop, Store-Integritaet, Safety-Gates fail-closed inkl. Boot-Refusal). *(P0/P1/P2 waren bereits in `83ccef9` live; Boot-Refusal hat den laufenden Deploy ueberlebt.)*
- **Telnyx-Inbound-STT-Fix** (`04549c4`): provider-bewusster `extractSpeech` + absolute action-URL — der Fix fuer "KI hoert mich nicht".
- **Originate-Leak-Fix**: `/api/calls`-500 leakt keine rohe Provider-`err.message` mehr.

**Direkte Folge-Aufgabe (Owner, Gate aus 1b):** STT-Fix ist live, aber unverifiziert.
Naechster Owner-Test-Call -> Render-Log (`[turn-recv]`) lesen -> Akzeptanz `>=1 role:caller`.
Bei Erfolg: temporaeres `[turn-recv]`-Diagnose-Log entfernen.

> Hinweis fuer kuenftige Sessions: origin (Antonio) und upstream (jonas986/Render)
> divergieren aktiv — jonas986 committet selbst (z.B. den `form-data`-Fix). Vor Aussagen
> ueber den Live-Stand IMMER `git fetch --all` und origin vs. upstream getrennt vermessen.

---

## 1. Offene Phasen

### 1a. Crash-Hotspot-Remediation (`tasks/crash-hotspots/`)

5 Oberthemen OT-1..OT-5 aus einer 5-Agent-Analyse (2026-06-16). Reihenfolge: P0 zuerst solo, dann P1/P2/P3 parallel, P4 zuletzt solo.

| Phase | OT | Thema | Severity | Status |
|---|---|---|---|---|
| P0 | OT-1 | Crash-Backstop & Boot-Entkopplung | Critical | ✅ gemergt (origin) |
| P1 | OT-3 | Store-Integritaet (atomic/lock/korrupt) | Critical | ✅ gemergt (origin) |
| P2 | OT-4 | Safety-Gates fail-closed (numEnv, Boot-Refusal, Leak-Fix) | High | ✅ gemergt (origin) |
| **P3** | **OT-2** | **Realtime-Audio-Haertung** (`bridge.js`, twilio/media.js) | **Critical** | ❌ **OFFEN** (Plan fertig) |
| **P4** | **OT-5** | **Test-Coverage + `server.js`-Decomposition** | Medium | ❌ **OFFEN** (Plan fertig) |

- [ ] **P3 (OT-2) — Realtime-Audio-Haertung.** `bridge.js` Audio-Hot-Path hat drei Crash-Klassen, die den **ganzen** Node-Prozess (= alle parallelen Calls) killen koennen. Fix ist additiv/verhaltens-erhaltend: aeusserer `try/catch` + `readyState`-Vorbedingungen an der HEIKLE STELLE (Barge-in `bridge.js:136-143`, Call-Ende `:67-89`). **Prereq P0 ist erfuellt.** Nur relevant bei `VOICE_ENGINE=realtime` — Live laeuft derzeit auf `budget`, daher Critical aber nicht akut. Verifikation: Unit-Tests offline + manueller Real-Call-Smoke.
- [ ] **P4 (OT-5) — Coverage + Decomposition.** Rekurrenz-Treiber: `server.js` ist God-File (944 LOC, 11 Fix-Touches), OIDC-fetch/parse hat 0 Coverage, `mcp-tools.js` dereferenziert blind aus still degradiertem `{}`. Muss **solo + zuletzt** laufen (fasst `server.js` breit an). Details inkl. AC1.. im Plan.

### 1b. Inbound-STT-Bug "Die KI hoert mich nicht" (Telnyx, Budget-Engine)

Status: **Fix ist auf origin (`04549c4`), aber das harte Gate ist noch offen.**

- Symptom: Agent redet (TTS), reagiert aber nicht auf den Anrufer; Transkript nur `role:agent`, Re-Greet nach Stille. Outbound ok, Inbound defekt.
- Bisher 3 Fix-Versuche ohne Live-Beweis (`455bd71` transcriptionEngine, `fb59001` Deepgram-Umstellung, `04549c4` extractSpeech+absolute-URL).
- **Hartes Gate (aus dem Pre-Mortem):** Kein Fix gilt als verifiziert, bevor der echte Telnyx-POST-Body beobachtet ist. Dafuer liegt live ein temporaeres Diagnose-Log `[turn-recv]` (`server.js`).

**ToDo (Betreiber, nur live moeglich):**
- [ ] Render-Log (Region Frankfurt) **waehrend eines Owner-Test-Calls** lesen → `[turn-recv]`-Zeile trennt die 3 Aeste (siehe Tabelle in `BERICHT-INBOUND-STT-2026-06-16.md`): relative action-URL? / Deepgram nicht freigeschaltet? / Modell/Sprache nicht bedient?
- [ ] Wahrscheinlichstes: `04549c4` (absolute action-URL) live deployen + Test-Call → **Akzeptanz: >=1 `role:caller`-Zeile** + inhaltliche Antwort.
- [ ] Falls Deepgram still scheitert: im Telnyx-Portal freischalten ODER Fallback `transcriptionEngine="Telnyx"`/`"Google"` bzw. `model="deepgram/nova-2"`.
- [ ] **Phase 3 Aufraeumen:** temporaeres `[turn-recv]`-Diagnose-Log nach erfolgreichem Live-Test wieder entfernen (kein dauerhaftes PII-Logging).

### 1c. Multi-Tenant-Telefonie (`PLAN-MULTI-TENANT-TELNYX.md`, P0–P8)

Die gesamte Roadmap P0–P8 ist **code-seitig umgesetzt** (Ports, Telnyx-Adapter, pg-Store, pro-Tenant-Budget, Onboarding, REST-P6 Payment/Worker/Budget/KYC, Realtime-Port, DSGVO-Tiefe). Offen sind nur **Aktivierungs-Gates und Live-Smokes**, die einen Menschen/Account brauchen:

- [ ] **Telnyx-Realtime scharf schalten** (P7): blockiert bis **WS-Echo-Test** gegen die Telnyx-Live-API gruen ist (exaktes Payload-Format: rohe µ-law vs. RTP). Bis dahin hinter Flag. (Live laeuft ohnehin auf `budget`.)
- [ ] **`TELNYX_NUMBER` produktiv setzen** erst nach gruenem Live-Smoke (fail-closed, scharfer Schalter fuer MCP-Telnyx-Outbound; siehe Memory `telnyx-provisioning-state`).
- [ ] **Stripe live** (P6): bisher nur Test-Mode/Fakes; keine Stripe-Keys → Live-Smoke geparkt. `PAYMENT_ENABLED` ist byte-identisch aus.
- [ ] **pg-boss** als Queue-Backend: aktuell In-Memory-Adapter (Default `QUEUE_BACKEND=memory`), pg-boss-Adapter ist ein bewusst werfender Stub (auf P8 vertagt, kein Dep).
- [ ] **EU-AI-Act Art. 50(2)** (maschinenlesbare KI-Markierung der Stimme, ab 08/2026): bewusst auf spaetere Compliance-Phase vertagt; ersetzt den gesprochenen Disclosure-Satz nie.
- [ ] **P8 Scale-Infra** (PgBouncer/Read-Replicas/Partitionierung): erst bei echter Last; Partition-Key-Weichen sind in P3 gesetzt.

### 1d. Multi-Tenant-Identitaet (`PLAN-MULTI-TENANT-IDENTITY.md`, I0–I9)

**Komplett umgesetzt + gemergt (I1–I9 in master).** Eine bekannte funktionale Luecke bleibt:

- [ ] **Remote-Browser-OAuth fuer Self-Service.** `req.auth` liegt nur auf `/mcp` → **Self-Service funktioniert remote noch nicht, nur auf localhost** (I9, bewusst deferred). Vor echten Fremd-Tenants noetig.

### 1e. Auth-Foundation / OAuth-Betrieb (`PLAN-SECURITY.md`)

Code fertig, RLS-Haertung F1–F5 gemergt. Offen = Betrieb:

- [ ] **Invite-only scharf schalten** (WorkOS "Sign up" aus, Team per Invite) vor Dauerbetrieb.
- [ ] **Staging → Production** umstellen (eigene authkit.app-Domain, `OAUTH_ISSUER_URL` umstellen).
- [ ] **Echter Killer-Test** (2 Tenants, 50 parallele Requests, injizierte Txn-Fehler, reale Render/pgBouncer-Topologie) als manuelles Release-Gate vor jedem Deploy (`docs/RELEASE-GATE-killer-test.md`). pglite (CI) kann pgBouncer-Transaction-Pooling nicht reproduzieren.
- [ ] **Deployment-Voraussetzung:** `DATABASE_URL`-Rolle MUSS non-superuser + NOBYPASSRLS sein (F5 prueft fail-closed beim Start), Postgres mit pgBouncer (transaction mode) in EU/DE-Region.

### 1f. Allowlist-Lockerung (Phase 0.6, `PLAN-SECURITY.md`)

- [ ] **Betreiber-Entscheidung 2026-06-13: auf Phase 2 vertagt.** Bis dahin bleibt die Allowlist das harte letzte Gate (leer = Outbound gesperrt). Architektur ist vorbereitet (letzte Verzweigung in `numberGateError()`), Umsetzung pro Nutzer ueber Rechteprofile.

---

## 2. Tech-Debt (bewusst aufgeschoben, mit Fundstelle)

| # | Tech-Debt | Fundstelle | Wann faellig | Quelle |
|---|---|---|---|---|
| TD-1 | **DI des Telefonie-Clients** statt Lazy-Init-Singleton (`if (!client)…`) | `src/telephony/adapters/twilio/client.js` | bei P3/P5 (Registry loest pro Tenant auf) | TELNYX-Plan "Tech-Debt", P15/N7 |
| TD-2 | **E.164-Normalisierung des Owner-Nummer-Seeds**: Lookup normalisiert via `normNum`, Seed speichert `config.twilioNumber` RAW | `src/db/migrate.js` (seedDefaults), `src/store/state-ops.js` (seedOwnerNumber) | P6 Defense-in-Depth (heute fail-closed, kein Defekt) | TELNYX-Plan, P3c-Audit S3 |
| TD-3 | **`provider`-Default als benannte Konstante** (`"twilio"` 2x hardcoded) → `DEFAULT_PROVIDER` | `src/store/state-ops.js`, `src/store/pg.js` (flushNumbers) | sobald echte Multi-Provider-Werte (P5/P6) | TELNYX-Plan, P3c-Audit S4 |
| TD-4 | **`server.js` God-File** (944 LOC) zerlegen — strukturelle Ursache, warum OT-1..OT-4 wiederkehren | `src/server.js` | **P4 (OT-5), offen** | crash-hotspots P4-plan |
| TD-5 | **OIDC fetch/parse 0 Coverage** (Discovery/Token immer per DI gefaket) | `src/web-auth.js:180-246` | **P4 (OT-5), offen** | crash-hotspots P4-plan AC1/AC2 |
| TD-6 | **`mcp-tools.js` dereferenziert blind aus still degradiertem `{}`** (`await res.json().catch(()=>({}))`) | `src/mcp-tools.js:11,19,58,148,161` | **P4 (OT-5), offen** | crash-hotspots P4-plan |
| TD-7 | **`uncaughtException` laeuft weiter statt Exit** — bewusster Backstop (Exit = alle Calls weg); echter quellseitiger Fix = P3 | `src/process-guards.js` | mit P3 (OT-2) | P0-plan AC4 |
| TD-8 | **MCP-sub-Threading im Read-Scope** (I5): fail-CLOSED gestrippt, kein Leak, aber sub noch nicht durchgereicht | I5-Bereich | spaeter | Memory `i5-design-decisions` |
| TD-9 | **`startTelnyxMock`-Namenskollision** (Test-Helper) | Tests | Folge-Ticket | Memory `i3-design-decisions` |
| TD-10 | **pg persistiert ownerName/Profile** je nach Pfad — I8 deckt Tenant-Buckets ab; Profile owner-only | `src/store/pg.js` | bei Bedarf | Memory `i8-design-decisions` |
| TD-11 | **`.env.example`-Kommentar** SELF_SERVICE_ENABLED (web-session) | `.env.example` | ✅ auf origin nachgezogen (`236aaf2`); lokal/live noch nicht | todo.md #3 |

**Akzeptierte, dauerhafte Prototyp-Abweichungen (kein Debt, dokumentiert):**
- `/api/*` (inkl. `/api/calls`, `/api/profiles`) ohne gesetztes `DASHBOARD_PASSWORD` offen erreichbar — geerbte, in `PLAN-SECURITY.md` begruendete Abweichung; `assertConfig` warnt. Scharfes Fail-closed offen fuer spaeteren Schritt.
- Render free plan = fluechtiges FS → per-API angelegte Profile ueberleben keinen Neustart; Loesung `PROFILES_JSON` (Env-Seed).
- Roh-Transkripte werden nach Summary geloescht (Datenminimierung) — `get_transcript` liefert fuer abgeschlossene Calls nur Summary.

---

## 3. Betreiber-ToDo (nicht autonom — braucht Account/Mensch/Geld)

- [ ] **`git push upstream master`** (Live deployen, siehe Abschnitt 0) + Live-Commit verifizieren.
- [ ] **Inbound-STT Live-Test** + `[turn-recv]`-Log lesen + Diagnose-Log danach entfernen (Abschnitt 1b).
- [ ] **Telnyx WS-Echo-Test** vor Realtime-Scharfschaltung; `TELNYX_NUMBER` erst danach produktiv.
- [ ] **Deepgram-STT + Azure-NTTS im Telnyx-Portal freischalten** (sonst stummer Agent; Minutenkosten laufen ausserhalb des Budget-Guards).
- [ ] **Stripe Test-Mode-Smoke** (Hold/Capture/Rollback) → dann Live-Keys.
- [ ] **WorkOS:** invite-only scharf, Staging→Production.
- [ ] **Postgres prod:** non-superuser/NOBYPASSRLS-Rolle + pgBouncer (transaction mode), EU/DE-Region; echten Killer-Test fahren.
- [ ] **Secrets-Hygiene** (PLAN-SECURITY Phase 3.5): Token-Rotation dokumentieren, Twilio-Subaccount mit minimalen Rechten.

---

## 4. Was fertig ist (Kontext)

- **Security Phase 0/1/2/3** (Number-Gates, Auth fail-closed, Rate-Limit, Validierung, Retention, Audit, CI, OAuth-Code) — ✅
- **Rechteprofile pro Nutzer** — ✅
- **Multi-Tenant-Telefonie P0–P8** (Ports, Telnyx-Adapter, pg-Store, pro-Tenant-Budget, Onboarding, REST-P6, Realtime-Port, DSGVO-Tiefe) — ✅ (code-seitig)
- **Multi-Tenant-Identitaet I1–I9** — ✅
- **Auth-Foundation (Sub-Projekt B)** + RLS-Haertung F1–F5 + Self-Service-Konvergenz #3 — ✅
- **Crash-Haertung P0/P1/P2** — ✅ (auf origin, nicht live)
- Test-Baseline auf origin: dokumentiert **490/490** gruen (P2-Stand); lokal `fb59001` 460/460.
