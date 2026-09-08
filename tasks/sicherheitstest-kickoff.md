# Kickoff: Sicherheitstest weiterfuehren

Kopiere den Block unten als erste Nachricht in die neue Session. Er ist so geschrieben, dass
er ohne den fluechtigen Scratchpad der Vorsession auskommt — alles Bleibende liegt im Repo.

---

Du fuehrst einen laufenden Sicherheitstest von Hermes fort. Lies ZUERST `CLAUDE.md` (Absolute
Regeln), dann diese drei Dateien vollstaendig, verlass dich NICHT auf Zusammenfassungen:

- `PLAN-SICHERHEITSTEST.md` — der Testkatalog (IDs, Angriffspfade, Soll-Ergebnisse). Der Plan ist
  fertig; hier wird NICHT geplant, sondern abgearbeitet.
- `tasks/sicherheitstest-befunde.md` — das Befundprotokoll. HIER steht, was schon gemessen wurde.
  Alles Neue traegst du hier ein, im selben Format (BESTANDEN / BEFUND / OFFEN, je mit Beleg).
- Memory `sicherheitstest-plan.md` (im Kontext ueber MEMORY.md).

## Auftrag und Grenzen (nicht verhandelbar)

Der Owner will LUECKEN FINDEN, keine Fixes bauen. Ob und was gefixt wird, entscheidet er separat.
Du BAUST also keine Fixes und keine Regressionstests (Ausnahme: die 5 Struktur-Waechter aus
Abschnitt "Gruppe A" des Plans darfst du bauen, wenn der Owner es ausdruecklich sagt — sonst nicht).

Erlaubt: read-only gegen Produktion (SELECT, GET, Dashboard-Ablesen), und aktive Proben gegen
einen LOKAL gestarteten Server. Verboten, ausnahmslos: Angriffe/Scanner/POST-mit-Seiteneffekt
gegen Produktion, echte Anrufe, echtes Geld, Lesen von `.env`/`.env.bak-*`. Kein `git push`, kein
Deploy, kein Aendern eines Live-Env-Werts. Die Anbieter-Regeln (Telnyx-AUP, Render) verbieten
aktives Testen gegen Produktion — Welle W4 bleibt gesperrt.

## Stand (nach Lauf 2, 2026-09-08): 15 Funde, 13 bestanden

Kurzfassung — die Details mit Belegen stehen im Protokoll (`tasks/sicherheitstest-befunde.md`,
Abschnitte "Lauf 1" und "Lauf 2"):

- **Die Kernlogik haelt, auch im Fehlerfall.** Mandanten-Trennung in der DB (DB-01/03) und ueber
  den MCP-Hop (L-02). Neu belegt: 17 von 17 sterbenden Gate-Datenquellen fuehren zu **null**
  Wahlversuchen (GATE-02); korrupte UND werfende Budgetquellen sperren Inbound fail-closed
  (GATE-03); die Wahlfunktion hat je Weg genau EINEN Aufrufer, alle hinter der Kette (GATE-01);
  Routen-Fuzzing + Traversal finden nichts (L-03).
- **Die Loecher sitzen an den Raendern und im Wiederholungsfall.** Neu: **REPLAY-02** — ein
  identisch wiederholter `/voice/turn` bucht ein zweites Mal Geld (828 -> 1656 Cent) und
  verdoppelt das Transkript; `/voice/status` ist dagegen ueber `billedAt` sauber. **GATE-02
  Antwortverhalten** — 14/17 sterbende Quellen lassen den Request ohne jede Antwort haengen.
  **`scripts/spike2-anruf.mjs`** waehlt beim Anbieter an allen Gates vorbei.
- **Aus Lauf 1 unveraendert offen:** L-01 (EL-Token ohne Mandanten-Dimension), CFG-01
  (`ALLOWED_COUNTRY_CODES=*`), OPS-02 (Deploy-Repo nicht administrierbar, `hermes-web`
  autoDeploy=yes), ID-01, REPLAY-01, OPS-05, fehlendes HSTS + `unsafe-inline`, PI-01, ID-02,
  WEB-01.

## Als Naechstes, in dieser Reihenfolge

1. **DB-05 / OPS-04 / OPS-03-Rest — Owner-Handgriffe.** Die vier konkreten Handgriffe stehen
   im Protokoll unter "Was der Owner selbst messen muss". OPS-03 ist teilweise erledigt:
   Log-Aufbewahrung ~7 Tage, gemessen; offen ist nur noch der Log-Stream zu einem Drittdienst.
2. **L-04** (Injektions-Bench, `npm run convo-bench`) — braucht echte Schluessel und kostet
   Geld; NUR nach ausdruecklicher Owner-Freigabe, Vorher-Messung ZUERST.
3. **Gruppe A (die fuenf Struktur-Waechter)** — nur, wenn der Owner es ausdruecklich sagt.
   Nach Lauf 2 sind zwei davon besonders billig geworden, weil die Messung schon steht:
   GATE-01 (Aufrufer-Inventar) und GATE-02/03 (fail-open-Proben).
4. **W5 / VDP** — `security.txt` kostet nichts und ist unabhaengig von allem anderen.

## Methode und Fallen (aus Lauf 1 gelernt)

- Aktive Proben sind Einmal-Skripte im Scratchpad, KEINE Repo-Tests. Muster: den Server ueber
  `test/helpers.js` `startServer({env, seed})` spawnen (nutzt Eltern-Waechter, PORT=0). Seeds ueber
  `seedState`/`seedCall`. Signierte `/voice`-Requests ueber `makeTelnyxSigner`. MCP-Tenant-Proben
  ueber `startIdp`/`mcpPost`/`toolCall` (Muster `test/am6-oauth-tenant.test.js`).
- FALLE 1: `node probe.mjs | tail` puffert bis Prozessende — bei einem haengenden Serverstart
  siehst du NICHTS. Ausgabe ohne Pipe, oder `run_in_background: true` und die Output-Datei lesen.
- FALLE 2: Scratchpad-Skripte koennen `express` nicht per Bloss-Name importieren. Absoluter Pfad:
  `await import(`${R}/node_modules/express/index.js`)`.
- FALLE 3: `sleep` im Vordergrund ist blockiert. Server-Spawns immer `run_in_background: true`.
- METHODE: jede Negativ-Probe braucht eine Positiv-Kontrolle (erfundene ID -> erwartete Ablehnung),
  sonst heisst "kein Fund" vielleicht nur "die Probe sucht nichts". Bei L-01 war genau das
  ABWEICHENDE Ablehnungsergebnis der Beweis.
- FALLE 4 (Lauf 2, zweimal zugeschlagen): **die Probe muss ihren Gegenstand nachweislich
  TREFFEN.** Eine vergiftete Store-Methode, die das Gate nie aufruft, sieht aus wie "haelt";
  ein Traversal gegen einen gar nicht montierten statischen Mount sieht aus wie "dicht". Beides
  passiert real: `resolveProfile.unrestricted` kurzschliesst das Verifikations-Gate, und
  `BASE_ENV` pinnt `WEB_DIST_DIR=""`. Gegenmittel: Aufruf-ZAEHLER an der vergifteten Methode
  bzw. eine Positiv-Kontrolle auf derselben Oberflaeche im selben Lauf.
- FALLE 5: **ueber die LAN-IP messen, nie ueber `127.0.0.1`.** `internalOnly`
  (`isTrustedLocalCaller`) laesst den Loopback durch: `/api/state` liefert lokal 200 mit
  Tenant-Daten, ueber die LAN-IP 403. `srv.externalUrl` aus `test/helpers.js`.
- FALLE 6: ein Spawn-Server mit ueber-Zeit-Call bucht beim BOOT (Max-Dauer-Re-Arm), bevor die
  erste Zustellung ankommt — eine Vorher/Nachher-Messung misst dann den Boot, nicht den
  Webhook. Frisch gestarteter Call + grosszuegiges `maxDurationS`.
- LLM-Wege lassen sich ohne Anbieter messen: `ANTHROPIC_BASE_URL` auf einen lokalen Stub
  zeigen lassen (Muster `test/al-p6-turn-deadline-budget.test.js`), Token-Zahlen frei waehlen.
- Der Sicherheits-Klassifikator blockiert Muster-SELECTs, die wie PII-Ernte aussehen (Suche nach
  Rufnummern/Mails). Solche Abfragen dem Owner mit `!`-Prefix zum Selbstausfuehren geben.

## Owner-Entscheidungen, die schon Antworten haben

8.4-5 (EL-Token): durch L-01 beantwortet — **Tenant-Bindung faellig**, Rotation allein genuegt
nicht. 8.4-2 (Land-Gate): durch CFG-01 belegt — steht live auf `*`. Beides im Plan als Entscheidung
(8.5) und als getragenes Risiko (`PLAN-SECURITY.md` SEC-TEST) dokumentiert.

## Am Ende

Befundprotokoll aktualisieren, Pfadstand-Tabelle fortschreiben, dem Owner Funde nach Schwere melden
(nicht nach Reihenfolge des Findens). Keine Fixes ohne ausdrueckliche Freigabe.
