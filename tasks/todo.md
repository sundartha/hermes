# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Launch-Testlauf 1 (auto + lokal) — 2026-07-03

Auftrag: `NEXT-SESSION-LAUNCH-TESTRUN.md` — alle auto- und lokal-Tests aus
`PLAN-LAUNCH-TESTS.md` ausfuehren und protokollieren. Reine TEST-Session:
KEINE Aenderung an `src/`, `public/`, `apps/` (Ausnahme: keiner — auch kein
Fix roter Produkt-Befunde). Rote Tests sind Resultate, keine Fix-Auftraege.
Branch: `test/launch-run-1`, NICHTS pushen (weder origin noch upstream).

## Erwartetes Ergebnis (deterministisch pruefbar) + Verifikation

- [ ] **Schritt 0 Baseline:** `npm test` komplett gelaufen; Erwartung gruen
      (~1591 Tests, Stand master 9f3391a). Verifikation: exit code +
      pass/fail-Zaehler im Protokoll. Rot => erst BASE_ENV-Drift pruefen
      (`test/helpers.js`), dokumentieren, weiter.
- [ ] **Schritt 1 auto (existierende Suiten):** je Test-ID gebuendelt
      `npm test -- test/<datei> ...` gelaufen. IDs: OUT-01/02/03/06/08/13,
      IN-01/02/04/05/06, SMS-03(Bestandsteil), MCP-02/03/04, UI-01, CFG-01,
      AUTH-01/02/03/05/06, BILL-02/03/07, PROV-04, STORE-03, WEB-03(Build),
      WEB-04(auto), DASH-01, OBS-02, CFG-04(grep), DEPLOY-10(auto-grep).
      Verifikation: Protokollzeile je ID mit exaktem Kommando + Zaehler.
- [ ] **Schritt 2 auto (neu zu schreiben):** OUT-05*, IN-03, IN-08, MCP-06,
      MCP-07, MCP-08, UI-02, DASH-02 (OHNE jsdom — kein neues Dep, Adaption
      dokumentieren), SMS-02, CFG-03, PROV-06*, BILL-04-Erweiterung,
      OUT-07/10/11-Ergaenzungen, AUTH-07-auto, OUT-12-auto-Teil.
      (* = erwartet ROT: OUT-05, PROV-06 — nur dokumentieren, kein Produktfix.)
      Konventionen: node:test, PORT=0 + DATA_DIR-Temp, BASE_ENV aus
      test/helpers.js, pglite und Server-Spawn NIE mischen, keine neuen Deps.
      Verifikation: jede neue Datei laeuft einzeln (`npm test -- test/<datei>`),
      Ergebnis im Protokoll.
- [ ] **Schritt 3 lokal:** OUT-04, OUT-09, IN-07, SMS-01, OBS-01, CFG-02,
      PROV-01 (NUR Repro + Zustandsbeschreibung), PROV-05, DEP-01, DEP-02
      (frischer Worktree), OUT-12-auto-Teil falls offen. Serverstart IMMER
      fail-safe mit Dummy-Provider-Keys: `PORT=3999
      SKIP_TWILIO_SIGNATURE_CHECK=true TELNYX_API_KEY=invalid
      TWILIO_ACCOUNT_SID=ACinvalid TWILIO_AUTH_TOKEN=invalid
      PROVISIONING_ENABLED=false PAYMENT_ENABLED=false npm start`.
      `.env` NIE aendern, `data/store.json` NIE anfassen.
      Verifikation: curl-Sequenz + beobachtete HTTP-Antwort je ID im Protokoll.
- [ ] **Schritt 4 live markieren:** alle live-Zeilen als
      "uebersprungen (live, Owner-Session)" im Protokoll.
- [ ] **Protokoll** `tasks/launch-test-run-1.md`: pro Test-ID genau eine
      Zeile (GRUEN/ROT/UEBERSPRUNGEN-live/BLOCKIERT, Kommando, 1-Zeilen-Beleg,
      bei ROT Kurz-Diagnose max 3 Saetze).
- [ ] **Checkboxen** in `PLAN-LAUNCH-TESTS.md` NUR bei GRUEN auf `[x]`.
- [ ] **Git:** alles auf `test/launch-run-1` committet; master unberuehrt;
      kein Push. Fremde uncommittete Aenderungen (apps/hermes-animation-lab,
      apps/hermes-studio, PLAN-MCP-UI-*, PLAN-WIDGET-*) NIE stagen.
      Verifikation: `git log --oneline master..test/launch-run-1` +
      `git diff master --stat -- src public apps` leer.

## Review (wird am Ende befuellt)

- (offen)

## Task: claude.ai-Connector-Icon zeigt Default-Wuerfel statt Hermes-Logo (2026-07-03)

Befund (empirisch, Chrome-DOM + curl):
- claude.ai rendert Custom-Connector-Icons NICHT aus MCP serverInfo.icons,
  sondern via Google-Favicon-Dienst (`google.com/s2/favicons?domain=<connector-domain>`).
- Connector-Domain = app.sundartha.com; Google liefert dafuer 404 (Fallback
  -> Default-Wuerfel). Fuer sundartha.com liefert Google bereits 200.
- Wurzel: Startseite (apps/web/src/pages/index.astro, Standalone-Head ohne
  Layout) deklariert KEIN `<link rel="icon">`; Subdomain ist fuer Googles
  Favicon-Crawler noch unbekannt.

- [ ] index.astro-Head: favicon.svg + favicon.ico Links ergaenzen.
      Erwartet: lokaler Build `apps/web/dist/index.html` enthaelt `rel="icon"`.
      Verifikation: `npm --prefix apps/web run build` + grep.
- [ ] Deploy upstream (master==upstream, nur dieser Commit faehrt mit).
      Erwartet: `curl -s https://app.sundartha.com/ | grep rel="icon"` trifft.
      Verifikation: curl nach Render-Deploy (render-MCP Deploy-Status).
- [ ] Google-Favicon-Cache + claude.ai-Anzeige re-checken (Chrome).
      ACHTUNG: Google-Cache-Refresh ist extern, nicht erzwingbar — falls
      weiterhin 404, als Warte-Punkt dokumentieren + Alternative (Connector
      unter sundartha.com/mcp, single-origin) dem Owner vorlegen.

### Review

- (offen)
