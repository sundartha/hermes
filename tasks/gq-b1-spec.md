# GQ-B1 — Spec (bindend): `place_call`-Briefing, Rueckfragekanal und Tempo

Status: bindend. Wer das umsetzt, braucht kein anderes Dokument. Entscheidungsgrundlage steht in
`tasks/gq-strategie-2026-08-19.md`; die Entwuerfe sind ueberholt.

Diese Phase aendert **ausschliesslich Text, den ein Client-Modell liest** — vier
Feldbeschreibungen in `src/mcp-tools.js` und einen Satz in `src/mcp-server-info.js`. Kein
Laufzeitpfad, keine Gate-Logik, keine neue API-Flaeche, kein Schema-Feld.

Sprache: die Beschreibungen sind einsprachig ENGLISCH (Systemgrenze O14, Kopf von
`src/mcp-tools.js`) — sie liest das Modell, nie der Tenant. Code-Kommentare deutsch OHNE Umlaute.

---

## 1. Was heute falsch ist

Im Testanruf `call_mt0ddduxuzgl` waren beide In-Call-Werkzeuge freigegeben, und trotzdem blieben
`consults` und `lookup_log` LEER. Der Grund steht im Briefing, das der auftraggebende Claude
geschrieben hat:

> "... Details zu Platz/Ort kenne ich nicht – falls danach gefragt wird, sagen, dass Antonio sich
> dazu noch direkt meldet."

Zwei Wirkungen, beide belegt am Code:

1. **Die Vertroestung schaltet den Rueckfragekanal ab.** Das Briefing reist als erste Zeile des
   `{{background}}`-Blocks in den Agenten-Prompt (`src/elevenlabs/outbound.js`, `backgroundText`,
   Zeilen 547-559), und derselbe Prompt sagt woertlich: *"DO NOT CALL IT FOR: anything already
   written in your task, background, constraints or mandate"*. Jede Zeile, die eine Wissensluecke
   im Voraus beantwortet, ist damit die Abschaltung von `get_consult` fuer genau diese Luecke.
2. **Die Vertroestung verstoesst gegen den Prompt.** Er sagt: *"NEVER offer {{owner_name}} as
   another way to get that answer. Do not tell the other party to contact them, to call back
   later, or to bring the missing detail along at the appointment."* Das Briefing hat den Prompt
   ueberstimmt, weil es konkreter und auftragsspezifisch ist.

Die `briefing`-Feldbeschreibung erwaehnt den Rueckfragekanal mit KEINEM Wort. Und fuer
Unbekanntes kennen die Beschreibungen nur EINEN Ausgang — die Vorab-Rueckfrage im Chat ("ask the
user FIRST", zweimal: `objective` und `mandate.decide_freely`). "Offen lassen" ist nirgends
benannt; jede Unklarheit kostet also entweder eine Chat-Runde oder eine erfundene Zeile im
Briefing.

**Belegstellen (gelesen, nicht vermutet):**

| Ort | Was dort steht |
|---|---|
| `src/mcp-tools.js:578-582` | `objective` mit "if the topic or preference is still unknown, ask the user FIRST" |
| `src/mcp-tools.js:583-588` | `briefing` — kein Wort zum Rueckfragekanal |
| `src/mcp-tools.js:599-606` | `mandate.decide_freely` — zweite "Ask the user FIRST"-Anweisung |
| `src/mcp-tools.js:440-452` | `PLACE_CALL_DESCRIPTION` + der nur bei aktivem Kanal angehaengte `PLACE_CALL_CONSULT_LOOP` |
| `src/mcp-server-info.js:75-82` | `MCP_CONSULT_INSTRUCTIONS`, gesetzt in `routes/mcp.js` ueber `mcpServerOptions` |
| `src/consult/gate.js:19-25` | `consultAllowedFor` = `CONSULT_ENABLED` x `ASSISTANT_CONTEXT_ENABLED` x `profile.allowConsult`, fail-closed |
| `src/consult/in-call.js:48` | `MAX_IN_CALL_CONSULTS_PER_CALL = 1` |
| `src/consult/in-call.js:97`, `src/routes/webhooks-elevenlabs.js:271` | die Rueckfrage IM Gespraech braucht ZUSAETZLICH `IN_CALL_CONSULT_ENABLED` |
| `src/routes/api-calls.js:145-151`, `:281`, `:290-291` | `emitOpeningConsult` feuert unmittelbar vor `originateElevenLabsCall` |
| `src/elevenlabs/outbound.js:742-762` | `dynamicVariables` samt `background` wird genau EINMAL beim Waehlen gebaut |

---

## 2. Die zwei Entwurfsprinzipien, die alle Formulierungen binden

1. **Kanalabhaengige Zusagen stehen nur am kanalabhaengigen Text — und sie sind so formuliert,
   dass sie unter JEDER Flag-Kombination wahr bleiben.** Das VERBOT ("keine Vertroestung
   schreiben") gilt immer und gehoert deshalb ins `briefing`, das immer registriert ist. Der
   Hinweis auf die Live-Rueckfrage gehoert in `PLACE_CALL_CONSULT_LOOP`, der nur bei
   `consultAllowedFor` angehaengt wird. **Wichtig:** `consultAllowedFor` deckt die
   Rueckfrage IM Gespraech nicht vollstaendig ab — die braucht zusaetzlich
   `IN_CALL_CONSULT_ENABLED`. Der Loop-Satz ist deshalb KONDITIONAL zu formulieren ("if the agent
   runs into ..."), nie als Versprechen ("the agent can ask you back"). Eine unbedingte Zusage
   waere bei `IN_CALL_CONSULT_ENABLED=false` genau die Luege, die der Kommentar an
   `PLACE_CALL_CONSULT_LOOP` bereits verbietet.
2. **Praezision schlaegt Laenge.** Jede Beschreibung kostet bei JEDEM Turn des Client-Modells
   Token. Gemessene Ausgangslage: 5283 Zeichen ueber alle `place_call*`-Pfade ohne Kanal, 5513 mit
   Kanal. Die Aenderungen unten addieren 384 (ohne Kanal) bzw. 556 (mit Kanal). Bezahlt wird das
   mit dem Wegfall mindestens einer Chat-Runde je Anruf.

---

## 3. Spezifikation — die verbindlichen Wortlaute

Alle vier Texte sind **byte-genau** so zu setzen. Alles nicht Genannte bleibt byte-identisch.

### 3.1 `src/mcp-tools.js` — `briefing` (heute Zeile 583-588)

**Nachher** (ein neuer Satz, eingefuegt NACH dem Secrets-Satz und VOR dem Assistenten-Satz; die
Position entscheidet ueber die Marker-Reihenfolge):

> Relevant context from the chat so far that the agent needs for the call: what it is about, the names involved, likes/preferences, history as well as the desired outcome and tone. SUMMARISE instead of copying in raw - only what counts for the conversation. NO secrets, passwords or payment data. Write only what you KNOW: never script an answer for a detail you are missing, and never write that the principal will get back to the other party - the agent is not allowed to say that, so such a line removes an answer instead of adding one. Leave the gap open. The agent speaks as the personal AI assistant of the principal (not as Claude/Gemini); phrase the context from their perspective.

Neuer Code-Kommentar ueber dem Feld (deutsch, ohne Umlaute), sinngemaess: *Das Briefing reist als
erste Zeile des HINTERGRUND-Blocks in den Agenten-Prompt (elevenlabs/outbound.js backgroundText).
Der Agenten-Prompt verbietet die Rueckfrage fuer alles, was dort schon steht - eine
vorweggenommene Antwort schaltet damit den Rueckfragekanal fuer genau diese Luecke ab (Befund B,
tasks/gq-transkript-befunde-2026-08-19.md). Deshalb steht das VERBOT hier (es gilt immer, auch
bei ausgeschaltetem Kanal), der Hinweis auf die Live-Rueckfrage dagegen am kanalabhaengigen
PLACE_CALL_CONSULT_LOOP.*

Marker-Inventur nachher: `["SUMMARISE", "NO", "KNOW"]`.

### 3.2 `src/mcp-tools.js` — `objective` (heute Zeile 578-582)

**Nachher** (nur die eine Passage aendert sich, davor und danach byte-identisch):

> ... ALWAYS name a concrete topic/occasion when it is known; if the topic itself is still unknown, ask the user FIRST, instead of sending off a vague task - a single missing detail is not a reason to ask, it belongs in the briefing or stays open. Background and details do NOT belong here, they belong in the briefing.

Zwei bewusste Aenderungen:

- `"the topic or preference"` -> `"the topic itself"`: die Vorab-Rueckfrage bleibt fuer den einen
  Fall, der sie zwingend braucht — dieser Satz wird woertlich vorgesprochen, ohne Thema gibt es
  keinen sprechbaren ersten Satz. Eine fehlende *Praeferenz* traegt dagegen das Mandat oder die
  Live-Rueckfrage.
- Der neue Nebensatz benennt den bisher fehlenden dritten Ausgang ("stays open"). Er ist
  **durchgehend klein geschrieben** — jedes versehentliche Grossbuchstaben-Wort mit zwei oder mehr
  Buchstaben verschiebt die Marker-Inventur und macht `test/p15-mcp-tool-descriptions-en.test.js`
  rot.

Marker-Inventur nachher: `["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"]` —
**unveraendert**. Die Testerwartung fuer diesen Pfad wird NICHT angefasst.

### 3.3 `src/mcp-tools.js` — `mandate.decide_freely` (heute Zeile 599-606)

**Vorher** (betroffener Satz): "Ask the user FIRST about their frame, instead of inventing one."

**Nachher:**

> Never invent one: take the frame from what the user has already said, otherwise leave the field out.

Rest der Beschreibung byte-identisch. Begruendung: die Erfindungs-Sperre ist die
sicherheitsrelevante Haelfte und bleibt; der Ausgang dreht von "Chat-Runde" auf "Feld weglassen",
was fail-closed ist — ohne Feld darf der Agent nichts zusagen, und genau das sagt der naechste
Satz derselben Beschreibung bereits. Die bedingte Aufforderung im ELTERN-Feld `mandate` ("Ask the
user about their frame when an appointment or price question is to be expected in the call")
bleibt WOERTLICH stehen: sie ist an eine Bedingung geknuepft und der einzige verbleibende Weg zu
einem Mandat.

Marker-Inventur nachher: `["WITHOUT", "WITHOUT", "NOT"]` (das mittlere `FIRST` faellt weg).

### 3.4 `src/mcp-tools.js` — `PLACE_CALL_CONSULT_LOOP` (heute Zeile 446-447)

**Nachher:**

> Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event="done" - if the agent runs into a detail the briefing left open, its question reaches you only inside this loop, and it can ask at most once, so answer it straight away. Place the call with what you have: an open detail costs nothing, a guessed one cannot be taken back.

Vier bewusste Aenderungen, jede mit Grund:

1. **Konditional statt Zusage.** "if the agent runs into ..." bleibt wahr, auch wenn
   `IN_CALL_CONSULT_ENABLED=false` die In-Call-Rueckfrage abschaltet — dieser Schalter geht in
   `consultAllowedFor` (das diesen Text anhaengt) NICHT ein.
2. **"at most once"** statt "questions" im Plural: am Code belegt,
   `MAX_IN_CALL_CONSULTS_PER_CALL = 1` (`src/consult/in-call.js:48`, derselbe Riegel auf dem
   EL-Weg, `src/routes/webhooks-elevenlabs.js:269-274`).
3. **"while the phone is still ringing ... for free" faellt weg.** Der Satz beschreibt Consult #0,
   und dessen Antwort erreicht auf dem heute live laufenden EL-Weg keinen Prompt mehr
   (`api-calls.js:281` feuert unmittelbar vor `originateElevenLabsCall`, `outbound.js:742-762`
   baut `background` genau einmal). Eine Zusage ohne Deckung gehoert nicht in eine Beschreibung;
   der Sachverhalt selbst ist offener Punkt B-O2 der Strategie.
4. **Der Tempo-Satz** ersetzt die weggefallene Gratis-Zusage als Antrieb.

**Keine Grossschreib-Marker** (wie bisher). Die Inventur von `place_call` bleibt damit `["NOT"]`,
`PLACE_CALL_DESCRIPTION` bleibt unangetastet, und
`test/al-p13-consult-channel.test.js` `AL-P13-36` (`looped.startsWith(plain)`) bleibt gruen.

### 3.5 `src/mcp-server-info.js` — `MCP_CONSULT_INSTRUCTIONS` (heute Zeile 75-82)

Ein Satz wird angehaengt; der Bestandstext bleibt byte-identischer PREFIX:

> ... Staying in that loop pays off: the final "done" answer carries the summary of the call and whether the objective was achieved. The agent is on the phone while it waits, so answer within seconds - if you have to ask the user, do it in the same turn.

Begruendung: die Rueckfrage hat eine Wanduhr-Frist (`CONSULT_OPEN_MS`, `src/consult/in-call.js:38`);
eine Antwort nach einer gemuetlichen Chat-Runde kommt zu spaet. **KEINE Sekundenzahl im Text** —
der Wert liegt in der Konfiguration und wuerde im Text veralten.

---

## 4. Testplan

Alle neuen Testnamen beginnen mit `GQ-B1-`. Dieses Praefix trifft weder `config.i18nCatalogPattern`
noch `config.abnahmePattern` in `package.json` — die Faelle bleiben also im Regressionslauf
(`npm test`) und wandern nicht in `test:gates` (Lehre `catalog-id-prefix-misroutes-tests`).

### 4.1 Bestand anpassen: `test/p15-mcp-tool-descriptions-en.test.js`

In `EXPECTED_MARKERS`:

- `"place_call.briefing": ["SUMMARISE", "NO"]` -> `["SUMMARISE", "NO", "KNOW"]`, mit Kommentar:
  *GQ-B1: die Vertroestungs-Sperre. KNOW ist die Verhaltensgarantie des Feldes (nur Gewusstes ins
  Briefing) - bewusst nachgezogen statt weggeschrieben, Praezedenz max_duration_s/KS-P3.*
- `"place_call.mandate.decide_freely": ["WITHOUT", "FIRST", "WITHOUT", "NOT"]` ->
  `["WITHOUT", "WITHOUT", "NOT"]`, mit Kommentar: *GQ-B1: die Vorab-Rueckfrage ist hier gestrichen
  (sie steht bedingt im Eltern-Feld); die Erfindungs-Sperre bleibt, sie traegt keinen Marker.*
- `"place_call.objective"` bleibt UNVERAENDERT. Wird dieser Fall rot, ist der neue Nebensatz
  falsch gross geschrieben — dann den Text korrigieren, nicht die Erwartung.

Unveraendert gruen bleiben muessen:
`O14: die Negativ-Beispiele der Qualitaets-Kette stehen woertlich in der EN-Fassung`
(`ask the user FIRST` steht weiterhin in `objective`, `Hard prohibitions do NOT belong here`
weiterhin in `decide_freely`),
`O14: keine der MCP-Tool-/Feld-Beschreibungen enthaelt noch deutschen Text` (die neuen Texte sind
englisch und enthalten keines der Stopwoerter aus `GERMAN_STOPWORDS`), und
`O14/AL-P13: die Emphase der Consult-Werkzeuge ist nach Anzahl UND Reihenfolge gepinnt`
(der Loop-Text traegt keine Marker).

### 4.2 Bestand ergaenzen: `test/place-call-context-bridge.test.js`

- `P1-01: place_call-briefing-Beschreibung verlangt zusammengefassten Kontext ohne Secrets in der
  Assistenten-Rolle` — zwei Zusicherungen dazu:
  `assert.match(briefing, /never write that the principal will get back/i)` und
  `assert.match(briefing, /Leave the gap open/i)`.
- `I9-01: place_call-objective-Beschreibung verlangt Ich-Satz + konkretes Thema + warnt vor
  woertlichem Vorsprechen` — eine Zusicherung dazu:
  `assert.match(objective, /topic itself/i, "die Vorab-Rueckfrage gilt nur noch dem Thema selbst")`.
  Die bestehende Zeile `/ask the user FIRST/i` bleibt.
- `P1-02` (Feldmenge + Optionalitaet) bleibt unveraendert gruen — es kommt kein Feld dazu.

### 4.3 Neue Datei `test/gq-b1-briefing-openness.test.js`

**Harness:** derselbe `fakeServer` wie in `test/p15-mcp-tool-descriptions-en.test.js` (beide
Registrierungswege einsammeln: `server.tool` positionsbasiert und `server.registerTool` per
config). KEIN Server-Spawn. Weil ein Fall die Konstante `MAX_IN_CALL_CONSULTS_PER_CALL` aus
`src/consult/in-call.js` liest und dieses Modul die Store-Fassade importiert, wird
`process.env.DATA_DIR` in `before()` auf ein Temp-Verzeichnis gesetzt
(`tempDataDir(seedState({}))` aus `test/helpers.js`), BEVOR dynamisch importiert wird — dasselbe
Muster wie `test/elevenlabs-consult-webhook-blockers.test.js`. Ohne diese Bindung haengt der
JSON-Store an `data/store.json` des Arbeitsverzeichnisses.

1. **`GQ-B1-01: die briefing-Beschreibung verbietet die Vertroestung und verlangt die offene Luecke`**
   - `briefing` matcht `/never script an answer/i`, `/get back to the other party/i` und
     `/Leave the gap open/i`;
   - `assert.doesNotMatch(briefing, /await_call_event/)` und
     `assert.doesNotMatch(briefing, /get_consult/)` — das Feld ist IMMER registriert und darf kein
     Werkzeug versprechen, das fehlen kann.

2. **`GQ-B1-02: der Hinweis auf die Live-Rueckfrage steht NUR bei aktivem Kanal`**
   - ohne `consultAllowed`: die `place_call`-Beschreibung matcht NICHT `/inside this loop/i`;
   - mit `{ consultAllowed: true }`: sie matcht `/its question reaches you only inside this loop/i`
     und `/at most once/i`;
   - zusaetzlich: `assert.doesNotMatch(looped, /while the phone is still ringing/i)` — die
     ungedeckte Klingelzeit-Zusage darf nicht zurueckwandern (B-O2).

3. **`GQ-B1-03: die Vorab-Rueckfrage steht an GENAU EINER Stelle des place_call-Schemas`**
   - Ueber alle Beschreibungs-Pfade, die mit `place_call` beginnen, kommt `ask the user FIRST`
     (gross-/kleinschreibungs-genau) genau EINMAL vor, und zwar in `place_call.objective`.
     Regressionsfang gegen das Wiedereinwandern der zweiten Vorab-Rueckfrage. Die
     Praefix-Einschraenkung ist Absicht: `answer_consult` traegt denselben Wortlaut bewusst weiter
     — anderer Pfad, anderer Zeitpunkt (IM Gespraech, dort ist die Rueckfrage richtig).

4. **`GQ-B1-04: die place_call-Beschreibungen bleiben unter dem Zeichen-Deckel`**
   - Zwei benannte Konstanten im Test:
     `PLACE_CALL_BUDGET_CHARS = 5800` (Summe aller `place_call*`-Beschreibungen OHNE Kanal;
     gemessen vorher 5283, nachher 5667) und
     `PLACE_CALL_WITH_CONSULT_BUDGET_CHARS = 6200` (MIT Kanal; gemessen vorher 5513, nachher 6069).
   - Kommentar an den Konstanten: *Jede Beschreibung kostet bei JEDEM Turn des Client-Modells
     Token. Der Deckel ist kein Stil-Test: er zwingt die naechste Phase, Zuwachs zu begruenden
     statt anzuhaengen. Anheben nur mit benanntem Grund. Die Luft ist bewusst knapp bemessen, aber
     nicht so knapp, dass eine Wortwahl-Korrektur ihn reisst.*

5. **`GQ-B1-05: die Server-Instructions nennen die Frist, ohne eine Sekundenzahl zu nennen`**
   - `MCP_CONSULT_INSTRUCTIONS` matcht `/answer within seconds/i`;
   - `assert.doesNotMatch(text, /\d+\s*(s|sec|seconds)\b/i)` — der Konfigurationswert
     (`CONSULT_OPEN_MS`) darf nicht in den Text wandern;
   - `assert.ok(text.startsWith('While a call placed with place_call is running'))` und
     `assert.match(text, /Staying in that loop pays off/)` — der Bestandstext bleibt Prefix, der
     neue Satz haengt hinten an und schreibt die Schleifen-Anweisung nicht um.

6. **`GQ-B1-06: die Zahl im Loop-Text stammt aus der Zahl im Code`**
   - `assert.equal(MAX_IN_CALL_CONSULTS_PER_CALL, 1)` mit Kommentar: *Wird der Kosten-Riegel je auf
     2 gehoben, ist "at most once" im Loop-Text eine Falschaussage - dieser Fall ist der Draht
     zwischen beiden.*
   - dazu `assert.match(loopText, /at most once/i)`.

### 4.4 Pflichtlauf

```
node --check src/mcp-tools.js
node --check src/mcp-server-info.js
LLM_PROVIDER=anthropic npm test
```

**Vorbedingung, nicht verhandelbar:** `npm test` OHNE `LLM_PROVIDER=anthropic` ist auf diesem
Rechner rot, weil `.env` `LLM_PROVIDER=deepseek` traegt und 42 Testdateien nur
`ANTHROPIC_BASE_URL` binden. Das ist ein Bestandsdefekt und **wird in dieser Phase NICHT behoben**
(Regel 6). Gemessene Basis vor der Aenderung: 4888 Tests, 4887 gruen, ein bekannter Spawn-Flake rot
(`Gate 11 Budget: erschoepftes Tenant-Budget blockt auch mit Flag an (402)`,
`test/telnyx-p5-gate-proof.test.js`). Nachher muss dieselbe Bilanz stehen — plus die neuen Faelle.

`npm run test:gates` bleibt unveraendert: keine der Aenderungen traegt eine Katalog-ID.

---

## 5. Leitplanken (Verletzung = Abbruch)

1. **Keine Gate-Logik.** `src/consult/gate.js`, `src/consult/in-call.js`,
   `src/routes/webhooks-elevenlabs.js`, `src/telephony/outbound-gates.js`,
   `MAX_IN_CALL_CONSULTS_PER_CALL`, `CONSULT_WAIT_MS`/`CONSULT_OPEN_MS` bleiben unberuehrt. Der
   Test aus 4.3.6 LIEST die Konstante, er aendert sie nicht.
2. **Keine neuen Endpunkte, kein neues Schema-Feld**, keine Aenderung an Feldmenge oder
   Optionalitaet von `place_call` (`test/place-call-context-bridge.test.js` `P1-02` muss
   unveraendert gruen bleiben).
3. **Keine Aenderung an** `elevenlabs/agent_configs/outbound-agent.template.json` — das ist
   Anrufverhalten und braucht Testanrufe.
4. **Keine Lokalisierung.** Die Beschreibungen bleiben einsprachig englisch (O14).
   `loc.mcp.consultPermissionHint` (tenant-sichtbar, drei Sprachen) bleibt unveraendert.
5. **Kein Anfassen von:** `answer_consult` ("if you do not know, ask the user FIRST" gilt IM
   Gespraech und ist richtig), `place_call.to`, `constraints`, `context.*` (inklusive
   `open_questions`), `max_duration_s`, `diagnostic`, `mandate` (Eltern-Beschreibung),
   `mandate.fallback_order`, `mandate.on_out_of_scope`, `PLACE_CALL_DESCRIPTION`,
   `CANCEL_CALL_DESCRIPTION`.
6. **Kein Werben fuer `context.open_questions`.** Kein neuer Text darf dieses Feld als
   "offen lassen"-Kanal empfehlen — auf der live laufenden Engine erreicht eine waehrend der
   Klingelzeit eintreffende Antwort keinen Prompt mehr (B-O2 der Strategie). Die bestehende
   Beschreibung des Feldes bleibt trotzdem unveraendert: ihre Korrektur braucht eine eigene
   Entscheidung.
7. **Keine Aenderung an der Offenlegung, den Kosten-/Sicherheits-Gates oder irgendeinem
   Laufzeitpfad.** Diese Phase fasst genau zwei Dateien an.

---

## 6. Reihenfolge fuer den Implementierer

1. `src/mcp-tools.js`: `briefing` (3.1), `objective` (3.2), `mandate.decide_freely` (3.3),
   `PLACE_CALL_CONSULT_LOOP` (3.4)
2. `src/mcp-server-info.js` (3.5)
3. `test/p15-mcp-tool-descriptions-en.test.js` (4.1), `test/place-call-context-bridge.test.js` (4.2)
4. neue Datei `test/gq-b1-briefing-openness.test.js` (4.3)
5. Pflichtlauf (4.4)

Kein Push, kein Anbieter-Schritt: die Feldbeschreibungen reisen mit dem Server.

---

## 7. Offene Punkte dieser Phase (nicht bauen, nur wissen)

1. **B-O1 Wirkungsbeleg.** Ob der auftraggebende Claude die Vertroestung nun laesst UND der Agent
   daraufhin `get_consult` zieht, zeigt nur ein Anruf mit demselben Szenario: ein Auftrag mit genau
   einem Detail, das der Auftraggeber nicht kennt (Vorlage: der Tennis-Anruf, "Platz/Ort
   unbekannt"). Forensik danach: ist `consults` am Call-Datensatz NICHT mehr leer, und enthaelt das
   Transkript keine "der-Auftraggeber-meldet-sich"-Zeile? Ohne diesen Anruf ist die Phase statisch
   belegt, aber nicht wirksam belegt.
2. **B-O2 Consult #0 ist auf dem EL-Weg vermutlich wirkungslos — und die Beschreibung von
   `context.open_questions` verspricht das Gegenteil** ("They are asked while the phone is ringing,
   so the agent starts the conversation with the answers"). Am Code nachvollzogen, NICHT am
   Anbieter gemessen. Eigene Kette.
3. **B-O3 `consult_available` und der Webhook-Riegel messen nicht dasselbe.** Der Vorlagen-Wert
   kommt aus `consultAllowedFor` (drei Faktoren, `src/elevenlabs/outbound.js:1241`), der Webhook
   verlangt einen vierten (`IN_CALL_CONSULT_ENABLED`). Latent, nicht aktiv; der Fix waere
   fail-closed, ist aber Anrufverhalten und braucht eine eigene Phase.
4. **B-O4 Reicht EINE Rueckfrage je Anruf?** Owner-Entscheidung (Geld gegen Gespraechsqualitaet),
   braucht Messdaten aus mehreren Anrufen.
5. **B-O5 Tempo-Messung.** Ob die zwei entschaerften "Ask the user FIRST"-Stellen die Zahl der
   Chat-Runden senken — und ob die Auftraege dabei konkret bleiben —, laesst sich nur ueber mehrere
   echte Auftraege beobachten.
6. **B-O6 Agenten-Prompt-Seite.** Ein Briefing mit legitimer Teilantwort ("Platz steht noch nicht
   fest") koennte der Agent als "steht schon im Hintergrund" lesen und wieder nicht rueckfragen.
   Korrektur laege in der Vorlage.
7. **Reihenfolge.** Owner-Ziel: Track E zuerst, dann Track B. Diese Phase beruehrt keine Datei aus
   Track E (`call-locale.js`, `locales.js`, `opening-line*.js`, Agenten-Vorlage) — beide Ketten
   koennen unabhaengig gemergt werden, solange beide den Regressionslauf gruen halten.
