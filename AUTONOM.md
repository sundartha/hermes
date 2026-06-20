# Sundartha - Autonom umsetzbarer Backlog

> Der Teil von `STATUS.md`, den ich (Claude) OHNE Owner / Account / Geld / echten Anruf
> abschliessen kann - inkl. Vorgehen pro Item und ob das schwere phase-impl-Workflow noetig ist.
>
> **NICHT hier** (weil nicht autonom abschliessbar): Live-/Betreiber-Gates (`STATUS.md` §1),
> Azure `speak_failed` (nur per echtem Call verifizierbar, Fix ohne Failure-Webhook unklar),
> Rebrand-Infra/URL-Cutover (`STATUS.md` §4 Track B).
>
> **Stand:** 2026-06-20.

## Vorgehen: wann das phase-impl-Workflow noetig ist

Zwei Ebenen, nicht verwechseln:

- **workflow.md-Disziplin** - Pflicht bei JEDEM nicht-trivialen Task (CLAUDE.md): kurz planen,
  alle Caller greppen, sauber implementieren, `node --check` + `npm test`, gegen
  `.claude/refs/clean-code.md` pruefen, bei Sicherheits-Bezug `PLAN-SECURITY.md` nachziehen.
- **phase-impl / phase-impl-lean (Skill)** - schwere Multi-Agent-Orchestrierung (Plan ->
  Worktree-Impl -> dualer Review Safety + Clean-Code mit S1/S2 = Blocker -> Self-Fix). Lohnt
  NUR, wenn der Eingriff Safety-Gates / Auth / Mandanten-Isolation / Geld / die
  `bridge.js`-HEIKLE-STELLE beruehrt, ODER gross/architektonisch ist, ODER du die adversariale
  Doppelpruefung explizit willst.

**Faustregel hier:** phase-impl(-lean) nur fuer **A4 (Remote-Self-Service)** - das ist die
Auth-/Isolations-Grenze. Alles andere = workflow.md-Disziplin + gezielte Tests reicht.

---

## Items

### A1 - `/voice/status` Telnyx-Lifecycle parsen
- **Was/Warum:** `/voice/status` (`src/server.js` ~620) liest nur Twilio-Felder
  (`CallStatus`/`CallSid`). Telnyx-Call-Ende/Hangup-Ursachen kommen dadurch nicht an ->
  kuenftiges Call-Debugging blind (haette dieses STT-Debugging stark verkuerzt).
- **Scope:** `/voice/status`-Handler in `src/server.js`, ggf. kleiner Telnyx-Adapter-Helper;
  1 node:test (simulierter Telnyx-Status-POST).
- **Vorgehen:** (1) exaktes Telnyx-TeXML-Status-Callback-Feldformat klaeren (Telnyx ist
  Twilio-kompatibel - evtl. schon teils abgedeckt); (2) provider-bewusstes Mapping (analog
  `extractSpeech`); (3) PII-frei strukturiert loggen; (4) Test mit simuliertem Body.
- **Verifikation:** autonom per node:test. Finale Bestaetigung der echten Feldnamen idealerweise
  an einem realen Status-Callback (nice-to-have, nicht blockierend).
- **Workflow:** leicht - workflow.md-Disziplin, kein phase-impl (Call-Pfad, aber read-only,
  loest keine Calls/SMS aus).
- **Blocker:** keine.

### A2 - `server.js` entzerren (TD-4 Decomposition)
- **Was/Warum:** `src/server.js` ist ~1130 LOC God-File; bisher nur `/api/profiles` nach
  `src/routes/api-profiles.js` extrahiert. Rekurrenz-Treiber, erschwert jede Aenderung.
- **Scope:** weitere `/api`-Routen-Gruppen in `src/routes/*` ausziehen (verhaltens-erhaltend).
- **Vorgehen:** inkrementell je Gruppe, NICHT alles auf einmal; nach jeder Gruppe `npm test`.
  Reine Verschiebung, KEINE Verhaltens-Aenderung. Safety-Gates + Disclosure unangetastet.
- **Verifikation:** `npm test` (579/579 muss erhalten bleiben) nach jedem Schritt.
- **Workflow:** mittel - workflow.md-Disziplin in kleinen Schritten. phase-impl optional (nur
  falls du die Doppelpruefung der Verhaltens-Gleichheit willst).
- **Blocker:** keine. Am besten NACH den anderen Items (sonst Merge-Reibung).

### A3 - `handleOpenAiEvent` aus `bridge.js` extrahieren (Delta-2)
- **Was/Warum:** `src/bridge.js` (Realtime) hat den OpenAI-Event-Handler inline -> nicht offline
  unit-isolierbar. Nur relevant, falls die Realtime-Engine je aktiviert wird.
- **Scope:** `src/bridge.js`.
- **Vorgehen:** ZUERST Charakterisierungs-Test der Frame-Ausgabe (HEIKLE STELLE!), DANN extrahieren.
- **Verifikation:** Charakterisierungs-Test + `npm test`.
- **Workflow:** vorsichtig - `bridge.js` ist HEIKLE STELLE (Barge-in/Call-Ende). phase-impl-lean
  sinnvoll, mindestens aber Charakterisierungs-Test-first.
- **Blocker:** keine, aber niedrige Prio (Realtime dormant).

### A4 - Remote-Browser-OAuth fuer Self-Service
- **Was/Warum:** `req.auth` wird im REST-Pfad nur auf `/mcp` gelesen; Tenant-Self-Service ist
  remote nicht nutzbar (nur localhost). Einziger funktionaler Gap der Mandanten-Schicht.
- **Scope:** `src/server.js` (`requestTenant`/REST-Auth-Pfad), `src/web-auth.js` (Web-Session ->
  Tenant-Identitaet im REST-Pfad).
- **Vorgehen:** Web-Session (OIDC-Cookie) auch im REST-Pfad zu `requestTenant` durchreichen,
  **fail-closed** (kein Tenant -> kein Zugriff). Muster der Auth-Fixes F1-F5 + RLS beachten.
- **Verifikation:** node:test (Session -> korrekter Tenant; keine Session -> 401/403; KEIN
  Cross-Tenant-Leak).
- **Workflow:** **phase-impl(-lean) EMPFOHLEN** - Auth-/Mandanten-Isolations-Grenze, genau wo der
  duale Safety-Review zaehlt. S1/S2 = Blocker.
- **Blocker:** keine (Code), aber das sensibelste der Items.

### A5 - Diagnose-Logs entfernen
- **Was/Warum:** `[turn-recv]`, `[turn-ok]`, `[boot]`-Commit-Log in `src/server.js` sind TEMP.
- **Scope:** 3 Log-Stellen in `src/server.js`.
- **Vorgehen:** entfernen + zugehoerige Kommentare.
- **Verifikation:** `node --check` + `npm test`.
- **Workflow:** trivial-leicht.
- **Blocker:** **SEQUENZIELL - erst nach der STT-Live-Abnahme** (`STATUS.md` §1.1); bis dahin
  sind die Logs noch nuetzlich.

### A6 - Rebrand Track A (Code/Doku-Umbenennung)
- **Was/Warum:** `vodafone-agent` / "Vodafone Agent" -> neuer Name in Code/Doku, null
  Runtime-Risiko. Detail: `tasks/rebrand-sundartha.md` (Track A).
- **Scope:** `package.json`, `src/mcp-server.js` (Server-Name), `src/store/defaults.js`
  (agentName-Default), Banner/Realm, `public/*` (Dashboards inkl. "Vodafone Verified"-Badge),
  die 4 Tests die den agentName-String pinnen, Doku-Produktnamen.
- **Vorgehen:** Owner-Entscheidungen abwarten (s.u.), dann String-/Symbol-Rename + Tests
  nachziehen. KEINE Live-URLs/Infra (= Track B, nicht autonom).
- **Verifikation:** `npm test` (die 4 agentName-Tests mitziehen).
- **Workflow:** leicht (Rename), kein phase-impl.
- **Blocker:** entfallen - entschieden 2026-06-20: Agent/Produkt = **Hermes**, Unternehmen =
  **Sundartha**, Repo → `hermes-call-mcp`, **Track A jetzt / Track B spaeter** (Details +
  exaktes Disclosure-Wording: `tasks/rebrand-sundartha.md`).

---

## Empfohlene Reihenfolge

1. **A1** (`/voice/status`) - schnell, erleichtert kuenftiges Debugging sofort.
2. **A4** (Remote-Self-Service) - echter Funktions-Gap; mit phase-impl-lean.
3. **A6** (Rebrand Track A) - sobald du den Namen entscheidest.
4. **A2** (Decompose) - danach, inkrementell.
5. **A5** (Logs raus) - erst nach STT-Live-Abnahme.
6. **A3** (bridge-Extract) - niedrig, nur falls Realtime kommt.
