# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Strategie Launch-Fixes (OUT-05, PROV-01, A6) — 2026-07-03

Auftrag: `NEXT-SESSION-LAUNCH-FIXES-STRATEGY.md`. Reine STRATEGIE-Session:
Analyse, Design, Phasenschnitt, Prompts. KEINE Implementierung, Code strikt
read-only. Alles entsteht in DIESEM Worktree auf `docs/launch-fixes-strategy`,
KEIN Merge nach master, NICHTS pushen, KEIN `git stash`.

- [x] 1. Eigenes Worktree, allererster Schritt
  - Erwartet: Session arbeitet in `.claude/worktrees/launch-fixes-strategy`
    auf Branch `docs/launch-fixes-strategy`, Basis = lokaler `master` (361e55b)
  - Verifikation: `git worktree list` + `git log --oneline -1`
  - Ergebnis: erledigt — EnterWorktree, Branch umbenannt
    (`worktree-launch-fixes-strategy` -> `docs/launch-fixes-strategy`),
    `reset --hard 361e55b` (HEAD bestaetigt)

- [x] 2. Dynamic Workflow: Map (3x Sonnet, read-only) -> Design (3x Opus) ->
  Pre-Mortem (3x Opus, adversarial) -> Revision (1 Runde) -> Synthese
  - Erwartet: `PLAN-LAUNCH-FIXES.md` existiert im Worktree-Root und enthaelt
    pro Defekt: verifizierte Wurzelanalyse (Dateipfade), Fix-Design,
    verworfene Alternativen mit Grund, betroffene Absolute Regeln,
    Test-first-Definition, Rollback-Plan, Pre-Mortem-Restrisiken; dazu
    Phasenschnitt F1..Fn (je Phase deterministisches erwartetes Ergebnis +
    exaktes Verifikationskommando + Abhaengigkeiten), empfohlene Reihenfolge
    mit Begruendung, PLAN-SECURITY.md-Vermerk, offene Owner-Fragen
  - Verifikation: Datei lesen und Punkt fuer Punkt gegen den Abschnitt
    "Anforderungen an PLAN-LAUNCH-FIXES.md" der Auftragsdatei pruefen
  - Ergebnis: erledigt — Workflow `wf_2c4a33ed-720`, 13/13 Agenten ohne
    Fehler; Datei komplett gelesen (1123 Zeilen), ALLE Pflicht-Abschnitte
    vorhanden: Kap. 1-3 je Defekt (Wurzel mit Datei:Zeile, Design,
    Alternativen, Regel-Nachweis, Test-first, Rollback, Restrisiken),
    Kap. 4 Phasen F1-F12 (je Ergebnis+Kommando+Abhaengigkeiten+Groesse),
    Kap. 5 Reihenfolge begruendet (Owner-Vorgabe uebernommen), Kap. 6
    PLAN-SECURITY-Eintraege, Kap. 7 sechs Owner-Fragen. A6 = 5 Phasen,
    Reconcile-Schutz zuerst (F8), Drill separat — wie gefordert

- [x] 3. `NEXT-SESSION-LAUNCH-FIXES-IMPL.md` (Lean-Lead-Prompt) schreiben
  - Erwartet: enthaelt Lead-Regeln (liest NIE Code, <100k, mergt selbst),
    Phase-Pinning im per-run Skript + Git-Stand-Check vor Phasenstart,
    Branch-Schema `fix/<phase>`, Push-Verbot ohne Owner-Freigabe +
    Deploy-Freeze-Hinweis, Merge-Koordination mit Test-Session
    (`git worktree list` + `git status` im Haupt-Checkout), Test-Konventionen
    (node:test, PORT=0, DATA_DIR-Temp, BASE_ENV, pglite/Spawn-Trennung),
    kein `git stash`, npm test gruen + Report-Datei pro Phase
  - Verifikation: `grep -c` auf die Pflicht-Stichworte (fix/, BASE_ENV,
    git stash, worktree list, <100k, Owner-Freigabe) — jeweils >= 1 Treffer
  - Ergebnis: erledigt — alle 10 geprueften Stichworte >= 1 Treffer
    (fix/<phase>, BASE_ENV, git stash, git worktree list, <100k,
    Owner-Freigabe, hart gepinnt, PORT=0, pglite, Report-Datei)
  - Nachtrag (Owner-Review): Abschnitt "Effizienz-Regeln" ergaenzt —
    Self-Fix-Deckel (2 erfolglose Runden -> Eskalation an den Lead,
    Konvergenz-Definition), S-Phasen ohne breite Exploration (F3/F6/F8),
    unabhaengige Phasen F1/F3/F4/F8 parallel implementieren bei strikt
    sequenziellen Merges (F9 nicht parallel zu offenem F2 wegen finishCall)

- [x] 4. Commit auf `docs/launch-fixes-strategy`
  - Erwartet: genau die drei Session-Dateien (`PLAN-LAUNCH-FIXES.md`,
    `NEXT-SESSION-LAUNCH-FIXES-IMPL.md`, `tasks/todo.md`) committet,
    `git status` danach clean, Haupt-Checkout unberuehrt
  - Verifikation: `git log -1 --stat` + `git status --short`
  - Ergebnis: erledigt — Commit `5475d45` (amended: Todo-Abschluss), 3 Dateien,
    status clean; Workflow-Zwischendokumente (map/design/premortem je Defekt)
    lagen im Worktree-Root und wurden ins Session-Scratchpad verschoben
    (nicht committet, gehoeren nicht ins Repo)

- [x] 5. Abschluss-Report als letzte Nachricht
  - Erwartet: Kernentscheidung je Defekt (3-5 Saetze), Phasenliste mit
    Groesse+Reihenfolge, offene Owner-Fragen, Pfade beider Deliverables,
    Branch-Name + Worktree-Pfad
  - Verifikation: Abgleich gegen Abschnitt "Abschluss-Report" der Auftragsdatei

## Task: claude.ai-Connector-Icon zeigt Default-Wuerfel statt Hermes-Logo (2026-07-03)

Befund (empirisch, Chrome-DOM + curl):
- claude.ai rendert Custom-Connector-Icons NICHT aus MCP serverInfo.icons,
  sondern via Google-Favicon-Dienst (`google.com/s2/favicons?domain=<connector-domain>`).
- Connector-Domain = app.sundartha.com; Google liefert dafuer 404 (Fallback
  -> Default-Wuerfel). Fuer sundartha.com liefert Google bereits 200.
- Wurzel: Startseite (apps/web/src/pages/index.astro, Standalone-Head ohne
  Layout) deklariert KEIN `<link rel="icon">`; Subdomain ist fuer Googles
  Favicon-Crawler noch unbekannt.

- [x] index.astro-Head: favicon.svg + favicon.ico Links ergaenzt; zusaetzlich
      favicon.svg (war generisches Indigo-Zeichen!) durch Fluegel-Marke ersetzt
      (SVG-Wrapper um 128px-Brand-PNG aus src/brand-icon-data.js).
      Verifiziert: Build gruen, beide Links in dist/index.html, SVG-Thumbnail
      zeigt Fluegel.
- [x] Deploy: Commit 361e55b origin+upstream; beide Render-Deploys live
      (hermes-web 07:34Z, vodafone-agent 07:35Z), healthz {"ok":true},
      /mcp weiter 401 fail-closed. Verifiziert: beide Origins liefern die
      neuen Head-Links + Fluegel-SVG (curl).
- [x] Re-Check: google s2 sundartha.com liefert weiter den ALTEN Wuerfel
      (559B, Stale-Cache), claude.ai zeigt entsprechend noch Wuerfel.

### Review

- Mechanismus empirisch belegt (Chrome-DOM): claude.ai-Connector-Icon =
  `google.com/s2/favicons?domain=sundartha.com&sz=32` (registrierbare Domain,
  Subdomain gestrippt) — serverInfo.icons wird dort NICHT benutzt, Re-Connect
  aendert nichts. Der Wuerfel ist Googles gecachtes Render-DEFAULT-Favicon
  von vor dem favicon.ico-Deploy (2026-07-02).
- Alles Kontrollierbare ist gefixt+live; verbleibt NUR der externe
  Google-Cache-Refresh (Stunden bis Tage). Check-Kommando:
  `curl -sL 'https://www.google.com/s2/favicons?domain=sundartha.com&sz=64'`
  (559B=alt/Wuerfel; anderes Ergebnis=Fluegel). Beschleuniger waere nur
  Google Search Console (Owner-Google-Account).
- Memory: [claude-connector-icon-mechanism] angelegt, Re-Connect-Hypothese
  in [widget-i18n-icon-polish] widerlegt.
- Nachtrag (Owner-Auftrag, via Chrome): Google Search Console Property
  https://sundartha.com angelegt + per HTML-Datei bestaetigt
  (apps/web/public/googleb431b04eee6fa345.html, deployt — Datei NICHT
  loeschen, sonst verfaellt die Bestaetigung), Startseiten-Indexierung
  beantragt (bevorzugte Crawling-Warteschlange), sitemap.xml eingereicht
  ("Konnte nicht abgerufen werden" = bekannter Anzeige-Quirk direkt nach
  Submit; Datei live 200/application/xml verifiziert). Damit ist der
  Google-Recrawl angestossen; Favicon-Cache-Update folgt daraus.
