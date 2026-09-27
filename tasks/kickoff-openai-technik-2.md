# Kickoff: OpenAI-Einreichung - technische Restarbeiten, Runde 2

Du bist LEAN LEAD. Ziel: JEDE technische Anforderung der OpenAI-Einreichung, die sich ohne den
Owner bauen laesst, ist am Ende gebaut, geprueft und auf master gemergt. Nicht "der Vorrat",
nicht "die Liste aus dem letzten Bericht" - ALLES technisch Baubare.

Runde 1 ist genau daran gescheitert: sie hat einen mitgegebenen Vorrat abgearbeitet, am Ende
41 von 84 technischen IDs erfuellt vorgefunden, rund die Haelfte der offenen Blocker waere ohne
den Owner baubar gewesen - und sie hat trotzdem "fertig" gemeldet. Das passiert dir nicht.

## 1. Kontext-Disziplin - die oberste Betriebsregel

Ab etwa 100.000 Token Kontext wird ein Agent unzuverlaessig. Runde 1 hat den Lead auf rund
700.000 Token laufen lassen. Das ist verboten. Es gilt fuer den Lead UND fuer jeden Subagenten.

**Lead:**
- Du liest NICHTS selbst: keinen Code, keinen Diff, keinen Testlog, keinen Bericht, keine Spec,
  kein `.output`-File. Jede Leseaufgabe geht an einen Subagenten. Du tippst nur: Workflows
  starten, kompakte Rueckgaben lesen, `git diff --stat`, mergen, den Stand fortschreiben.
- Jeder Workflow gibt dir eine KOMPAKTE, per Schema erzwungene Rueckgabe: Urteil, Commit,
  Testzahlen, offene Blocker - hart begrenzt (Richtwert <= 1.500 Zeichen je Phase). Nie ein
  ausfuehrlicher Bericht, nie roher JSON-Ballast. Wird eine Rueckgabe abgeschnitten, fordere
  eine kuerzere an, statt die Datei auszulesen.
- Workflow-Skripte liegen als Datei unter `.claude/workflows/runs/` und werden per `scriptPath`
  gestartet. Aendern nur per kleinem Patch, nie das ganze Skript neu in den Chat schreiben.
- An den Owner waehrend der Kette nur Statuszeilen (1-3 Zeilen je Phase). Keine Essays.
- **Uebergabe statt Ueberlauf:** Spaetestens nach 5 gemergten Phasen - oder sofort, wenn du merkst,
  dass dein Kontext gross wird - schreibst du den Stand fort und legst
  `tasks/kickoff-openai-technik-2-weiter.md` an (kurz: wo die Kette steht, naechste Phase, was
  gilt), und hoerst auf. Der Owner startet eine frische Sitzung. Eine saubere Uebergabe ist kein
  Abbruch, sondern die Regel.

**Subagenten:**
- Phasen so klein schneiden, dass jeder Agent deutlich unter 100.000 Token bleibt: je Phase
  wenige zusammengehoerige IDs, ein abgegrenzter Dateibereich. Lieber mehr, kleinere Phasen.
- Jeder Agent committet frueh und gibt seine strukturierte Rueckgabe ab, SOLANGE ER NOCH LUFT HAT
  - lieber eine Rueckgabe mit offenen Punkten als keine. (Runde 1: ein Bau-Agent starb nach 269
  Werkzeugaufrufen ohne Rueckgabe, die Arbeit lag nur gestaged.)
- Pruef- und Verifikations-Agenten pruefen NUR ihre Phase, nicht das ganze Repo.

## 2. Der Auftrag und wann er fertig ist

**Scope:** jede technische ID aus `tasks/openai-audit/00-openai-anforderungen.md`, die heute nicht
ERFUELLT ist. Ausgangsbild: `tasks/openai-technik-schlussabnahme.md` (41 von 84 erfuellt, mit
Tabelle aller 100 IDs und Blockerliste). Diese Datei ist LANDKARTE, nicht Beleg - die IDs werden
neu gemessen, nicht abgeschrieben.

**Fertig ist die Kette NUR, wenn jede technische ID einen dieser Endzustaende hat:**
- ERFUELLT - belegt am Code, an einem Test oder am Draht;
- GEGENSTANDSLOS - mit Beleg, warum sie auf Hermes nicht zutrifft;
- OWNER - und zwar nur, wenn sie wirklich etwas braucht, das nur der Owner hat (siehe Abschnitt 4).
  "Aendert Live-Verhalten" ist KEIN Owner-Grund: diese Kette pusht nie, live geht nur, was der
  Owner deployt. Der Deploy IST das Owner-Gate. Einzige Ausnahme: eine Aenderung, die beim Deploy
  die Produktion lahmlegen kann, weil ein Live-Wert ungemessen ist - die wird gebaut UND mit einer
  Deploy-Vorbedingung auf die Owner-Liste gesetzt.

Zeigt die Schlussmessung noch eine baubare Luecke, bist du NICHT fertig - dann baust du weiter.
"Folgekette anbieten" ist kein Abschluss.

## 3. Bereits getroffene Owner-Entscheidungen - nicht erneut fragen

- **2026-09-22: Einreichung MIT Widget-UI.** Das Widget soll auch in ChatGPT sichtbar sein.
  Damit sind T-30, T-31, T-23, T-34, X-3, X-7 Pflicht und keine Option mehr.
- **2026-09-22: `get_transcript` darf umbenannt werden** (N-12). Es gibt keine echten Nutzer -
  alle aktiven Accounts sind das Team selbst. Das gilt allgemein: Breaking Changes an Werkzeugen
  sind erlaubt, wenn eine Anforderung sie verlangt. Der eigene Claude-Connector des Owners wird
  beim naechsten Deploy mit umgestellt.
- Alles unter "Autonome Entscheidungen" in `tasks/openai-technik-stand.md` gilt weiter.

## 4. Was nur der Owner kann - vorbereiten, nicht versuchen

Deploy/Push; die Messung im ChatGPT Developer Mode (Origin-Header, Quell-IP, Capabilities);
ein echtes Access-Token dekodieren (`aud`, `scope`, `exp`, `email_verified`); den Wert des
Challenge-Tokens; Werte im Render-Dashboard; Einstellungen beim Sprach-Anbieter
(`retention_days`); Live-Proben in Claude und ChatGPT; Rechtstext-Inhalte.
Fuer jeden dieser Punkte gilt: so vorbereiten, dass der Owner ihn in wenigen Minuten erledigt -
Schritt-fuer-Schritt, mit erwartetem Ergebnis und mit dem schon gebauten und getesteten Code, der
nur noch auf seine Messung wartet.

## 5. Stufe 1 - Strategiedokument per Workflow

Ein dynamischer Workflow schreibt `tasks/PLAN-OPENAI-TECHNIK-2.md`:
- **Abdeckung zuerst:** eine Tabelle mit JEDER technischen ID der 100er-Liste, die nicht ERFUELLT
  ist -> Phase, oder GEGENSTANDSLOS mit Beleg, oder OWNER mit Grund nach Abschnitt 2. Keine ID
  fehlt. Ein Kritiker-Agent prueft diese Tabelle gegen die LISTE (nicht gegen einen Vorrat) und
  gegen die Owner-Grund-Regel: jeder OWNER-Eintrag, der in Wahrheit baubar ist, ist ein Blocker.
- Phasen nach Risiko geschnitten und klein (Abschnitt 1). Auth, Transport, Widget-UI und
  Geldpfad je eigene Phase mit eigener Gegenprobe.
- Je Phase: Ziel, IDs, Dateien, Abnahmekriterium als pruefbare Beweisart, und ein Pre-Mortem
  ("ein Jahr spaeter war diese Phase ein Fehler - was ist passiert?"), konkret, nicht generisch.
- Harte Nuesse, die der Plan mit Belegen aus der Primaerquelle (developers.openai.com) loesen muss:
  - **T-30/T-31:** `_meta.ui.csp`/`_meta.ui.domain` gehoeren an den RESOURCE-INHALT
    (`resources/read` -> `contents[]._meta`), Hermes setzt sie heute am Tool-Deskriptor.
    `domain` ist host-abhaengig: Claude erwartet `<sha256(connector-url)[:32]>.claudemcpcontent.com`,
    OpenAI einen eigenen Origin. Der Transport ist zustandslos, der Server erkennt den Host nicht.
    Gesucht ist ein Weg, der in Claude UND ChatGPT funktioniert (Kandidaten zum Pruefen, nicht
    vorgegeben: Standard-`csp` am Inhalt plus `domain` ueber den OpenAI-Alias
    `openai/widgetDomain`; Host-Erkennung pro Request; zustandsbehafteter Transport). Was nur eine
    Live-Probe klaert, wird als Owner-Probe vorbereitet.
  - **T-29 (CORS):** `/mcp` weist `Origin: https://chatgpt.com` heute mit 403 ab, solange
    `MCP_ALLOWED_ORIGINS` leer ist. Mit UI in ChatGPT wird das wichtiger. Die Strenge wird nicht auf
    Verdacht gelockert: den genauen Wert vorbereiten und testen, setzen tut ihn der Owner nach
    seiner Messung.
  - **O-27:** die `place_call`-Beschreibungen nennen "Claude/Gemini" und "calendar, mail, files,
    chat". Die Texte sind an `convo-bench` kalibriert: aendern NUR mit Vorher-/Nachher-Messung
    (`npm run convo-bench`, n>=5). Laeuft der Bench nicht (z.B. Anbieterkonto leer), ist das der
    belegte Owner-Grund - vorher versuchen.
  - Rate-Limit 120/min PRO IP: hinter OpenAIs gemeinsamen Egress-IPs drosselt es alle
    ChatGPT-Nutzer zusammen.
- Ausdruecklich: was NICHT gebaut wird, und warum.

## 6. Stufe 2 - eine Phase, ein Workflow

Grundlage ist das Phasen-Skript aus Runde 1: `.claude/workflows/runs/openai-phase.js`
(Planen -> Bauen im Worktree -> Safety-Review Opus + Clean-Code-Audit Sonnet -> Nachbessern ->
Bericht; Phase oben als Literal gepinnt; Schalter `VORGEBAUT`, um einen abgestuerzten Bau
aufzunehmen). Vor der ersten Phase verbessern:
- **Die unabhaengige Verifikation kommt IN den Workflow** als letzter Schritt: ein eigener
  Opus-Agent, der Spec und Bericht NICHT sieht, neutral fragt ("ist X erfuellt und woran siehst du
  das"), selbst misst, und ein kompaktes Schema-Urteil liefert. Sagt er NEIN: Fix-Agent, dann
  erneut Verifikation, hoechstens zwei Runden. Runde 1 hat genau das jedes Mal von Hand im Lead
  nachgeschoben - das hat den Kontext gefressen.
- Berichte NIE in den Branch committen - sie landen sonst als Prozessmuell auf master.
- Rueckgabe an den Lead nur das Kompaktschema aus Abschnitt 1.

Modellpolitik: Opus fuer Planen, Safety, Verifikation und JEDES Dokument, das an OpenAI geht;
Sonnet fuer Bauen und Clean-Code-Audit. Pin pro `agent()`, nie geerbt.
`.claude/refs/clean-code.md` ist hartes Gate (Blocker bei Verstoss).

Nach jeder Phase: `git diff --stat` selbst ansehen, dann mergen (`--no-ff`). Widerspricht die
Verifikation dem Bericht, gewinnt die Verifikation.

## 7. Stufe 3 - Schlussabnahme

Wie in Runde 1 (vier Opus-Pruefer je Teil der Liste, ein Zusammenfuehrer, Vollstaendigkeit gegen
genau 100 IDs, Stichprobe von mindestens zehn Belegen, nur ERFUELLT zaehlt). Neu: fahre eine
Zwischenmessung schon nach der Haelfte der Phasen - dann siehst du Luecken, solange noch gebaut
wird. Danach gilt Abschnitt 2: Luecke gefunden -> weiterbauen.

## 8. Fallen aus Runde 1 - teuer gelernt

- `registerTool()` des MCP-SDK verwirft unbekannte Felder STILL. Ein Test am Registrierungsobjekt
  beweist nichts - geprueft wird am echten `tools/list`-Output ueber die Route.
- Doppelte Pfade: HTTP `/mcp` und stdio, OAuth- und token-/Legacy-Modus. Ein Punkt ist erst
  erfuellt, wenn er auf allen betroffenen Pfaden gilt.
- In Runde 1 wurden ZEHN luegende Kommentare gefunden, gehaeuft dort, wo sich Verhalten aenderte.
  Jede Verhaltensaenderung zieht die Kommentare mit.
- Dokumente fuer OpenAI sind BEIDE in erster Fassung durchgefallen, alle Code-Phasen nicht. Die
  Begruendungen waren aus Plausibilitaet geschrieben. Deshalb: Opus schreibt, fuer jede Aussage
  ueber ein Werkzeug ZUERST Handler und eigene `tools/list`-Beschreibung lesen; die englische
  Fassung darf nie glatter sein als die deutsche; OpenAI woertlich aus der Primaerquelle zitieren;
  keine internen Kennungen (Phasen, H-Nummern) im Text.
- `render.yaml` ist NICHT die Produktionswahrheit (`CONSULT_ENABLED` steht dort auf `false`, ist
  live aber AN). Produktionswerte sind Dashboard-gepflegt.
- NIE Produktionswerte in eine Datei schreiben, die committet wird. Bevor Prozessdateien
  committet werden, Secrets/PII-Pruefung. `tasks/openai-p10b-spec.md` enthaelt Produktionswerte -
  nicht committen. Branch `phase/openai-p10b-http` nie pushen.
- Der pre-commit-Hook lintet den GANZEN Arbeitsbaum inkl. ungetrackter Owner-Dateien und
  scheitert dort. `--no-ff`-Merges loesen ihn nicht aus. Normale Commits im Haupt-Baum (Squash,
  Aufraeumen) deshalb in einem sauberen Hilfs-Worktree (node_modules per Symlink), dann
  `git merge --ff-only`. Einen gestagten Squash nur mit `git reset --merge HEAD` zuruecknehmen,
  NIE `reset --hard` - `tasks/lessons.md` traegt ungespeicherte Owner-Aenderungen.
- Testkommando `npm test -- -- --test-concurrency=4` (nur der doppelte `--`-Trenner kommt an).
  Der Exit-Code luegt - nur `# pass`/`# fail` zaehlen. Die Suite ist nicht deterministisch: ein
  roter Test zaehlt erst, wenn er ISOLIERT erneut rot ist.
- Der Sandbox-Klassifizierer blockiert lokales Abschwaechen von Auth-Code, auch fuer Gegenproben.
  Die Beweiskraft solcher Tests wird durch Lesen der Zusicherungen beurteilt.
- Website (`apps/web`, sundartha.com) nur ueber `staging` und das Labor
  (`docs/RUNBOOK-LAB-LIVE.md`), nie direkt auf master. `npm test` deckt `apps/web` nicht ab.

## 9. Betriebsregeln (nicht verhandelbar)

- EINE Bahn zur Zeit. Waehrend eine Welle laeuft, wird nicht auf master gemergt.
- Phase im per-run-Skript pinnen, Git-Stand selbst pruefen. Worktree: erst
  `git worktree add -b <branch> <pfad> master`, dann lesen.
- Ein abgebrochener Lauf hinterlaesst einen Branch: erst belegen, was drauf liegt, dann aufraeumen.
- Nie `git add -A`, Dateien einzeln. Kein Push. Force-Push nur `--force-with-lease`.
- Neue Env-Variable: `src/config.js`, `.env.example`, `render.yaml` UND `BASE_ENV` in den Tests.
- Die Safety-Gates aus CLAUDE.md werden NICHT angefasst. Der Offenlegungssatz bleibt.
- Kein echter Anruf, keine echte SMS, kein Schreibzugriff auf Produktion.
- Nach der Kette: Prozessdateien nach der CLAUDE.md-Regel aufraeumen (erst committen, dann
  loeschen, vorher Secrets-Pruefung).

## 10. Frageverbot fuer deine Agenten (woertlich in jeden Auftrag)

> DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht
> erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter.
> Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine
> ausdrueckliche Owner-Freigabe ersetzt.

## 11. Was an den Owner geht

Nichts blockiert, nichts wird zwischendurch gefragt. Stand und Entscheidungen fuehrst du in
`tasks/openai-technik-2-stand.md` (knapp halten, du liest ihn nicht staendig neu). Am Ende EINE
kompakte Liste: nur die Punkte aus Abschnitt 4, jeder schon vorbereitet, mit Anleitung.

## 12. caffeinate

AN, sobald der erste Workflow laeuft: `nohup caffeinate -is -t 10800 &`, PID in eine Datei im
Scratchpad. Pruefen mit `ps -p <pid>` (nie `pgrep` - blind in dieser Sandbox), vor Ablauf
erneuern. AUS, sobald die Kette fertig ist oder du uebergibst.
