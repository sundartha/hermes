# T2-17-Bericht — Server-instructions: Kern in die ersten 512 Zeichen (T-21)

Branch `phase/openai-t2-17-instructions-512-core`, Worktree
`.../scratchpad/wt-t2-17`, kein neuer Commit (Diff liegt ungetrackt im Worktree, im
Report unten belegt über `git diff master...HEAD`). Basis: master `28e6fdb`.

## 1. Was NICHT erfüllt ist

- **Plan-Abnahme (Zeile 1019–1021) ≠ gebauter Test.** Der Plan-Text verlangt wörtlich
  `confirmation_code` sowie `await_call_event`/`done` "in jedem Modus (Consult an/aus,
  ...)" in den ersten 512 Zeichen. Gebaut wurde stattdessen die Fassung aus
  `T2-17-spec.md` (vom Lead vorentschieden): `confirmation_code` (mit Unterstrich) steht
  an **keiner** Stelle im Gesamttext — das war schon vor dieser Phase so (das Modell
  sieht den Code seit T2-14 nie, die Karte wählt) — und `await_call_event`/`done` fehlen
  im Basis-Kern (ohne Consult, stdio), weil die Werkzeuge dort gar nicht registriert
  sind. Der Bestandspin `test/openai-p4-ergebnisstruktur-instructions.test.js:285/:324`
  verbietet die Nennung dort explizit; ein Kern, der den Plan-Wortlaut wörtlich erfüllt,
  wäre also ein Regressions-Bruch gegen einen bestehenden Test. Das Review-Urteil
  cleancode markiert das als offenen, nicht blockierenden Befund — reine
  Doku-Angleichung im Plan steht noch aus.
- **Kein neuer Commit.** Die Änderung liegt nur im Diff des Phasen-Worktrees. Vor einem
  Merge muss sie noch committet werden (oder der Merge-Prozess tut das).
- **Deploy-Vorbedingung aus T2-16 bleibt offen**, jetzt erweitert auf den Endstand inkl.
  T2-17: ein echter `briefing-bench`-Lauf (alt `66d95ae` gegen Endstand) ist NICHT
  gelaufen — Versuch im Worktree scheitert wortgetreu am Anthropic-Guthaben (s. Owner-
  Punkte). Ohne diesen Lauf ist die Wirkung der Textänderung auf echte Modellantworten
  unbelegt, nur strukturell (Draht-Test) geprüft.
- **Consult-Kern wird vom `briefing-bench` nicht gemessen**, weil der Bench-Kindprozess
  über stdio läuft und dort Consult hart aus ist (`STDIO_CONSULT_LOOP`). Benannte Lücke,
  in README/PLAN-SECURITY dokumentiert, kein Test deckt sie.
- **MCP_WIRE_PATHS selbst wurde nicht um die zwei UI-Pfade erweitert** (Plan-Schritt 3
  sagt wörtlich "Harness erweitern"); statt dessen wurden `legacySnapshot`/
  `stdioSnapshot` exportiert und im neuen Testfile zu einer eigenen `ALL_PATHS`-Liste
  kombiniert. Deckt denselben Punkt (mind. zwei UI-an-Pfade gemessen), aber anderer
  Dateischnitt als im Plan-Wortlaut.

## 2. Was erfüllt ist (T-21)

- **Kern-Vorspann existiert, quellgleich aus `CALL_PURPOSE_EXCLUSIONS`.** Vier neue
  modul-interne Konstanten (`CORE_SEQUENCE`, `CORE_CONSULT_LOOP`, `CORE_PURPOSE`,
  `CORE_MONEY`) plus Bauer `instructionsCore(consultLoop)` in
  `src/mcp-server-info.js:122-158`. `CORE_PURPOSE` wird aus derselben Tabelle gebaut wie
  `CALL_PURPOSE_SHORT_RULE` — eine neue Ausschluss-Kategorie zieht automatisch nach.
- **Komposition:** `MCP_BASE_INSTRUCTIONS = instructionsCore(false) + " " + BASE_DETAILS`
  (Zeile 258), `MCP_CONSULT_INSTRUCTIONS = instructionsCore(true) + " " + BASE_DETAILS +
  " " + CONSULT_BLOCK` (Zeile 259). Bisheriger Bestandstext (`BASE_DETAILS`, vormals
  exportiert als `MCP_BASE_INSTRUCTIONS`) ist byte-identisch dahinter erhalten.
- **Messung am echten Draht, nicht an Konstanten:** neuer Test
  `test/openai-t2-17-instructions-kern.test.js`, 34 Fälle, isoliert grün
  (`NODE_ENV=test node --test test/openai-t2-17-instructions-kern.test.js` → `pass 34,
  fail 0`, Log unter `logs-t2-17/t2-17-new.log`). Deckt:
  - Gesamttext ASCII-only je Pfad (begründet Zeichen=Byte=length-Zählweise).
  - `core = head.slice(0, head.lastIndexOf(".")+1)` von `instructions.slice(0,512)` —
    nur vollständige Sätze zählen (kein Merkmal in einem abgeschnittenen Wort).
  - Im Kern (alle Pfade): `CONFIRMATION_SEQUENCE_START`, "Hermes card", "places the
    call", "never call place_call yourself", "invent a confirmation code", "user asks
    for", `"not-placed"` in Anführungszeichen, "retry", jeder einzelne
    `CALL_PURPOSE_EXCLUSIONS[i].full`.
  - Im Gesamttext (alle Pfade): volle `CALL_PURPOSE_RULE`, "Do NOT retry the call",
    "Never invent facts" — Plan-Pre-Mortem-Pflichtsätze bleiben.
  - Nur Consult-HTTP-Pfade zusätzlich im Kern: `await_call_event`, `event="done"`,
    `answer_consult`, `status="working"`; Gesamttext zusätzlich "never invent an
    answer".
  - Nicht-Consult-Pfade (inkl. stdio mit Consult-Env): `await_call_event` fehlt im
    Gesamttext ganz — eigener grüner Testfall je Pfad.
  - **Positiv-Kontrolle:** derselbe Prüfer auf den Text OHNE Kern-Vorspann (ab
    `BASE_DETAILS_START`) liefert nachweislich Befunde (`assert.notDeepEqual(...,
    [])`) — 6 grüne Fälle, das entwertet nicht die "alles grün"-Aussage oben.
- **node-Messung aus der Spec, im Worktree gemessen:**
  `MCP_BASE_INSTRUCTIONS.indexOf("Hermes card") < 512` → `true`,
  `MCP_CONSULT_INSTRUCTIONS.indexOf("working") < 512` → `true`. Länge Basis 1690,
  Consult 2788 Zeichen (davor: Basis 1311/1373-Punkt "Hermes card" bei 516, hinter 512).
- **Bestandspins bleiben grün:** gezielter Lauf von
  `test/openai-p4-ergebnisstruktur-instructions.test.js`,
  `test/openai-t2-13-bestaetigung.test.js`, `test/openai-t2-16-place-call-texte.test.js`,
  `test/gq-b1-briefing-openness.test.js`, `test/openai-policy-abgleich-doku.test.js`,
  `test/openai-p10a-tool-inventar.test.js`, `test/mcp-fehlergrund-rueckweg.test.js`,
  `test/mcp-draht-pfade.js` zusammen: `pass 96, fail 0` (Log
  `logs-t2-17/t2-17-pins.log`). Darunter namentlich die im Plan-Pre-Mortem genannten
  Risikopins (T16-a/b/c/d/f/g zum "not-placed"/Erfindungsverbot/Zweckbindung).
- **ESLint auf allen drei geänderten Code-/Testdateien: 0 Befunde**
  (`npx eslint src/mcp-server-info.js test/mcp-draht-pfade.js
  test/openai-t2-17-instructions-kern.test.js`, Exit 0). `eslint-legacy-exceptions.json`
  unangetastet.
- **Doku nachgezogen ohne interne Kennungen:** `docs/OPENAI-TOOL-INVENTORY.md:395-401`
  (neuer Absatz nach der "Purpose rule"-Passage, nennt Kern-Inhalt in Fließtext, keine
  T2-/T-/GQ-Kennung — geprüft per Diff-Lesen). `PLAN-SECURITY.md` und
  `scripts/briefing-bench/README.md` enthalten die Kennung `T2-17`/`T-21` — beide sind
  interne Repo-Docs, nicht Teil der OpenAI-Auslieferung, daher zulässig laut Spec.

## 3. Pfade

Betroffen: HTTP Legacy (mit/ohne Consult), HTTP OAuth (mit Mandant mit/ohne Consult,
ohne Mandant), stdio (mit/ohne Consult-Env — Consult ist dort strukturell aus),
zusätzlich HTTP Legacy mit Consult + `MCP_UI_ENABLED=true` und stdio +
`MCP_UI_ENABLED=true`. Alle 9 Pfade sind im neuen Test gemessen (7 aus
`MCP_WIRE_PATHS` + 2 UI-an) und dort einzeln grün. Instructions hängen laut Code nicht
von `uiEnabled` ab; die zwei UI-an-Pfade belegen das am Draht statt nur am Code zu
glauben (isoliert im neuen Test bestätigt, nicht separat für diesen Bericht
nachgemessen — die 34/34-grün-Zahl schließt sie ein).

Punkt "Kern in 512 Zeichen" ist auf ALLEN 9 gemessenen Pfaden erfüllt (Test grün, kein
Fail). Der Consult-Teilkern (`await_call_event`/`answer_consult`/`working`) gilt naturgemäß
nur auf den HTTP-Consult-Pfaden — auf stdio und Nicht-Consult-Pfaden ist er per Design
nicht vorhanden und wird dort auch nicht verlangt (Test prüft das Gegenteil: Abwesenheit).

## 4. Was ein fremder Prüfer nachmessen sollte

- Ist der neue Test isoliert grün? `cd <worktree> && NODE_ENV=test node --test
  test/openai-t2-17-instructions-kern.test.js` — welche Zahl bei `pass`/`fail`?
- Stimmt die 512-Zeichen-Behauptung an der Quelle, nicht am Test? `node
  --input-type=module -e 'const m=await import("./src/mcp-server-info.js");
  console.log(m.MCP_BASE_INSTRUCTIONS.slice(0,520))'` — steht dort wirklich die volle
  Bestätigungs-Sequenz plus Zweckausschlüsse plus "not-placed"/retry, und endet kein
  Satz mitten im Wort vor Zeichen 512?
- Bleibt `BASE_DETAILS` (der alte Bestandstext) wirklich byte-identisch? `git diff
  master...HEAD -- src/mcp-server-info.js` gezielt auf den Abschnitt ab
  `const BASE_DETAILS =` lesen — wurde dort irgendein Wort verändert, nicht nur
  verschoben?
- Ist die Plan-Abweichung (Abschnitt 1 oben) tatsächlich vom Lead vorentschieden, oder
  eine eigene Auslegung des Bauers? `tasks/openai-t2/T2-17-spec.md`, Abschnitt
  "Zwingende Randbedingungen für den Wortlaut" gegen `tasks/PLAN-OPENAI-TECHNIK-2.md`
  Zeile 1019-1021 gegenlesen.
- Bleiben die Bestandspins wirklich unberührt? Gezielt
  `test/openai-p4-ergebnisstruktur-instructions.test.js`,
  `test/openai-t2-16-place-call-texte.test.js`, `test/gq-b1-briefing-openness.test.js`
  isoliert laufen lassen — welche Zahl bei `fail`?
- Enthält `docs/OPENAI-TOOL-INVENTORY.md` (die an OpenAI ausgelieferte Doku) irgendeine
  interne Kennung (T2-, T-21, GQ-, O-)? `grep -nE "T2-|T-21|GQ-|O-[0-9]" docs/OPENAI-TOOL-INVENTORY.md`
  auf den NEUEN Absatz angewendet — leer?
- Läuft die volle Suite nach diesen Änderungen tatsächlich grün, oder war das ein
  Flake-Artefakt? Eigener Lauf: `npm test -- -- --test-concurrency=4` im Worktree,
  Summenzeile lesen.

## 5. Owner-Punkte und Restrisiko

- **Deploy/Push erst nach dem einen `briefing-bench`-Lauf** (alt `66d95ae` gegen
  Endstand INKLUSIVE T2-17, 5 Läufe/Szenario, Modell claude-sonnet-5): Anleitung in
  `scripts/briefing-bench/README.md`, Abschnitt "Deploy-Vorbedingung". Im Worktree
  dieser Phase erneut versucht (Schlüssel nur als Env-Var, keine `.env`-Kopie) —
  scheitert wortgetreu identisch wie bei T2-16 am Anbieterguthaben: "Anbieterfehler 400:
  Your credit balance is too low to access the Anthropic API. Please go to Plans &
  Billing to upgrade or purchase credits." Erst nach Guthaben-Aufladung UND Merge kann
  der eine echte Lauf nachgeholt werden. Erwartet danach: `vergleich` liefert
  `erfuellt: true`.
- **Live-Probe nach Deploy** (ChatGPT Developer Mode und Claude, Connector neu
  verbinden): Modell soll erst `prepare_call` rufen, die Hermes-Karte zeigen,
  `place_call` nicht selbst rufen, nicht nach einem Code fragen; im Consult-Fall nach
  der Kartenmeldung `await_call_event` rufen und eine Rückfrage sofort mit
  `status="working"` quittieren. Kein Test hier deckt Modellverhalten am echten Host ab
  — reine Owner-Probe.
- **Restrisiko:** Die strukturelle Garantie (Draht-Test: die richtigen Wörter stehen in
  den ersten 512 Zeichen) ist stark, aber sie beweist nicht, dass ein reales Host-Modell
  bei Abschneiden nach 512 Zeichen tatsächlich robuster handelt — das kann nur der
  echte `briefing-bench`-Lauf zeigen, und der ist blockiert (Guthaben). Zusätzlich bleibt
  die Plan/Code-Diskrepanz zu `confirmation_code` als offener Doku-Punkt stehen (kein
  Verhaltensrisiko, aber ein Lesbarkeits-/Nachvollziehbarkeitsrisiko für künftige Prüfer,
  die nur den Plan lesen).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: dbefb53; Tests (volle Suite, pass/fail): 6619/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-21 | ja | initialize am Draht (7 Pfade + UI an; HTTP Legacy/OAuth/ohne Mandant, stdio): erste 512 Zeichen = prepare_call/Karte, ggf. await_call_event, Zweckbindung, not-placed. src/mcp-server-info.js:130-157; T2-17-Test 34/34 | Keine fuer T-21. Nebenbefund: die Sequenz steht nach dem Kern ein zweites Mal im vollen Text, und ein Satz (Zweckregel) ist auch Teil der prepare_call-Beschreibung. Tool-Beschreibungen werden nicht pauschal wiederholt.
- Isoliert rot: []
- Offene Blocker:
  - cleancode/wichtig tasks/PLAN-OPENAI-TECHNIK-2.md:1013-1015 vs. src/mcp-server-info.js:141-165: Das Abnahmekriterium in der Plan-Sektion T2-17 verlangt woertlich `confirmation_code` sowie `await_call_event`/`done` 'in jedem Modus (Consult an/aus, ...)' in den ersten 512 Zeichen. Der ausgelieferte Kern enthaelt `confirmation_code` (mit Unterstrich) an keiner Stelle (auch nicht im Gesamttext, das galt schon vor dieser Phase) und laesst await_call_event/done im Nicht-Consult-Kern bewusst weg, weil das Werkzeug dort nicht registriert ist.
