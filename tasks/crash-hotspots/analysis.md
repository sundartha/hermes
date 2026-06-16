# Crash-Hotspot-Analyse — vodafone-agent

**Datum:** 2026-06-16
**Methode:** 5 parallele Sub-Agents, je eine unabhaengige Domaene (Git-Historie, Realtime-Audio, Auth/OIDC/DB-Pool, MCP/REST/Persistenz, Lessons/Test-Coverage).
**Zweck:** Crash-Hotspots nach Oberthemen gliedern als Basis fuer eine phasenweise Abarbeitung in spaeteren Sessions.

---

## TL;DR

Der gefaehrlichste Befund ist struktureller, nicht punktueller: **es gibt im gesamten `src/` keinen `uncaughtException`/`unhandledRejection`-Handler**, und der Boot-Pfad haengt ueber ungeschuetzte top-level `await`s zusammen. Ein einzelner Throw in einem Async-/WebSocket-Handler oder ein pg-Fehler beim Start reisst den **ganzen Prozess** runter — und ein Prozess bedient ALLE gleichzeitigen Calls plus das Web-Stack. Das macht aus fast jedem "einzelner Call failt" ein "alle Calls weg".

Zweitwichtigste Klasse: Sicherheits-/Kosten-Gates, die **leise OPEN failen** statt laut zu crashen (NaN-Budget, presence-only Config-Check, fail-open Auth-Edges) — schlimmer als ein Crash, weil unsichtbar.

---

## Datenbasis & Caveat

**Kein Runtime-Crash-Log im Repo** (kein `data/`, keine `*.log`). "Crashes" ist daher **abgeleitet** aus: (a) git-Fix-Rekurrenz, (b) crash-prone Code-Patterns/Error-Handling-Luecken, (c) `tasks/lessons.md`, (d) External-Integration-Failure-Surfaces. Sobald echte Render-/Twilio-Debugger-Logs vorliegen, sollten sie gegen diese Hypothesen gehalten werden.

---

## Die 5 Oberthemen (ranked: Blast-Radius x Wahrscheinlichkeit)

### OT-1 — Kein globales Crash-Backstop + gekoppelter Boot-Pfad  *(Fundament)*
Force-Multiplier fuer alles andere. Klein zu fixen, kappt den Blast-Radius saemtlicher anderer Themen.

| Hotspot | Mechanismus | Severity | Quelle |
|---|---|---|---|
| `src/` global | Kein `process.on('uncaughtException'/'unhandledRejection')` irgendwo → jeder entkommene Throw = Prozess-Exit = alle Calls weg | Critical | telephony, auth |
| `server.js:134` `await createPortalRunner()` | Top-level await ohne try/catch; pg-Boot-Fehler → ESM-Modul-Rejection → Prozess stirbt (inkl. Telefonie, die kein pg braucht) | Critical | auth #1 |
| `portal-pool.js:52` `await pool.connect()` | Liegt EINE Zeile ueber seinem eigenen `try` → erste Connection-Failure bubblet zum top-level await | Critical | auth #2 |
| `store.js:42` `await store.init()` (pg-Pfad) | Modul-top-level await; unerreichbare `DATABASE_URL` → Boot-Crash, evtl. Connection-String-Fragment im Stack | High | mcp-data #6 |

**Warum es rekurriert:** Fail-closed-at-startup ist bewusst richtig (F5 RLS-Assertion), aber "der Security-Gate muss blocken" wurde nie von "der ganze Dienst muss sterben" getrennt. Jede Haertungsschicht (F5, Identity-Dedup, Self-Service) legt einen weiteren Throw auf denselben ungeschuetzten Boot-Pfad.

### OT-2 — Realtime-Audio-Pfad ungeschuetzt  *(Live-Call-Crashes)*
Hoechstes Prozess-Crash-Risiko waehrend echter Calls. Code-analytisch top, historisch unauffaellig (siehe Schluessel-Erkenntnis 1).

| Hotspot | Mechanismus | Severity | Quelle |
|---|---|---|---|
| `bridge.js:119` (OpenAI-WS) + `:193` (Provider-WS) | `message`-Handler ohne aeusseres try/catch; Throw aus `store`/`execTool`/unerwartetem Event entkommt zum Emitter → Prozess-Crash | Critical | telephony #1/#2 |
| `bridge.js:141/167/171` | `ws.send` ohne `readyState`-Check an Barge-in + Tool-Output + Call-Ende (HEIKLE STELLE); Send auf schliessendem Socket throwt | Critical | telephony #4 |
| `adapters/twilio/media.js:14` | Deref `msg.start.streamSid`/`.customParameters` ohne `?.` (Telnyx-Adapter nutzt `?.`) → malformter Start-Frame = Crash | Critical | telephony #3 |
| bridge.js Coverage | 0 Imports in Tests; nur WS-Boundary via gespawntem Server; Barge-in/Call-Ende-Internas nie unit-getestet | — | lessons |

### OT-3 — JSON-Store als ungeschuetzter Single Point of Failure  *(Daten-Integritaet)*

| Hotspot | Mechanismus | Severity | Quelle |
|---|---|---|---|
| `store/json.js:118` `save()` | Non-atomic `fs.writeFileSync`, kein Lock, kein tmp+rename; zwei gleichzeitige Writes (inbound `/voice` + MCP `place_call` + Dashboard-Poll) → last-writer-wins, stiller Datenverlust; SIGTERM/disk-full mid-write = truncated File. Budget-Counter-Rollback schwaecht Kosten-Gate | Critical | mcp-data #1 |
| `store/json.js:26` `catch` | Korruptes/halbes File → `JSON.parse` throwt → catch ersetzt **stillschweigend den ganzen Store** mit Defaults + speichert; Korruption sieht aus wie sauberer Restart, alle Calls/Tenants/Usage weg, kein Fehler | Critical | mcp-data #2 |
| `server.js:828` `POST /api/onboard` | `store.save()` ausserhalb try/catch → unhandled async rejection bei I/O-Fehler, mem/disk-Divergenz | High | mcp-data #4 |

### OT-4 — Safety-Gates failen OPEN (silent)  *(Sicherheits-/Kosten-Garantien)*
Die unheimlichste Klasse: kein Crash, sondern leises Abschalten einer Garantie. Beruehrt CLAUDE.md Absolute Rules 1 + 2.

| Hotspot | Mechanismus | Severity | Quelle |
|---|---|---|---|
| `config.js` + `server.js:921` | `assertConfig` ist presence-only, throwt nie, nur `console.error`; `server.js:921` berechnet `ok`, **ignoriert es**, bootet trotzdem | High | mcp-data #5 |
| `config.js:11` u.a. | `parseFloat`/`parseInt` ohne `Number.isFinite`; malformtes `MAX_BUDGET_EUR` → NaN → `costEur >= NaN` immer false → **Budget-Gate still deaktiviert** | High | mcp-data #5 |
| F1-F5 Cluster (historisch) | Fuenf Auth/Tenant-Edges die OPEN failten: unverifizierte Emails akzeptiert, fehlender OIDC-nonce, stale JWKS, RLS ohne WITH CHECK, BYPASSRLS-Rolle. Alle jetzt gefixt+getestet — aber das Muster (silent-grant statt crash) ist der Klassen-Beweis | High (mitigiert) | lessons, git |
| `claude.js` disclosureSentence | Tool-Loop/Summary ungetestet; haelt den hart verdrahteten Offenlegungssatz (Rule 2). Regression koennte ihn droppen/umordnen ohne failenden Test. `0fefd5d` hat genau das im Fehlerpfad schon mal repariert | Medium | lessons, git |

### OT-5 — External-I/O untested + `server.js` God-File  *(Rekurrenz-Treiber)*
Der Grund, warum OT-1..OT-4 immer wiederkommen: der eigentliche Failure-Mode-Code ist nirgends asserted und regrediert bei jedem Refactor.

| Hotspot | Mechanismus | Severity | Quelle |
|---|---|---|---|
| `web-auth.js:192/246` echte OIDC-fetch/parse | `r.json()` auf Discovery/Token, `new URL(jwks_uri)`, `id_token`-Destructure — in JEDEM Test per DI-Stub ersetzt → 0 Coverage gegen malformte/unvollstaendige IdP-Antworten | High | auth #2 |
| `web-auth.js:95` `GET /auth/login` | Kein try/catch + keine Express-4-Error-Middleware → `discover`-Rejection laesst Request bis Socket-Timeout haengen | High | auth #5 |
| `mcp-tools.js:71+` | Handler derefen verschachtelte Felder aus `api()`, das bei Parse-Fail still zu `{}` degradiert; stdio-Pfad ohne per-handler catch → unhandled rejection | High | mcp-data #3 |
| `server.js` (943 LOC) | God-File: 11 Fix-Touches / 48 Churn — jede Auth/Tenant/Gate/Signature-Aenderung konvergiert hier; nur Behavior-Coverage via gespawntem Server, kein Unit-Isolat; Refactors landen blind | Medium | git #1, lessons |

---

## Top-Hotspots gesamt (die eine ranked Liste)

| # | Sev | Hotspot | OT |
|---|---|---|---|
| 1 | CRIT | Kein globaler `uncaughtException`/`unhandledRejection`-Handler (`src/` gesamt) | OT-1 |
| 2 | CRIT | `server.js:134` + `portal-pool.js:52` ungeschuetzte Boot-awaits → pg-Fail killt ganzen Prozess inkl. Telefonie | OT-1 |
| 3 | CRIT | `bridge.js:119/193` WS-Message-Handler ohne aeusseres try/catch | OT-2 |
| 4 | CRIT | `bridge.js:141/167/171` `ws.send` ohne readyState-Guard (Barge-in/Call-Ende-Race) | OT-2 |
| 5 | CRIT | `adapters/twilio/media.js:14` Deref ohne `?.` → malformter Start-Frame crasht | OT-2 |
| 6 | CRIT | `store/json.js:118` non-atomic write, kein Lock → Concurrent-Write-Datenverlust | OT-3 |
| 7 | CRIT | `store/json.js:26` Korrupt-File-catch wischt Store still | OT-3 |
| 8 | HIGH | `config.js`+`server.js:921` Gate-Check presence-only/ignoriert; NaN-Budget → Gate still aus | OT-4 |
| 9 | HIGH | `web-auth.js` echte OIDC-fetch/parse 0 Coverage + `/auth/login` ohne try/catch | OT-5 |
| 10 | HIGH | `mcp-tools.js:71+` Deref aus degradiertem `{}`; stdio unhandled rejection | OT-2/5 |
| 11 | HIGH | `server.js:828` `/api/onboard` `save()` ausserhalb try/catch | OT-3 |
| 12 | MED | `claude.js` Tool-Loop/Summary ungetestet — Risiko fuer disclosureSentence (Rule 2) | OT-4/5 |

---

## Schluessel-Erkenntnisse (kontraintuitiv)

1. **`bridge.js` ist git-historisch stabil (1 Fix-Touch) — aber code-analytisch das hoechste Prozess-Crash-Risiko.** Wenig gefixt heisst hier nicht wenig riskant, sondern wenig *exercised*: 0 Unit-Coverage, nur aktiv unter `VOICE_ENGINE=realtime`, und schon einmal fehldiagnostiziert (lessons #1: falsche Layer debuggt, weil aktive Config nicht geprueft). Latentes, unentdecktes Risiko.
2. **Die Auth-Schicht ist trotz hoher git-Churn jetzt gut verteidigt** (F1-F5 wurden je zu Tests). Ihr *Restrisiko* liegt nicht in der Logik, sondern im Boot-Pfad (OT-1) und im ungetesteten echten OIDC-I/O (OT-5) — nicht dort, wo die Historie es vermuten laesst.
3. **Die gefaehrlichste Klasse crasht nicht laut, sie failt leise OPEN** (OT-4). Ein NaN-Budget oder ein ignorierter Config-Check deaktiviert ein Safety-Gate ohne jedes Signal — das verletzt die CLAUDE.md-Kernregeln unsichtbar.

---

## Vorgeschlagene Phasen-Gliederung (Startpunkt — finale Aufteilung in naechster Session)

Dependency-geordnet, nach Risikoreduktion/Aufwand:

- **Phase 0 — Crash-Backstop & Boot-Entkopplung (OT-1).** Globale `uncaughtException`/`unhandledRejection`-Handler mit sauberem Logging + Entscheidung crash-vs-degrade; Boot-awaits wrappen (`server.js:134`, `portal-pool.js:52`, `store.js:42`) so dass pg-Fail die Telefonie nicht mittoetet. *Kleinster Aufwand, kappt Blast-Radius aller anderen → ZUERST.* Verifizierbar: injizierter Boot-pg-Fail → Prozess degradiert/loggt, `/voice` laeuft; injizierter Handler-Throw → kein Prozess-Exit.
- **Phase 1 — Store-Integritaet (OT-3).** Atomic write (tmp+fsync+rename) + Write-Serialisierung/Lock; Korrupt-File → `.corrupt` umbenennen + Backup laden + LAUTER Fehler, nie still wischen. Verifizierbar: Concurrent-Write-Test ohne Verlust; Korrupt-File-Test bewahrt+flaggt.
- **Phase 2 — Safety-Gates fail-closed (OT-4).** `assertConfig` throwt bei missing/NaN; `server.js:921` ehrt `ok`; `Number.isFinite`-Guards auf numerische Env; disclosureSentence-Regressionstest. Verifizierbar: NaN-Budget-Env → Boot verweigert; Disclosure-Test gruen.
- **Phase 3 — Realtime-Audio-Haertung (OT-2).** Aeusseres try/catch in beiden WS-Handlern; readyState-Guard auf allen `ws.send`; `?.` im Twilio-Adapter; bridge-Unit-Tests fuer malformte Frames + Disconnect-Races. *Vorsicht HEIKLE STELLE.* Verifizierbar: Malformed-Frame + Closing-Socket-Tests ohne Crash; + Real-Call-Smoke-Test.
- **Phase 4 — Test-Coverage & `server.js`-Decomposition (OT-5).** Echte OIDC-fetch/parse-Failure-Tests (un-stubben), pg-connect-Fail, mcp-tools malformed-response, stdio per-handler catch; `server.js`-God-File schrittweise nach Concern extrahieren. Querschnitt/laufend.

**Abhaengigkeiten:** Phase 0 ist Fundament (zuerst). Danach sind 1/2/3 weitgehend unabhaengig und ueber Sessions parallelisierbar. Phase 4 ist Querschnitt und ermoeglicht teilweise die Verifikation von 0-3.

---

## Offene Verifikations-Items

- **`server.js:649-655`** `/api/calls` Originate-Fehler-catch: interpoliert es rohe Provider-`err.message`? Potenzielles Secret/Param-Leak (Rule 4/5) — von mcp-data-surface NICHT zeilengenau geprueft. In Phase 2/4 verifizieren.
- **Telnyx inbound-STT** (`transcriptionEngine="Telnyx"`): Fix gelandet, aber Akzeptanzkriterium (echter Call → ≥1 `role:caller`-Transkript) offline nicht testbar. de-DE-Reife der In-House-STT live unbestaetigt.
- **`MAX_BUDGET_EUR`/max-duration:** Twilio/Telnyx `TimeLimit` unbestaetigt → Kosten-Cap haengt am Timer, nicht an einem Provider-Limit.
