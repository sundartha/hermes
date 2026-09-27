# T2-17 - Server-instructions: Kern in die ersten 512 Zeichen (T-21)

Umfang: GENAU T-21. Basis: master `28e6fdb`, Worktree
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-17`,
Branch `phase/openai-t2-17-instructions-512-core`. Diese Spec bleibt ungetrackt im Haupt-Arbeitsbaum.

## Anforderung (Primaerquelle)

OpenAI, developers.openai.com/plugins/build/mcp-server (am 2026-09-26 gelesen): "Keep the most
important details in the first 512 characters." Die Seite sagt NICHT, ob Bytes, Tokens oder
Unicode-Zeichen gemeint sind, und nicht, ob danach abgeschnitten wird. Folgerung: der Text bleibt
reines ASCII - dann sind Zeichen, UTF-8-Bytes und JS-`length` (UTF-16-Einheiten) identisch und
die Zaehlweise ist egal. Der neue Test prueft ASCII am Draht.

## Ist-Stand (gemessen im Worktree, `src/mcp-server-info.js`)

- Basis-Text (HTTP ohne Consult, stdio immer): 1311 Zeichen, ASCII. Positionen: `not-placed` 50,
  `Do NOT retry` 126, `place_call` 418, `prepare_call` 435, `Hermes card` 516 (HINTER 512),
  `confirmation code` 702, Zweckregel 1035-1311.
- Consult-Text (HTTP mit Consult): 2289 Zeichen = Basis + " " + CONSULT_BLOCK;
  `await_call_event` 1373, `done` 1450, `answer_consult` 1526, `working` 1559.
- In den ersten 512 Zeichen steht heute also nur der Geld-Satz, der Satz "Never invent facts" und
  der Anfang der Bestaetigungs-Sequenz (mitten im Satz, vor "Hermes card"). Karte,
  Nicht-selbst-waehlen, Code-nie-erfinden, Zweckbindung und der ganze Consult-Kern fehlen dort.
- `CALL_PURPOSE_RULE` allein ist 276 Zeichen und wird wortgleich in `prepare_call` geteilt
  (`src/mcp-tools.js:47` Import, `:944` Beschreibung) - Sequenz (~290) + Zweckregel (276)
  passen NICHT zusammen in 512. Reines Umordnen reicht deshalb nicht; es braucht einen
  verdichteten Kern-Vorspann.
- Instructions haengen NICHT von `uiEnabled` ab (`mcpServerOptions`, Zeile 221-226) und nicht von
  der Sprache (einsprachig Englisch, Kommentar O14, Zeile 126). stdio pinnt Consult aus
  (`src/mcp-server.js:26`). Aufrufer: `src/routes/mcp.js:232-236`, `src/mcp-server.js:27-30`.
- Baseline gezielt (9 Testdateien, s. Schritt 6): 206/206 gruen; eslint auf
  `src/mcp-server-info.js` + beiden Testdateien: 0 Befunde.

## Entwurf (Kandidat, gemessen: Basis-Kern 378, Consult-Kern 498 Zeichen)

Neu ist NUR ein verdichteter Kern-Vorspann VOR dem unveraenderten Bestandstext. Alle
Bestandssaetze bleiben byte-identisch (Geld-Satz, "Never invent facts", Sequenz-Satz,
`CALL_PURPOSE_RULE`, CONSULT_BLOCK) - so bleiben alle Bestandspins, Doku-Zitate und die
Pflichtsaetze aus dem Plan-Pre-Mortem unberuehrt.

Kern-Saetze (Kandidat; Wortlaut darf der Bauer verdichten, solange die Tests aus Schritt 3 gruen
sind und er ASCII bleibt):

- K1 Sequenz: `Before every place_call, call prepare_call first; the user confirms in the Hermes card, which then places the call - never call place_call yourself or invent a confirmation code.` (178)
- K2 nur Consult: `While a call runs, call await_call_event until event="done"; answer a consult at once: answer_consult status="working".` (119)
- K3 Zweck, aus der Tabelle gebaut: `` `Only place calls the user asks for, never ${listWithOr(CALL_PURPOSE_EXCLUSIONS.map(e => e.full), LAST_OR_FULL)}.` `` (166)
- K4 Geld: `` `Never retry a "${NOT_PLACED}" call.` `` (32)

Basis = K1 K3 K4 + " " + bisheriger Basis-Text. Consult = K1 K2 K3 K4 + " " + bisheriger
Basis-Text + " " + CONSULT_BLOCK. Gemessener Endumfang: Basis 1690, Consult 2788 Zeichen.

Zwingende Randbedingungen fuer den Wortlaut:
- K1 beginnt woertlich mit `Before every place_call, call prepare_call first`
  (Pin `CONFIRMATION_SEQUENCE_START`, `test/openai-t2-16-place-call-texte.test.js:34`, T16-d).
- K1 darf das Selbstbestaetigungs-Muster nicht treffen
  (`/\b(check|read|look at|copy|take)\b[^.;]*\bcode\b/i`, `/\breveals?\b[^.;]*\bcode\b/i`,
  `test/openai-t2-13-bestaetigung.test.js:529`, angewandt auf `MCP_BASE_INSTRUCTIONS` Z. 569).
  Keine Aufforderung, place_call selbst mit einem Code aufzurufen (T2-14-Korrektur, Kommentar
  Z. 156-162): die KARTE waehlt.
- K3 ist der ERSTE Satz mit "telemarketing" im Gesamttext (`sentenceWith` in T16-b) - er darf
  kein Durchsetzungs-Wort enthalten (`/\b(server|checked|rejected|blocked|enforced|refused)\b/i`).
  K3 kommt aus `CALL_PURPOSE_EXCLUSIONS` (eine Quelle): eine neue Kategorie laeuft automatisch
  in den Kern und laesst den 512-Test anschlagen, statt still hinter 512 zu rutschen.
- K2 ohne Sekundenzahl (GQ-B1-05: `/\d+\s*(s|sec|seconds)\b/i`).
- Basis-Kern nennt NIE `await_call_event`/`answer_consult` (nicht registriert ohne Consult;
  Pins `test/openai-p4-ergebnisstruktur-instructions.test.js:285/:324`).
- Keine Markennamen/fremde Werkzeugklassen (T16-a-Scanner).

## Schritte

1. **Kern-Bausteine in `src/mcp-server-info.js` bauen.** Neue modul-interne Konstanten fuer
   K1/K2/K3/K4 und einen internen Bauer (z. B. `instructionsCore(consultLoop)`), der die Kern-Saetze
   mit " " verbindet. Neue Deklarationen HINTER Zeile 120 (`CALL_PURPOSE_SHORT_RULE`) einfuegen,
   damit die Doku-Anker `src/mcp-server-info.js:80`, `:106-113`, `:117`
   (docs/OPENAI-POLICY-ABGLEICH.md Z. 96/155/159/161/763/1009-1011) stehen bleiben; verschieben
   sich Zeilen doch, Anker-Block UND Fliesstext dort nachziehen. Keine neuen Exporte ausser falls
   ein Test sie zwingend braucht (Tests messen am Draht, nicht an Konstanten).
   IDs: T-21. Pfade: gemeinsame Quelle fuer HTTP /mcp (Legacy+OAuth) und stdio.
   Beweis (a): Code an `src/mcp-server-info.js` (neue Konstanten + Bauer); (c)
   `node -e` Messung: `node --input-type=module -e 'const m=await import("./src/mcp-server-info.js");console.log(m.MCP_BASE_INSTRUCTIONS.indexOf("Hermes card")<512, m.MCP_CONSULT_INSTRUCTIONS.indexOf("working")<512)'` -> `true true`.

2. **Komposition umstellen.** `MCP_BASE_INSTRUCTIONS = core(false) + " " + <bisheriger Basis-Text>`;
   `MCP_CONSULT_INSTRUCTIONS = core(true) + " " + <bisheriger Basis-Text> + " " + CONSULT_BLOCK`.
   Den bisherigen Basis-Text dafuer in eine modul-interne Konstante (z. B. `BASE_DETAILS`)
   ziehen, Wortlaut byte-identisch. `mcpServerOptions` bleibt unveraendert (Signatur, Rueckgabe).
   Kommentare nachziehen: Z. 122-131 (T-21: Kern-Vorspann + Details), Z. 171-173 ("Zweckbindung
   HINTER der Bestaetigungs-Sequenz" -> jetzt: Kurzform im Kern, volle Regel in den Details,
   Sequenz bleibt vorn), Z. 210-216 ("Komposition statt Ersatz": Consult beginnt NICHT mehr mit
   dem Basis-Text; der Kern ist je Modus eigen, die Details sind komposiert), Tabellen-Kommentar
   Z. 73-79 (die Tabelle speist jetzt DREI Texte: volle Regel, Kurzfassung, Kern) - Zeilenzahl
   dort gleich halten oder Anker nachziehen.
   IDs: T-21. Pfade: HTTP Legacy/OAuth mit+ohne Consult, OAuth ohne Mandant, stdio mit+ohne
   Consult-Env, MCP_UI_ENABLED an+aus.
   Beweis (b): Schritt 3 gruen + Bestandstests Schritt 6 gruen.

3. **Neuer Test `test/openai-t2-17-instructions-kern.test.js`** (Draht, nicht Konstante).
   Pfade: alle `MCP_WIRE_PATHS` aus `test/mcp-draht-pfade.js` (7 Pfade) PLUS mindestens zwei mit
   `MCP_UI_ENABLED: "true"` (HTTP Legacy mit Consult, stdio) - BASE_ENV setzt
   `MCP_UI_ENABLED=false` (`test/helpers.js:390`), die sieben Pfade messen also nur UI aus. Den
   Harness dafuer erweitern (z. B. exportierte Snapshot-Fabrik mit env) statt Code zu kopieren.
   Je Pfad:
   - Gesamttext ASCII-only (`/^[\x00-\x7f]*$/`) - begruendet die Zaehlweise.
   - `head = instructions.slice(0, 512)`; `core = head.slice(0, head.lastIndexOf(".") + 1)` -
     nur VOLLSTAENDIGE Saetze bis 512 zaehlen, damit ein Merkmal in einem abgeschnittenen Satz
     nicht als "vorhanden" durchgeht.
   - In `core`: beginnt mit `Before every place_call, call prepare_call first`; `/Hermes card/`;
     `/places the call/`; `/never call place_call yourself/`; `/invent a confirmation code/`;
     `/user asks for/`; JEDES `CALL_PURPOSE_EXCLUSIONS[i].full`; `` `"${NOT_PLACED}"` `` und
     `/retry/i`.
   - Consult-Pfade (Label enthaelt "mit Consult" UND HTTP): zusaetzlich in `core`
     `await_call_event`, `event="done"`, `answer_consult`, `status="working"`. Nicht-Consult-Pfade
     (inkl. stdio mit Consult-Env, OAuth ohne Mandant): Gesamttext enthaelt `await_call_event`
     NICHT.
   - Gesamttext enthaelt weiter: `CALL_PURPOSE_RULE`, `Do NOT retry the call`, `Never invent facts`;
     Consult zusaetzlich `never invent an answer` (Plan-Pre-Mortem: Pflichtsaetze bleiben).
   - Positiv-Kontrolle: dieselbe Kern-Pruefung auf den Text OHNE Kern-Vorspann (z. B. ab dem
     ersten Vorkommen von `If a call reports a failure_reason`) liefert Befunde - sonst beweist
     "gruen" nichts.
   - Pruefung als Funktion `coreFindings(text, {consult})` -> Liste fehlender Merkmale, leer =
     erfuellt (Muster wie `forbiddenHits`).
   IDs: T-21. Beweis (b): `NODE_ENV=test node --test test/openai-t2-17-instructions-kern.test.js`
   -> `# fail 0`, und die Positiv-Kontrolle ist ein eigener gruener Fall.

4. **Doku nachziehen (ohne interne Kennungen).** `docs/OPENAI-TOOL-INVENTORY.md` Z. 375-383
   ("Purpose rule"): bleibt wahr (voller Satz steht weiter woertlich in den instructions); einen
   Satz ergaenzen, dass die Server-Instructions mit einem verdichteten Kern beginnen (erste 512
   Zeichen: Bestaetigung in der Hermes-Karte, Zweckausschluesse aus derselben Liste, kein erneuter
   Anruf bei "not-placed", im Rueckfrage-Modus die sofortige Quittung). Keine Phasen-/ID-Kennungen.
   `docs/OPENAI-POLICY-ABGLEICH.md`: nur Anker pruefen (Schritt 1); Aussagen "tragen denselben
   Satz woertlich" bleiben wahr. Beweis (b): `test/openai-policy-abgleich-doku.test.js` und
   `test/openai-p10a-tool-inventar.test.js` gruen; (c) `grep -nE "T2-|T-21|O-27|GQ-" docs/OPENAI-TOOL-INVENTORY.md`
   liefert keine neue Zeile gegenueber master.

5. **Messwerkzeug/Deploy-Vorbedingung nachziehen + echten Lauf versuchen.** Die instructions
   aendern sich -> sie sind Teil des briefing-bench-Schnappschusses (`scripts/briefing-bench/bench.mjs:32`
   liest `client.getInstructions()`, Z. 60 nutzt sie als System-Text).
   - `scripts/briefing-bench/README.md` Z. 65-80 "Rueckbau": Kern-Vorspann (`src/mcp-server-info.js`,
     Kern-Konstanten und Komposition) und den neuen Test aufnehmen. Abschnitt "Deploy-Vorbedingung"
     (Z. 53-63): klarstellen, dass `snapshot --repo .` den ENDSTAND inkl. Kern-Vorspann misst und
     der eine Lauf erst nach dem Merge dieser Phase erfolgt; dass stdio nur den Basis-Text liefert
     (Consult ist dort aus), der Consult-Kern also vom Bench NICHT gemessen wird.
   - `PLAN-SECURITY.md`: neuer kurzer Abschnitt am Dateiende "OpenAI-T2-17 - Server-Instructions:
     Kern in die ersten 512 Zeichen" (Was, Pfade, Rueckbau, Deploy-Vorbedingung): die offene
     Deploy-Vorbedingung aus T2-16 (Z. 6649-6659) gilt fuer den Endstand INKL. dieser Phase - ein
     Lauf, alt `66d95ae` gegen den Endstand. Keine Produktionswerte.
   - Echten Lauf versuchen (NACH dem Bau, im Worktree, Schnappschuesse nach README Z. 55-59;
     Schluessel nur so: `NODE_ENV=test ANTHROPIC_API_KEY="$(grep '^ANTHROPIC_API_KEY=' '/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/.env' | head -1 | cut -d= -f2-)" node scripts/briefing-bench/lauf.mjs run --modus anthropic --modell claude-sonnet-5 --laeufe 5 --tools <schnappschuss> --out <bericht>`,
     nie ausgeben, nie `.env` kopieren/laden). Scheitert er am Guthaben: Fehlermeldung
     WORTGETREU in PLAN-SECURITY.md und im Bericht belegen; Messpunkt bleibt offen.
   IDs: T-21. Beweis (c): `grep -n "T2-17\|Kern" scripts/briefing-bench/README.md PLAN-SECURITY.md`
   zeigt die Eintraege; Bench-Bericht bzw. wortgetreue Fehlermeldung.

6. **Bestandstests + Lint.** Muessen gruen bleiben (ohne Aenderung erwartet):
   `test/openai-p4-ergebnisstruktur-instructions.test.js` (Fall 3: NOT_PLACED in 512; Fall 4/5:
   Draht == Konstante, kein await_call_event im Basis-Text), `test/openai-t2-16-place-call-texte.test.js`
   (T16-a/b/d auf 7 Pfaden), `test/al-p13-consult-channel.test.js` (AL-P13-37),
   `test/mcp-fehlergrund-rueckweg.test.js` (7), `test/openai-p5b-geldpfad.test.js`,
   `test/openai-t2-13-bestaetigung.test.js`, `test/gq-b1-briefing-openness.test.js` (GQ-B1-04
   6690/7090, GQ-B1-04b 1370 - Deckel NIE anheben; mcp-tools.js wird nicht angefasst),
   `test/openai-policy-abgleich-doku.test.js`, `test/openai-t2-11-werkzeugtexte.test.js`.
   Kommentar-Kopf in `test/openai-p4-ergebnisstruktur-instructions.test.js` Z. 7-10 ggf.
   nachziehen (das Wichtigste ist jetzt der ganze Kern, nicht nur der Riegel).
   Dann `npm test -- -- --test-concurrency=4` komplett in Logdatei; nur `# pass`/`# fail` zaehlen;
   Rot erst zaehlen, wenn isoliert rot. `npx eslint` auf allen angefassten Dateien -> 0 Befunde,
   `eslint-legacy-exceptions.json` unveraendert. Danach `ps` auf verwaiste Server.
   Beweis (b)+(c): Logzeilen `# fail 0`; `git diff master --stat -- eslint-legacy-exceptions.json src/mcp-tools.js src/claude.js elevenlabs` leer.

## Nicht bauen

- `CALL_PURPOSE_RULE` / `CALL_PURPOSE_SHORT_RULE` / Tabelle `CALL_PURPOSE_EXCLUSIONS` NICHT
  aendern: geteilt mit `prepare_call`/`place_call` (Deckel 1370 bzw. 6690/7090, T16-Pins,
  Doku-Zitate); eine Aenderung waere eine Werkzeugtext-Aenderung ausserhalb von T-21.
- Keine Werkzeugbeschreibung in `src/mcp-tools.js` anfassen (T-21 betrifft nur `instructions`).
- Bestandssaetze der instructions NICHT umformulieren (Plan-Pre-Mortem: nur Reihenfolge und
  Verdichtung des Kerns); sie bleiben byte-identisch hinter dem Kern.
- `confirmation_code` bzw. "place_call mit dem Code aus der Nachricht des Nutzers" NICHT in den
  Kern (Plan-Abnahme veraltet, s. Widersprueche): das Modell sieht den Code nie, die Karte waehlt.
- `await_call_event`/`done` NICHT in den Basis-Kern (nicht registriert ohne Consult).
- Keine Sprachfassungen: instructions sind einsprachig Englisch (O14), es gibt keine Varianten.
- Kein neuer Env-Schalter (nichts, was die vier Orte braucht).
- Sprachagent, `src/claude.js`, Prompts, ElevenLabs-/Telnyx-Template, Offenlegungssatz,
  Safety-Gates: unberuehrt.
- Kein neuer Test auf Konstanten allein (Metadaten nur am Draht).

## Pre-Mortem (ein Jahr spaeter war T2-17 ein Fehler)

1. **Doppelte Anrufe/Kosten:** beim Verdichten verschwand "bei not-placed nicht erneut waehlen",
   Modelle waehlten nach Fehler dreimal. -> Bestandssatz bleibt byte-identisch hinter dem Kern,
   PLUS Kurzfassung K4 im Kern; Test prueft beides am Draht.
2. **Host schneidet bei 512 ab, Zweckbindung/Bestaetigungsfluss weg:** ein Host nutzt nur den
   Kopf. -> Test prueft auf ALLEN Pfaden nur vollstaendige Saetze bis 512 auf Karte,
   Nicht-selbst-waehlen, Code-nie-erfinden, alle vier Zweckausschluesse; Positiv-Kontrolle.
3. **Selbstbestaetigung:** eine Verdichtung wie "pass the code to place_call" liess das Modell
   einen Code erfinden oder nach ihm fragen. -> K1 sagt "the card places the call", "never call
   place_call yourself", "never ... invent a confirmation code"; T2-13-Muster-Scanner laeuft auf
   dem Basis-Text; Server-Gate (Code je Anruf, `src/call-confirmation.js`) bleibt ohnehin.
4. **Verweigerung legitimer Anrufe:** die Kurzform K3 ohne Positivliste ("for someone they act
   for") liess Modelle Angehoerigen-Anrufe ablehnen. -> K3 schraenkt nur auf "was der Nutzer
   verlangt" ein und zaehlt nur Ausschluesse auf; die volle Regel mit Positivliste bleibt im Text;
   Bench-Metrik `verweigert` (neu <= alt) im einen echten Lauf. Restrisiko akzeptiert bis zur
   Messung (Deploy-Vorbedingung).
5. **Pfad-Drift:** Kern nur in HTTP oder nur ohne UI geprueft. -> Test auf 7 Draht-Pfaden + UI an;
   instructions unabhaengig von uiEnabled per Code (`mcpServerOptions`).
6. **Stille Laengen-Drift:** spaeterer Zusatz (neue Zweckkategorie) schiebt Kernsatz hinter 512.
   -> K3 aus der Tabelle gebaut, Test schlaegt an; Kern heute 498 (Marge 14) - bewusst knapp,
   damit Wachstum sichtbar wird statt still.
7. **Zaehlweise:** Nicht-ASCII (Umlaut, Gedankenstrich) im Kern verschiebt Byte- gegen
   Zeichenzahl. -> ASCII-Assertion am Draht.
8. **Unbelegte Modellwirkung:** Kern-Text geht live ohne Messung. -> Deploy-Vorbedingung
   (ein briefing-bench-Lauf auf dem Endstand) in PLAN-SECURITY.md + README; Consult-Kern ist
   vom Bench NICHT abgedeckt (stdio ohne Consult) - als Luecke benannt.
9. **Doku-Anker brechen:** neue Zeilen vor Z. 106 verschieben Anker. -> Deklarationen hinter
   Z. 120; Doku-Test faengt jeden Rest.

## Widersprueche Plan <-> Code

- Plan-Abnahme verlangt `confirmation_code` und "place_call mit dem Code aus der Nachricht des
  Nutzers" im Kern. Seit T2-14 (Kommentar `src/mcp-server-info.js:158-162`) waehlt die KARTE
  selbst; das Modell ruft place_call fuer den bestaetigten Anruf NICHT auf und sieht den Code
  nie. Massgeblich ist der Code: Kern sagt "the card places the call ... never call place_call
  yourself ... never invent a confirmation code". `confirmation_code` (Token) steht heute
  nirgends in den instructions (gemessen: -1).
- Plan-Abnahme: `await_call_event` und `done` in den ersten 512 "HTTP Consult an/aus, stdio".
  Ohne Consult (und ueber stdio immer) ist await_call_event nicht registriert; Bestandspins
  verlangen, dass der Basis-Text es NICHT nennt (`test/openai-p4-...:285/:324`). Nur im
  Consult-Modus.
- Plan-Tabelle Z. 66: "Schleifen-Kern beginnt erst bei Zeichen 404". Gemessen heute: 1373
  (Zweckregel und Sequenz kamen seither davor).
- Plan nennt die Zweckbindung nicht als Kern-Inhalt; der Lead-Auftrag verlangt sie vollstaendig
  in 512. Die volle `CALL_PURPOSE_RULE` (276) passt nicht mit dem Rest in 512 -> Kurzform K3 aus
  derselben Tabelle mit ALLEN vier Ausschluessen.
- Plan "Deploy-Vorbedingung: keine". Die instructions sind Teil des briefing-bench-Schnappschusses;
  der Lead verlangt den Einschluss in die offene T2-16-Messung -> Vorbedingung erweitert, keine
  neue.
- Plan: "Dateien: src/mcp-server-info.js, Tests". Zusaetzlich betroffen: Doku (Inventar),
  README des Bench, PLAN-SECURITY.md, ggf. `test/mcp-draht-pfade.js` (UI-an-Pfade).

## Owner-Punkte

- Deploy/Push (Owner-Gate) erst nach dem einen briefing-bench-Lauf auf dem Endstand (inkl. T2-17),
  alt `66d95ae`; wenn das Anbieterguthaben fehlt: Guthaben aufladen, dann Lauf nach
  `scripts/briefing-bench/README.md`. Erwartet: `vergleich` -> `erfuellt: true`.
- Live-Probe in ChatGPT Developer Mode und Claude nach Deploy: Connector neu verbinden, im
  Gespraech "Ruf fuer mich beim Friseur an" -> erwartet: Modell ruft zuerst prepare_call, zeigt
  die Karte, ruft place_call NICHT selbst und fragt nicht nach einem Code; mit Consult ruft es
  nach Kartenmeldung await_call_event und quittiert eine Rueckfrage sofort mit status="working".
